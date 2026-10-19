import { useEffect, useState } from 'react'
import { Download, Eye, EyeOff, Lock, RefreshCw, Trash2 } from 'lucide-react'
import { library, relays, server } from '../services'
import { RelaySection, StorageServerSection } from '../components/connections'
import { Button, ConfirmDialog, copyText, CopyButton, Dialog, notify } from '../components/ui'
import { authorization, deleteBlob, listAllBlobs, type BlobDescriptor } from '../lib/blossom/client'
import { formatAgo, formatBytes } from '../lib/format'
import { npubOf, nsecOf } from '../lib/nostr/keys'
import { cache } from '../lib/storage/cache'
import { identity, useIdentity } from '../stores/identity'
import { useLibraryState } from '../stores/library'
import { applyTheme, settings, useSettings, type Theme } from '../stores/settings'

export default function Settings() {
  const id = useIdentity()
  if (id.phase !== 'unlocked') return null
  return (
    <div className="page">
      <h1 className="page__title">Settings</h1>
      <IdentitySection pubkey={id.pubkey} source={id.source} ephemeral={id.ephemeral} />
      <section className="page__section" id="connections" aria-labelledby="h-conn">
        <h2 id="h-conn">Connections</h2>
        <p className="secondary">
          The storage server and the relays fail independently. A relay outage hides the list of
          what you have; a storage outage hides the pictures.
        </p>
        <StorageServerSection />
        <h3 className="section-title">Relays</h3>
        <RelaySection />
        <OutboxNote />
      </section>
      <StorageSection pubkey={id.pubkey} />
      <AppearanceSection />
      <CacheSection />
      <PrivacySection />
      <TroubleshootingSection />
    </div>
  )
}

/* Identity ------------------------------------------------------------- */

function IdentitySection({
  pubkey,
  source,
  ephemeral,
}: {
  pubkey: string
  source: 'local' | 'extension'
  ephemeral: boolean
}) {
  const [backup, setBackup] = useState(false)
  const [forget, setForget] = useState(false)
  const npub = npubOf(pubkey)
  const where =
    source === 'extension'
      ? 'The key is held by your browser extension. This site never sees it.'
      : ephemeral
        ? 'The key exists only in this tab. It is lost on reload.'
        : 'The key is stored on this device, encrypted with your passphrase.'
  return (
    <section className="page__section" aria-labelledby="h-id">
      <h2 id="h-id">Identity</h2>
      <dl className="kv">
        <dt>Public key</dt>
        <dd>
          <div className="copy-row">
            <code className="mono" style={{ overflowWrap: 'anywhere' }}>
              {npub}
            </code>
            <CopyButton text={npub} label="Copy public key" />
          </div>
        </dd>
        <dt>Custody</dt>
        <dd>{where}</dd>
      </dl>
      <div className="inline">
        {source === 'local' && (
          <Button onClick={() => setBackup(true)}>
            <Download className="icon" />
            Back up key
          </Button>
        )}
        {source === 'local' && !ephemeral && (
          <Button onClick={() => identity.lock()}>
            <Lock className="icon" />
            Lock
          </Button>
        )}
        <Button variant="danger-quiet" onClick={() => setForget(true)}>
          <Trash2 className="icon" />
          Remove from this device
        </Button>
      </div>
      <BackupDialog open={backup} onClose={() => setBackup(false)} />
      <ConfirmDialog
        open={forget}
        title="Remove this identity from the device?"
        confirmLabel="Remove identity"
        danger
        onCancel={() => setForget(false)}
        onConfirm={() => {
          setForget(false)
          identity.forget()
        }}
      >
        <p>
          The encrypted key is deleted from this browser. Without a backup you cannot sign in as
          this identity again. Files on the storage server are not deleted.
        </p>
      </ConfirmDialog>
    </section>
  )
}

function BackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [shown, setShown] = useState(false)
  if (!open && shown) setShown(false)
  const secret = identity.revealSecret()
  const encrypted = identity.storedBackup()
  return (
    <Dialog
      open={open}
      title="Back up your key"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <p>Anyone with the secret key can act as you. Keep backups where only you can read them.</p>
      {encrypted && (
        <Button
          onClick={() => {
            const url = URL.createObjectURL(new Blob([encrypted], { type: 'text/plain' }))
            const a = document.createElement('a')
            a.href = url
            a.download = 'media-hub-key-backup.txt'
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }}
        >
          <Download className="icon" />
          Download encrypted backup
        </Button>
      )}
      {secret && (
        <>
          <Button onClick={() => setShown((v) => !v)} aria-expanded={shown}>
            {shown ? <EyeOff className="icon" /> : <Eye className="icon" />}
            {shown ? 'Hide secret key' : 'Show secret key (nsec)'}
          </Button>
          {shown && (
            <div className="stack stack--sm">
              <code className="mono" style={{ overflowWrap: 'anywhere' }}>
                {nsecOf(secret)}
              </code>
              <div>
                <Button size="sm" onClick={() => copyText(nsecOf(secret), 'Secret key copied')}>
                  Copy
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

/* Connections extras ---------------------------------------------------- */

function OutboxNote() {
  const state = useLibraryState(library)
  const relayState = useRelaysSnapshot()
  if (state.outbox.total === 0) return null
  return (
    <div className="banner banner--info" role="status">
      <div className="banner__body">
        <p className="banner__title">
          {state.outbox.total} unsent {state.outbox.total === 1 ? 'event' : 'events'}
        </p>
        <ul className="plain">
          {Object.entries(state.outbox.perRelay).map(([url, n]) => (
            <li key={url}>
              <span className="mono">{url}</span>: {n} waiting
              {relayState.find((r) => r.url === url)?.state !== 'connected'
                ? ' (not connected)'
                : ''}
            </li>
          ))}
        </ul>
        <div className="banner__actions">
          <Button size="sm" onClick={() => void library.flushOutbox()}>
            Send now
          </Button>
        </div>
      </div>
    </div>
  )
}

function useRelaysSnapshot() {
  const [, force] = useState(0)
  useEffect(() => {
    const off = relays.statuses.subscribe(() => force((n) => n + 1))
    return () => void off()
  }, [])
  return relays.statuses.get()
}

/* Storage --------------------------------------------------------------- */

interface Measurement {
  at: number
  blobs: BlobDescriptor[]
  unindexed: BlobDescriptor[]
}

function StorageSection({ pubkey }: { pubkey: string }) {
  const { serverUrl } = useSettings()
  const state = useLibraryState(library)
  const [busy, setBusy] = useState<'measure' | 'clean' | null>(null)
  const [measurement, setMeasurement] = useState<Measurement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  const indexedHashes = () => {
    const set = new Set<string>()
    for (const i of state.items) {
      set.add(i.sha256)
      if (i.thumbSha256) set.add(i.thumbSha256)
    }
    return set
  }

  const measure = async () => {
    setBusy('measure')
    setError(null)
    try {
      const blobs = await listAllBlobs(serverUrl, pubkey, (t) => identity.sign(t))
      const indexed = indexedHashes()
      setMeasurement({
        at: Date.now(),
        blobs,
        unindexed: blobs.filter((b) => !indexed.has(b.sha256)),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The storage server did not answer.')
    } finally {
      setBusy(null)
    }
  }

  const clean = async () => {
    if (!measurement) return
    setBusy('clean')
    let removed = 0
    try {
      for (const b of measurement.unindexed) {
        const token = await authorization((t) => identity.sign(t), {
          verb: 'delete',
          serverUrl,
          hashes: [b.sha256],
          content: 'Delete unindexed file',
        })
        await deleteBlob(serverUrl, b.sha256, token)
        removed++
      }
      notify(`Deleted ${removed} unindexed ${removed === 1 ? 'file' : 'files'}.`)
    } catch (e) {
      notify(
        `Deleted ${removed}. ${e instanceof Error ? e.message : 'The storage server stopped answering.'}`,
        'error',
      )
    } finally {
      setConfirm(false)
      setBusy(null)
      void measure()
    }
  }

  const total = measurement?.blobs.reduce((n, b) => n + b.size, 0) ?? 0
  const orphanBytes = measurement?.unindexed.reduce((n, b) => n + b.size, 0) ?? 0

  return (
    <section className="page__section" aria-labelledby="h-storage">
      <h2 id="h-storage">Storage</h2>
      <p className="secondary">
        Measured from the storage server for this key. It signs a list request each time.
      </p>
      <div className="inline">
        <Button onClick={measure} disabled={busy !== null}>
          {busy === 'measure' ? (
            <span className="spinner" aria-hidden />
          ) : (
            <RefreshCw className="icon" />
          )}
          {measurement ? 'Measure again' : 'Measure storage'}
        </Button>
        {measurement && <span className="muted">Measured {formatAgo(measurement.at)}</span>}
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {measurement && (
        <dl className="kv">
          <dt>Files on server</dt>
          <dd>
            {measurement.blobs.length} · {formatBytes(total)}
          </dd>
          <dt>Items in library</dt>
          <dd>{state.items.length}</dd>
          <dt>Not in the library</dt>
          <dd>
            {measurement.unindexed.length === 0
              ? 'None'
              : `${measurement.unindexed.length} files · ${formatBytes(orphanBytes)}`}
          </dd>
        </dl>
      )}
      {measurement && measurement.unindexed.length > 0 && (
        <div className="banner banner--warning">
          <div className="banner__body">
            <p className="banner__text">
              These files are on the server under your key but no metadata event in this library
              points to them. They can be left over from a deletion that could not reach the server,
              or from an upload whose event was never accepted. The library on this device may also
              still be syncing.
            </p>
            <div className="banner__actions">
              <Button
                size="sm"
                variant="danger"
                onClick={() => setConfirm(true)}
                disabled={busy !== null || state.syncing}
              >
                Delete {measurement.unindexed.length} files
              </Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title="Delete files that are not in the library?"
        confirmLabel="Delete files"
        danger
        busy={busy === 'clean'}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void clean()}
      >
        <p>
          {measurement?.unindexed.length} files ({formatBytes(orphanBytes)}) will be deleted from
          the storage server. A file that another key also stores is kept for that key.
        </p>
      </ConfirmDialog>
    </section>
  )
}

/* Appearance ------------------------------------------------------------ */

function AppearanceSection() {
  const { theme } = useSettings()
  return (
    <section className="page__section" aria-labelledby="h-look">
      <h2 id="h-look">Appearance</h2>
      <div className="segmented" role="group" aria-label="Theme">
        {(['system', 'light', 'dark'] as Theme[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={theme === t}
            onClick={() => {
              settings.update({ theme: t })
              applyTheme(t)
            }}
          >
            {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
    </section>
  )
}

/* Cache ----------------------------------------------------------------- */

function CacheSection() {
  const [info, setInfo] = useState<{ count: number; bytes: number } | null | 'unavailable'>(null)
  const refresh = () =>
    Promise.all([cache.countEvents(), cache.approximateBytes()]).then(
      ([count, bytes]) => setInfo({ count, bytes }),
      () => setInfo('unavailable'),
    )
  useEffect(() => {
    void refresh()
  }, [])
  return (
    <section className="page__section" aria-labelledby="h-cache">
      <h2 id="h-cache">Cache on this device</h2>
      <p className="secondary">
        Metadata events are kept in this browser so the library opens without waiting for relays and
        can be browsed offline. Previews and originals are not stored by the app; the
        browser&rsquo;s HTTP cache may keep them.
      </p>
      {info === 'unavailable' ? (
        <p className="muted">This browser is blocking local storage for the app.</p>
      ) : info ? (
        <p>
          {info.count} events · about {formatBytes(info.bytes)}
        </p>
      ) : null}
      <div>
        <Button
          onClick={async () => {
            await cache.clearEvents()
            await refresh()
            void library.refresh()
            notify('Cache cleared. The library is being reloaded from the relays.')
          }}
        >
          Clear cached metadata
        </Button>
      </div>
    </section>
  )
}

/* Privacy --------------------------------------------------------------- */

function PrivacySection() {
  return (
    <section className="page__section" aria-labelledby="h-privacy">
      <h2 id="h-privacy">What is visible to whom</h2>
      <ul className="plain plain--spaced">
        <li>
          <strong>Files</strong> are sent only to your storage server. Relays never receive file
          contents.
        </li>
        <li>
          <strong>Metadata events</strong> go to every relay you list. They contain your public key,
          the file hash, type, size, dimensions, a small blurred preview code, the file&rsquo;s
          address and times. On a public relay anyone can read them.
        </li>
        <li>
          <strong>File addresses are not secret.</strong> Anyone who learns a file&rsquo;s URL or
          hash can download it from the storage server unless you restrict access there.
        </li>
        <li>
          <strong>Files are not end-to-end encrypted.</strong> The storage server operator can read
          them.
        </li>
        <li>
          <strong>Your private key</strong> stays in this browser, or in your extension. It is never
          sent to the server or to relays.
        </li>
        <li>
          <strong>Deleting</strong> removes the file from your server and asks relays to drop the
          metadata. Relays and other people may keep copies of what they already received.
        </li>
      </ul>
    </section>
  )
}

function TroubleshootingSection() {
  const [checked, setChecked] = useState(false)
  return (
    <section className="page__section" aria-labelledby="h-help">
      <h2 id="h-help">Troubleshooting</h2>
      <ul className="plain plain--spaced">
        <li>
          <strong>Previews do not load.</strong> The storage server is probably unreachable or
          blocked by CORS. Use Test above; the message says which.
        </li>
        <li>
          <strong>The library is empty after signing in.</strong> The relays you list may not hold
          your events. Check that they are connected, or add the relay you uploaded through.
        </li>
        <li>
          <strong>A relay shows an https error.</strong> A page served over https cannot open a{' '}
          <code>ws://</code> relay. Use a <code>wss://</code> address.
        </li>
        <li>
          <strong>Upload rejected with 403.</strong> The storage server only accepts approved keys.
          Add your public key to its <code>ALLOWED_PUBKEYS</code>.
        </li>
        <li>
          <strong>Upload rejected with 401.</strong> The device clock is probably wrong by more than
          a minute.
        </li>
      </ul>
      <div className="inline">
        <Button
          onClick={async () => {
            relays.reconnect()
            const s = await server.check()
            setChecked(true)
            notify(
              s.state === 'ok' ? 'Storage server answered.' : 'Storage server did not answer.',
              s.state === 'ok' ? 'info' : 'error',
            )
          }}
        >
          Re-check connections
        </Button>
        {checked && <span className="muted">Done</span>}
      </div>
    </section>
  )
}
