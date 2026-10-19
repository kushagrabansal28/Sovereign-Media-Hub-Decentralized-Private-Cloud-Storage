import { useEffect, useState } from 'react'
import { AlertCircle, Check, ChevronDown, ChevronUp, Copy, Film, RotateCw, X } from 'lucide-react'
import { uploads } from '../services'
import { formatBytes } from '../lib/format'
import { useUploads, type UploadItem } from '../stores/uploads'
import { Button, IconButton } from './ui'

export function describeUpload(u: UploadItem): {
  text: string
  fraction?: number
  tone: 'busy' | 'ok' | 'warn' | 'bad' | 'idle'
} {
  switch (u.status) {
    case 'queued':
      return { text: 'Waiting', tone: 'idle' }
    case 'cancelled':
      return { text: 'Cancelled', tone: 'idle' }
    case 'duplicate':
      return { text: 'Already in your library', tone: 'ok' }
    case 'error':
      return { text: u.error ?? 'Failed', tone: 'bad' }
    case 'done': {
      const r = u.relays
      if (r && r.total > 0 && r.accepted === 0) {
        return {
          text: 'Stored on the server. No relay has accepted the metadata yet; it will be retried.',
          tone: 'warn',
        }
      }
      const base = u.serverHadBlob ? 'Added. The server already had these bytes.' : 'Added'
      if (r && r.accepted < r.total)
        return { text: `${base} · ${r.accepted} of ${r.total} relays`, tone: 'warn' }
      return {
        text: r ? `${base} · ${r.accepted} ${r.accepted === 1 ? 'relay' : 'relays'}` : base,
        tone: 'ok',
      }
    }
    default:
      break
  }
  switch (u.stage) {
    case 'hashing':
      return {
        text: `Hashing ${Math.round((u.hashed / Math.max(1, u.file.size)) * 100)}%`,
        fraction: u.hashed / Math.max(1, u.file.size),
        tone: 'busy',
      }
    case 'uploading':
      return {
        text: `Uploading ${formatBytes(u.sent)} of ${formatBytes(u.file.size)}`,
        fraction: u.sent / Math.max(1, u.file.size),
        tone: 'busy',
      }
    case 'publishing':
      return { text: 'Publishing metadata', tone: 'busy' }
    case 'preparing':
      return { text: 'Making a preview', tone: 'busy' }
    default:
      return { text: 'Checking file', tone: 'busy' }
  }
}

function FilePreview({ file }: { file: File }) {
  const [url] = useState(() => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null))
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )
  return (
    <span className="uploads__preview" aria-hidden>
      {url ? <img src={url} alt="" /> : <Film className="icon icon--sm" />}
    </span>
  )
}

export function UploadPanel() {
  const items = useUploads(uploads)
  const [collapsed, setCollapsed] = useState(false)
  const active = items.filter((i) => i.status === 'queued' || i.status === 'active').length
  const failed = items.filter((i) => i.status === 'error').length
  const allClean = items.length > 0 && active === 0 && failed === 0

  // A finished batch with nothing to act on folds away; anything that failed stays open.
  useEffect(() => {
    if (!allClean) return
    const t = setTimeout(() => setCollapsed(true), 4000)
    return () => clearTimeout(t)
  }, [allClean])
  // New work reopens the panel (state adjusted during render).
  const [seenActive, setSeenActive] = useState(0)
  if (active !== seenActive) {
    setSeenActive(active)
    if (active > 0 && collapsed) setCollapsed(false)
  }
  if (items.length === 0) return null

  const finished = items.length - active
  const title = active
    ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}`
    : failed
      ? `${failed} failed, ${finished - failed} finished`
      : `${finished} ${finished === 1 ? 'file' : 'files'} finished`

  return (
    <section className="uploads" aria-label="Uploads">
      <header className="uploads__head">
        <h2 className="uploads__title" aria-live="polite">
          {title}
        </h2>
        <div className="inline">
          {active === 0 && (
            <Button size="sm" onClick={() => uploads.clearFinished()}>
              Clear
            </Button>
          )}
          <IconButton
            label={collapsed ? 'Expand uploads' : 'Collapse uploads'}
            size="sm"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? (
              <ChevronUp className="icon icon--sm" />
            ) : (
              <ChevronDown className="icon icon--sm" />
            )}
          </IconButton>
        </div>
      </header>
      {!collapsed && (
        <ul className="uploads__list">
          {items.map((u) => {
            const d = describeUpload(u)
            const pending = u.status === 'queued' || u.status === 'active'
            return (
              <li key={u.id} className="uploads__row">
                <span className="uploads__icon" aria-hidden>
                  {u.status === 'done' && (
                    <Check className="icon icon--sm" style={{ color: 'var(--success)' }} />
                  )}
                  {u.status === 'duplicate' && (
                    <Copy className="icon icon--sm" style={{ color: 'var(--success)' }} />
                  )}
                  {u.status === 'error' && (
                    <AlertCircle className="icon icon--sm" style={{ color: 'var(--danger)' }} />
                  )}
                  {pending && <span className="spinner" />}
                </span>
                <FilePreview file={u.file} />
                <div className="uploads__main">
                  <div className="uploads__name" title={u.file.name}>
                    {u.file.name}
                  </div>
                  <div className={`uploads__status uploads__status--${d.tone}`}>{d.text}</div>
                  {d.fraction !== undefined && (
                    <div
                      className="progress"
                      role="progressbar"
                      aria-label={`${u.file.name}: ${d.text}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(d.fraction * 100)}
                    >
                      <span style={{ width: `${Math.round(d.fraction * 100)}%` }} />
                    </div>
                  )}
                </div>
                {pending && (
                  <IconButton
                    label={`Cancel ${u.file.name}`}
                    size="sm"
                    onClick={() => uploads.cancel(u.id)}
                  >
                    <X className="icon icon--sm" />
                  </IconButton>
                )}
                {(u.status === 'error' && u.retryable !== false) || u.status === 'cancelled' ? (
                  <IconButton
                    label={`Retry ${u.file.name}`}
                    size="sm"
                    onClick={() => uploads.retry(u.id)}
                  >
                    <RotateCw className="icon icon--sm" />
                  </IconButton>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
