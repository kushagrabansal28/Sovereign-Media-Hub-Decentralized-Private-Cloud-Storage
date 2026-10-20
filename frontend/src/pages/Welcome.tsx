import { useEffect, useRef, useState } from 'react'
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
import { Avatar, ProfileFields } from '../components/Avatar'
import { Wordmark } from '../components/Logo'
import { sha256Native } from '../lib/blossom/sha256'
import { Button, ConfirmDialog, copyText, Field, notify } from '../components/ui'
import { KeyError, isEncryptedKey, npubOf, nsecOf, publicKeyOf } from '../lib/nostr/keys'
import { identity, useIdentity } from '../stores/identity'
import { cleanName, profiles } from '../stores/profile'
import { settings } from '../stores/settings'

type Step = 'choose' | 'protect' | 'backup' | 'import' | 'profile' | 'connections'
type Origin = 'create' | 'import' | 'extension'

/** The numbered steps for each way of getting an identity. */
const PLANS: Record<Origin, Step[]> = {
  create: ['protect', 'backup', 'profile', 'connections'],
  import: ['protect', 'profile', 'connections'],
  extension: ['profile', 'connections'],
}

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
  // Returning mid-onboarding with an unlocked identity: only the profile and connections are left.
  const [step, setStep] = useState<Step>(
    identityState.phase === 'unlocked'
      ? profiles.get(identityState.pubkey)
        ? 'connections'
        : 'profile'
      : 'choose',
  )
  const [origin, setOrigin] = useState<Origin>(
    identityState.phase === 'unlocked' && identityState.source === 'extension'
      ? 'extension'
      : 'create',
  )
  const [pubkey, setPubkey] = useState('')
  const [protectedByPassphrase, setProtected] = useState(false)

  // Starting again with no identity (a fresh browser, or after "Use a different identity") must
  // walk through every step, even if setup was finished in this browser before. Otherwise the
  // saved "confirmed" flag would send a new key straight to the library.
  useEffect(() => {
    if (identityState.phase === 'none') settings.update({ confirmed: false })
    // Runs once, when the first-run screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = PLANS[origin]
  const label = (s: Step) => `Step ${plan.indexOf(s) + 1} of ${plan.length}`
  const signedInPubkey = identityState.phase === 'unlocked' ? identityState.pubkey : ''

  const finish = () => settings.update({ confirmed: true })

  return (
    <div className="welcome">
      <header className="welcome__top">
        <Wordmark full draw />
      </header>
      <main id="main" className={`welcome__main${step === 'choose' ? ' welcome__main--wide' : ''}`}>
        {step === 'choose' && (
          <Choose
            onCreate={() => {
              setOrigin('create')
              setPubkey(publicKeyOf(identity.create().secretKey))
              setStep('protect')
            }}
            onExtension={() => {
              setOrigin('extension')
              setStep('profile')
            }}
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
            label={label('protect')}
            onBack={() => {
              identity.forget()
              setStep('choose')
            }}
            onDone={(sessionOnlyChoice) => {
              setProtected(!sessionOnlyChoice)
              setStep(origin === 'create' ? 'backup' : 'profile')
            }}
          />
        )}
        {step === 'backup' && (
          <Backup
            protectedByPassphrase={protectedByPassphrase}
            label={label('backup')}
            onDone={() => setStep('profile')}
          />
        )}
        {step === 'profile' && (
          <ProfileStep
            pubkey={signedInPubkey}
            label={label('profile')}
            onDone={() => setStep('connections')}
          />
        )}
        {step === 'connections' && <Connections label={label('connections')} onDone={finish} />}
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
    <div className="welcome-grid">
      <div className="stack stack--lg">
        <div className="stack">
          <h1 className="display">Your library. Your server.</h1>
          <p className="secondary">
            Photos and videos are stored on a server you run. Relays keep small metadata records,
            not the files. You sign in with a key you hold, so there is no password to reset or
            leak.
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
      <aside className="how" aria-label="How it works">
        <h2 className="how__title">How it works</h2>
        <ol className="how__list">
          <li>
            <span className="how__n" aria-hidden>
              01
            </span>
            <div>
              <strong>Your key signs every request.</strong>
              <p>
                It is created on this device. The server checks signatures and never receives the
                key.
              </p>
            </div>
          </li>
          <li>
            <span className="how__n" aria-hidden>
              02
            </span>
            <div>
              <strong>Files go to your server.</strong>
              <p>Each file is stored under its SHA-256, so identical files are kept once.</p>
            </div>
          </li>
          <li>
            <span className="how__n" aria-hidden>
              03
            </span>
            <div>
              <strong>Relays keep the index.</strong>
              <p>Small signed records: hash, size, preview address. No file contents.</p>
            </div>
          </li>
        </ol>
        <HashDemo />
      </aside>
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
  label,
  onBack,
  onDone,
}: {
  pubkey: string
  label: string
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
        <p className="step">{label}</p>
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
  label,
  onDone,
}: {
  protectedByPassphrase: boolean
  label: string
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
        <p className="step">{label}</p>
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

/* Profile ------------------------------------------------------------- */

function ProfileStep({
  pubkey,
  label,
  onDone,
}: {
  pubkey: string
  label: string
  onDone: () => void
}) {
  const [name, setName] = useState(profiles.get(pubkey)?.name ?? '')
  const [picture, setPicture] = useState<string | undefined>(profiles.get(pubkey)?.picture)
  const ready = cleanName(name).length > 0

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!profiles.set(pubkey, { name, picture })) return
    onDone()
  }

  return (
    <form className="stack stack--lg" onSubmit={save}>
      <div className="stack">
        <p className="step">{label}</p>
        <h1 className="title">What should we call you?</h1>
        <p className="secondary">
          Your name and photo identify this key on this device, for example on the sign-in screen
          and in the sidebar. They are saved only in this browser.
        </p>
      </div>
      <ProfileFields
        name={name}
        picture={picture}
        onName={setName}
        onPicture={setPicture}
        autoFocus
      />
      <div className="profile-preview" aria-live="polite">
        <Avatar name={name || '?'} picture={picture} size={36} />
        <span>{ready ? `Signed in as ${cleanName(name)}` : 'Enter a name to continue'}</span>
      </div>
      <div className="inline inline--end">
        <Button type="submit" variant="primary" disabled={!ready}>
          Continue
        </Button>
      </div>
    </form>
  )
}

/* Connections --------------------------------------------------------- */

function Connections({ label, onDone }: { label: string; onDone: () => void }) {
  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="step">{label}</p>
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

/**
 * Shows what "addressed by content" means with the real function the app uses: type anything
 * and see its SHA-256. Characters that changed since the last keystroke flash.
 */
function HashDemo() {
  const [text, setText] = useState('harbour-clip.webm')
  const [hash, setHash] = useState('')
  const [failed, setFailed] = useState(false)
  const previous = useRef('')

  useEffect(() => {
    let live = true
    sha256Native(new Blob([text]))
      .then((h) => {
        if (!live) return
        previous.current = hash
        setHash(h)
        setFailed(false)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
    // `hash` is read only to remember the previous value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <section className="hashdemo" aria-labelledby="hashdemo-title">
      <h2 className="how__title" id="hashdemo-title">
        Try it: a file's address
      </h2>
      <label className="hashdemo__field">
        <span className="sr-only">Text to fingerprint</span>
        <input
          className="input hashdemo__input"
          value={text}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="hashdemo__hash" aria-live="off" data-testid="hashdemo-hash">
        {failed
          ? 'This browser cannot compute SHA-256 here.'
          : Array.from({ length: 8 }, (_, g) => (
              <span key={g} className="hashdemo__group">
                {[...hash.slice(g * 8, g * 8 + 8)].map((c, k) => (
                  <span
                    key={`${g}-${k}-${hash}`}
                    className={
                      previous.current && previous.current[g * 8 + k] !== c
                        ? 'hashdemo__changed'
                        : undefined
                    }
                  >
                    {c}
                  </span>
                ))}{' '}
              </span>
            ))}
      </p>
      <div className="hashdemo__note">
        <p>
          <strong>What is this?</strong> Every file you store is named by its SHA-256: a 64-digit
          fingerprint of its contents. Type anything above and its fingerprint appears.
        </p>
        <p>
          Change one character and every digit changes. Identical content always gets the identical
          fingerprint, which is how Media Hub recognises a duplicate without comparing files. It is
          worked out here, in your browser.
        </p>
      </div>
    </section>
  )
}
