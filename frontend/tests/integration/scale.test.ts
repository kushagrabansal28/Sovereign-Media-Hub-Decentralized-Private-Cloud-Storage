// A large library through the real relay manager and library store.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRelay, type DevRelay } from '../../tools/dev-relay/relay.mjs'
import { buildMediaEvent } from '../../src/lib/nostr/events'
import { generateKey, publicKeyOf, signWithKey } from '../../src/lib/nostr/keys'
import { RelayManager } from '../../src/lib/nostr/relays'
import { cache } from '../../src/lib/storage/cache'
import { Library } from '../../src/stores/library'

const COUNT = 1200
const secret = generateKey()
const pubkey = publicKeyOf(secret)
let relay: DevRelay

beforeAll(async () => {
  relay = await startRelay({ maxLimit: 500 })
  const now = Date.now()
  for (let i = 0; i < COUNT; i++) {
    const hash = i.toString(16).padStart(64, '0')
    const ev = signWithKey(
      secret,
      buildMediaEvent({
        url: `http://127.0.0.1:1/${hash}.png`,
        sha256: hash,
        mime: 'image/png',
        size: 1000,
        width: 800,
        height: 600,
        now: () => now - i * 60_000,
      }),
    )
    relay.events.set(ev.id, ev)
  }
}, 60_000)

afterAll(() => relay.close())

describe('large library', () => {
  it('loads every item through a relay that caps results at 500, then refreshes cheaply', async () => {
    const relays = new RelayManager({ queryTimeoutMs: 8000 })
    relays.setRelays([relay.url])
    const library = new Library({ relays, sign: async (t) => signWithKey(secret, t) })

    await library.start(pubkey)
    expect(library.state.get().items).toHaveLength(COUNT)
    expect(library.state.get().error).toBeUndefined()

    // A second refresh must not duplicate anything and must not lose paging.
    const t0 = performance.now()
    await library.refresh()
    const warmMs = performance.now() - t0
    expect(library.state.get().items).toHaveLength(COUNT)
    expect(warmMs).toBeLessThan(1500)

    library.stop()
    relays.destroy()
  })

  it('picks up a relay that is added after the library has started', async () => {
    await cache.clearEvents() // the first test cached these events for this key
    const relays = new RelayManager({ queryTimeoutMs: 8000, connectTimeoutMs: 1000 })
    relays.setRelays(['ws://127.0.0.1:1']) // nothing listens here
    const library = new Library({ relays, sign: async (t) => signWithKey(secret, t) })
    await library.start(pubkey)
    expect(library.state.get().items).toHaveLength(0)

    relays.setRelays([relay.url])
    const end = Date.now() + 15_000
    while (library.state.get().items.length < COUNT && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(library.state.get().items).toHaveLength(COUNT)

    library.stop()
    relays.destroy()
  })
})
