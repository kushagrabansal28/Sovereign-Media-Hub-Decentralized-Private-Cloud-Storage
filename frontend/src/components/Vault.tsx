import { memo, useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { copyText } from './ui'
import { formatAgo, formatBytes, formatDate, formatDateTime, shorten } from '../lib/format'
import type { VaultStats } from '../lib/media/stats'
import type { MediaItem } from '../lib/nostr/events'

/** Eases a number toward its new value, so changes are noticed instead of flashing. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || from.current === value) {
      from.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 450)
      const eased = 1 - (1 - t) ** 3
      setShown(Math.round(a + (value - a) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return shown
}

interface StripProps {
  stats: VaultStats
  relaysConnected: number
  relaysTotal: number
  lastSyncAt?: number
  duplicatesAvoided: number
  bytesAvoided: number
}

/** Totals for the whole library, measured from its metadata. Nothing here is estimated. */
export const VaultStrip = memo(function VaultStrip({
  stats,
  relaysConnected,
  relaysTotal,
  lastSyncAt,
  duplicatesAvoided,
  bytesAvoided,
}: StripProps) {
  const objects = useCountUp(stats.objects)
  const total = stats.photoBytes + stats.videoBytes
  const photoShare = total > 0 ? (stats.photoBytes / total) * 100 : 0

  return (
    <section className="vault" aria-label="Library totals">
      <div className="vault__cell">
        <span className="vault__label">Objects</span>
        <span className="vault__value">{objects.toLocaleString()}</span>
        <span className="vault__note">
          {stats.photos.toLocaleString()} {stats.photos === 1 ? 'photo' : 'photos'} ·{' '}
          {stats.videos.toLocaleString()} {stats.videos === 1 ? 'video' : 'videos'}
        </span>
      </div>
      <div className="vault__cell">
        <span className="vault__label">Originals stored</span>
        <span className="vault__value">{formatBytes(stats.bytes)}</span>
        <span className="vault__bar" aria-hidden="true">
          <span className="vault__bar-photos" style={{ width: `${photoShare}%` }} />
          <span
            className="vault__bar-videos"
            style={{ width: `${total > 0 ? 100 - photoShare : 0}%` }}
          />
        </span>
        <span className="vault__note">
          {stats.unsized > 0
            ? `${stats.unsized} without a recorded size`
            : 'Photos and videos by size'}
        </span>
      </div>
      <div className="vault__cell">
        <span className="vault__label">Index</span>
        <span className="vault__value">
          {relaysConnected}
          <span className="vault__of"> of {relaysTotal}</span>
        </span>
        <span className="vault__note">
          {relaysTotal === 1 ? 'relay' : 'relays'} connected
          {lastSyncAt ? ` · synced ${formatAgo(lastSyncAt)}` : ''}
        </span>
      </div>
      {duplicatesAvoided > 0 && (
        <div className="vault__cell vault__cell--saved">
          <span className="vault__label">Saved by addressing</span>
          <span className="vault__value">{formatBytes(bytesAvoided)}</span>
          <span className="vault__note">
            {duplicatesAvoided} duplicate {duplicatesAvoided === 1 ? 'upload' : 'uploads'} skipped
            this session
          </span>
        </div>
      )}
    </section>
  )
})

const PAGE = 100

interface LedgerProps {
  items: MediaItem[]
  onOpen: (item: MediaItem) => void
}

/** The library as a table of stored objects: name by hash, type, size and the event that lists it. */
export const Ledger = memo(function Ledger({ items, onOpen }: LedgerProps) {
  const [limit, setLimit] = useState(PAGE)
  const rows = items.slice(0, limit)

  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <caption className="sr-only">
          Stored objects, each named by the SHA-256 of its contents
        </caption>
        <thead>
          <tr>
            <th scope="col">Object</th>
            <th scope="col" className="ledger__hash-col">
              SHA-256 address
            </th>
            <th scope="col" className="num hide-compact">
              Size
            </th>
            <th scope="col" className="hide-medium">
              Dimensions
            </th>
            <th scope="col" className="hide-medium">
              Added
            </th>
            <th scope="col" className="hide-compact">
              Event
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const ext = item.mime.split('/')[1] ?? ''
            const name =
              item.caption ||
              `${item.kind === 'video' ? 'Video' : 'Photo'} · ${formatDate(item.taken ?? item.createdAt)}`
            return (
              <tr key={item.sha256} onDoubleClick={() => onOpen(item)}>
                <td>
                  <button type="button" className="ledger__open" onClick={() => onOpen(item)}>
                    <span className="ledger__thumb" aria-hidden="true">
                      {item.thumbUrl && (
                        <img src={item.thumbUrl} alt="" loading="lazy" decoding="async" />
                      )}
                    </span>
                    <span className="ledger__name">
                      <span>{name}</span>
                      <span className="ledger__type">
                        {ext.toUpperCase()}
                        {item.durationSeconds ? ` · ${Math.round(item.durationSeconds)} s` : ''}
                        {item.size ? (
                          <span className="ledger__size-inline"> · {formatBytes(item.size)}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="ledger__hash-col">
                  <span className="ledger__hash">
                    <code title={item.sha256}>
                      {item.sha256.slice(0, 10)}
                      <span className="ledger__hash-rest">{item.sha256.slice(10, 40)}</span>…
                    </code>
                    <button
                      type="button"
                      className="ledger__copy"
                      aria-label={`Copy SHA-256 ${shorten(item.sha256)}`}
                      onClick={() => void copyText(item.sha256, 'SHA-256 copied')}
                    >
                      <Copy className="icon icon--sm" />
                    </button>
                  </span>
                </td>
                <td className="num hide-compact">{item.size ? formatBytes(item.size) : '—'}</td>
                <td className="hide-medium">
                  {item.width && item.height ? `${item.width} × ${item.height}` : '—'}
                </td>
                <td className="hide-medium">{formatDateTime(item.createdAt)}</td>
                <td className="hide-compact">
                  <code title={item.id}>{item.id.slice(0, 8)}</code>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {items.length > limit && (
        <button type="button" className="ledger__more" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, items.length - limit)} more of{' '}
          {(items.length - limit).toLocaleString()} remaining
        </button>
      )}
    </div>
  )
})
