import type { Event } from '../nostr/keys'

/**
 * Local persistence in IndexedDB.
 *
 *   events  verified metadata events fetched from relays, for offline browsing
 *   outbox  signed events that no relay has accepted yet, retried later
 *
 * Neither store holds key material. The events cache is bounded.
 */
const DB_NAME = 'smh'
const DB_VERSION = 1
export const MAX_CACHED_EVENTS = 20_000

export interface OutboxEntry {
  id: string
  event: Event
  queuedAt: number
  /** Relays that have already accepted this event. */
  delivered: string[]
  lastError?: string
}

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      const events = db.createObjectStore('events', { keyPath: 'id' })
      events.createIndex('by_pubkey_time', ['pubkey', 'created_at'])
      db.createObjectStore('outbox', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      opening = null
      reject(req.error ?? new Error('IndexedDB is unavailable'))
    }
  })
  return opening
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

export const cache = {
  async available(): Promise<boolean> {
    try {
      await open()
      return true
    } catch {
      return false
    }
  },

  async putEvents(events: Event[]): Promise<void> {
    if (!events.length) return
    const db = await open()
    const tx = db.transaction('events', 'readwrite')
    for (const ev of events) tx.objectStore('events').put(plain(ev))
    await done(tx)
    await this.prune()
  },

  async getEvents(pubkey: string): Promise<Event[]> {
    const db = await open()
    const range = IDBKeyRange.bound([pubkey, 0], [pubkey, Number.MAX_SAFE_INTEGER])
    return wrap(
      db.transaction('events').objectStore('events').index('by_pubkey_time').getAll(range),
    )
  },

  async deleteEvents(ids: string[]): Promise<void> {
    if (!ids.length) return
    const db = await open()
    const tx = db.transaction('events', 'readwrite')
    for (const id of ids) tx.objectStore('events').delete(id)
    await done(tx)
  },

  /** Drops the oldest events beyond the cap. */
  async prune(max = MAX_CACHED_EVENTS): Promise<number> {
    const db = await open()
    const count = await wrap(db.transaction('events').objectStore('events').count())
    if (count <= max) return 0
    const excess = count - max
    const tx = db.transaction('events', 'readwrite')
    let removed = 0
    await new Promise<void>((resolve, reject) => {
      const cursor = tx.objectStore('events').index('by_pubkey_time').openCursor()
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c || removed >= excess) return resolve()
        c.delete()
        removed++
        c.continue()
      }
      cursor.onerror = () => reject(cursor.error)
    })
    await done(tx)
    return removed
  },

  async countEvents(): Promise<number> {
    const db = await open()
    return wrap(db.transaction('events').objectStore('events').count())
  },

  async addOutbox(event: Event): Promise<void> {
    const db = await open()
    const tx = db.transaction('outbox', 'readwrite')
    tx.objectStore('outbox').put({
      id: event.id,
      event: plain(event),
      queuedAt: Date.now(),
      delivered: [],
    } satisfies OutboxEntry)
    await done(tx)
  },

  async listOutbox(): Promise<OutboxEntry[]> {
    const db = await open()
    return wrap(db.transaction('outbox').objectStore('outbox').getAll())
  },

  async updateOutbox(
    id: string,
    change: Partial<Pick<OutboxEntry, 'delivered' | 'lastError'>>,
  ): Promise<void> {
    const db = await open()
    const tx = db.transaction('outbox', 'readwrite')
    const store = tx.objectStore('outbox')
    const entry = (await wrap(store.get(id))) as OutboxEntry | undefined
    if (entry) store.put({ ...entry, ...change })
    await done(tx)
  },

  async removeOutbox(id: string): Promise<void> {
    const db = await open()
    const tx = db.transaction('outbox', 'readwrite')
    tx.objectStore('outbox').delete(id)
    await done(tx)
  },

  /** Approximate size of cached metadata, for the settings screen. */
  async approximateBytes(): Promise<number> {
    const db = await open()
    const all = await wrap(db.transaction('events').objectStore('events').getAll())
    return all.reduce((sum, ev) => sum + JSON.stringify(ev).length, 0)
  },

  async clearEvents(): Promise<void> {
    const db = await open()
    const tx = db.transaction('events', 'readwrite')
    tx.objectStore('events').clear()
    await done(tx)
  },
}

/** Drops hidden properties (nostr-tools' verified marker) before storing. */
function plain(ev: Event): Event {
  const { id, pubkey, created_at, kind, tags, content, sig } = ev
  return { id, pubkey, created_at, kind, tags, content, sig }
}
