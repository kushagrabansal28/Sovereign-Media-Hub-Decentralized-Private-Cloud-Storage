import type { Event, EventTemplate } from './keys'

/**
 * Library metadata uses NIP-94 (kind 1063, "File Metadata") with the standard
 * tags url, m, x, ox, size, dim, blurhash, thumb and alt. One non-standard tag,
 * `smh-taken`, carries the file's last-modified time as a capture-time hint.
 * Relays and other clients ignore tags they do not know.
 *
 * Deletions use NIP-09 (kind 5) with `e` and `k` tags.
 */
export const KIND_FILE_METADATA = 1063
export const KIND_DELETION = 5

export type MediaKind = 'image' | 'video'

export interface MediaItem {
  /** Nostr event id. */
  id: string
  pubkey: string
  /** Seconds since epoch when the metadata event was created. */
  createdAt: number
  url: string
  sha256: string
  originalSha256: string
  mime: string
  kind: MediaKind
  size?: number
  width?: number
  height?: number
  blurhash?: string
  thumbUrl?: string
  thumbSha256?: string
  alt?: string
  caption: string
  /** Capture-time hint (file last-modified), seconds since epoch. */
  taken?: number
  durationSeconds?: number
}

const HEX64 = /^[0-9a-f]{64}$/
const DIM = /^(\d{1,6})x(\d{1,6})$/
const BLURHASH = /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,200}$/
const MIME = /^(image|video)\/[a-z0-9.+-]{1,60}$/

function isHttpUrl(value: string | undefined): value is string {
  if (!value || value.length > 2048) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function firstTag(tags: string[][], name: string): string[] | undefined {
  return tags.find((t) => t[0] === name)
}

/**
 * Converts a relay event into a MediaItem, or returns null if it does not
 * describe usable media. Relay content is untrusted, so every field is checked.
 */
export function parseMediaEvent(ev: Event): MediaItem | null {
  if (ev.kind !== KIND_FILE_METADATA || !Array.isArray(ev.tags)) return null

  const url = firstTag(ev.tags, 'url')?.[1]
  const x = firstTag(ev.tags, 'x')?.[1]
  const m = firstTag(ev.tags, 'm')?.[1]?.toLowerCase()
  if (!isHttpUrl(url) || !x || !HEX64.test(x) || !m || !MIME.test(m)) return null

  const ox = firstTag(ev.tags, 'ox')?.[1]
  const item: MediaItem = {
    id: ev.id,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
    url,
    sha256: x,
    originalSha256: ox && HEX64.test(ox) ? ox : x,
    mime: m,
    kind: m.startsWith('video/') ? 'video' : 'image',
    caption: typeof ev.content === 'string' ? ev.content.slice(0, 2000) : '',
  }

  const size = firstTag(ev.tags, 'size')?.[1]
  if (size && /^\d{1,15}$/.test(size)) item.size = Number(size)

  const dim = firstTag(ev.tags, 'dim')?.[1]?.match(DIM)
  if (dim) {
    const w = Number(dim[1])
    const h = Number(dim[2])
    if (w > 0 && h > 0) {
      item.width = w
      item.height = h
    }
  }

  const blurhash = firstTag(ev.tags, 'blurhash')?.[1]
  if (blurhash && BLURHASH.test(blurhash)) item.blurhash = blurhash

  const thumb = firstTag(ev.tags, 'thumb')
  if (isHttpUrl(thumb?.[1])) {
    item.thumbUrl = thumb[1]
    if (thumb[2] && HEX64.test(thumb[2])) item.thumbSha256 = thumb[2]
  }

  const alt = firstTag(ev.tags, 'alt')?.[1]
  if (alt) item.alt = alt.slice(0, 500)

  const taken = firstTag(ev.tags, 'smh-taken')?.[1]
  if (taken && /^\d{1,11}$/.test(taken)) item.taken = Number(taken)

  const duration = firstTag(ev.tags, 'smh-duration')?.[1]
  if (duration && /^\d{1,6}(\.\d{1,3})?$/.test(duration)) item.durationSeconds = Number(duration)

  return item
}

export interface MediaEventInput {
  url: string
  sha256: string
  mime: string
  size: number
  width?: number
  height?: number
  blurhash?: string
  thumb?: { url: string; sha256: string }
  alt?: string
  caption?: string
  taken?: number
  durationSeconds?: number
  now?: () => number
}

export function buildMediaEvent(input: MediaEventInput): EventTemplate {
  const tags: string[][] = [
    ['url', input.url],
    ['m', input.mime],
    ['x', input.sha256],
    ['ox', input.sha256],
    ['size', String(input.size)],
  ]
  if (input.width && input.height) tags.push(['dim', `${input.width}x${input.height}`])
  if (input.blurhash) tags.push(['blurhash', input.blurhash])
  if (input.thumb) tags.push(['thumb', input.thumb.url, input.thumb.sha256])
  if (input.alt) tags.push(['alt', input.alt])
  if (input.taken) tags.push(['smh-taken', String(Math.floor(input.taken))])
  if (input.durationSeconds) tags.push(['smh-duration', input.durationSeconds.toFixed(1)])
  return {
    kind: KIND_FILE_METADATA,
    created_at: Math.floor((input.now?.() ?? Date.now()) / 1000),
    tags,
    content: input.caption ?? '',
  }
}

export function buildDeletionEvent(
  eventIds: string[],
  now: () => number = Date.now,
): EventTemplate {
  return {
    kind: KIND_DELETION,
    created_at: Math.floor(now() / 1000),
    tags: [...eventIds.map((id) => ['e', id]), ['k', String(KIND_FILE_METADATA)]],
    content: 'Removed from library',
  }
}

/** Event ids a kind 5 event asks to delete, if it was signed by `pubkey`. */
export function deletedIds(ev: Event, pubkey: string): string[] {
  if (ev.kind !== KIND_DELETION || ev.pubkey !== pubkey) return []
  return ev.tags.filter((t) => t[0] === 'e' && t[1] && HEX64.test(t[1])).map((t) => t[1] as string)
}
