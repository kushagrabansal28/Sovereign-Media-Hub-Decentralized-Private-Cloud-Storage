import { useState } from 'react'
import { Wordmark } from '../components/Logo'
import { Button, ConfirmDialog, Field } from '../components/ui'
import { KeyError, npubOf } from '../lib/nostr/keys'
import { shorten } from '../lib/format'
import { identity, useIdentity } from '../stores/identity'

const paint = () => new Promise((r) => setTimeout(r, 30))

export default function Unlock() {
  const id = useIdentity()
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  if (id.phase !== 'locked') return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    await paint()
    try {
      identity.unlock(pass)
    } catch (err) {
      setError(err instanceof KeyError ? err.message : 'Could not unlock.')
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <header className="welcome__top">
        <Wordmark full />
      </header>
      <main id="main" className="welcome__main">
        <form className="stack stack--lg" onSubmit={submit}>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={npubOf(id.pubkey)}
            readOnly
            hidden
          />
          <div className="stack">
            <h1 className="title">Unlock your identity</h1>
            <p className="secondary">
              <span className="mono">{shorten(npubOf(id.pubkey), 12, 6)}</span>
              <br />
              Enter the passphrase you chose when this key was saved on this device.
            </p>
          </div>
          <Field label="Passphrase" error={error}>
            {(p) => (
              <input
                {...p}
                className="input"
                type="password"
                autoComplete="current-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <div className="inline inline--end">
            <Button variant="ghost" onClick={() => setConfirmForget(true)} disabled={busy}>
              Use a different identity
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !pass}>
              {busy && <span className="spinner" aria-hidden />}
              {busy ? 'Unlocking…' : 'Unlock'}
            </Button>
          </div>
        </form>
        <ConfirmDialog
          open={confirmForget}
          title="Remove the saved identity?"
          confirmLabel="Remove and start over"
          danger
          onCancel={() => setConfirmForget(false)}
          onConfirm={() => {
            setConfirmForget(false)
            identity.forget()
          }}
        >
          <p>
            The encrypted key is deleted from this browser. If you do not have a backup of it, you
            cannot sign in as this identity again.
          </p>
        </ConfirmDialog>
      </main>
    </div>
  )
}
