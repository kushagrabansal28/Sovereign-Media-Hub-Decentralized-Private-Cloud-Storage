import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent as verifyEventCached,
} from 'nostr-tools/pure'
import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'

export type { Event, EventTemplate, VerifiedEvent }

export class KeyError extends Error {
  constructor(
    readonly code: 'format' | 'passphrase' | 'unsupported',
    message: string,
  ) {
    super(message)
    this.name = 'KeyError'
  }
}

const HEX64 = /^[0-9a-f]{64}$/i

export function generateKey(): Uint8Array {
  return generateSecretKey()
}

export function publicKeyOf(secret: Uint8Array): string {
  return getPublicKey(secret)
}

/** Parses an nsec or 64-character hex private key. */
export function parsePrivateKey(input: string): Uint8Array {
  const text = input.trim()
  if (text.startsWith('nsec1')) {
    try {
      const decoded = nip19.decode(text)
      if (decoded.type !== 'nsec') throw new Error('wrong type')
      return decoded.data
    } catch {
      throw new KeyError(
        'format',
        'That nsec is not valid. Check for a missing or changed character.',
      )
    }
  }
  if (text.startsWith('ncryptsec1')) {
    throw new KeyError(
      'unsupported',
      'That is an encrypted key. Use "Restore from encrypted backup".',
    )
  }
  if (HEX64.test(text)) return hexToBytes(text.toLowerCase())
  throw new KeyError('format', 'Expected an nsec1… key or 64 hexadecimal characters.')
}

export function npubOf(pubkey: string): string {
  return nip19.npubEncode(pubkey)
}

export function nsecOf(secret: Uint8Array): string {
  return nip19.nsecEncode(secret)
}

/** Accepts an npub or a hex public key and returns hex, or null. */
export function parsePublicKey(input: string): string | null {
  const text = input.trim()
  if (HEX64.test(text)) return text.toLowerCase()
  try {
    const decoded = nip19.decode(text)
    return decoded.type === 'npub' ? decoded.data : null
  } catch {
    return null
  }
}

/** Default scrypt cost for NIP-49. 2^16 takes about a second in the browser. */
export const DEFAULT_SCRYPT_LOGN = 16

export function encryptKey(
  secret: Uint8Array,
  passphrase: string,
  logn = DEFAULT_SCRYPT_LOGN,
): string {
  return nip49.encrypt(secret, passphrase, logn)
}

export function decryptKey(ncryptsec: string, passphrase: string): Uint8Array {
  try {
    return nip49.decrypt(ncryptsec, passphrase)
  } catch {
    // NIP-49 uses an AEAD, so a wrong passphrase and a damaged backup are indistinguishable.
    throw new KeyError('passphrase', 'Wrong passphrase, or the backup is damaged.')
  }
}

export function isEncryptedKey(text: string): boolean {
  return text.trim().startsWith('ncryptsec1')
}

export function signWithKey(secret: Uint8Array, template: EventTemplate): VerifiedEvent {
  // finalizeEvent fills in id, pubkey and sig on the object it is given, so sign a copy.
  return finalizeEvent({ ...template, tags: template.tags.map((t) => [...t]) }, secret)
}

/**
 * Verifies the id and BIP-340 signature. nostr-tools marks events it has already
 * checked with a hidden symbol that survives object spread, so the event is
 * copied to a plain object first and always re-verified.
 */
export function verifyEvent(ev: Event): boolean {
  if (!ev || typeof ev !== 'object') return false
  const { id, pubkey, created_at, kind, tags, content, sig } = ev
  return verifyEventCached({ id, pubkey, created_at, kind, tags, content, sig })
}

export { bytesToHex }
