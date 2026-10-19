import { describe, expect, it } from 'vitest'
import { getEventHash } from 'nostr-tools/pure'
import {
  bytesToHex,
  decryptKey,
  encryptKey,
  generateKey,
  KeyError,
  npubOf,
  nsecOf,
  parsePrivateKey,
  parsePublicKey,
  publicKeyOf,
  signWithKey,
  verifyEvent,
} from './keys'

const FAST = 8 // scrypt cost for tests only; the app default is 16

describe('key generation and encodings', () => {
  it('derives a 32-byte x-only public key and round-trips through npub/nsec', () => {
    const sk = generateKey()
    const pk = publicKeyOf(sk)
    expect(pk).toMatch(/^[0-9a-f]{64}$/)
    expect(parsePublicKey(npubOf(pk))).toBe(pk)
    expect(parsePrivateKey(nsecOf(sk))).toEqual(sk)
    expect(parsePrivateKey(bytesToHex(sk))).toEqual(sk)
  })

  it('derives the BIP-340 public key for secret key 1', () => {
    const sk = new Uint8Array(32)
    sk[31] = 1
    expect(publicKeyOf(sk)).toBe('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')
  })

  it('generates distinct keys', () => {
    expect(bytesToHex(generateKey())).not.toBe(bytesToHex(generateKey()))
  })
})

describe('private key import', () => {
  it.each([
    ['empty', ''],
    ['short hex', 'abcd'],
    ['non-hex 64 chars', 'z'.repeat(64)],
    ['an nsec with a changed character', nsecOf(generateKey()).slice(0, -1) + 'q'],
    ['an npub', npubOf(publicKeyOf(generateKey()))],
  ])('rejects %s', (_name, input) => {
    expect(() => parsePrivateKey(input)).toThrow(KeyError)
  })

  it('tells the user when they paste an encrypted key', () => {
    const enc = encryptKey(generateKey(), 'pw', FAST)
    expect(() => parsePrivateKey(enc)).toThrow(/encrypted/i)
  })

  it('ignores surrounding whitespace', () => {
    const sk = generateKey()
    expect(parsePrivateKey(`  ${nsecOf(sk)}\n`)).toEqual(sk)
  })
})

describe('NIP-49 encrypted backup', () => {
  it('round-trips with the right passphrase', () => {
    const sk = generateKey()
    const enc = encryptKey(sk, 'correct horse battery staple', FAST)
    expect(enc.startsWith('ncryptsec1')).toBe(true)
    expect(enc).not.toContain(bytesToHex(sk))
    expect(decryptKey(enc, 'correct horse battery staple')).toEqual(sk)
  })

  it('fails with a wrong passphrase', () => {
    const enc = encryptKey(generateKey(), 'right', FAST)
    expect(() => decryptKey(enc, 'wrong')).toThrowError(
      expect.objectContaining({ code: 'passphrase' }),
    )
  })

  it('fails on a damaged backup', () => {
    const enc = encryptKey(generateKey(), 'pw', FAST)
    const damaged = enc.slice(0, 40) + (enc[40] === 'q' ? 'p' : 'q') + enc.slice(41)
    expect(() => decryptKey(damaged, 'pw')).toThrow(KeyError)
  })

  it('produces different ciphertext for the same key and passphrase (random salt)', () => {
    const sk = generateKey()
    expect(encryptKey(sk, 'pw', FAST)).not.toBe(encryptKey(sk, 'pw', FAST))
  })
})

describe('event signing and verification', () => {
  const template = { kind: 1063, created_at: 1_700_000_000, tags: [['x', 'a']], content: 'hi' }

  it('signs with a valid id and BIP-340 signature', () => {
    const sk = generateKey()
    const ev = signWithKey(sk, template)
    expect(ev.pubkey).toBe(publicKeyOf(sk))
    expect(ev.id).toBe(getEventHash(ev))
    expect(ev.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(verifyEvent(ev)).toBe(true)
  })

  it('rejects an event whose content changed after signing', () => {
    const ev = signWithKey(generateKey(), template)
    expect(verifyEvent({ ...ev, content: 'tampered' })).toBe(false)
  })

  it('rejects an event with a wrong id', () => {
    const ev = signWithKey(generateKey(), template)
    expect(verifyEvent({ ...ev, id: '0'.repeat(64) })).toBe(false)
  })

  it('rejects a signature from another key', () => {
    const a = signWithKey(generateKey(), template)
    const b = signWithKey(generateKey(), template)
    expect(verifyEvent({ ...a, sig: b.sig })).toBe(false)
  })

  it('rejects a swapped public key', () => {
    const ev = signWithKey(generateKey(), template)
    expect(verifyEvent({ ...ev, pubkey: publicKeyOf(generateKey()) })).toBe(false)
  })

  it('rejects malformed fields', () => {
    const ev = signWithKey(generateKey(), template)
    expect(verifyEvent({ ...ev, tags: 'x' as unknown as string[][] })).toBe(false)
    expect(verifyEvent({ ...ev, created_at: 'now' as unknown as number })).toBe(false)
  })
})
