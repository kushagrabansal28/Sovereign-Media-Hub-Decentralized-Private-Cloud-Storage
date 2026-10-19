import { useSyncExternalStore } from 'react'
import { RelayManager, type RelayStatus } from './lib/nostr/relays'
import { identity } from './stores/identity'
import { Library } from './stores/library'
import { ServerConnection } from './stores/connections'
import { settings } from './stores/settings'
import { UploadQueue } from './stores/uploads'

/**
 * The application's long-lived services, created once and wired to the
 * settings and identity stores. Components read them through hooks.
 */
export const relays = new RelayManager()
export const server = new ServerConnection(() => settings.get().serverUrl)
export const library = new Library({ relays, sign: (t) => identity.sign(t) })
export const uploads = new UploadQueue({
  library,
  sign: (t) => identity.sign(t),
  serverUrl: () => settings.get().serverUrl,
  maxBytes: () => server.maxUploadBytes(),
})

let wired = false

/** Connects services to stores. Idempotent. */
export function startApp() {
  if (wired) return
  wired = true

  relays.setRelays(settings.get().relays)
  let lastRelays = settings.get().relays.join('\n')
  let lastServer = settings.get().serverUrl
  settings.subscribe(() => {
    const s = settings.get()
    if (s.relays.join('\n') !== lastRelays) {
      lastRelays = s.relays.join('\n')
      relays.setRelays(s.relays)
    }
    if (s.serverUrl !== lastServer) {
      lastServer = s.serverUrl
      void server.check()
    }
  })

  const sync = () => {
    const state = identity.state
    if (state.phase === 'unlocked') void library.start(state.pubkey)
    else library.stop()
  }
  let lastKey = ''
  identity.subscribe(() => {
    const state = identity.state
    const key = state.phase === 'unlocked' ? state.pubkey : ''
    if (key !== lastKey) {
      lastKey = key
      sync()
    }
  })
  if (identity.state.phase === 'unlocked') {
    lastKey = identity.state.pubkey
    sync()
  }
  server.start()
}

export function useRelayStatuses(): RelayStatus[] {
  return useSyncExternalStore(relays.statuses.subscribe, relays.statuses.get)
}
