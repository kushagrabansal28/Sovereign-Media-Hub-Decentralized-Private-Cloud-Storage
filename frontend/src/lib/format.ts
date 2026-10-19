const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log2(bytes) / 10))
  const value = bytes / 1024 ** i
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[i]}`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function formatDate(epochSeconds: number, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, opts ?? { dateStyle: 'medium' }).format(
    epochSeconds * 1000,
  )
}

export function formatDateTime(epochSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    epochSeconds * 1000,
  )
}

/** First and last characters of a long identifier. */
export function shorten(text: string, head = 8, tail = 4): string {
  return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`
}

export function formatAgo(epochMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - epochMs) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
