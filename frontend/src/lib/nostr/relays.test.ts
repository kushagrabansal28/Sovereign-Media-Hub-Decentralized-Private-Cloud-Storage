import { afterEach, describe, expect, it } from 'vitest'
import { startRelay, type DevRelay } from '../../../tools/dev-relay/relay.mjs'
import { buildMediaEvent } from './events'
import { generateKey, publicKeyOf, signWithKey, type Event } from './keys'
import { RelayManager } from './relays'

const sk = generateKey()
const pk = publicKeyOf(sk)

let seq = 0
function mediaEvent(createdAt: number, key = sk): Event {
  const hash = (++seq).toString(16).padStart(64, '0')
  const template = buildMediaEvent({
    url: `http://blobs.test/${hash}.jpg`,
    sha256: hash,
    mime: 'image/jpeg',
    size: 10,
  })
  return signWithKey(key, { ...template, created_at: createdAt })
}

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function relay(opts?: Parameters<typeof startRelay>[0]): Promise<DevRelay> {
  const r = await startRelay(opts)
  cleanup.push(() => r.close())
  return r
}

function manager(urls: string[]): RelayManager {
  const m = new RelayManager({
    connectTimeoutMs: 1500,
    queryTimeoutMs: 1500,
    publishTimeoutMs: 1500,
    reconnectMinMs: 50,
    reconnectMaxMs: 200,
  })
  cleanup.push(() => m.destroy())
  m.setRelays(urls)
  return m
}

const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('RelayManager connection state', () => {
  it('reports connected relays with a measured connect time', async () => {
    const r = await relay()
    const m = manager([r.url])
    await m.settled()
    const [s] = m.statuses.get()
    expect(s).toMatchObject({ url: r.url, state: 'connected' })
    expect(s!.connectMs).toBeGreaterThanOrEqual(0)
  })

  it('reports an unreachable relay as an error with a reason, not as connected', async () => {
    const r = await relay()
    const dead = r.url.replace(String(r.port), '1') // nothing listens on port 1
    const m = manager([dead])
    await m.settled()
    const [s] = m.statuses.get()
    expect(s!.state).toBe('error')
    expect(s!.error).toBeTruthy()
  })

  it('notices a dropped connection and reconnects', async () => {
    const r = await relay()
    const m = manager([r.url])
    await m.settled()
    const connects: string[] = []
    m.onConnect((u) => connects.push(u))

    r.dropConnections()
    await until(() => m.statuses.get()[0]!.state !== 'connected')
    await until(() => m.statuses.get()[0]!.state === 'connected')
    expect(connects).toEqual([r.url])
  })

  it('keeps retrying until a relay that was down comes up', async () => {
    const first = await relay()
    const port = first.port
    await first.close()
    const m = manager([`ws://127.0.0.1:${port}`])
    await m.settled()
    expect(m.statuses.get()[0]!.state).toBe('error')

    const revived = await relay({ port })
    await until(() => m.statuses.get()[0]!.state === 'connected', 6000)
    expect(revived.url).toContain(String(port))
  })
})

describe('RelayManager publish', () => {
  it('collects a per-relay acknowledgement', async () => {
    const a = await relay()
    const b = await relay()
    const m = manager([a.url, b.url])
    const ev = mediaEvent(1_700_000_000)
    const report = await m.publish(ev)
    expect(report.accepted).toBe(2)
    expect(report.results.every((x) => x.outcome === 'accepted')).toBe(true)
    expect(a.events.has(ev.id)).toBe(true)
    expect(b.events.has(ev.id)).toBe(true)
  })

  it('treats a relay refusal as a rejection with the relay’s reason', async () => {
    const a = await relay()
    a.rejectWrites('blocked: members only')
    const m = manager([a.url])
    const report = await m.publish(mediaEvent(1_700_000_001))
    expect(report.accepted).toBe(0)
    expect(report.results[0]).toMatchObject({ outcome: 'rejected' })
    expect(report.results[0]!.message).toContain('members only')
  })

  it('still succeeds when one relay is down and says which one failed', async () => {
    const up = await relay()
    const down = await relay()
    const downUrl = down.url
    await down.close()
    const m = manager([up.url, downUrl])
    const report = await m.publish(mediaEvent(1_700_000_002))
    expect(report.accepted).toBe(1)
    expect(report.results.find((r) => r.url === downUrl)!.outcome).toBe('unreachable')
    expect(report.results.find((r) => r.url === up.url)!.outcome).toBe('accepted')
  })

  it('reports a timeout when a relay does not answer', async () => {
    const slow = await relay()
    slow.setDelay(5000)
    const m = new RelayManager({
      connectTimeoutMs: 1000,
      publishTimeoutMs: 300,
      reconnectMinMs: 50,
    })
    cleanup.push(() => m.destroy())
    m.setRelays([slow.url])
    const report = await m.publish(mediaEvent(1_700_000_003))
    expect(report.results[0]!.outcome).toBe('timeout')
  })

  it('is idempotent: publishing the same event twice stays accepted', async () => {
    const a = await relay()
    const m = manager([a.url])
    const ev = mediaEvent(1_700_000_004)
    await m.publish(ev)
    const again = await m.publish(ev)
    expect(again.accepted).toBe(1)
    expect([...a.events.values()].filter((e) => e.id === ev.id)).toHaveLength(1)
  })

  it('a relay refuses an event with a bad signature and the client sees a rejection', async () => {
    const a = await relay()
    const m = manager([a.url])
    const ev = { ...mediaEvent(1_700_000_005), content: 'edited after signing' }
    const report = await m.publish(ev)
    expect(report.accepted).toBe(0)
    expect(a.events.size).toBe(0)
  })
})

describe('RelayManager queries', () => {
  it('merges relays and removes duplicate events', async () => {
    const a = await relay()
    const b = await relay()
    const shared = mediaEvent(1_700_000_100)
    const onlyA = mediaEvent(1_700_000_101)
    const onlyB = mediaEvent(1_700_000_102)
    a.events.set(shared.id, shared)
    b.events.set(shared.id, shared)
    a.events.set(onlyA.id, onlyA)
    b.events.set(onlyB.id, onlyB)

    const m = manager([a.url, b.url])
    const res = await m.fetch({ authors: [pk], kinds: [1063] })
    expect(res.events.map((e) => e.id).sort()).toEqual([shared.id, onlyA.id, onlyB.id].sort())
    expect(res.completed).toHaveLength(2)
  })

  it('only returns events from the requested author', async () => {
    const a = await relay()
    const mine = mediaEvent(1_700_000_200)
    const other = mediaEvent(1_700_000_201, generateKey())
    a.events.set(mine.id, mine)
    a.events.set(other.id, other)
    const m = manager([a.url])
    const res = await m.fetch({ authors: [pk], kinds: [1063] })
    expect(res.events.map((e) => e.id)).toEqual([mine.id])
  })

  it('pages through relays that cap the result size', async () => {
    const a = await relay({ maxLimit: 4 })
    const ids = new Set<string>()
    for (let i = 0; i < 11; i++) {
      const ev = mediaEvent(1_700_001_000 + i)
      a.events.set(ev.id, ev)
      ids.add(ev.id)
    }
    const m = manager([a.url])
    const res = await m.fetchAll({ authors: [pk], kinds: [1063] }, { pageSize: 4 })
    expect(new Set(res.events.map((e) => e.id))).toEqual(ids)
  })

  it('does not loop forever when many events share one timestamp', async () => {
    const a = await relay({ maxLimit: 3 })
    for (let i = 0; i < 8; i++) {
      const ev = mediaEvent(1_700_002_000)
      a.events.set(ev.id, ev)
    }
    const m = manager([a.url])
    const res = await m.fetchAll({ authors: [pk], kinds: [1063] }, { pageSize: 3 })
    // A relay that cannot page past a shared timestamp yields what it can, then stops.
    expect(res.events.length).toBeGreaterThanOrEqual(3)
    expect(res.events.length).toBeLessThanOrEqual(8)
  })

  it('skips relays that are down and still returns results from the others', async () => {
    const up = await relay()
    const down = await relay()
    const downUrl = down.url
    await down.close()
    const ev = mediaEvent(1_700_003_000)
    up.events.set(ev.id, ev)
    const m = manager([up.url, downUrl])
    const res = await m.fetch({ authors: [pk], kinds: [1063] })
    expect(res.events).toHaveLength(1)
    expect(res.skipped).toEqual([downUrl])
  })

  it('records how long the last query took', async () => {
    const a = await relay()
    const m = manager([a.url])
    await m.fetch({ authors: [pk], kinds: [1063] })
    expect(m.statuses.get()[0]!.queryMs).toBeGreaterThanOrEqual(0)
  })
})

describe('RelayManager live subscriptions', () => {
  it('delivers new events and resumes after a reconnect', async () => {
    const a = await relay()
    const m = manager([a.url])
    await m.settled()
    const got: string[] = []
    m.subscribe({ authors: [pk], kinds: [1063], since: 1_700_004_000 }, (e) => got.push(e.id))

    const first = mediaEvent(1_700_004_001)
    await m.publish(first)
    await until(() => got.includes(first.id))

    a.dropConnections()
    await until(() => m.statuses.get()[0]!.state !== 'connected')
    await until(() => m.statuses.get()[0]!.state === 'connected')

    const second = mediaEvent(1_700_004_002)
    a.events.set(second.id, second)
    // Publish through a second manager to trigger the relay’s live fan-out.
    const other = manager([a.url])
    const third = mediaEvent(1_700_004_003)
    await other.publish(third)
    await until(() => got.includes(third.id))
  })

  it('stops delivering after unsubscribe', async () => {
    const a = await relay()
    const m = manager([a.url])
    await m.settled()
    const got: string[] = []
    const off = m.subscribe({ authors: [pk], kinds: [1063] }, (e) => got.push(e.id))
    off()
    await m.publish(mediaEvent(1_700_005_000))
    await new Promise((r) => setTimeout(r, 200))
    expect(got).toEqual([])
  })
})

describe('RelayManager known-event skipping', () => {
  it('does not return events the caller already holds, but still counts them for paging', async () => {
    const a = await relay()
    const have: Event[] = []
    const fresh: Event[] = []
    for (let i = 0; i < 6; i++) {
      const ev = mediaEvent(1_700_010_000 + i)
      a.events.set(ev.id, ev)
      ;(i < 4 ? have : fresh).push(ev)
    }
    const m = manager([a.url])
    const times = new Map(have.map((e) => [e.id, e.created_at]))
    const res = await m.fetch({ authors: [pk], kinds: [1063] }, { known: (id) => times.get(id) })
    expect(res.events.map((e) => e.id).sort()).toEqual(fresh.map((e) => e.id).sort())
    expect(res.received).toBe(6)
    expect(res.oldest).toBe(have[0]!.created_at)
  })

  it('still pages through a whole library when most events are already known', async () => {
    const a = await relay({ maxLimit: 4 })
    const all: Event[] = []
    for (let i = 0; i < 13; i++) {
      const ev = mediaEvent(1_700_020_000 + i)
      a.events.set(ev.id, ev)
      all.push(ev)
    }
    const known = new Map(all.slice(0, 10).map((e) => [e.id, e.created_at]))
    const m = manager([a.url])
    const res = await m.fetchAll(
      { authors: [pk], kinds: [1063] },
      { pageSize: 4, known: (id) => known.get(id) },
    )
    expect(res.events.map((e) => e.id).sort()).toEqual(
      all
        .slice(10)
        .map((e) => e.id)
        .sort(),
    )
    expect(res.received).toBeGreaterThanOrEqual(13)
  })

  it('does not verify the same event twice when two relays both hold it', async () => {
    const a = await relay()
    const b = await relay()
    const ev = mediaEvent(1_700_030_000)
    a.events.set(ev.id, ev)
    b.events.set(ev.id, ev)
    const m = manager([a.url, b.url])
    const res = await m.fetch({ authors: [pk], kinds: [1063] })
    expect(res.events).toHaveLength(1)
    expect(res.completed).toHaveLength(2)
  })
})
