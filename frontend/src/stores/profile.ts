import { useSyncExternalStore } from 'react'
import { createStore } from './createStore'

/**
 * The name and photo shown for an identity on this device. They are kept in this browser
 * only, beside the encrypted key. They are never sent to the storage server or to relays.
 */
export interface Profile {
  name: string
  /** A small JPEG as a data URL, made by `resizeAvatar`. */
  picture?: string
}

const KEY = 'smh.profiles.v1'
export const MAX_NAME = 40
const MAX_PICTURE = 60_000

export function cleanName(raw: string): string {
  const spaced = Array.from(raw, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
  return spaced.join('').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

function load(): Record<string, Profile> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Profile>
    const out: Record<string, Profile> = {}
    for (const [pubkey, p] of Object.entries(parsed)) {
      const name = typeof p?.name === 'string' ? cleanName(p.name) : ''
      if (!/^[0-9a-f]{64}$/.test(pubkey) || !name) continue
      const picture =
        typeof p.picture === 'string' &&
        p.picture.startsWith('data:image/jpeg;base64,') &&
        p.picture.length <= MAX_PICTURE
          ? p.picture
          : undefined
      out[pubkey] = picture ? { name, picture } : { name }
    }
    return out
  } catch {
    return {}
  }
}

const store = createStore<Record<string, Profile>>(load())

function persist(next: Record<string, Profile>) {
  store.set(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: the profile lasts until the tab closes */
  }
}

export const profiles = {
  get: (pubkey: string): Profile | undefined => store.get()[pubkey],
  /** Returns false when the name is empty after cleaning. */
  set(pubkey: string, profile: Profile): boolean {
    const name = cleanName(profile.name)
    if (!name) return false
    const picture =
      profile.picture && profile.picture.length <= MAX_PICTURE ? profile.picture : undefined
    persist({ ...store.get(), [pubkey]: picture ? { name, picture } : { name } })
    return true
  },
  remove(pubkey: string) {
    const { [pubkey]: _gone, ...rest } = store.get()
    void _gone
    persist(rest)
  },
}

export function useProfile(pubkey: string | undefined): Profile | undefined {
  const all = useSyncExternalStore(store.subscribe, store.get)
  return pubkey ? all[pubkey] : undefined
}

export function __resetProfilesForTests() {
  store.set({})
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
