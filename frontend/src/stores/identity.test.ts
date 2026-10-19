// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetIdentityForTests, identity } from './identity'
import { bytesToHex, generateKey, nsecOf, publicKeyOf, verifyEvent } from '../lib/nostr/keys'

const FAST = 8
const template = { kind: 1, created_at: 1_700_000_000, tags: [], content: 'x' }

function storedText(): string {
  return Object.keys(localStorage)
    .map((k) => `${k}=${localStorage.getItem(k)}`)
    .join('\n')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  __resetIdentityForTests()
  delete (globalThis as { nostr?: unknown }).nostr
})

describe('identity lifecycle', () => {
  it('starts empty', () => {
    expect(identity.state).toEqual({ phase: 'none' })
  })

  it('creating a key persists nothing until the user protects it', () => {
    const { secretKey } = identity.create()
    expect(storedText()).toBe('')
    expect(identity.state.phase).toBe('none')
    expect(secretKey).toHaveLength(32)
  })

  it('protect() stores only the encrypted key and unlocks the session', async () => {
    const { secretKey } = identity.create()
    identity.protect('a passphrase', FAST)

    const text = storedText()
    expect(text).toContain('ncryptsec1')
    expect(text).not.toContain(bytesToHex(secretKey))
    expect(text).not.toContain(nsecOf(secretKey))
    expect(sessionStorage.length).toBe(0)

    expect(identity.state).toMatchObject({ phase: 'unlocked', source: 'local', ephemeral: false })
    const ev = await identity.sign(template)
    expect(verifyEvent(ev)).toBe(true)
    expect(ev.pubkey).toBe(publicKeyOf(secretKey))
  })

  it('lock() forgets the key in memory and signing then fails', async () => {
    identity.create()
    identity.protect('pw', FAST)
    identity.lock()
    expect(identity.state.phase).toBe('locked')
    await expect(identity.sign(template)).rejects.toThrow(/Unlock/)
  })

  it('unlock() with the right passphrase restores signing for the same pubkey', async () => {
    const { secretKey } = identity.create()
    identity.protect('pw', FAST)
    identity.lock()
    identity.unlock('pw')
    expect(identity.state).toMatchObject({ phase: 'unlocked', pubkey: publicKeyOf(secretKey) })
    expect((await identity.sign(template)).pubkey).toBe(publicKeyOf(secretKey))
  })

  it('a wrong passphrase leaves the identity locked and does not replace it', () => {
    const { secretKey } = identity.create()
    identity.protect('right', FAST)
    identity.lock()
    expect(() => identity.unlock('wrong')).toThrowError(
      expect.objectContaining({ code: 'passphrase' }),
    )
    expect(identity.state).toMatchObject({ phase: 'locked', pubkey: publicKeyOf(secretKey) })
    expect(localStorage.getItem('smh.identity.v1')).toContain(publicKeyOf(secretKey))
  })

  it('survives a reload: a stored encrypted key comes back locked', () => {
    identity.create()
    identity.protect('pw', FAST)
    // A fresh module would call initial(); simulate by reading storage the same way.
    const stored = JSON.parse(localStorage.getItem('smh.identity.v1')!)
    expect(stored).toMatchObject({ v: 1, source: 'local' })
    expect(stored.ncryptsec).toMatch(/^ncryptsec1/)
  })

  it('keepInMemory() marks the identity as ephemeral and writes nothing', () => {
    identity.create()
    identity.keepInMemory()
    expect(identity.state).toMatchObject({ phase: 'unlocked', ephemeral: true })
    expect(storedText()).toBe('')
  })

  it('imports an nsec and a hex key to the same public key', () => {
    const sk = generateKey()
    expect(identity.import(nsecOf(sk))).toBe(publicKeyOf(sk))
    expect(identity.import(bytesToHex(sk))).toBe(publicKeyOf(sk))
  })

  it('rejects an invalid import without touching the current key', async () => {
    identity.create()
    identity.keepInMemory()
    const before = identity.state
    expect(() => identity.import('not a key')).toThrow()
    expect(identity.state).toBe(before)
    expect(verifyEvent(await identity.sign(template))).toBe(true)
  })

  it('restores from an encrypted backup', () => {
    const { secretKey } = identity.create()
    identity.protect('pw', FAST)
    const backup = identity.storedBackup()!
    identity.forget()
    expect(identity.restoreEncrypted(backup, 'pw')).toBe(publicKeyOf(secretKey))
    expect(() => identity.restoreEncrypted(backup, 'nope')).toThrow()
  })

  it('forget() removes everything from the device', () => {
    identity.create()
    identity.protect('pw', FAST)
    identity.forget()
    expect(identity.state.phase).toBe('none')
    expect(storedText()).toBe('')
  })

  it('refuses to sign when nothing is unlocked', async () => {
    await expect(identity.sign(template)).rejects.toThrow()
  })
})

describe('browser extension (NIP-07)', () => {
  it('stores only the public key', async () => {
    const sk = generateKey()
    ;(globalThis as { nostr?: unknown }).nostr = {
      getPublicKey: async () => publicKeyOf(sk),
      signEvent: async (t: typeof template) =>
        (await import('../lib/nostr/keys')).signWithKey(sk, t),
    }
    await identity.useExtension()
    expect(identity.state).toMatchObject({ phase: 'unlocked', source: 'extension' })
    expect(storedText()).not.toContain('ncryptsec')
    expect(verifyEvent(await identity.sign(template))).toBe(true)
  })

  it('rejects an extension that signs with a different key', async () => {
    const a = generateKey()
    const b = generateKey()
    ;(globalThis as { nostr?: unknown }).nostr = {
      getPublicKey: async () => publicKeyOf(a),
      signEvent: async (t: typeof template) =>
        (await import('../lib/nostr/keys')).signWithKey(b, t),
    }
    await identity.useExtension()
    await expect(identity.sign(template)).rejects.toThrow(/different key/)
  })

  it('reports a missing extension plainly', async () => {
    await expect(identity.useExtension()).rejects.toThrow(/No Nostr browser extension/)
  })
})
