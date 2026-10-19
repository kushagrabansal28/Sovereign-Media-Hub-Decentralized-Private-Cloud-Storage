import { NATIVE_LIMIT, sha256Native, sha256Stream } from './sha256'
import type { HashMessage } from './hash.worker'

/**
 * SHA-256 of a file's bytes.
 *
 * Small files use the native digest. Larger files stream through a Web Worker
 * so hashing a multi-gigabyte video does not block the interface. Where
 * Workers are unavailable (tests, very old browsers) the same streaming code
 * runs on the calling thread.
 */
export async function hashFile(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Hashing cancelled', 'AbortError')
  if (file.size <= NATIVE_LIMIT) {
    const sha = await sha256Native(file)
    onProgress?.(file.size, file.size)
    return sha
  }
  if (typeof Worker === 'undefined') return sha256Stream(file, onProgress, signal)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' })
    const stop = () => {
      worker.terminate()
      reject(new DOMException('Hashing cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', stop, { once: true })
    worker.onmessage = (e: MessageEvent<HashMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') onProgress?.(msg.done, msg.total)
      else if (msg.type === 'done') {
        worker.terminate()
        resolve(msg.sha256)
      } else {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Hashing failed'))
    }
    worker.postMessage({ file })
  })
}
