import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileWarning,
  Hash,
  Info,
  Maximize,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { formatBytes, formatDateTime } from '../lib/format'
import { downloadOriginal, originalSources } from '../lib/media/actions'
import type { MediaItem } from '../lib/nostr/events'
import { useSettings } from '../stores/settings'
import { Button, CopyButton, IconButton, notify, Spinner } from './ui'

interface ViewerProps {
  items: MediaItem[]
  index: number
  onClose: () => void
  onNavigate: (item: MediaItem) => void
  onDelete: (item: MediaItem) => void
}

const MAX_SCALE = 8
const PREFETCH_LIMIT = 6 * 1024 * 1024

export function Viewer({ items, index, onClose, onNavigate, onDelete }: ViewerProps) {
  const item = items[index]!
  const { serverUrl } = useSettings()
  const [showInfo, setShowInfo] = useState(false)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [progress, setProgress] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const prev = index > 0 ? items[index - 1] : undefined
  const next = index < items.length - 1 ? items[index + 1] : undefined

  // Reset zoom when the item changes (state adjusted during render, not in an effect).
  const [seen, setSeen] = useState(item.sha256)
  if (seen !== item.sha256) {
    setSeen(item.sha256)
    setScale(1)
    setPan({ x: 0, y: 0 })
  }

  // Focus on open, restore on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    rootRef.current?.focus()
    return () => {
      setTimeout(() => {
        const target = opener?.isConnected
          ? opener
          : document.querySelector<HTMLElement>('[data-index][tabindex="0"]')
        target?.focus()
      }, 0)
    }
  }, [])

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => {
      const n = Math.min(MAX_SCALE, Math.max(1, s * factor))
      if (n === 1) setPan({ x: 0, y: 0 })
      return n
    })
  }, [])

  const download = useCallback(async () => {
    if (progress !== null) return
    setProgress(0)
    try {
      await downloadOriginal(item, serverUrl, (got, total) => setProgress(total ? got / total : 0))
      notify('Saved. The file matched its SHA-256.')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Download failed.', 'error')
    } finally {
      setProgress(null)
    }
  }, [item, progress, serverUrl])

  // Prefetch the next original only when it is small enough to be cheap.
  useEffect(() => {
    if (next && next.kind === 'image' && next.size && next.size <= PREFETCH_LIMIT) {
      const img = new Image()
      img.src = next.url
    }
  }, [next])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inVideo = (e.target as HTMLElement).tagName === 'VIDEO'
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowLeft' && !inVideo && prev) onNavigate(prev)
    else if (e.key === 'ArrowRight' && !inVideo && next) onNavigate(next)
    else if (e.key === 'i') setShowInfo((v) => !v)
    else if (e.key === '+' || e.key === '=') zoomBy(1.5)
    else if (e.key === '-') zoomBy(1 / 1.5)
    else if (e.key === '0') {
      setScale(1)
      setPan({ x: 0, y: 0 })
    } else if (e.key === 'Tab') trapTab(e, rootRef.current)
    else return
    if (e.key !== 'Tab') e.preventDefault()
  }

  const date = formatDateTime(item.taken ?? item.createdAt)

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="viewer__bar">
        <IconButton label="Close viewer (Esc)" onClick={onClose}>
          <X className="icon" />
        </IconButton>
        <div className="viewer__title">
          <h2 id={titleId}>{item.caption || item.alt || date}</h2>
          <span className="muted">
            {index + 1} of {items.length}
            {item.caption || item.alt ? ` · ${date}` : ''}
          </span>
        </div>
        <div className="viewer__actions">
          {item.kind === 'image' && (
            <>
              <IconButton
                label="Zoom out (−)"
                onClick={() => zoomBy(1 / 1.5)}
                disabled={scale <= 1}
              >
                <ZoomOut className="icon" />
              </IconButton>
              <IconButton
                label="Zoom in (+)"
                onClick={() => zoomBy(1.5)}
                disabled={scale >= MAX_SCALE}
              >
                <ZoomIn className="icon" />
              </IconButton>
              <IconButton
                label="Fit to screen (0)"
                onClick={() => {
                  setScale(1)
                  setPan({ x: 0, y: 0 })
                }}
                disabled={scale === 1}
              >
                <Maximize className="icon" />
              </IconButton>
            </>
          )}
          <IconButton
            label={
              progress === null
                ? 'Download original (checks SHA-256)'
                : `Downloading ${Math.round(progress * 100)}%`
            }
            onClick={download}
            disabled={progress !== null}
          >
            {progress === null ? (
              <Download className="icon" />
            ) : (
              <span className="spinner" aria-hidden />
            )}
          </IconButton>
          <IconButton label="Delete" onClick={() => onDelete(item)}>
            <Trash2 className="icon" />
          </IconButton>
          <IconButton
            label="Details (i)"
            aria-pressed={showInfo}
            onClick={() => setShowInfo((v) => !v)}
          >
            <Info className="icon" />
          </IconButton>
        </div>
      </header>

      <div className="viewer__stage">
        <Stage
          key={item.sha256}
          item={item}
          scale={scale}
          pan={pan}
          setPan={setPan}
          setScale={setScale}
          configuredServer={serverUrl}
        />
        {prev && (
          <IconButton
            className="viewer__nav viewer__nav--prev"
            label="Previous (←)"
            onClick={() => onNavigate(prev)}
          >
            <ChevronLeft className="icon icon--lg" />
          </IconButton>
        )}
        {next && (
          <IconButton
            className="viewer__nav viewer__nav--next"
            label="Next (→)"
            onClick={() => onNavigate(next)}
          >
            <ChevronRight className="icon icon--lg" />
          </IconButton>
        )}
        {showInfo && <Details item={item} onClose={() => setShowInfo(false)} />}
      </div>
    </div>
  )
}

function trapTab(e: React.KeyboardEvent, root: HTMLElement | null) {
  if (!root) return
  const focusable = [
    ...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], video[controls], input, [tabindex="0"]',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement)
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

type LoadState = { phase: 'loading' } | { phase: 'ready' } | { phase: 'failed'; reason: string }

function Stage({
  item,
  scale,
  pan,
  setPan,
  setScale,
  configuredServer,
}: {
  item: MediaItem
  scale: number
  pan: { x: number; y: number }
  setPan: (p: { x: number; y: number }) => void
  setScale: (s: number) => void
  configuredServer: string
}) {
  const sources = originalSources(item, configuredServer)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const src = sources[sourceIndex]!

  const fail = useCallback(
    async (decodeFailed: boolean) => {
      if (sourceIndex < sources.length - 1) {
        setSourceIndex(sourceIndex + 1)
        setState({ phase: 'loading' })
        return
      }
      let reason = 'The storage server could not be reached.'
      try {
        const res = await fetch(src, { method: 'HEAD' })
        if (res.status === 404)
          reason =
            'The storage server does not have this file (404). It may have been deleted, or this entry points to another server.'
        else if (!res.ok) reason = `The storage server answered ${res.status}.`
        else if (decodeFailed)
          reason = 'The server sent the file, but this browser cannot display it.'
        else reason = 'The file did not finish loading.'
      } catch {
        /* keep the unreachable message */
      }
      setState({ phase: 'failed', reason })
    },
    [sourceIndex, sources.length, src],
  )

  if (state.phase === 'failed') {
    return (
      <div className="viewer__error" role="alert">
        <FileWarning className="icon icon--lg" />
        <p className="viewer__error-title">This file could not be loaded</p>
        <p className="secondary">{state.reason}</p>
        <p className="mono muted viewer__error-url">{src}</p>
        <div className="inline">
          <Button
            onClick={() => {
              setSourceIndex(0)
              setState({ phase: 'loading' })
              setAttempt((a) => a + 1)
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (item.kind === 'video') {
    return (
      <div className="viewer__media">
        <video
          key={`${src}-${attempt}`}
          src={src}
          poster={item.thumbUrl}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={() => setState({ phase: 'ready' })}
          onError={() => void fail(true)}
        />
        {state.phase === 'loading' && (
          <div className="viewer__loading">
            <Spinner label="Loading video" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="viewer__media"
      data-zoomed={scale > 1 || undefined}
      onWheel={(e) =>
        setScale(Math.min(MAX_SCALE, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
      }
      onDoubleClick={() => {
        if (scale > 1) {
          setScale(1)
          setPan({ x: 0, y: 0 })
        } else setScale(2.5)
      }}
      onPointerDown={(e) => {
        if (scale <= 1) return
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })
      }}
      onPointerUp={() => (drag.current = null)}
    >
      {item.thumbUrl && state.phase === 'loading' && (
        <img className="viewer__preview" src={item.thumbUrl} alt="" aria-hidden />
      )}
      <img
        key={`${src}-${attempt}`}
        className="viewer__image"
        src={src}
        alt={
          item.alt || item.caption || `Photo from ${formatDateTime(item.taken ?? item.createdAt)}`
        }
        draggable={false}
        data-ready={state.phase === 'ready' || undefined}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
        onLoad={() => setState({ phase: 'ready' })}
        onError={() => void fail(true)}
      />
      {state.phase === 'loading' && (
        <div className="viewer__loading">
          <Spinner label="Loading original" />
        </div>
      )}
    </div>
  )
}

function Details({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const host = (() => {
    try {
      return new URL(item.url).host
    } catch {
      return item.url
    }
  })()
  return (
    <aside className="viewer__details" aria-label="Details">
      <div className="viewer__details-head">
        <h3>Details</h3>
        <IconButton label="Close details" size="sm" onClick={onClose}>
          <X className="icon icon--sm" />
        </IconButton>
      </div>
      {(item.caption || item.alt) && <p>{item.caption || item.alt}</p>}
      <dl className="kv">
        <dt>Type</dt>
        <dd>{item.mime}</dd>
        {item.size !== undefined && (
          <>
            <dt>Size</dt>
            <dd>{formatBytes(item.size)}</dd>
          </>
        )}
        {item.width && item.height && (
          <>
            <dt>Dimensions</dt>
            <dd>
              {item.width} × {item.height}
            </dd>
          </>
        )}
        {item.taken && (
          <>
            <dt>File date</dt>
            <dd>{formatDateTime(item.taken)}</dd>
          </>
        )}
        <dt>Added</dt>
        <dd>{formatDateTime(item.createdAt)}</dd>
        <dt>Stored on</dt>
        <dd>{host}</dd>
      </dl>
      <div className="stack stack--sm">
        <span className="field__label">
          <Hash className="icon icon--sm" style={{ verticalAlign: '-2px' }} /> SHA-256
        </span>
        <div className="copy-row">
          <code className="mono" style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
            {item.sha256}
          </code>
          <CopyButton text={item.sha256} label="Copy SHA-256" />
        </div>
        <span className="field__label">Metadata event</span>
        <div className="copy-row">
          <code className="mono">{item.id}</code>
          <CopyButton text={item.id} label="Copy event id" />
        </div>
        <span className="field__label">File URL</span>
        <div className="copy-row">
          <code className="mono">{item.url}</code>
          <CopyButton text={item.url} label="Copy file URL" />
        </div>
      </div>
      <p className="field__hint">
        The file URL is not secret. Anyone who has it can fetch the file unless the storage server
        restricts access.
      </p>
    </aside>
  )
}
