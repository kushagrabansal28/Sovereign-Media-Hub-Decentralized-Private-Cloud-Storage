import 'fake-indexeddb/auto'
import WebSocket from 'ws'

// Node 22's built-in WebSocket re-fires `error` from inside `close()` while a connection is
// still failing, and nostr-tools closes the socket in its error handler. That recurses until
// the stack overflows. Browsers do not do this. Tests use the `ws` package instead.
Object.defineProperty(globalThis, 'WebSocket', {
  value: WebSocket,
  configurable: true,
  writable: true,
})
