import { useSyncExternalStore } from 'react'
import {
  authorization,
  BlossomError,
  uploadBlob,
  type Signer,
  type UploadResult,
} from '../lib/blossom/client'
import { hashFile } from '../lib/blossom/hash'
import { buildMediaEvent } from '../lib/nostr/events'
import { prepareMedia, type PreparedMedia } from '../lib/media/prepare'
import { validateFile } from '../lib/media/validate'
import type { PublishReport } from '../lib/nostr/relays'
import type { Library } from './library'
import { createStore } from './createStore'

export type UploadStage =
  'waiting' | 'checking' | 'hashing' | 'preparing' | 'uploading' | 'publishing'
export type UploadStatus = 'queued' | 'active' | 'done' | 'duplicate' | 'error' | 'cancelled'

export interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  stage: UploadStage
  /** Bytes sent of the original file; only meaningful while uploading. */
  sent: number
  hashed: number
  error?: string
  retryable?: boolean
  warning?: string
  sha256?: string
  /** Server already held these bytes (another upload, or the same file earlier). */
  serverHadBlob?: boolean
  relays?: { accepted: number; total: number }
}

export interface UploadDeps {
  library: Library
  sign: Signer
  serverUrl: () => string
  maxBytes: () => number
  concurrency?: number
  /** Reads dimensions and makes a thumbnail. Replaceable because it needs a browser. */
  prepare?: (file: File) => Promise<PreparedMedia>
}

interface Work {
  controller: AbortController
  prepared?: PreparedMedia
  thumbSha?: string
}

let counter = 0

export class UploadQueue {
  readonly state = createStore<UploadItem[]>([])
  private work = new Map<string, Work>()
  private running = 0
  private readonly limit: number

  constructor(private readonly deps: UploadDeps) {
    this.limit = deps.concurrency ?? 2
  }

  add(files: File[]) {
    const items = files.map<UploadItem>((file) => ({
      id: `u${++counter}`,
      file,
      status: 'queued',
      stage: 'waiting',
      sent: 0,
      hashed: 0,
    }))
    this.state.update((s) => [...s, ...items])
    this.pump()
  }

  cancel(id: string) {
    this.work.get(id)?.controller.abort()
    const item = this.find(id)
    if (item?.status === 'queued') this.patch(id, { status: 'cancelled' })
  }

  retry(id: string) {
    const item = this.find(id)
    if (!item || (item.status !== 'error' && item.status !== 'cancelled')) return
    this.patch(id, { status: 'queued', stage: 'waiting', error: undefined, sent: 0 })
    this.pump()
  }

  clearFinished() {
    this.state.update((s) => s.filter((i) => i.status === 'queued' || i.status === 'active'))
    for (const id of [...this.work.keys()]) if (!this.find(id)) this.work.delete(id)
  }

  get activeCount() {
    return this.state.get().filter((i) => i.status === 'queued' || i.status === 'active').length
  }

  /** Resolves when nothing is queued or running. Used by tests and by "leave page" guards. */
  async idle(): Promise<void> {
    while (this.activeCount > 0) await new Promise((r) => setTimeout(r, 10))
  }

  private find(id: string) {
    return this.state.get().find((i) => i.id === id)
  }

  private patch(id: string, change: Partial<UploadItem>) {
    this.state.update((s) => s.map((i) => (i.id === id ? { ...i, ...change } : i)))
  }

  private pump() {
    while (this.running < this.limit) {
      const next = this.state.get().find((i) => i.status === 'queued')
      if (!next) return
      this.running++
      this.patch(next.id, { status: 'active', stage: 'checking' })
      void this.run(next.id).finally(() => {
        this.running--
        this.pump()
      })
    }
  }

  private async run(id: string) {
    const item = this.find(id)!
    const work: Work = this.work.get(id) ?? { controller: new AbortController() }
    work.controller = new AbortController()
    this.work.set(id, work)
    const { signal } = work.controller
    const { library, sign } = this.deps
    const serverUrl = this.deps.serverUrl()

    try {
      this.patch(id, { stage: 'checking' })
      const check = await validateFile(item.file, this.deps.maxBytes())
      if (!check.ok)
        return this.patch(id, { status: 'error', error: check.reason, retryable: false })

      this.patch(id, { stage: 'hashing' })
      const sha256 =
        item.sha256 ??
        (await hashFile(item.file, (done) => this.patch(id, { hashed: done }), signal))
      this.patch(id, { sha256 })

      if (library.hasHash(sha256)) {
        return this.patch(id, { status: 'duplicate', error: undefined })
      }

      this.patch(id, { stage: 'preparing' })
      work.prepared ??= await (this.deps.prepare ?? prepareMedia)(item.file)
      const prepared = work.prepared
      if (prepared.thumb && !work.thumbSha) work.thumbSha = await hashFile(prepared.thumb)
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError')

      this.patch(id, { stage: 'uploading', sent: 0, warning: prepared.thumbWarning })
      const hashes = work.thumbSha ? [sha256, work.thumbSha] : [sha256]
      const token = await authorization(sign, {
        verb: 'upload',
        serverUrl,
        hashes,
        content: `Upload ${item.file.size} bytes`,
        ttlSeconds: 600,
      })

      let thumb: UploadResult | undefined
      if (prepared.thumb && work.thumbSha) {
        thumb = await uploadBlob({
          serverUrl,
          body: prepared.thumb,
          sha256: work.thumbSha,
          authorization: token,
          signal,
        })
      }
      const original = await uploadBlob({
        serverUrl,
        body: item.file,
        sha256,
        authorization: token,
        signal,
        onProgress: (sent) => this.patch(id, { sent }),
      })
      this.patch(id, { sent: item.file.size, serverHadBlob: original.existed })

      this.patch(id, { stage: 'publishing' })
      const template = buildMediaEvent({
        url: original.url,
        sha256,
        mime: original.type,
        size: original.size,
        width: prepared.width || undefined,
        height: prepared.height || undefined,
        blurhash: prepared.blurhash,
        thumb: thumb ? { url: thumb.url, sha256: thumb.sha256 } : undefined,
        taken: item.file.lastModified ? item.file.lastModified / 1000 : undefined,
        durationSeconds: prepared.durationSeconds,
      })
      const { report } = await library.publish(template)
      this.patch(id, { status: 'done', relays: summarise(report) })
    } catch (cause) {
      if (signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
        return this.patch(id, { status: 'cancelled', error: undefined })
      }
      const retryable = cause instanceof BlossomError ? cause.retryable : true
      this.patch(id, {
        status: 'error',
        retryable,
        error: cause instanceof Error ? cause.message : 'Upload failed.',
      })
    }
  }
}

function summarise(report: PublishReport) {
  return { accepted: report.accepted, total: report.results.length }
}

export function useUploads(queue: UploadQueue): UploadItem[] {
  return useSyncExternalStore(queue.state.subscribe, queue.state.get)
}
