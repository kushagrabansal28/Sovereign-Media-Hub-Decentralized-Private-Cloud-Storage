import { bytesToHex } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'

/** Files up to this size are hashed with the browser's native digest. */
export const NATIVE_LIMIT = 32 * 1024 * 1024

/**
 * Streams a blob through SHA-256 in chunks so large videos are never held in
 * memory whole. `onProgress` receives the number of bytes hashed so far.
 */
export async function sha256Stream(
  blob: Blob,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const hasher = sha256.create()
  const reader = blob.stream().getReader()
  let done = 0
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel()
      throw new DOMException('Hashing cancelled', 'AbortError')
    }
    const { value, done: finished } = await reader.read()
    if (finished) break
    hasher.update(value)
    done += value.byteLength
    onProgress?.(done, blob.size)
  }
  return bytesToHex(hasher.digest())
}

/**
 * Hashes a blob that is small enough to read into memory. `crypto.subtle` only exists in secure
 * contexts (HTTPS or localhost), so on plain HTTP over a LAN this falls back to the same
 * pure-JS digest the streaming path uses.
 */
export async function sha256Native(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return sha256Stream(blob)
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return bytesToHex(new Uint8Array(digest))
}
