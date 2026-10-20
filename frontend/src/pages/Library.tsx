import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckSquare,
  CloudOff,
  Download,
  Film,
  Image as ImageIcon,
  ImageUp,
  LayoutGrid,
  Rows3,
  Search,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react'
import { library, relays, server, uploads, useRelayStatuses } from '../services'
import { GridSkeleton, JustifiedGrid } from '../components/Gallery'
import { Ledger, VaultStrip } from '../components/Vault'
import { Viewer } from '../components/Viewer'
import { Button, ConfirmDialog, IconButton, notify, Select } from '../components/ui'
import { formatAgo } from '../lib/format'
import { vaultStats } from '../lib/media/stats'
import { withTransition } from '../lib/transition'
import { deleteMedia, describeDelete, downloadOriginal } from '../lib/media/actions'
import {
  applyQuery,
  isFiltered,
  parseQuery,
  SORT_OPTIONS,
  type SortKey,
  type TypeFilter,
} from '../lib/media/query'
import type { MediaItem } from '../lib/nostr/events'
import { useServerStatus } from '../stores/connections'
import { useUploads } from '../stores/uploads'
import { identity } from '../stores/identity'
import { useLibraryState } from '../stores/library'
import { useSettings } from '../stores/settings'

const ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/quicktime,video/webm'

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export default function Library() {
  const state = useLibraryState(library)
  const settings = useSettings()
  const serverStatus = useServerStatus(server)
  const relayStatuses = useRelayStatuses()
  const online = useOnline()
  const [params, setParams] = useSearchParams()
  const { sha } = useParams()
  const navigate = useNavigate()
  const query = parseQuery(params)
  const view = params.get('view') === 'ledger' ? 'ledger' : 'grid'
  const uploadItems = useUploads(uploads)
  const fileInput = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const anchor = useRef<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<MediaItem[] | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { q: text, type: typeFilter, sort } = query
  const visible = useMemo(
    () => applyQuery(state.items, { q: text, type: typeFilter, sort }),
    [state.items, text, typeFilter, sort],
  )
  const selecting = selectMode || selected.size > 0
  const stats = useMemo(() => vaultStats(state.items), [state.items])
  const skipped = uploadItems.filter((u) => u.status === 'duplicate')
  const bytesAvoided = skipped.reduce((n, u) => n + u.file.size, 0)

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [k, v] of Object.entries(patch)) {
        if (
          v === null ||
          v === '' ||
          (k === 'type' && v === 'all') ||
          (k === 'sort' && v === 'added-desc') ||
          (k === 'view' && v === 'grid')
        )
          next.delete(k)
        else next.set(k, v)
      }
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const openItem = useCallback(
    (item: MediaItem) => {
      const source = document.querySelector<HTMLElement>(
        `.tile__main[data-sha="${item.sha256}"] img`,
      )
      withTransition(() => navigate({ pathname: `/m/${item.sha256}`, search: params.toString() }), {
        source,
        until: () => document.querySelector('.viewer') !== null,
      })
    },
    [navigate, params],
  )
  const closeViewer = useCallback(
    () =>
      withTransition(() => navigate({ pathname: '/', search: params.toString() }), {
        until: () => document.querySelector('.viewer') === null,
      }),
    [navigate, params],
  )

  const toggle = useCallback(
    (item: MediaItem, shift: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (shift && anchor.current) {
          const a = visible.findIndex((i) => i.sha256 === anchor.current)
          const b = visible.findIndex((i) => i.sha256 === item.sha256)
          if (a >= 0 && b >= 0) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(visible[i]!.sha256)
            return next
          }
        }
        if (next.has(item.sha256)) next.delete(item.sha256)
        else next.add(item.sha256)
        anchor.current = item.sha256
        return next
      })
    },
    [visible],
  )

  const clearSelection = () => {
    setSelected(new Set())
    setSelectMode(false)
    anchor.current = null
  }

  const viewerIndex = sha ? visible.findIndex((i) => i.sha256 === sha) : -1
  useEffect(() => {
    // A link to something that is not in the list: leave once loading has finished.
    if (sha && viewerIndex < 0 && !state.loading && !state.syncing) closeViewer()
  }, [sha, viewerIndex, state.loading, state.syncing, closeViewer])

  const runDelete = async (targets: MediaItem[]) => {
    setDeleting(true)
    let problems = 0
    let last = ''
    for (const item of targets) {
      try {
        const report = await deleteMedia(item, library, (t) => identity.sign(t))
        const d = describeDelete(report)
        if (d.kind === 'error') {
          problems++
          last = d.text
        } else last = d.text
      } catch (e) {
        problems++
        last = e instanceof Error ? e.message : 'Delete failed.'
      }
    }
    setDeleting(false)
    setConfirmDelete(null)
    clearSelection()
    if (targets.length === 1) notify(last, problems ? 'error' : 'info')
    else
      notify(
        problems
          ? `${targets.length - problems} of ${targets.length} deleted. ${last}`
          : `Deleted ${targets.length} items.`,
        problems ? 'error' : 'info',
      )
    if (sha && targets.some((t) => t.sha256 === sha)) closeViewer()
  }

  const downloadSelected = async () => {
    const targets = visible.filter((i) => selected.has(i.sha256))
    for (const item of targets) {
      try {
        await downloadOriginal(item, settings.serverUrl)
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Download failed.', 'error')
        return
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    notify(
      `Saved ${targets.length} ${targets.length === 1 ? 'file' : 'files'}. Each matched its SHA-256.`,
    )
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length) uploads.add(files)
  }

  const showSkeleton = state.loading || (state.syncing && state.items.length === 0)
  const filtered = isFiltered(query)

  return (
    <div className="library">
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={onPick}
        aria-label="Choose files to upload"
      />

      {selecting ? (
        <div className="toolbar" role="toolbar" aria-label="Selection">
          <IconButton label="Cancel selection" onClick={clearSelection}>
            <X className="icon" />
          </IconButton>
          <span className="toolbar__count" aria-live="polite">
            {selected.size} selected
          </span>
          <span className="toolbar__spacer" />
          <Button
            size="md"
            onClick={() => setSelected(new Set(visible.map((i) => i.sha256)))}
            disabled={selected.size === visible.length}
          >
            Select all {visible.length}
          </Button>
          <Button
            aria-label="Download selected"
            onClick={downloadSelected}
            disabled={selected.size === 0}
          >
            <Download className="icon" />
            <span className="hide-compact">Download</span>
          </Button>
          <Button
            variant="danger"
            aria-label="Delete selected"
            disabled={selected.size === 0}
            onClick={() => setConfirmDelete(visible.filter((i) => selected.has(i.sha256)))}
          >
            <Trash2 className="icon" />
            <span className="hide-compact">Delete</span>
          </Button>
        </div>
      ) : (
        <div className="toolbar" role="toolbar" aria-label="Library">
          <div className="search">
            <Search className="icon icon--sm search__icon" />
            <input
              type="search"
              className="input search__input"
              aria-label="Search library"
              placeholder="Search captions, dates, hashes"
              value={query.q}
              onChange={(e) => {
                update({ q: e.target.value })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query.q) {
                  update({ q: null })
                }
              }}
            />
          </div>
          <div className="segmented" role="group" aria-label="Type">
            {(
              [
                ['all', 'All', null],
                ['image', 'Photos', ImageIcon],
                ['video', 'Videos', Film],
              ] as [TypeFilter, string, typeof ImageIcon | null][]
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={query.type === value}
                onClick={() => update({ type: value })}
              >
                {Icon && (
                  <Icon
                    className="icon icon--sm"
                    style={{ verticalAlign: '-2px', marginRight: 4 }}
                  />
                )}
                {label}
              </button>
            ))}
          </div>
          <Select<SortKey>
            label="Sort"
            value={query.sort}
            options={SORT_OPTIONS}
            onChange={(v) => update({ sort: v })}
          />
          <div className="segmented segmented--icons" role="group" aria-label="Layout">
            <button
              type="button"
              aria-pressed={view === 'grid'}
              aria-label="Grid view"
              title="Grid"
              onClick={() => update({ view: 'grid' })}
            >
              <LayoutGrid className="icon icon--sm" />
            </button>
            <button
              type="button"
              aria-pressed={view === 'ledger'}
              aria-label="Ledger view"
              title="Ledger: hashes, sizes, events"
              onClick={() => update({ view: 'ledger' })}
            >
              <Rows3 className="icon icon--sm" />
            </button>
          </div>
          <span className="toolbar__meta" aria-live="polite">
            {visible.length === state.items.length
              ? `${state.items.length.toLocaleString()} ${state.items.length === 1 ? 'item' : 'items'}`
              : `${visible.length.toLocaleString()} of ${state.items.length.toLocaleString()}`}
          </span>
          <span className="toolbar__spacer" />
          <Button
            className="toolbar__select"
            aria-label="Select items"
            onClick={() => setSelectMode(true)}
            disabled={visible.length === 0}
          >
            <CheckSquare className="icon show-compact" />
            <span className="hide-compact">Select</span>
          </Button>
          <Button
            className="toolbar__upload"
            variant="primary"
            aria-label="Upload files"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="icon" />
            <span className="hide-compact">Upload</span>
          </Button>
        </div>
      )}

      <div className="library__body">
        <HealthBanner
          online={online}
          serverState={serverStatus.state}
          serverError={serverStatus.error}
          serverUrl={settings.serverUrl}
          relayCount={settings.relays.length}
          connected={relayStatuses.filter((r) => r.state === 'connected').length}
          cachedItems={state.items.length}
          fromCacheOnly={state.fromCacheOnly}
          lastSyncAt={state.lastSyncAt}
          outbox={state.outbox.total}
        />

        {!state.cacheAvailable && (
          <p className="banner banner--warning" role="status">
            <AlertTriangle className="icon" />
            <span className="banner__body">
              This browser is not allowing local storage for the library cache, so the library is
              not available offline and unsent events are only kept until you close the tab.
            </span>
          </p>
        )}

        {!showSkeleton && state.items.length > 0 && !selecting && (
          <VaultStrip
            stats={stats}
            relaysConnected={relayStatuses.filter((r) => r.state === 'connected').length}
            relaysTotal={settings.relays.length}
            lastSyncAt={state.lastSyncAt}
            duplicatesAvoided={skipped.length}
            bytesAvoided={bytesAvoided}
          />
        )}

        {showSkeleton ? (
          <GridSkeleton />
        ) : visible.length > 0 && view === 'ledger' && !selecting ? (
          <Ledger items={visible} onOpen={openItem} />
        ) : visible.length > 0 ? (
          <JustifiedGrid
            items={visible}
            selected={selected}
            selecting={selecting}
            onOpen={openItem}
            onToggle={toggle}
          />
        ) : (
          <Empty
            filtered={filtered && state.items.length > 0}
            query={query.q}
            noRelays={relayStatuses.every((r) => r.state !== 'connected')}
            onClear={() => {
              setParams(new URLSearchParams(), { replace: true })
            }}
            onUpload={() => fileInput.current?.click()}
            onRetry={() => {
              relays.reconnect()
              void library.refresh()
            }}
          />
        )}
      </div>

      {sha && viewerIndex >= 0 && (
        <Viewer
          items={visible}
          index={viewerIndex}
          onClose={closeViewer}
          onNavigate={(item) =>
            navigate(
              { pathname: `/m/${item.sha256}`, search: params.toString() },
              { replace: true },
            )
          }
          onDelete={(item) => setConfirmDelete([item])}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={
          confirmDelete && confirmDelete.length > 1
            ? `Delete ${confirmDelete.length} items?`
            : 'Delete this item?'
        }
        confirmLabel="Delete"
        danger
        busy={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void runDelete(confirmDelete)}
      >
        <p>
          This removes {confirmDelete && confirmDelete.length > 1 ? 'them' : 'it'} from your library
          and deletes the file and its preview from your storage server.
        </p>
        <p>
          Copies you saved elsewhere are not affected. Relays are asked to drop the metadata, but a
          relay may keep what it has already received.
        </p>
      </ConfirmDialog>
    </div>
  )
}

function HealthBanner(p: {
  online: boolean
  serverState: 'checking' | 'ok' | 'unreachable'
  serverError?: string
  serverUrl: string
  relayCount: number
  connected: number
  cachedItems: number
  fromCacheOnly: boolean
  lastSyncAt?: number
  outbox: number
}) {
  const navigate = useNavigate()
  const settingsBtn = (
    <Button size="sm" onClick={() => navigate('/settings#connections')}>
      Connection settings
    </Button>
  )

  if (!p.online) {
    return (
      <div className="banner banner--warning" role="status">
        <WifiOff className="icon" />
        <div className="banner__body">
          <p className="banner__title">This device is offline</p>
          <p className="banner__text">
            The app itself is running.{' '}
            {p.cachedItems > 0
              ? `${p.cachedItems} items are shown from the copy saved on this device.`
              : 'Nothing is saved on this device yet.'}{' '}
            Previews and originals load only if the storage server is reachable from here.
          </p>
        </div>
      </div>
    )
  }
  if (p.serverState === 'unreachable') {
    return (
      <div className="banner banner--danger" role="alert">
        <CloudOff className="icon" />
        <div className="banner__body">
          <p className="banner__title">The storage server is not reachable</p>
          <p className="banner__text">
            {p.serverUrl}: {p.serverError} Previews and originals will not load, and uploads will
            fail, until it answers. The library list is not affected.
          </p>
          <div className="banner__actions">
            <Button size="sm" onClick={() => void server.check()}>
              Check again
            </Button>
            {settingsBtn}
          </div>
        </div>
      </div>
    )
  }
  if (p.relayCount === 0) {
    return (
      <div className="banner banner--warning" role="status">
        <AlertTriangle className="icon" />
        <div className="banner__body">
          <p className="banner__title">No relays are configured</p>
          <p className="banner__text">
            Uploads are stored on your server, but nothing indexes them, so the library cannot be
            listed again later.
          </p>
          <div className="banner__actions">{settingsBtn}</div>
        </div>
      </div>
    )
  }
  if (p.connected === 0) {
    return (
      <div className="banner banner--warning" role="status">
        <CloudOff className="icon" />
        <div className="banner__body">
          <p className="banner__title">No relay is reachable</p>
          <p className="banner__text">
            {p.fromCacheOnly
              ? `Showing ${p.cachedItems} items saved on this device${p.lastSyncAt ? `, last synced ${formatAgo(p.lastSyncAt)}` : ''}.`
              : 'The library cannot be loaded from the network.'}{' '}
            New uploads are stored on the server and published when a relay comes back.
          </p>
          <div className="banner__actions">
            <Button size="sm" onClick={() => relays.reconnect()}>
              Retry now
            </Button>
            {settingsBtn}
          </div>
        </div>
      </div>
    )
  }
  if (p.outbox > 0) {
    return (
      <div className="banner banner--info" role="status">
        <ImageUp className="icon" />
        <div className="banner__body">
          <p className="banner__title">
            {p.outbox} {p.outbox === 1 ? 'event is' : 'events are'} waiting to reach every relay
          </p>
          <div className="banner__actions">
            <Button size="sm" onClick={() => void library.flushOutbox()}>
              Send now
            </Button>
          </div>
        </div>
      </div>
    )
  }
  return null
}

function Empty({
  filtered,
  query,
  noRelays,
  onClear,
  onUpload,
  onRetry,
}: {
  filtered: boolean
  query: string
  noRelays: boolean
  onClear: () => void
  onUpload: () => void
  onRetry: () => void
}) {
  if (filtered) {
    return (
      <div className="empty">
        <Search className="icon icon--lg muted" />
        <h2 className="empty__title">
          {query.trim() ? `No matches for “${query.trim()}”` : 'Nothing of this type'}
        </h2>
        <Button onClick={onClear}>Clear search and filters</Button>
      </div>
    )
  }
  if (noRelays) {
    return (
      <div className="empty">
        <CloudOff className="icon icon--lg muted" />
        <h2 className="empty__title">The library could not be loaded</h2>
        <p className="secondary empty__text">
          No relay is connected and there is no saved copy on this device. Files already on the
          storage server are not lost.
        </p>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    )
  }
  return (
    <div className="empty">
      <ImageUp className="icon icon--lg muted" />
      <h2 className="empty__title">No photos or videos yet</h2>
      <p className="secondary empty__text">
        Drop files anywhere in this window, or choose them from your device. JPEG, PNG, GIF, WebP,
        AVIF, MP4, MOV and WebM are accepted.
      </p>
      <Button variant="primary" onClick={onUpload}>
        <Upload className="icon" />
        Choose files
      </Button>
    </div>
  )
}
