import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ImageOff, Play } from 'lucide-react'
import { formatBytes, formatDate, formatDuration } from '../lib/format'
import { justifiedLayout, visibleRows } from '../lib/media/layout'
import { blurhashToDataUrl } from '../lib/media/placeholder'
import type { MediaItem } from '../lib/nostr/events'

export interface GridProps {
  items: MediaItem[]
  selected: ReadonlySet<string>
  selecting: boolean
  onOpen: (item: MediaItem) => void
  onToggle: (item: MediaItem, shift: boolean) => void
}

const GAP = 3

function ratioOf(item: MediaItem): number {
  if (item.width && item.height) return item.width / item.height
  return item.kind === 'video' ? 16 / 9 : 4 / 3
}

function rowHeightFor(width: number): number {
  if (width < 520) return 120
  if (width < 900) return 170
  return 210
}

/** Walks up to the element that scrolls. The page has exactly one. */
function scrollParent(el: HTMLElement | null): HTMLElement {
  let node: HTMLElement | null = el?.parentElement ?? null
  while (node && node !== document.body) {
    if (node.hasAttribute('data-scroll-root')) return node
    node = node.parentElement
  }
  return document.documentElement
}

/**
 * Justified rows with row-level virtualization.
 *
 * Positions come from the metadata alone (`dim` tags), so nothing shifts when
 * images load, and only the rows near the viewport exist in the DOM. Arrow
 * keys move between tiles; the grid is a single tab stop.
 */
export function JustifiedGrid({ items, selected, selecting, onOpen, onToggle }: GridProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 800 })
  const [focusIndex, setFocusIndex] = useState(0)
  const pendingFocus = useRef(false)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    const root = scrollParent(wrap)
    let frame = 0
    const measure = () => {
      frame = 0
      if (!wrap) return
      const rootTop = root === document.documentElement ? 0 : root.getBoundingClientRect().top
      const offset =
        wrap.getBoundingClientRect().top -
        rootTop +
        (root === document.documentElement ? window.scrollY : root.scrollTop)
      const scrollTop = root === document.documentElement ? window.scrollY : root.scrollTop
      const height = root === document.documentElement ? window.innerHeight : root.clientHeight
      setViewport({ top: scrollTop - offset, height })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const target: HTMLElement | Window = root === document.documentElement ? window : root
    target.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      target.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const ratios = useMemo(() => items.map(ratioOf), [items])
  const layout = useMemo(
    () => justifiedLayout({ width, targetRowHeight: rowHeightFor(width), gap: GAP, ratios }),
    [width, ratios],
  )
  const [first, last] = visibleRows(
    layout.rows,
    viewport.top,
    viewport.height,
    viewport.height * 0.75,
  )

  const cellOf = useMemo(() => {
    const map = new Map<number, { row: number; center: number }>()
    layout.rows.forEach((r, ri) =>
      r.cells.forEach((c) => map.set(c.index, { row: ri, center: c.left + c.width / 2 })),
    )
    return map
  }, [layout])

  const focusTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(items.length - 1, index))
      setFocusIndex(clamped)
      pendingFocus.current = true
      const cell = cellOf.get(clamped)
      const row = cell ? layout.rows[cell.row] : undefined
      if (row) {
        const root = scrollParent(wrapRef.current)
        const wrap = wrapRef.current
        if (wrap) {
          const rootTop = root === document.documentElement ? 0 : root.getBoundingClientRect().top
          const base =
            wrap.getBoundingClientRect().top -
            rootTop +
            (root === document.documentElement ? window.scrollY : root.scrollTop)
          const top = base + row.top
          const scrollTop = root === document.documentElement ? window.scrollY : root.scrollTop
          const height = root === document.documentElement ? window.innerHeight : root.clientHeight
          if (top < scrollTop + 8) root.scrollTo({ top: top - 64 })
          else if (top + row.height > scrollTop + height - 8)
            root.scrollTo({ top: top + row.height - height + 24 })
        }
      }
    },
    [cellOf, items.length, layout.rows],
  )

  useEffect(() => {
    if (!pendingFocus.current) return
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-index="${focusIndex}"]`)
    if (el) {
      pendingFocus.current = false
      el.focus({ preventScroll: true })
    }
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = cellOf.get(focusIndex)
    if (!cur) return
    const vertical = (dir: 1 | -1) => {
      const target = layout.rows[cur.row + dir]
      if (!target) return focusIndex
      let best = target.cells[0]!
      for (const c of target.cells) {
        if (
          Math.abs(c.left + c.width / 2 - cur.center) <
          Math.abs(best.left + best.width / 2 - cur.center)
        )
          best = c
      }
      return best.index
    }
    const perPage = Math.max(1, Math.floor(viewport.height / (rowHeightFor(width) + GAP))) * 4
    const keys: Record<string, number> = {
      ArrowRight: focusIndex + 1,
      ArrowLeft: focusIndex - 1,
      ArrowDown: vertical(1),
      ArrowUp: vertical(-1),
      Home: 0,
      End: items.length - 1,
      PageDown: focusIndex + perPage,
      PageUp: focusIndex - perPage,
    }
    if (e.key in keys) {
      e.preventDefault()
      focusTo(keys[e.key]!)
    }
  }

  return (
    <div
      ref={wrapRef}
      className="grid"
      style={{ height: layout.height }}
      role="group"
      aria-label={`Library, ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      onKeyDown={onKeyDown}
    >
      {layout.rows.slice(first, last).flatMap((row) =>
        row.cells.map((cell) => {
          const item = items[cell.index]!
          return (
            <Tile
              key={item.sha256}
              item={item}
              index={cell.index}
              left={cell.left}
              top={row.top}
              width={cell.width}
              height={row.height}
              selected={selected.has(item.sha256)}
              selecting={selecting}
              tabbable={cell.index === focusIndex}
              onFocusIndex={setFocusIndex}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          )
        }),
      )}
    </div>
  )
}

interface TileProps {
  item: MediaItem
  index: number
  left: number
  top: number
  width: number
  height: number
  selected: boolean
  selecting: boolean
  tabbable: boolean
  onFocusIndex: (i: number) => void
  onOpen: (item: MediaItem) => void
  onToggle: (item: MediaItem, shift: boolean) => void
}

const Tile = memo(function Tile({
  item,
  index,
  left,
  top,
  width,
  height,
  selected,
  selecting,
  tabbable,
  onFocusIndex,
  onOpen,
  onToggle,
}: TileProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const src = item.thumbUrl ?? (item.kind === 'image' ? item.url : undefined)
  const placeholder = useMemo(
    () => (item.blurhash ? blurhashToDataUrl(item.blurhash) : undefined),
    [item.blurhash],
  )

  const date = formatDate(item.taken ?? item.createdAt)
  const label = `${item.kind === 'video' ? `Video${item.durationSeconds ? ` ${formatDuration(item.durationSeconds)}` : ''}` : 'Photo'}, ${date}${item.size ? `, ${formatBytes(item.size)}` : ''}${selected ? ', selected' : ''}`

  return (
    <div
      className="tile"
      data-selected={selected || undefined}
      data-selecting={selecting || undefined}
      style={{ transform: `translate(${left}px, ${top}px)`, width, height }}
    >
      <button
        type="button"
        className="tile__main"
        data-index={index}
        tabIndex={tabbable ? 0 : -1}
        aria-label={label}
        aria-pressed={selecting ? selected : undefined}
        onFocus={() => onFocusIndex(index)}
        onClick={(e) => {
          if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) onToggle(item, e.shiftKey)
          else onOpen(item)
        }}
        style={placeholder ? { backgroundImage: `url(${placeholder})` } : undefined}
      >
        {src && !failed ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            data-loaded={loaded || undefined}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="tile__missing">
            {item.kind === 'video' && !failed ? (
              <Play className="icon icon--lg" />
            ) : (
              <ImageOff className="icon icon--lg" />
            )}
            <span>{failed ? 'Unavailable' : 'No preview'}</span>
          </span>
        )}
        {item.kind === 'video' && (
          <span className="tile__badge" aria-hidden="true">
            <Play className="icon icon--sm" fill="currentColor" />
            {item.durationSeconds ? formatDuration(item.durationSeconds) : 'Video'}
          </span>
        )}
        {width >= 150 && (
          <span className="tile__caption" aria-hidden="true">
            {date}
            {item.size ? ` · ${formatBytes(item.size)}` : ''}
          </span>
        )}
      </button>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${label}`}
        className="tile__check"
        tabIndex={-1}
        onClick={(e) => onToggle(item, e.shiftKey)}
      >
        {selected && <Check className="icon icon--sm" strokeWidth={3} />}
      </button>
    </div>
  )
})

export function GridSkeleton() {
  return (
    <div className="grid-skeleton" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          style={{ aspectRatio: i % 3 === 0 ? '3 / 2' : i % 3 === 1 ? '4 / 3' : '1 / 1' }}
        />
      ))}
    </div>
  )
}
