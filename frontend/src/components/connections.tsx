import { useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import { relays, server, useRelayStatuses } from '../services'
import { formatAgo } from '../lib/format'
import type { RelayStatus } from '../lib/nostr/relays'
import { useServerStatus, type ServerStatus } from '../stores/connections'
import { settings, useSettings } from '../stores/settings'
import { Button, Field, IconButton } from './ui'

export function serverLine(s: ServerStatus): { tone: 'ok' | 'bad' | 'busy'; text: string } {
  if (s.state === 'ok')
    return { tone: 'ok', text: `Reachable · ${s.ms} ms${s.version ? ` · v${s.version}` : ''}` }
  if (s.state === 'unreachable') return { tone: 'bad', text: s.error ?? 'Not reachable' }
  return { tone: 'busy', text: 'Checking…' }
}

export function relayLine(r: RelayStatus): { tone: 'ok' | 'bad' | 'warn' | 'busy'; text: string } {
  switch (r.state) {
    case 'connected':
      return {
        tone: 'ok',
        text: `Connected${r.connectMs !== undefined ? ` · opened in ${r.connectMs} ms` : ''}`,
      }
    case 'connecting':
      return { tone: 'busy', text: 'Connecting…' }
    case 'disconnected':
      return { tone: 'warn', text: `Disconnected${r.error ? ` · ${r.error}` : ''} · retrying` }
    default:
      return { tone: 'bad', text: `${r.error ?? 'Could not connect'} · retrying` }
  }
}

export function StorageServerSection() {
  const { serverUrl } = useSettings()
  const status = useServerStatus(server)
  const [draft, setDraft] = useState(serverUrl)
  const [error, setError] = useState<string | null>(null)
  const line = serverLine(status)
  const dirty = draft.trim() !== serverUrl

  const apply = async () => {
    try {
      settings.setServer(draft)
      setError(null)
      setDraft(settings.get().serverUrl)
      await server.check()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid address')
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        void apply()
      }}
    >
      <Field
        label="Storage server"
        hint="Where original files and thumbnails are uploaded. Files are addressed by SHA-256."
        error={error}
      >
        {(p) => (
          <div className="inline">
            <input
              {...p}
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://media.example.org"
            />
            <Button type="submit" variant={dirty ? 'primary' : 'secondary'}>
              {dirty ? 'Save and test' : 'Test'}
            </Button>
          </div>
        )}
      </Field>
      <p className="status" role="status">
        <span className={`dot dot--${line.tone}`} aria-hidden />
        <span>{line.text}</span>
      </p>
      {status.state === 'ok' && status.info && (
        <p className="field__hint">
          Upload limit {Math.round(status.info.max_upload_bytes / 1048576)} MB ·{' '}
          {status.info.upload_policy === 'allowlist'
            ? 'Uploads limited to approved keys'
            : 'Any valid key can upload'}
        </p>
      )}
    </form>
  )
}

export function RelaySection() {
  const { relays: urls } = useSettings()
  const statuses = useRelayStatuses()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    try {
      settings.addRelay(draft)
      setDraft('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid address')
    }
  }

  return (
    <div className="stack">
      {urls.length === 0 ? (
        <p className="banner banner--warning" role="status">
          No relays are configured. Uploads will be stored, but the library cannot be listed or
          shared across devices.
        </p>
      ) : (
        <ul className="rows" aria-label="Relays">
          {urls.map((url) => {
            const s = statuses.find((x) => x.url === url)
            const line = s ? relayLine(s) : { tone: 'busy' as const, text: 'Starting…' }
            return (
              <li key={url} className="rows__item">
                <div className="rows__main">
                  <span className="mono rows__title">{url}</span>
                  <span className="status">
                    <span className={`dot dot--${line.tone}`} aria-hidden />
                    <span className="secondary">{line.text}</span>
                    {s?.queryMs !== undefined && s.state === 'connected' && (
                      <span className="muted">· last query {s.queryMs} ms</span>
                    )}
                  </span>
                </div>
                {s && s.state !== 'connected' && s.state !== 'connecting' && (
                  <IconButton
                    label={`Reconnect to ${url}`}
                    size="sm"
                    onClick={() => relays.reconnect(url)}
                  >
                    <RefreshCw className="icon icon--sm" />
                  </IconButton>
                )}
                <IconButton
                  label={`Remove ${url}`}
                  size="sm"
                  onClick={() => settings.removeRelay(url)}
                >
                  <X className="icon icon--sm" />
                </IconButton>
              </li>
            )
          })}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Field
          label="Add a relay"
          hint="Events are public on public relays. Prefer a relay you run for a private index."
          error={error}
        >
          {(p) => (
            <div className="inline">
              <input
                {...p}
                className="input"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="wss://relay.example.org"
              />
              <Button type="submit" disabled={!draft.trim()}>
                <Plus className="icon icon--sm" />
                Add
              </Button>
            </div>
          )}
        </Field>
      </form>
    </div>
  )
}

export function lastChecked(s: ServerStatus): string {
  return s.checkedAt ? formatAgo(s.checkedAt) : 'not yet'
}
