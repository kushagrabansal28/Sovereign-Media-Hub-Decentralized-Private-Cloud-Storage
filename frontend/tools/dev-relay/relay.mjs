// A small Nostr relay for development and automated tests.
//
// It verifies signatures, answers REQ/EVENT/CLOSE, applies NIP-09 deletions and
// can persist events to a JSON-lines file. It is not hardened and has no rate
// limits or access control: do not expose it to the internet.
//
//   node tools/dev-relay/relay.mjs --port 7777 --persist data/relay.jsonl
import fs from 'node:fs'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { verifyEvent } from 'nostr-tools/pure'

function matches(filter, ev) {
  if (filter.ids && !filter.ids.includes(ev.id)) return false
  if (filter.authors && !filter.authors.includes(ev.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(ev.kind)) return false
  if (filter.since !== undefined && ev.created_at < filter.since) return false
  if (filter.until !== undefined && ev.created_at > filter.until) return false
  for (const [key, wanted] of Object.entries(filter)) {
    if (key[0] !== '#') continue
    const name = key.slice(1)
    if (!ev.tags.some((t) => t[0] === name && wanted.includes(t[1]))) return false
  }
  return true
}

export function startRelay({ port = 0, persist, maxLimit = 500, host = '127.0.0.1' } = {}) {
  const events = new Map()
  const subs = new Set() // { ws, id, filters }
  let rejectWrites = null // string reason when writes should be refused
  let delayMs = 0

  if (persist && fs.existsSync(persist)) {
    for (const line of fs.readFileSync(persist, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        events.set(ev.id, ev)
      } catch {
        /* skip damaged line */
      }
    }
  }

  const server = http.createServer((req, res) => {
    if (req.headers.accept?.includes('application/nostr+json')) {
      res.writeHead(200, {
        'content-type': 'application/nostr+json',
        'access-control-allow-origin': '*',
      })
      res.end(
        JSON.stringify({
          name: 'smh dev relay',
          supported_nips: [1, 9, 11],
          software: 'smh-dev-relay',
          limitation: { max_limit: maxLimit },
        }),
      )
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('Sovereign Media Hub development relay\n')
  })
  const wss = new WebSocketServer({ server })

  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg))
  const later = (fn) => (delayMs ? setTimeout(fn, delayMs) : fn())

  function store(ev) {
    events.set(ev.id, ev)
    if (persist) fs.appendFileSync(persist, JSON.stringify(ev) + '\n')
    if (ev.kind === 5) {
      for (const tag of ev.tags) {
        if (tag[0] !== 'e') continue
        const target = events.get(tag[1])
        if (target && target.pubkey === ev.pubkey && target.kind !== 5) events.delete(target.id)
      }
    }
    for (const sub of subs) {
      if (sub.filters.some((f) => matches(f, ev))) send(sub.ws, ['EVENT', sub.id, ev])
    }
  }

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return send(ws, ['NOTICE', 'error: invalid JSON'])
      }
      if (!Array.isArray(msg)) return send(ws, ['NOTICE', 'error: message must be an array'])
      const [type] = msg

      if (type === 'EVENT') {
        const ev = msg[1]
        later(() => {
          if (rejectWrites) return send(ws, ['OK', ev?.id ?? '', false, rejectWrites])
          if (!ev || typeof ev.id !== 'string' || !verifyEvent(ev)) {
            return send(ws, ['OK', ev?.id ?? '', false, 'invalid: bad id or signature'])
          }
          if (events.has(ev.id))
            return send(ws, ['OK', ev.id, true, 'duplicate: already have this event'])
          store(ev)
          send(ws, ['OK', ev.id, true, ''])
        })
      } else if (type === 'REQ') {
        const [, id, ...filters] = msg
        later(() => {
          subs.add({ ws, id, filters })
          const seen = new Set()
          for (const f of filters) {
            const limit = Math.min(f.limit ?? maxLimit, maxLimit)
            const found = [...events.values()]
              .filter((ev) => matches(f, ev))
              .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))
              .slice(0, limit)
            for (const ev of found) {
              if (seen.has(ev.id)) continue
              seen.add(ev.id)
              send(ws, ['EVENT', id, ev])
            }
          }
          send(ws, ['EOSE', id])
        })
      } else if (type === 'CLOSE') {
        for (const sub of subs) if (sub.ws === ws && sub.id === msg[1]) subs.delete(sub)
      }
    })
    ws.on('close', () => {
      for (const sub of subs) if (sub.ws === ws) subs.delete(sub)
    })
  })

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const actual = server.address().port
      resolve({
        url: `ws://${host}:${actual}`,
        port: actual,
        events,
        /** Make the relay answer OK=false to every EVENT; pass null to accept again. */
        rejectWrites: (reason) => (rejectWrites = reason),
        setDelay: (ms) => (delayMs = ms),
        /** Drop every client connection without stopping the server. */
        dropConnections: () => wss.clients.forEach((c) => c.terminate()),
        close: () =>
          new Promise((done) => {
            wss.clients.forEach((c) => c.terminate())
            wss.close(() => server.close(() => done()))
          }),
      })
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : fallback
  }
  const relay = await startRelay({
    port: Number(opt('port', 7777)),
    persist: opt('persist'),
    maxLimit: Number(opt('max-limit', 500)),
    host: opt('host', '127.0.0.1'),
  })
  process.stdout.write(`dev relay listening on ${relay.url} (${relay.events.size} stored events)
`)
  const stop = () => relay.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
