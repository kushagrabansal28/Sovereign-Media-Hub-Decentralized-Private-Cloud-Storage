import { Relay } from 'nostr-tools/relay'
import type { Filter } from 'nostr-tools/filter'
import type { Event } from './keys'
import { createStore } from '../../stores/createStore'

export type RelayState = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface RelayStatus {
  url: string
  state: RelayState
  /** Why the last attempt failed, in words the user can act on. */
  error?: string
  /** Time the websocket took to open on the last successful connection. */
  connectMs?: number
  /** Time from REQ to EOSE on the last query. */
  queryMs?: number
  connectedAt?: number
  attempts: number
}

export type PublishOutcome = 'accepted' | 'rejected' | 'timeout' | 'unreachable'

export interface PublishResult {
  url: string
  outcome: PublishOutcome
  message: string
}

export interface PublishReport {
  eventId: string
  results: PublishResult[]
  accepted: number
}

export interface FetchReport {
  events: Event[]
  /** Relays that answered EOSE before the timeout. */
  completed: string[]
  /** Relays that were connected but did not finish in time. */
  timedOut: string[]
  /** Relays we could not ask because they were not connected. */
  skipped: string[]
  /** Most events any single relay sent for this request, including ones skipped as already known. */
  received: number
  /** Oldest `created_at` among received events, or Infinity if there were none. */
  oldest: number
}

export interface FetchOptions {
  /**
   * Returns the `created_at` of an event the caller already holds and has verified.
   * Such events are skipped before they are parsed or their signature is checked,
   * which is what makes a refresh of a large library cheap.
   */
  known?: (id: string) => number | undefined
}

export interface RelayManagerOptions {
  connectTimeoutMs?: number
  queryTimeoutMs?: number
  publishTimeoutMs?: number
  reconnectMinMs?: number
  reconnectMaxMs?: number
}

interface Entry {
  status: RelayStatus
  relay?: Relay
  timer?: ReturnType<typeof setTimeout>
  removed: boolean
  connecting?: Promise<void>
}

interface Live {
  filter: Filter
  onEvent: (ev: Event) => void
  closers: Map<string, () => void>
}

export class RelayManager {
  readonly statuses = createStore<RelayStatus[]>([])
  private entries = new Map<string, Entry>()
  private live = new Set<Live>()
  private connectListeners = new Set<(url: string) => void>()
  private readonly o: Required<RelayManagerOptions>

  constructor(options: RelayManagerOptions = {}) {
    this.o = {
      connectTimeoutMs: options.connectTimeoutMs ?? 6000,
      queryTimeoutMs: options.queryTimeoutMs ?? 8000,
      publishTimeoutMs: options.publishTimeoutMs ?? 6000,
      reconnectMinMs: options.reconnectMinMs ?? 1000,
      reconnectMaxMs: options.reconnectMaxMs ?? 30_000,
    }
  }

  /** Replaces the relay set. Existing connections to kept relays are untouched. */
  setRelays(urls: string[]) {
    const wanted = new Set(urls)
    for (const [url, entry] of this.entries) {
      if (!wanted.has(url)) {
        entry.removed = true
        clearTimeout(entry.timer)
        entry.relay?.close()
        this.entries.delete(url)
      }
    }
    for (const url of urls) {
      if (!this.entries.has(url)) {
        this.entries.set(url, {
          removed: false,
          status: { url, state: 'connecting', attempts: 0 },
        })
        void this.connect(url)
      }
    }
    this.publishStatuses(urls)
  }

  get urls(): string[] {
    return [...this.entries.keys()]
  }

  connectedUrls(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.status.state === 'connected')
      .map((e) => e.status.url)
  }

  /** Runs `cb` each time a relay connects (including reconnects). */
  onConnect(cb: (url: string) => void): () => void {
    this.connectListeners.add(cb)
    return () => this.connectListeners.delete(cb)
  }

  /** Forces an immediate reconnection attempt for one relay or all of them. */
  reconnect(url?: string) {
    for (const [u, entry] of this.entries) {
      if (url && u !== url) continue
      if (entry.status.state === 'connected' || entry.status.state === 'connecting') continue
      clearTimeout(entry.timer)
      void this.connect(u)
    }
  }

  destroy() {
    for (const entry of this.entries.values()) {
      entry.removed = true
      clearTimeout(entry.timer)
      entry.relay?.close()
    }
    this.entries.clear()
    this.live.clear()
    this.statuses.set([])
  }

  private publishStatuses(order?: string[]) {
    const urls = order ?? [...this.entries.keys()]
    this.statuses.set(
      urls.flatMap((u) => (this.entries.has(u) ? [{ ...this.entries.get(u)!.status }] : [])),
    )
  }

  private patch(url: string, change: Partial<RelayStatus>) {
    const entry = this.entries.get(url)
    if (!entry) return
    entry.status = { ...entry.status, ...change }
    this.publishStatuses()
  }

  private connect(url: string): Promise<void> {
    const entry = this.entries.get(url)
    if (!entry || entry.removed) return Promise.resolve()
    if (entry.connecting) return entry.connecting

    this.patch(url, { state: 'connecting', attempts: entry.status.attempts + 1 })
    const started = performance.now()

    entry.connecting = (async () => {
      try {
        const relay = new Relay(url, { enablePing: true })
        await relay.connect({ timeout: this.o.connectTimeoutMs })
        if (entry.removed) return relay.close()

        entry.relay = relay
        relay.onclose = () => {
          if (entry.removed) return
          entry.relay = undefined
          this.patch(url, {
            state: 'disconnected',
            error: 'The connection was closed by the relay or the network.',
          })
          this.scheduleReconnect(url)
        }
        this.patch(url, {
          state: 'connected',
          error: undefined,
          connectMs: Math.round(performance.now() - started),
          connectedAt: Date.now(),
          attempts: 0,
        })
        for (const live of this.live) this.attachLive(live, url, relay)
        this.connectListeners.forEach((cb) => cb(url))
      } catch (cause) {
        if (entry.removed) return
        this.patch(url, { state: 'error', error: describeConnectError(cause, url) })
        this.scheduleReconnect(url)
      } finally {
        entry.connecting = undefined
      }
    })()
    return entry.connecting
  }

  private scheduleReconnect(url: string) {
    const entry = this.entries.get(url)
    if (!entry || entry.removed) return
    const attempt = Math.max(1, entry.status.attempts)
    const base = Math.min(this.o.reconnectMaxMs, this.o.reconnectMinMs * 2 ** (attempt - 1))
    const delay = base / 2 + Math.random() * (base / 2)
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.connect(url), delay)
  }

  /** Waits until no relay is mid-connection, or the connect timeout passes. */
  async settled(): Promise<void> {
    const pending = [...this.entries.values()]
      .map((e) => e.connecting)
      .filter(Boolean) as Promise<void>[]
    if (!pending.length) return
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((r) => setTimeout(r, this.o.connectTimeoutMs + 500)),
    ])
  }

  /** Sends the event to every relay, or only to `only` when given. */
  async publish(event: Event, only?: string[]): Promise<PublishReport> {
    await this.settled()
    const targets = [...this.entries.entries()].filter(([url]) => !only || only.includes(url))
    const results = await Promise.all(
      targets.map(async ([url, entry]): Promise<PublishResult> => {
        if (!entry.relay || entry.status.state !== 'connected') {
          return { url, outcome: 'unreachable', message: entry.status.error ?? 'Not connected' }
        }
        try {
          const message = await withTimeout(entry.relay.publish(event), this.o.publishTimeoutMs)
          return { url, outcome: 'accepted', message: message || 'accepted' }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          // Our own timer, or nostr-tools' internal publish timeout.
          if (message === TIMEOUT || /timed out|timeout/i.test(message))
            return { url, outcome: 'timeout', message: 'No answer before the timeout' }
          // nostr-tools rejects with "msg" when the relay answers OK=false.
          return { url, outcome: 'rejected', message: message.replace(/^msg:\s*/, '') }
        }
      }),
    )
    return {
      eventId: event.id,
      results,
      accepted: results.filter((r) => r.outcome === 'accepted').length,
    }
  }

  /** One page from every connected relay, merged and de-duplicated. */
  async fetch(filter: Filter, options: FetchOptions = {}): Promise<FetchReport> {
    await this.settled()
    const seen = new Map<string, Event>()
    const completed: string[] = []
    const timedOut: string[] = []
    const skipped: string[] = []
    let received = 0
    let oldest = Infinity

    await Promise.all(
      [...this.entries.entries()].map(async ([url, entry]) => {
        if (!entry.relay || entry.status.state !== 'connected') {
          skipped.push(url)
          return
        }
        const started = performance.now()
        let fromThisRelay = 0
        const done = await new Promise<boolean>((resolve) => {
          const sub = entry.relay!.subscribe([filter], {
            // Checked on the raw message, before parsing and signature verification.
            // A copy already received from another relay has the same id, so the same content.
            alreadyHaveEvent: (id) => {
              const known = options.known?.(id)
              if (known !== undefined) oldest = Math.min(oldest, known)
              return known !== undefined || seen.has(id)
            },
            receivedEvent: () => {
              fromThisRelay++
            },
            onevent: (ev) => {
              oldest = Math.min(oldest, ev.created_at)
              if (!seen.has(ev.id)) seen.set(ev.id, ev)
            },
            oneose: () => {
              resolve(true) // before close(): closing fires onclose, which resolves false
              sub.close()
            },
            onclose: () => resolve(false),
            eoseTimeout: this.o.queryTimeoutMs,
          })
          setTimeout(() => {
            resolve(false)
            sub.close()
          }, this.o.queryTimeoutMs + 250)
        })
        received = Math.max(received, fromThisRelay)
        if (done) {
          completed.push(url)
          this.patch(url, { queryMs: Math.round(performance.now() - started) })
        } else timedOut.push(url)
      }),
    )
    return { events: [...seen.values()], completed, timedOut, skipped, received, oldest }
  }

  /**
   * Pages backwards in time with `until` until a relay returns fewer events than
   * asked for, so relays that cap `limit` still yield the whole library.
   */
  async fetchAll(
    base: Filter,
    opts: FetchOptions & {
      pageSize?: number
      maxEvents?: number
      onPage?: (events: Event[]) => void
    } = {},
  ): Promise<FetchReport> {
    const pageSize = opts.pageSize ?? 500
    const maxEvents = opts.maxEvents ?? 20_000
    const all = new Map<string, Event>()
    const completed = new Set<string>()
    const timedOut = new Set<string>()
    const skipped = new Set<string>()
    let until: number | undefined
    let received = 0
    let oldestOverall = Infinity

    for (;;) {
      const page = await this.fetch(
        { ...base, limit: pageSize, ...(until !== undefined ? { until } : {}) },
        { known: opts.known },
      )
      page.completed.forEach((u) => completed.add(u))
      page.timedOut.forEach((u) => timedOut.add(u))
      page.skipped.forEach((u) => skipped.add(u))
      for (const ev of page.events) all.set(ev.id, ev)
      opts.onPage?.(page.events)
      received += page.received
      oldestOverall = Math.min(oldestOverall, page.oldest)

      // Stop when a relay is exhausted, when the window did not move (many events share
      // one second), or at the cap. `until` is inclusive, so boundary events are re-sent
      // and dropped by id.
      if (page.received < pageSize || page.oldest === Infinity) break
      if (until !== undefined && page.oldest >= until) break
      if (received >= maxEvents) break
      until = page.oldest
    }
    return {
      events: [...all.values()],
      completed: [...completed],
      timedOut: [...timedOut].filter((u) => !completed.has(u)),
      skipped: [...skipped],
      received,
      oldest: oldestOverall,
    }
  }

  /** Long-lived subscription that survives reconnects. Returns an unsubscribe function. */
  subscribe(filter: Filter, onEvent: (ev: Event) => void): () => void {
    const live: Live = { filter, onEvent, closers: new Map() }
    this.live.add(live)
    for (const [url, entry] of this.entries) {
      if (entry.relay && entry.status.state === 'connected') this.attachLive(live, url, entry.relay)
    }
    return () => {
      this.live.delete(live)
      live.closers.forEach((close) => close())
      live.closers.clear()
    }
  }

  private attachLive(live: Live, url: string, relay: Relay) {
    live.closers.get(url)?.()
    const sub = relay.subscribe([live.filter], { onevent: live.onEvent })
    live.closers.set(url, () => sub.close())
  }
}

const TIMEOUT = 'timeout'

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(TIMEOUT)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

function describeConnectError(cause: unknown, url: string): string {
  const text = cause instanceof Error ? cause.message : String(cause)
  if (/timed out|timeout/i.test(text)) return 'No answer before the timeout.'
  if (pageIsHttps() && url.startsWith('ws://')) {
    return 'Blocked: an https page cannot open an unencrypted ws:// relay. Use wss://.'
  }
  return text && text !== 'Error' ? text : 'Could not open a connection.'
}

function pageIsHttps(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:'
}

/** Accepts ws:// and wss:// addresses and returns a normalised URL, or throws. */
export function normalizeRelayUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter a relay address such as wss://relay.example.org')
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Relay addresses start with wss:// (or ws:// for a local relay).')
  }
  url.hash = ''
  const text = url.toString()
  return url.pathname === '/' && !url.search ? text.replace(/\/$/, '') : text
}
