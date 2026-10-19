import type { MediaItem } from '../nostr/events'

export type TypeFilter = 'all' | 'image' | 'video'
export type SortKey = 'added-desc' | 'added-asc' | 'taken-desc' | 'size-desc'

export interface Query {
  q: string
  type: TypeFilter
  sort: SortKey
}

export const DEFAULT_QUERY: Query = { q: '', type: 'all', sort: 'added-desc' }

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'added-desc', label: 'Newest added' },
  { value: 'added-asc', label: 'Oldest added' },
  { value: 'taken-desc', label: 'Date taken' },
  { value: 'size-desc', label: 'Largest' },
]

export function parseQuery(params: URLSearchParams): Query {
  const type = params.get('type')
  const sort = params.get('sort')
  return {
    q: params.get('q') ?? '',
    type: type === 'image' || type === 'video' ? type : 'all',
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as SortKey) : 'added-desc',
  }
}

export function isFiltered(q: Query): boolean {
  return q.q.trim() !== '' || q.type !== 'all'
}

/** Date text a user might type: 2026, 2026-03, 2026-03-14. */
function isoDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

function matches(item: MediaItem, needle: string): boolean {
  if (item.sha256.startsWith(needle)) return true
  if (item.caption.toLowerCase().includes(needle)) return true
  if (item.alt?.toLowerCase().includes(needle)) return true
  if (item.mime.includes(needle)) return true
  if (isoDay(item.taken ?? item.createdAt).startsWith(needle)) return true
  return false
}

/** Applies the search text, type filter and sort order. Returns a new array. */
export function applyQuery(items: MediaItem[], query: Query): MediaItem[] {
  const needle = query.q.trim().toLowerCase()
  let out = items.filter(
    (i) => (query.type === 'all' || i.kind === query.type) && (needle === '' || matches(i, needle)),
  )
  const byAdded = (a: MediaItem, b: MediaItem) =>
    b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)
  switch (query.sort) {
    case 'added-desc':
      out = out.sort(byAdded)
      break
    case 'added-asc':
      out = out.sort((a, b) => -byAdded(a, b))
      break
    case 'taken-desc':
      out = out.sort((a, b) => (b.taken ?? b.createdAt) - (a.taken ?? a.createdAt) || byAdded(a, b))
      break
    case 'size-desc':
      out = out.sort((a, b) => (b.size ?? 0) - (a.size ?? 0) || byAdded(a, b))
      break
  }
  return out
}
