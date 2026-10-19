import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../nostr/events'
import { applyQuery, DEFAULT_QUERY, isFiltered, parseQuery } from './query'

const item = (n: number, over: Partial<MediaItem> = {}): MediaItem => ({
  id: String(n).padStart(64, '0'),
  pubkey: 'p'.repeat(64),
  createdAt: 1_700_000_000 + n,
  url: 'https://h/' + n,
  sha256: String(n).repeat(64),
  originalSha256: String(n).repeat(64),
  mime: 'image/jpeg',
  kind: 'image',
  caption: '',
  ...over,
})

const items = [
  item(1, { size: 500, caption: 'Harbour at dusk', taken: 1_600_000_000 }),
  item(2, { size: 9000, kind: 'video', mime: 'video/mp4', alt: 'Boat leaving' }),
  item(3, { size: 100, taken: 1_800_000_000 }),
]

const ids = (list: MediaItem[]) => list.map((i) => i.createdAt - 1_700_000_000)

describe('applyQuery', () => {
  it('sorts newest added first by default and does not mutate its input', () => {
    const copy = [...items]
    expect(ids(applyQuery(items, DEFAULT_QUERY))).toEqual([3, 2, 1])
    expect(items).toEqual(copy)
  })

  it('sorts oldest first, by size and by date taken', () => {
    expect(ids(applyQuery(items, { ...DEFAULT_QUERY, sort: 'added-asc' }))).toEqual([1, 2, 3])
    expect(ids(applyQuery(items, { ...DEFAULT_QUERY, sort: 'size-desc' }))).toEqual([2, 1, 3])
    expect(ids(applyQuery(items, { ...DEFAULT_QUERY, sort: 'taken-desc' }))).toEqual([3, 2, 1])
  })

  it('filters by type', () => {
    expect(ids(applyQuery(items, { ...DEFAULT_QUERY, type: 'video' }))).toEqual([2])
    expect(ids(applyQuery(items, { ...DEFAULT_QUERY, type: 'image' }))).toEqual([3, 1])
  })

  it('searches captions, alt text, mime type, hash prefix and date', () => {
    const q = (text: string) => ids(applyQuery(items, { ...DEFAULT_QUERY, q: text }))
    expect(q('harbour')).toEqual([1])
    expect(q('BOAT')).toEqual([2])
    expect(q('video/')).toEqual([2])
    expect(q(items[2]!.sha256.slice(0, 10))).toEqual([3])
    expect(q('2020-09')).toEqual([1])
    expect(q('nothing matches this')).toEqual([])
  })

  it('treats whitespace-only text as no search', () => {
    expect(applyQuery(items, { ...DEFAULT_QUERY, q: '   ' })).toHaveLength(3)
  })
})

describe('parseQuery', () => {
  it('reads valid values and falls back for invalid ones', () => {
    expect(parseQuery(new URLSearchParams('q=a&type=video&sort=size-desc'))).toEqual({
      q: 'a',
      type: 'video',
      sort: 'size-desc',
    })
    expect(parseQuery(new URLSearchParams('type=pdf&sort=random'))).toEqual(DEFAULT_QUERY)
  })

  it('reports whether anything narrows the list', () => {
    expect(isFiltered(DEFAULT_QUERY)).toBe(false)
    expect(isFiltered({ ...DEFAULT_QUERY, type: 'image' })).toBe(true)
    expect(isFiltered({ ...DEFAULT_QUERY, q: 'x' })).toBe(true)
  })
})
