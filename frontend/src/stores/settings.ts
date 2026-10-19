import { useSyncExternalStore } from 'react'
import { normalizeServerUrl } from '../lib/blossom/client'
import { normalizeRelayUrl } from '../lib/nostr/relays'
import { createStore } from './createStore'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  serverUrl: string
  relays: string[]
  theme: Theme
  /** False until the user has confirmed the connection details once. */
  confirmed: boolean
}

const KEY = 'smh.settings.v1'

/** Used when neither the user nor /config.json says otherwise (local development). */
export const FALLBACK: Settings = {
  serverUrl: 'http://localhost:8787',
  relays: ['ws://localhost:7777'],
  theme: 'system',
  confirmed: false,
}

let defaults: Settings = FALLBACK

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : defaults.serverUrl,
      relays: Array.isArray(parsed.relays)
        ? parsed.relays.filter((r) => typeof r === 'string')
        : defaults.relays,
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system',
      confirmed: parsed.confirmed === true,
    }
  } catch {
    return defaults
  }
}

const store = createStore<Settings>(load())

function persist(value: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* private mode: settings last for this session only */
  }
}

export const settings = {
  get: store.get,
  subscribe: store.subscribe,

  update(patch: Partial<Settings>) {
    const next = { ...store.get(), ...patch }
    store.set(next)
    persist(next)
  },

  setServer(input: string) {
    this.update({ serverUrl: normalizeServerUrl(input) })
  },

  addRelay(input: string) {
    const url = normalizeRelayUrl(input)
    const current = store.get().relays
    if (current.includes(url)) throw new Error('That relay is already in the list.')
    this.update({ relays: [...current, url] })
  },

  removeRelay(url: string) {
    this.update({ relays: store.get().relays.filter((r) => r !== url) })
  },

  /**
   * Reads deployment defaults from /config.json. They apply only until the user
   * saves their own connection settings.
   */
  async loadDeploymentDefaults(fetcher: typeof fetch = fetch): Promise<void> {
    try {
      const res = await fetcher('/config.json', { cache: 'no-store' })
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return
      const cfg = (await res.json()) as { blossomUrl?: string; relays?: string[] }
      const next: Settings = {
        ...FALLBACK,
        serverUrl: cfg.blossomUrl ? normalizeServerUrl(cfg.blossomUrl) : FALLBACK.serverUrl,
        relays: (cfg.relays ?? FALLBACK.relays).map(normalizeRelayUrl),
      }
      defaults = next
      if (!store.get().confirmed) store.set({ ...next, theme: store.get().theme })
    } catch {
      /* no deployment config: keep the fallback */
    }
  },
}

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, store.get)
}

/** Applies the theme to <html>. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
