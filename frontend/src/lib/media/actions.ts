import { authorization, BlossomError, blobUrl, deleteBlob, extensionFor } from '../blossom/client'
import { sha256Native } from '../blossom/sha256'
import type { MediaItem } from '../nostr/events'
import type { Library } from '../../stores/library'
import type { Signer } from '../blossom/client'

export function originOf(url: string): string {
  return new URL(url).origin
}

/** Original first, then the same hash on the configured server (for libraries that moved). */
export function originalSources(item: MediaItem, configuredServer: string): string[] {
  const alt = blobUrl(configuredServer, item.sha256, item.mime)
  return item.url === alt ? [item.url] : [item.url, alt]
}

export function fileNameFor(item: MediaItem): string {
  const day = new Date((item.taken ?? item.createdAt) * 1000).toISOString().slice(0, 10)
  const ext = extensionFor(item.mime) || 'bin'
  return `${day}-${item.sha256.slice(0, 8)}.${ext}`
}

export class IntegrityError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `The downloaded bytes hash to ${actual.slice(0, 12)}… but the library expects ${expected.slice(0, 12)}…. Nothing was saved.`,
    )
    this.name = 'IntegrityError'
  }
}

/**
 * Fetches the original, checks that its SHA-256 matches the address it was
 * stored under, and only then hands it to the browser as a file.
 */
export async function downloadOriginal(
  item: MediaItem,
  configuredServer: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  let lastError: unknown = new Error('No source for this file.')
  for (const url of originalSources(item, configuredServer)) {
    try {
      const res = await fetch(url)
      if (!res.ok)
        throw new BlossomError(
          `The storage server answered ${res.status} for this file.`,
          res.status,
          res.status >= 500,
        )
      const total = Number(res.headers.get('content-length')) || item.size || 0
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let received = 0
      const reader = res.body!.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value as Uint8Array<ArrayBuffer>)
        received += value.byteLength
        onProgress?.(received, total)
      }
      const blob = new Blob(chunks, { type: item.mime })
      const actual = await sha256Native(blob)
      if (actual !== item.sha256) throw new IntegrityError(item.sha256, actual)
      saveBlob(blob, fileNameFor(item))
      return
    } catch (e) {
      lastError = e
      if (e instanceof IntegrityError) throw e
    }
  }
  throw lastError
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface DeleteReport {
  /** Relays that accepted the deletion event (NIP-09). Zero means it is queued. */
  relaysAccepted: number
  relaysTotal: number
  /** Blobs removed from the storage server. */
  blobsDeleted: number
  /** A blob stayed on the server because another key also owns it. */
  blobKept: boolean
  /** Set when the storage server could not be asked or refused. */
  blobError?: string
}

/**
 * Deletes a library item. The metadata goes first: if the file were removed
 * first and the deletion event failed, the library would show a broken item.
 */
export async function deleteMedia(
  item: MediaItem,
  library: Library,
  sign: Signer,
): Promise<DeleteReport> {
  const outcome = await library.remove(item.sha256)
  const report: DeleteReport = {
    relaysAccepted: outcome?.report.accepted ?? 0,
    relaysTotal: outcome?.report.results.length ?? 0,
    blobsDeleted: 0,
    blobKept: false,
  }

  const server = originOf(item.url)
  const hashes = [item.sha256, ...(item.thumbSha256 ? [item.thumbSha256] : [])]
  for (const sha of hashes) {
    try {
      const token = await authorization(sign, {
        verb: 'delete',
        serverUrl: server,
        hashes: [sha],
        content: 'Delete file',
      })
      const res = await deleteBlob(server, sha, token)
      if (res.file_removed) report.blobsDeleted++
      else report.blobKept = true
    } catch (e) {
      // A 404 means the server does not have it (or it is not ours): nothing left to remove.
      if (e instanceof BlossomError && e.status === 404) continue
      report.blobError = e instanceof Error ? e.message : 'The storage server could not be reached.'
    }
  }
  return report
}

export function describeDelete(r: DeleteReport): { text: string; kind: 'info' | 'error' } {
  if (r.blobError) {
    return {
      text: `Removed from the library, but the storage server did not delete the file: ${r.blobError} It is listed under Settings → Storage.`,
      kind: 'error',
    }
  }
  const relays =
    r.relaysAccepted === 0 && r.relaysTotal > 0
      ? ' No relay has accepted the removal yet; it will be sent when one is reachable.'
      : ''
  if (r.blobKept)
    return {
      text: `Removed from your library. The file stays on the server because another key also uses it.${relays}`,
      kind: 'info',
    }
  return { text: `Deleted from your library and the storage server.${relays}`, kind: 'info' }
}
