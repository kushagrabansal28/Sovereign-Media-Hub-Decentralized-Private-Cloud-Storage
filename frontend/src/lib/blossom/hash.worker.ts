/// <reference lib="webworker" />
import { sha256Stream } from './sha256'

export interface HashRequest {
  file: Blob
}
export type HashMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; sha256: string }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<HashRequest>) => {
  try {
    const sha = await sha256Stream(e.data.file, (done, total) => {
      self.postMessage({ type: 'progress', done, total } satisfies HashMessage)
    })
    self.postMessage({ type: 'done', sha256: sha } satisfies HashMessage)
  } catch (cause) {
    self.postMessage({
      type: 'error',
      message: cause instanceof Error ? cause.message : 'Hashing failed',
    } satisfies HashMessage)
  }
}
