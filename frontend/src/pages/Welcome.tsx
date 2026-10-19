import { useState } from 'react'
import {
  ArchiveRestore,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Puzzle,
  ShieldAlert,
} from 'lucide-react'
import { RelaySection, StorageServerSection } from '../components/connections'
import { Wordmark } from '../components/Logo'
import { Button, ConfirmDialog, copyText, Field, notify } from '../components/ui'
import { KeyError, isEncryptedKey, npubOf, nsecOf, publicKeyOf } from '../lib/nostr/keys'
import { identity, useIdentity } from '../stores/identity'
import { settings } from '../stores/settings'

type Step = 'choose' | 'protect' | 'backup' | 'import' | 'connections'

const MIN_PASSPHRASE = 8

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Lets the browser paint a pending state before a CPU-heavy step starts. */
const paint = () => new Promise((r) => setTimeout(r, 30))

export default function Welcome() {
  const identityState = useIdentity()
  // Returning mid-onboarding with an unlocked identity: only the connections step is left.
  const [step, setStep] = useState<Step>(
    identityState.phase === 'unlocked' ? 'connections' : 'choose',
  )
  const [origin, setOrigin] = useState<'create' | 'import'>('create')
  const [pubkey, setPubkey] = useState('')
  const [protectedByPassphrase, setProtected] = useState(false)

  const finish = () => settings.update({ confirmed: true })

  return (
    <div className="welcome">
      <header className="welcome__top">
        <Wordmark full />
      </header>
      <main id="main" className="welcome__main">
        {step === 'choose' && (
          <Choose
            onCreate={() => {
              setOrigin('create')
              setPubkey(publicKeyOf(identity.create().secretKey))
              setStep('protect')
            }}
            onExtension={() => setStep('connections')}
            onImport={() => {
              setOrigin('import')
              setStep('import')
            }}
          />
        )}
        {step === 'import' && (
          <ImportKey
            onBack={() => setStep('choose')}
            onImported={(pk) => {
              setPubkey(pk)
              setStep('protect')
            }}
          />
        )}
        {step === 'protect' && (
          <Protect
            pubkey={pubkey}
            onBack={() => {
              identity.forget()
              setStep('choose')
            }}
            onDone={(sessionOnlyChoice) => {
              setProtected(!sessionOnlyChoice)
              setStep(origin === 'create' ? 'backup' : 'connections')
            }}
          />
        )}
        {step === 'backup' && (
          <Backup
            protectedByPassphrase={protectedByPassphrase}
            onDone={() => setStep('connections')}
          />
        )}
        {step === 'connections' && <Connections onDone={finish} />}
      </main>
    </div>
  )
}

/* Step 1 -------------------------------------------------------------- */

function Choose({
  onCreate,
  onImport,
  onExtension,
}: {
  onCreate: () => void
  onImport: () => void
  onExtension: () => void
}) {
  const [busy, setBusy] = useState(false)
  const hasExtension = identity.hasExtension()

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <h1 className="display">Your library. Your server.</h1>
        <p className="secondary">
          Photos and videos are stored on a server you run. Relays keep small metadata records, not
          the files. You sign in with a key you hold, so there is no password to reset or leak.
        </p>
      </div>

      <ul className="choices">
        <li>
          <button className="choice" onClick={onCreate}>
            <KeyRound className="icon icon--lg" />
            <span className="choice__text">
              <span className="choice__title">Create a new identity</span>
              <span className="choice__desc">Generates a Nostr key on this device.</span>
            </span>
            <ChevronRight className="icon muted" />
          </button>
        </li>
        <li>
          <button className="choice" onClick={onImport}>
            <ArchiveRestore className="icon icon--lg" />
            <span className="choice__text">
              <span className="choice__title">Use an existing key</span>
              <span className="choice__desc">
                Paste an nsec, a hex key, or an encrypted backup.
              </span>
            </span>
            <ChevronRight className="icon muted" />
          </button>
        </li>
        <li>
          <button
            className="choice"
            disabled={!hasExtension || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await identity.useExtension()
                onExtension()
              } catch (e) {
                notify(e instanceof Error ? e.message : 'The extension did not respond.', 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            <Puzzle className="icon icon--lg" />
            <span className="choice__text">
              <span className="choice__title">Use a browser extension</span>
              <span className="choice__desc">
                {hasExtension
                  ? 'The extension holds the key and signs for this site (NIP-07).'
                  : 'No NIP-07 extension was detected in this browser.'}
              </span>
            </span>
            <ChevronRight className="icon muted" />
          </button>
        </li>
      </ul>

      <p className="field__hint">
        The private key is never sent to the storage server or to relays.
      </p>
    </div>
  )
}

/* Import -------------------------------------------------------------- */

function ImportKey({
  onBack,
  onImported,
}: {
  onBack: () => void
  onImported: (pubkey: string) => void
}) {
  const [mode, setMode] = useState<'key' | 'backup'>('key')
  const [text, setText] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    await paint()
    try {
      const pk =
        mode === 'backup' || isEncryptedKey(text)
          ? identity.restoreEncrypted(text, pass)
          : identity.import(text)
      onImported(pk)
    } catch (err) {
      setError(err instanceof KeyError ? err.message : 'That key could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack stack--lg" onSubmit={submit}>
      <div className="stack">
        <h1 className="title">Use an existing key</h1>
        <p className="secondary">
          The key is checked in this browser. It is not uploaded anywhere.
        </p>
      </div>

      <div className="segmented" role="group" aria-label="Key format">
        <button type="button" aria-pressed={mode === 'key'} onClick={() => setMode('key')}>
          Private key
        </button>
        <button type="button" aria-pressed={mode === 'backup'} onClick={() => setMode('backup')}>
          Encrypted backup
        </button>
      </div>

      <Field
        label={mode === 'key' ? 'nsec or hex private key' : 'Encrypted backup (ncryptsec1…)'}
        error={error}
      >
        {(p) => (
          <input
            {...p}
            className="input input--mono"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'key' ? 'nsec1…' : 'ncryptsec1…'}
            autoFocus
          />
        )}
      </Field>
      {mode === 'backup' && (
        <Field label="Backup passphrase">
          {(p) => (
            <input
              {...p}
              className="input"
              type="password"
              autoComplete="off"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
        </Field>
      )}

      <div className="inline inline--end">
        <Button onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !text.trim() || (mode === 'backup' && !pass)}
        >
          {busy && <span className="spinner" aria-hidden />}
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      </div>
    </form>
  )
}

/* Protect ------------------------------------------------------------- */

function Protect({
  pubkey,
  onBack,
  onDone,
}: {
  pubkey: string
  onBack: () => void
  onDone: (sessionOnly: boolean) => void
}) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [sessionOnly, setSessionOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const npub = npubOf(pubkey)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sessionOnly) {
      identity.keepInMemory()
      return onDone(true)
    }
    if (pass.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters.`)
    if (pass !== confirm) return setError('The two passphrases are different.')
    setError(null)
    setBusy(true)
    await paint()
    try {
      identity.protect(pass)
      onDone(false)
    } catch {
      setError('The key could not be encrypted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack stack--lg" onSubmit={submit}>
      <input type="text" name="username" autoComplete="username" value={npub} readOnly hidden />
      <div className="stack">
        <p className="step">Step 1 of 3</p>
        <h1 className="title">Protect the key on this device</h1>
        <p className="secondary">
          The key is encrypted with a passphrase before it is saved in this browser. You enter the
          passphrase to unlock it. Nothing readable is stored.
        </p>
      </div>

      <div className="stack stack--sm">
        <span className="field__label">Your public identity</span>
        <div className="copy-row">
          <code className="mono secondary" style={{ overflowWrap: 'anywhere' }}>
            {npub}
          </code>
        </div>
      </div>

      {!sessionOnly && (
        <>
          <Field label="Passphrase" error={error}>
            {(p) => (
              <input
                {...p}
                className="input"
                type="password"
                autoComplete="new-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field label="Repeat passphrase">
            {(p) => (
              <input
                {...p}
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
        </>
      )}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={sessionOnly}
          onChange={(e) => setSessionOnly(e.target.checked)}
        />
        <span>
          Don&rsquo;t save on this device. The key exists only until this tab is closed or reloaded.
        </span>
      </label>

      <div className="inline inline--end">
        <Button onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />}
          {busy ? 'Encrypting…' : 'Continue'}
        </Button>
      </div>
    </form>
  )
}

/* Backup -------------------------------------------------------------- */

function Backup({
  protectedByPassphrase,
  onDone,
}: {
  protectedByPassphrase: boolean
  onDone: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const secret = identity.revealSecret()
  const backup = identity.storedBackup()
  const nsec = revealed && secret ? nsecOf(secret) : null
  const pubkey = secret ? publicKeyOf(secret) : ''

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="step">Step 2 of 3</p>
        <h1 className="title">Back up your key</h1>
        <p className="secondary">
          Whoever holds this key can act as you. If it is lost and there is no backup, you cannot
          sign in again, and no one can recover it. The files stay on the server but you lose the
          ability to manage them.
        </p>
      </div>

      <div className="stack stack--sm">
        {protectedByPassphrase && backup && (
          <Button
            onClick={() => {
              download(`media-hub-key-${npubOf(pubkey).slice(0, 12)}.txt`, backup)
              setSaved(true)
            }}
          >
            <Download className="icon" />
            Download encrypted backup
          </Button>
        )}
        <Button onClick={() => setRevealed((v) => !v)} aria-expanded={revealed}>
          {revealed ? <EyeOff className="icon" /> : <Eye className="icon" />}
          {revealed ? 'Hide secret key' : 'Show secret key (nsec)'}
        </Button>
      </div>

      {nsec && (
        <div className="banner banner--warning" role="group" aria-label="Secret key">
          <ShieldAlert className="icon" />
          <div className="banner__body">
            <p className="banner__title">Secret key</p>
            <code
              className="mono"
              style={{ overflowWrap: 'anywhere', display: 'block', margin: '4px 0 8px' }}
            >
              {nsec}
            </code>
            <p className="banner__text">
              Store it in a password manager. Do not paste it into chats or documents you share.
            </p>
            <div className="banner__actions">
              <Button size="sm" onClick={() => copyText(nsec, 'Secret key copied')}>
                Copy
              </Button>
            </div>
          </div>
        </div>
      )}

      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I have stored a backup of this key somewhere safe.</span>
      </label>

      <div className="inline inline--end">
        <Button variant="ghost" onClick={() => setConfirmSkip(true)}>
          Skip backup
        </Button>
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          Continue
        </Button>
      </div>

      <ConfirmDialog
        open={confirmSkip}
        title="Continue without a backup?"
        confirmLabel="Continue without backup"
        danger
        onCancel={() => setConfirmSkip(false)}
        onConfirm={onDone}
      >
        <p>
          If you clear this browser&rsquo;s data, forget the passphrase, or use session-only mode
          and close the tab, this identity is gone for good. You can still back it up later from
          Settings while it is unlocked.
        </p>
      </ConfirmDialog>
    </div>
  )
}

/* Connections --------------------------------------------------------- */

function Connections({ onDone }: { onDone: () => void }) {
  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="step">Step 3 of 3</p>
        <h1 className="title">Connect your storage and relays</h1>
        <p className="secondary">
          The storage server holds the files. Relays hold the index. Both can be changed later in
          Settings.
        </p>
      </div>
      <section className="stack" aria-labelledby="conn-storage">
        <h2 className="section-title" id="conn-storage">
          Storage
        </h2>
        <StorageServerSection />
      </section>
      <section className="stack" aria-labelledby="conn-relays">
        <h2 className="section-title" id="conn-relays">
          Relays
        </h2>
        <RelaySection />
      </section>
      <div className="inline inline--end">
        <Button variant="primary" onClick={onDone}>
          Open library
        </Button>
      </div>
    </div>
  )
}
