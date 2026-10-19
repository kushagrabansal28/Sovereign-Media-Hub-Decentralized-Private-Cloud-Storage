import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Images, Lock, Settings as SettingsIcon, UploadCloud } from 'lucide-react'
import { library, server, uploads, useRelayStatuses } from '../services'
import { npubOf } from '../lib/nostr/keys'
import { shorten } from '../lib/format'
import { useServerStatus } from '../stores/connections'
import { identity, useIdentity } from '../stores/identity'
import { useLibraryState } from '../stores/library'
import { useSettings } from '../stores/settings'
import { Wordmark } from './Logo'
import { Toasts } from './ui'
import { UploadPanel } from './UploadPanel'

type Tone = 'ok' | 'warn' | 'bad' | 'busy'

function useConnectionSummary() {
  const s = useServerStatus(server)
  const statuses = useRelayStatuses()
  const settings = useSettings()
  const lib = useLibraryState(library)
  const connected = statuses.filter((r) => r.state === 'connected').length
  const total = settings.relays.length

  const storage: { tone: Tone; text: string } =
    s.state === 'ok'
      ? { tone: 'ok', text: `${s.ms} ms` }
      : s.state === 'checking'
        ? { tone: 'busy', text: 'Checking' }
        : { tone: 'bad', text: 'Unreachable' }
  const relay: { tone: Tone; text: string } =
    total === 0
      ? { tone: 'warn', text: 'None set' }
      : connected === total
        ? { tone: 'ok', text: `${connected} of ${total}` }
        : connected === 0
          ? { tone: 'bad', text: `0 of ${total}` }
          : { tone: 'warn', text: `${connected} of ${total}` }
  const queued = lib.outbox.total
  return { storage, relay, queued }
}

export function Shell() {
  const id = useIdentity()
  const summary = useConnectionSummary()
  const location = useLocation()
  if (id.phase !== 'unlocked') return null
  const npub = npubOf(id.pubkey)

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="nav" aria-label="Main">
        <div className="nav__brand">
          <Wordmark />
        </div>
        <ul className="nav__list">
          <li>
            <NavLink
              to="/"
              end={false}
              className={({ isActive }) =>
                `nav__link${isActive || location.pathname.startsWith('/m/') ? ' is-active' : ''}`
              }
            >
              <Images className="icon" />
              <span className="nav__label">Library</span>
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/settings"
              className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
            >
              <SettingsIcon className="icon" />
              <span className="nav__label">Settings</span>
              {(summary.storage.tone === 'bad' || summary.relay.tone === 'bad') && (
                <span
                  className="nav__alert dot dot--bad"
                  role="img"
                  aria-label="A connection needs attention"
                />
              )}
            </NavLink>
          </li>
        </ul>

        <div className="nav__foot">
          <dl className="nav__status" aria-label="Connection status">
            <div>
              <dt>Storage</dt>
              <dd>
                <span className={`dot dot--${summary.storage.tone}`} aria-hidden />
                {summary.storage.text}
              </dd>
            </div>
            <div>
              <dt>Relays</dt>
              <dd>
                <span className={`dot dot--${summary.relay.tone}`} aria-hidden />
                {summary.relay.text}
              </dd>
            </div>
            {summary.queued > 0 && (
              <div>
                <dt>Unsent</dt>
                <dd>
                  <span className="dot dot--warn" aria-hidden />
                  {summary.queued}
                </dd>
              </div>
            )}
          </dl>
          <div className="nav__id">
            <span className="mono nav__npub" title={npub}>
              {shorten(npub, 9, 4)}
            </span>
            {id.source === 'local' && !id.ephemeral && (
              <button
                type="button"
                className="btn btn--icon btn--sm"
                aria-label="Lock"
                title="Lock"
                onClick={() => identity.lock()}
              >
                <Lock className="icon icon--sm" />
              </button>
            )}
          </div>
        </div>
      </nav>

      <main id="main" className="main" data-scroll-root tabIndex={-1}>
        <Outlet />
      </main>

      <UploadPanel />
      <DropOverlay />
      <Toasts />
    </div>
  )
}

/** Shows a target while files are dragged over the window and queues them on drop. */
function DropOverlay() {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) uploads.add(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  if (!dragging) return null
  return (
    <div className="dropzone" aria-hidden>
      <UploadCloud className="icon icon--lg" />
      <p>Drop to upload</p>
    </div>
  )
}
