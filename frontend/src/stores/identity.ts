import { useSyncExternalStore } from 'react'
import {
  decryptKey,
  encryptKey,
  generateKey,
  isEncryptedKey,
  KeyError,
  npubOf,
  parsePrivateKey,
  publicKeyOf,
  signWithKey,
  type EventTemplate,
  type VerifiedEvent,
} from '../lib/nostr/keys'
import { createStore } from './createStore'

/**
 * Identity lifecycle.
 *
 *   none      no identity on this device
 *   locked    an encrypted key (NIP-49) is stored; the passphrase is needed
 *   unlocked  the key is held in memory (or an extension signs)
 *
 * The plaintext secret key never leaves this module's closure. Only the
 * encrypted form is written to localStorage.
 */
export type IdentityState =
  | { phase: 'none' }
  | { phase: 'locked'; pubkey: string; source: 'local' }
  | {
      phase: 'unlocked'
      pubkey: string
      source: 'local' | 'extension'
      /** True when the key exists only in memory and would be lost on reload. */
      ephemeral: boolean
    }

interface Stored {
  v: 1
  pubkey: string
  source: 'local' | 'extension'
  ncryptsec?: string
}

const STORAGE_KEY = 'smh.identity.v1'

interface Nip07 {
  getPublicKey(): Promise<string>
  signEvent(template: EventTemplate): Promise<VerifiedEvent>
}

function extension(): Nip07 | undefined {
  return (globalThis as { nostr?: Nip07 }).nostr
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (parsed.v !== 1 || !/^[0-9a-f]{64}$/.test(parsed.pubkey)) return null
    return parsed
  } catch {
    return null
  }
}

function write(value: Stored | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable: the identity stays in memory for this session */
  }
}

function initial(): IdentityState {
  const stored = read()
  if (!stored) return { phase: 'none' }
  if (stored.source === 'extension') {
    return { phase: 'unlocked', pubkey: stored.pubkey, source: 'extension', ephemeral: false }
  }
  if (stored.ncryptsec) return { phase: 'locked', pubkey: stored.pubkey, source: 'local' }
  return { phase: 'none' }
}

const store = createStore<IdentityState>(initial())

// The only place the plaintext key lives.
let secret: Uint8Array | null = null

function setSecret(next: Uint8Array | null) {
  secret?.fill(0)
  secret = next
}

export const identity = {
  get state() {
    return store.get()
  },
  subscribe: store.subscribe,

  /** Creates a key. Nothing is persisted until `protect` or `keepInMemory` is called. */
  create(): { npub: string; secretKey: Uint8Array } {
    const key = generateKey()
    setSecret(key)
    return { npub: npubOf(publicKeyOf(key)), secretKey: key.slice() }
  },

  /** Imports an nsec or hex key into memory. Persist it with `protect`. */
  import(text: string): string {
    const key = parsePrivateKey(text)
    setSecret(key)
    return publicKeyOf(key)
  },

  /** Encrypts the in-memory key with a passphrase and stores it on this device. */
  protect(passphrase: string, logn?: number) {
    if (!secret) throw new KeyError('format', 'No key to protect.')
    const pubkey = publicKeyOf(secret)
    write({ v: 1, pubkey, source: 'local', ncryptsec: encryptKey(secret, passphrase, logn) })
    store.set({ phase: 'unlocked', pubkey, source: 'local', ephemeral: false })
  },

  /** Uses the in-memory key for this session only. */
  keepInMemory() {
    if (!secret) throw new KeyError('format', 'No key to use.')
    store.set({ phase: 'unlocked', pubkey: publicKeyOf(secret), source: 'local', ephemeral: true })
  },

  /** Restores a key from an `ncryptsec` backup into memory. */
  restoreEncrypted(ncryptsec: string, passphrase: string): string {
    if (!isEncryptedKey(ncryptsec))
      throw new KeyError('format', 'That is not an encrypted key backup.')
    const key = decryptKey(ncryptsec.trim(), passphrase)
    setSecret(key)
    return publicKeyOf(key)
  },

  unlock(passphrase: string) {
    const stored = read()
    if (!stored?.ncryptsec)
      throw new KeyError('format', 'No encrypted key is stored on this device.')
    const key = decryptKey(stored.ncryptsec, passphrase)
    if (publicKeyOf(key) !== stored.pubkey) {
      key.fill(0)
      throw new KeyError('passphrase', 'The decrypted key does not match the stored identity.')
    }
    setSecret(key)
    store.set({ phase: 'unlocked', pubkey: stored.pubkey, source: 'local', ephemeral: false })
  },

  /** Forgets the in-memory key. The encrypted copy stays on the device. */
  lock() {
    const stored = read()
    setSecret(null)
    if (stored?.ncryptsec) store.set({ phase: 'locked', pubkey: stored.pubkey, source: 'local' })
    else store.set(stored?.source === 'extension' ? store.get() : { phase: 'none' })
  },

  async useExtension(): Promise<string> {
    const ext = extension()
    if (!ext) throw new KeyError('unsupported', 'No Nostr browser extension was found.')
    const pubkey = await ext.getPublicKey()
    setSecret(null)
    write({ v: 1, pubkey, source: 'extension' })
    store.set({ phase: 'unlocked', pubkey, source: 'extension', ephemeral: false })
    return pubkey
  },

  hasExtension: () => extension() !== undefined,

  /** Returns the `ncryptsec` stored on this device, for backup download. */
  storedBackup(): string | null {
    return read()?.ncryptsec ?? null
  },

  /** Returns a copy of the secret key for an explicit backup action. */
  revealSecret(): Uint8Array | null {
    return secret ? secret.slice() : null
  },

  /** Removes the identity from this device. */
  forget() {
    setSecret(null)
    write(null)
    store.set({ phase: 'none' })
  },

  async sign(template: EventTemplate): Promise<VerifiedEvent> {
    const state = store.get()
    if (state.phase !== 'unlocked') throw new KeyError('format', 'Unlock your identity first.')
    if (state.source === 'extension') {
      const ext = extension()
      if (!ext) throw new KeyError('unsupported', 'The Nostr extension is no longer available.')
      const signed = await ext.signEvent(template)
      if (signed.pubkey !== state.pubkey) {
        throw new KeyError(
          'format',
          'The extension signed with a different key than the one selected.',
        )
      }
      return signed
    }
    if (!secret) throw new KeyError('format', 'The key is not available. Unlock your identity.')
    return signWithKey(secret, template)
  },
}

export function useIdentity(): IdentityState {
  return useSyncExternalStore(identity.subscribe, () => store.get())
}

/** Test hook: resets module state between tests. */
export function __resetIdentityForTests() {
  setSecret(null)
  write(null)
  store.set({ phase: 'none' })
}
