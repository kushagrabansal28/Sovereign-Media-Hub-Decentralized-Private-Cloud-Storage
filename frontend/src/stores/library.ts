import { useSyncExternalStore } from 'react'
import {
  buildDeletionEvent,
  deletedIds,
  KIND_DELETION,
  KIND_FILE_METADATA,
  parseMediaEvent,
  type MediaItem,
} from '../lib/nostr/events'
import type { Event, EventTemplate, VerifiedEvent } from '../lib/nostr/keys'
import type { PublishReport, RelayManager } from '../lib/nostr/relays'
import { cache as defaultCache, type OutboxEntry } from '../lib/storage/cache'
import { createStore } from './createStore'

export interface LibraryState {
  /** Newest first, one entry per distinct file. */
  items: MediaItem[]
  /** Items came from the local cache and no relay has confirmed them in this session. */
  fromCacheOnly: boolean
  loading: boolean
  syncing: boolean
  lastSyncAt?: number
  lastSync?: { completed: string[]; timedOut: string[]; skipped: string[] }
  error?: string
  /** Events waiting to reach at least one configured relay. */
  outbox: { total: number; perRelay: Record<string, number> }
  cacheAvailable: boolean
}

const initial: LibraryState = {
  items: [],
  fromCacheOnly: false,
  loading: false,
  syncing: false,
  outbox: { total: 0, perRelay: {} },
  cacheAvailable: true,
}

export interface LibraryDeps {
  relays: RelayManager
  sign: (template: EventTemplate) => Promise<VerifiedEvent>
  cache?: typeof defaultCache
  now?: () => number
}

export interface PublishOutcome {
  event: Event
  report: PublishReport
}

/**
 * The user's media index.
 *
 * It holds the metadata events published under the user's key, merges what
 * relays return with what is cached on this device, and keeps a queue of
 * signed events that have not reached every relay yet.
 */
export class Library {
  readonly state = createStore<LibraryState>(initial)
  private readonly relays: RelayManager
  private readonly sign: LibraryDeps['sign']
  private readonly db: typeof defaultCache
  private readonly now: () => number

  private pubkey: string | null = null
  private events = new Map<string, Event>()
  private persisted = new Set<string>()
  private idsBySha = new Map<string, string[]>()
  private memoryOutbox = new Map<string, OutboxEntry>()
  private stopLive: (() => void) | null = null
  private stopConnect: (() => void) | null = null
  private flushing = false
  private rebuildQueued = false
  private generation = 0
  private refreshing: Promise<void> | null = null
  private refreshAgain = false

  constructor(deps: LibraryDeps) {
    this.relays = deps.relays
    this.sign = deps.sign
    this.db = deps.cache ?? defaultCache
    this.now = deps.now ?? Date.now
  }

  /** Loads the cache, then syncs with relays. Safe to call again for a new key. */
  async start(pubkey: string): Promise<void> {
    this.stop()
    const generation = ++this.generation
    this.pubkey = pubkey
    this.state.set({ ...initial, loading: true })

    try {
      const cached = await this.db.getEvents(pubkey)
      if (generation !== this.generation) return
      for (const ev of cached) {
        this.events.set(ev.id, ev)
        this.persisted.add(ev.id)
      }
      this.rebuild()
      this.state.update((s) => ({ ...s, fromCacheOnly: cached.length > 0, loading: false }))
    } catch {
      this.state.update((s) => ({ ...s, cacheAvailable: false, loading: false }))
    }
    await this.refreshOutboxState()

    // A relay that connects later (added in Settings, or back after an outage) may hold events
    // this session has not seen, so it triggers a refresh as well as an outbox flush.
    this.stopConnect = this.relays.onConnect(() => {
      void this.flushOutbox()
      void this.refresh()
    })
    this.stopLive = this.relays.subscribe(
      {
        authors: [pubkey],
        kinds: [KIND_FILE_METADATA, KIND_DELETION],
        since: Math.floor(this.now() / 1000) - 5,
      },
      (ev) => this.ingest([ev], true),
    )
    await this.refresh()
    void this.flushOutbox()
  }

  stop() {
    this.generation++
    this.stopLive?.()
    this.stopConnect?.()
    this.stopLive = this.stopConnect = null
    this.pubkey = null
    this.events.clear()
    this.persisted.clear()
    this.idsBySha.clear()
    this.state.set(initial)
  }

  /**
   * Re-queries every relay for the full list of events. Overlapping calls are merged:
   * one that arrives while a refresh is running schedules a single follow-up.
   */
  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true
      return this.refreshing
    }
    this.refreshing = this.runRefresh().finally(async () => {
      this.refreshing = null
      if (this.refreshAgain) {
        this.refreshAgain = false
        await this.refresh()
      }
    })
    return this.refreshing
  }

  private async runRefresh(): Promise<void> {
    const pubkey = this.pubkey
    if (!pubkey) return
    const generation = this.generation
    this.state.update((s) => ({ ...s, syncing: true, error: undefined }))
    try {
      const report = await this.relays.fetchAll(
        { authors: [pubkey], kinds: [KIND_FILE_METADATA, KIND_DELETION] },
        {
          onPage: (page) => this.ingest(page, true),
          known: (id) => this.events.get(id)?.created_at,
        },
      )
      if (generation !== this.generation) return
      this.ingest(report.events, true)
      const answered = report.completed.length > 0
      this.state.update((s) => ({
        ...s,
        syncing: false,
        fromCacheOnly: answered ? false : s.fromCacheOnly,
        lastSyncAt: answered ? this.now() : s.lastSyncAt,
        lastSync: {
          completed: report.completed,
          timedOut: report.timedOut,
          skipped: report.skipped,
        },
        error: answered
          ? undefined
          : this.relays.urls.length === 0
            ? 'No relays are configured.'
            : 'No relay answered. Showing the copy saved on this device.',
      }))
    } catch (cause) {
      if (generation !== this.generation) return
      this.state.update((s) => ({
        ...s,
        syncing: false,
        error: cause instanceof Error ? cause.message : 'Sync failed.',
      }))
    }
  }

  /** Event ids (all devices) that describe the file with this hash. */
  eventIdsFor(sha256: string): string[] {
    return this.idsBySha.get(sha256) ?? []
  }

  hasHash(sha256: string): boolean {
    return this.idsBySha.has(sha256)
  }

  /** Signs, queues and publishes an event, and shows it in the library right away. */
  async publish(template: EventTemplate): Promise<PublishOutcome> {
    const event = await this.sign(template)
    this.events.set(event.id, event)
    this.rebuild()
    await this.outboxAdd(event)
    this.persist([event])
    const report = await this.relays.publish(event)
    await this.recordDelivery(event.id, report)
    return { event, report }
  }

  /** Hides a file from the library by publishing a NIP-09 deletion for every event that describes it. */
  async remove(sha256: string): Promise<PublishOutcome | null> {
    const ids = this.eventIdsFor(sha256)
    if (!ids.length) return null
    const outcome = await this.publish(buildDeletionEvent(ids, this.now))
    await this.db.deleteEvents(ids).catch(() => undefined)
    ids.forEach((id) => this.persisted.delete(id))
    return outcome
  }

  async flushOutbox(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      for (const entry of await this.outboxList()) {
        const targets = this.relays.urls.filter((u) => !entry.delivered.includes(u))
        if (!targets.length) {
          await this.outboxRemove(entry.id)
          continue
        }
        const report = await this.relays.publish(entry.event, targets)
        await this.recordDelivery(entry.id, report, entry)
      }
    } finally {
      this.flushing = false
      await this.refreshOutboxState()
    }
  }

  // -- internals ----------------------------------------------------------

  private ingest(events: Event[], persist: boolean) {
    const pubkey = this.pubkey
    if (!pubkey) return
    const fresh: Event[] = []
    for (const ev of events) {
      // Relay subscriptions already verified id and signature (nostr-tools does this
      // before delivering an event); here only ownership and kind are checked.
      if (ev.pubkey !== pubkey || this.events.has(ev.id)) continue
      if (ev.kind !== KIND_FILE_METADATA && ev.kind !== KIND_DELETION) continue
      this.events.set(ev.id, ev)
      fresh.push(ev)
    }
    if (!fresh.length) return
    this.scheduleRebuild()
    if (persist) this.persist(fresh)
  }

  private persist(events: Event[]) {
    const todo = events.filter((e) => !this.persisted.has(e.id))
    if (!todo.length) return
    todo.forEach((e) => this.persisted.add(e.id))
    this.db.putEvents(todo).catch(() => this.state.update((s) => ({ ...s, cacheAvailable: false })))
  }

  private scheduleRebuild() {
    if (this.rebuildQueued) return
    this.rebuildQueued = true
    queueMicrotask(() => {
      this.rebuildQueued = false
      this.rebuild()
    })
  }

  private rebuild() {
    const pubkey = this.pubkey
    if (!pubkey) return
    const deleted = new Set<string>()
    for (const ev of this.events.values()) {
      if (ev.kind === KIND_DELETION) deletedIds(ev, pubkey).forEach((id) => deleted.add(id))
    }

    const bySha = new Map<string, MediaItem>()
    const ids = new Map<string, string[]>()
    for (const ev of this.events.values()) {
      if (ev.kind !== KIND_FILE_METADATA || deleted.has(ev.id)) continue
      const item = parseMediaEvent(ev)
      if (!item) continue
      ids.set(item.sha256, [...(ids.get(item.sha256) ?? []), ev.id])
      const existing = bySha.get(item.sha256)
      if (!existing || item.createdAt < existing.createdAt) bySha.set(item.sha256, item)
    }
    this.idsBySha = ids
    const items = [...bySha.values()].sort(
      (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
    )
    this.state.update((s) => ({ ...s, items }))

    // Deleted events no longer need to occupy the cache.
    const stale = [...deleted].filter((id) => this.persisted.has(id))
    if (stale.length) {
      stale.forEach((id) => this.persisted.delete(id))
      this.db.deleteEvents(stale).catch(() => undefined)
    }
  }

  private async recordDelivery(id: string, report: PublishReport, known?: OutboxEntry) {
    const entry = known ?? (await this.outboxList()).find((e) => e.id === id)
    if (!entry) return
    const accepted = report.results.filter((r) => r.outcome === 'accepted').map((r) => r.url)
    const delivered = [...new Set([...entry.delivered, ...accepted])]
    const lastError = report.results.find((r) => r.outcome !== 'accepted')?.message
    const complete = this.relays.urls.every((u) => delivered.includes(u))
    if (complete) await this.outboxRemove(id)
    else await this.outboxUpdate(id, { delivered, lastError })
    await this.refreshOutboxState()
  }

  private async refreshOutboxState() {
    const entries = await this.outboxList()
    const perRelay: Record<string, number> = {}
    let total = 0
    for (const entry of entries) {
      const missing = this.relays.urls.filter((u) => !entry.delivered.includes(u))
      if (!missing.length) continue
      total++
      missing.forEach((u) => (perRelay[u] = (perRelay[u] ?? 0) + 1))
    }
    this.state.update((s) => ({ ...s, outbox: { total, perRelay } }))
  }

  private async outboxAdd(event: Event) {
    try {
      await this.db.addOutbox(event)
    } catch {
      this.memoryOutbox.set(event.id, { id: event.id, event, queuedAt: this.now(), delivered: [] })
    }
  }

  private async outboxList(): Promise<OutboxEntry[]> {
    let all: OutboxEntry[]
    try {
      all = [...(await this.db.listOutbox()), ...this.memoryOutbox.values()]
    } catch {
      all = [...this.memoryOutbox.values()]
    }
    // The outbox is shared by every identity used on this device; only this key's events belong here.
    return all.filter((e) => e.event.pubkey === this.pubkey)
  }

  private async outboxUpdate(
    id: string,
    change: Partial<Pick<OutboxEntry, 'delivered' | 'lastError'>>,
  ) {
    const mem = this.memoryOutbox.get(id)
    if (mem) this.memoryOutbox.set(id, { ...mem, ...change })
    else await this.db.updateOutbox(id, change).catch(() => undefined)
  }

  private async outboxRemove(id: string) {
    this.memoryOutbox.delete(id)
    await this.db.removeOutbox(id).catch(() => undefined)
  }
}

export function useLibraryState(library: Library): LibraryState {
  return useSyncExternalStore(library.state.subscribe, library.state.get)
}
