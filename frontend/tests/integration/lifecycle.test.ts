// End-to-end tests of the stores and protocol libraries against the real Go
// storage server and the development relay. Only the browser-only step
// (thumbnail rendering) is replaced by a stub.
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRelay, type DevRelay } from '../../tools/dev-relay/relay.mjs'
import { startBlossom, type RunningServer } from '../../tools/blossom-server'
import { makePng } from '../../tools/png'
import { authorization, deleteBlob, listAllBlobs } from '../../src/lib/blossom/client'
import { RelayManager } from '../../src/lib/nostr/relays'
import { cache } from '../../src/lib/storage/cache'
import { identity } from '../../src/stores/identity'
import { Library } from '../../src/stores/library'
import { UploadQueue, type UploadItem } from '../../src/stores/uploads'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const sign = (t: Parameters<typeof identity.sign>[0]) => identity.sign(t)

const stubPrepare = async () => ({
  width: 64,
  height: 64,
  thumb: new Blob([makePng(999, 16) as BlobPart], { type: 'image/png' }),
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
})

function stack(serverUrl: string, relayUrls: string[]) {
  const relays = new RelayManager({
    connectTimeoutMs: 1500,
    queryTimeoutMs: 1500,
    publishTimeoutMs: 1500,
    reconnectMinMs: 50,
    reconnectMaxMs: 200,
  })
  relays.setRelays(relayUrls)
  const library = new Library({ relays, sign })
  const uploads = new UploadQueue({
    library,
    sign,
    serverUrl: () => serverUrl,
    maxBytes: () => 50 * 1024 * 1024,
    prepare: stubPrepare,
  })
  return { relays, library, uploads }
}

const file = (bytes: Uint8Array, name = 'photo.png') =>
  new File([bytes as BlobPart], name, { type: 'image/png' })
const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 25))
  }
}
const finalState = (u: UploadQueue): UploadItem => u.state.get().at(-1)!

function blobFileCount(dataDir: string): number {
  let n = 0
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else n++
    }
  }
  walk(path.join(dataDir, 'blobs'))
  return n
}

let tmp: string
let server: RunningServer
let relay: DevRelay
let pubkey: string
const imgA = makePng(1, 96, 40)
const imgB = makePng(2, 96, 40)

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'smh-int-'))
  server = await startBlossom({ dataDir: path.join(tmp, 'data') })
  relay = await startRelay({ persist: path.join(tmp, 'relay.jsonl') })
  identity.create()
  identity.keepInMemory()
  const state = identity.state
  if (state.phase !== 'unlocked') throw new Error('identity not unlocked')
  pubkey = state.pubkey
}, 60_000)

afterAll(async () => {
  await server.stop()
  await relay.close()
  rmSync(tmp, { recursive: true, force: true })
})

describe('upload → index → retrieve', () => {
  const a = stack('', [])
  let url = ''

  it('uploads a real image, stores its bytes once and publishes a NIP-94 event', async () => {
    url = server.url
    const s = stack(url, [relay.url])
    Object.assign(a, s)
    await s.library.start(pubkey)

    s.uploads.add([file(imgA)])
    await s.uploads.idle()
    const item = finalState(s.uploads)

    expect(item).toMatchObject({ status: 'done', sha256: sha(imgA), serverHadBlob: false })
    expect(item.relays).toEqual({ accepted: 1, total: 1 })

    // The relay received a signed kind 1063 event describing the file, not the bytes.
    const events = [...relay.events.values()].filter((e) => e.kind === 1063)
    expect(events).toHaveLength(1)
    const tag = (n: string) => events[0]!.tags.find((t) => t[0] === n)
    expect(tag('x')?.[1]).toBe(sha(imgA))
    expect(tag('m')?.[1]).toBe('image/png')
    expect(tag('size')?.[1]).toBe(String(imgA.length))
    expect(tag('thumb')?.[1]).toMatch(/\.png$/)
    expect(JSON.stringify(events[0])).not.toContain(
      Buffer.from(imgA).toString('base64').slice(0, 40),
    )
    expect(events[0]!.pubkey).toBe(pubkey)

    // The gallery sees it.
    expect(s.library.state.get().items.map((i) => i.sha256)).toEqual([sha(imgA)])
  })

  it('serves the exact bytes back from the blob URL', async () => {
    const item = a.library.state.get().items[0]!
    const res = await fetch(item.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(sha(body)).toBe(sha(imgA))

    const thumb = await fetch(item.thumbUrl!)
    expect(thumb.status).toBe(200)
  })

  it('stores the original and its thumbnail, and nothing else', async () => {
    const blobs = await listAllBlobs(server.url, pubkey, sign)
    expect(blobs.map((b) => b.sha256).sort()).toContain(sha(imgA))
    expect(blobs).toHaveLength(2)
    expect(blobFileCount(server.dataDir)).toBe(2)
  })

  it('recognises the same file as a duplicate without sending it again', async () => {
    const before = [...relay.events.keys()].length
    a.uploads.add([file(imgA, 'copy-of-photo.png')])
    await a.uploads.idle()
    expect(finalState(a.uploads)).toMatchObject({ status: 'duplicate', sha256: sha(imgA) })
    expect([...relay.events.keys()].length).toBe(before)
    expect(blobFileCount(server.dataDir)).toBe(2)
  })

  it('does not create a second physical blob when another index uploads the same bytes', async () => {
    // A new device: empty local cache, and a relay that has never seen the file.
    await cache.clearEvents()
    const lonely = await startRelay()
    const s = stack(server.url, [lonely.url])
    await s.library.start(pubkey)
    s.uploads.add([file(imgA)])
    await s.uploads.idle()
    expect(finalState(s.uploads)).toMatchObject({ status: 'done', serverHadBlob: true })
    expect(blobFileCount(server.dataDir)).toBe(2)
    s.library.stop()
    s.relays.destroy()
    await lonely.close()
  })
})

describe('relay trouble', () => {
  it('keeps the upload when a relay refuses the event, queues it, and delivers it later', async () => {
    const s = stack(server.url, [relay.url])
    await s.library.start(pubkey)
    relay.rejectWrites('blocked: try again later')

    s.uploads.add([file(imgB)])
    await s.uploads.idle()
    const item = finalState(s.uploads)
    expect(item.status).toBe('done')
    expect(item.relays).toEqual({ accepted: 0, total: 1 })
    expect(s.library.state.get().outbox.total).toBe(1)
    expect(s.library.state.get().items.some((i) => i.sha256 === sha(imgB))).toBe(true)

    relay.rejectWrites(null)
    await s.library.flushOutbox()
    expect(s.library.state.get().outbox.total).toBe(0)
    expect(
      [...relay.events.values()].some((e) =>
        e.tags.some((t) => t[0] === 'x' && t[1] === sha(imgB)),
      ),
    ).toBe(true)
    s.library.stop()
    s.relays.destroy()
  })

  it('shows the cached library when no relay can be reached, then recovers', async () => {
    const port = relay.port
    await relay.close()

    const s = stack(server.url, [`ws://127.0.0.1:${port}`])
    await s.library.start(pubkey)
    const state = s.library.state.get()
    expect(state.items.length).toBeGreaterThanOrEqual(2)
    expect(state.fromCacheOnly).toBe(true)
    expect(state.error).toMatch(/No relay answered/)

    relay = await startRelay({ port, persist: path.join(tmp, 'relay.jsonl') })
    await until(() => s.relays.statuses.get()[0]!.state === 'connected', 8000)
    await s.library.refresh()
    expect(s.library.state.get().fromCacheOnly).toBe(false)
    expect(s.library.state.get().error).toBeUndefined()
    s.library.stop()
    s.relays.destroy()
  })
})

describe('persistence and deletion', () => {
  it('serves the same bytes after the storage server restarts', async () => {
    const before = await listAllBlobs(server.url, pubkey, sign)
    const { port, dataDir } = server
    await server.stop()
    server = await startBlossom({ dataDir, port })

    const after = await listAllBlobs(server.url, pubkey, sign)
    expect(after.map((b) => b.sha256).sort()).toEqual(before.map((b) => b.sha256).sort())
    const res = await fetch(`${server.url}/${sha(imgA)}`)
    expect(sha(new Uint8Array(await res.arrayBuffer()))).toBe(sha(imgA))

    // Re-uploading still deduplicates after a restart.
    const s = stack(server.url, [relay.url])
    await s.library.start(pubkey)
    const direct = await fetch(`${server.url}/upload`, {
      method: 'PUT',
      headers: {
        Authorization: await authorization(sign, {
          verb: 'upload',
          serverUrl: server.url,
          hashes: [sha(imgA)],
          content: 'again',
        }),
        'X-SHA-256': sha(imgA),
      },
      body: imgA as BodyInit,
    })
    expect(direct.status).toBe(200)
    expect(blobFileCount(server.dataDir)).toBe(before.length)
    s.library.stop()
    s.relays.destroy()
  })

  it('removes metadata first, then the blob, and the item stays gone after a refresh', async () => {
    const s = stack(server.url, [relay.url])
    await s.library.start(pubkey)
    const item = s.library.state.get().items.find((i) => i.sha256 === sha(imgB))!
    expect(item).toBeTruthy()

    const outcome = await s.library.remove(item.sha256)
    expect(outcome?.report.accepted).toBe(1)
    const token = await authorization(sign, {
      verb: 'delete',
      serverUrl: server.url,
      hashes: [item.sha256],
      content: 'Delete',
    })
    const result = await deleteBlob(server.url, item.sha256, token)
    expect(result).toMatchObject({ file_removed: true, owners_remaining: 0 })

    expect((await fetch(`${server.url}/${item.sha256}`)).status).toBe(404)
    expect(s.library.state.get().items.some((i) => i.sha256 === sha(imgB))).toBe(false)

    await cache.clearEvents()
    s.library.stop()
    await s.library.start(pubkey)
    expect(s.library.state.get().items.some((i) => i.sha256 === sha(imgB))).toBe(false)
    expect(s.library.state.get().items.some((i) => i.sha256 === sha(imgA))).toBe(true)
    s.library.stop()
    s.relays.destroy()
  })

  it('rejects an attempt to delete someone else’s blob', async () => {
    const other = (await import('../../src/lib/nostr/keys')).generateKey()
    const { signWithKey } = await import('../../src/lib/nostr/keys')
    const token = await authorization((t) => Promise.resolve(signWithKey(other, t)), {
      verb: 'delete',
      serverUrl: server.url,
      hashes: [sha(imgA)],
      content: 'Delete',
    })
    await expect(deleteBlob(server.url, sha(imgA), token)).rejects.toMatchObject({ status: 404 })
    expect((await fetch(`${server.url}/${sha(imgA)}`)).status).toBe(200)
  })
})
