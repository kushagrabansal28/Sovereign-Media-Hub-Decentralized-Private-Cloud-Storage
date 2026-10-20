import { useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { Button, Field } from './ui'
import { resizeAvatar } from '../lib/media/avatar'
import { MAX_NAME } from '../stores/profile'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** A round picture, or the person's initials when there is no picture. Decorative: the name is shown beside it. */
export function Avatar({
  name,
  picture,
  size = 32,
}: {
  name: string
  picture?: string
  size?: number
}) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {picture ? <img src={picture} alt="" draggable={false} /> : initials(name)}
    </span>
  )
}

/** Name and optional photo, used when setting up and in Settings. */
export function ProfileFields({
  name,
  picture,
  onName,
  onPicture,
  autoFocus,
}: {
  name: string
  picture?: string
  onName: (name: string) => void
  onPicture: (picture: string | undefined) => void
  autoFocus?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      onPicture(await resizeAvatar(file))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that picture.')
    }
  }

  return (
    <div className="profile-fields">
      <div className="profile-fields__photo">
        <Avatar name={name || '?'} picture={picture} size={72} />
        <div className="stack stack--sm">
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={choose}
            aria-label="Choose a profile photo"
          />
          <Button size="sm" onClick={() => input.current?.click()}>
            <ImagePlus className="icon icon--sm" />
            {picture ? 'Change photo' : 'Choose photo'}
          </Button>
          {picture && (
            <Button size="sm" variant="ghost" onClick={() => onPicture(undefined)}>
              <X className="icon icon--sm" />
              Remove photo
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <Field
        label="Your name"
        hint="Shown beside your key on this device. It is not sent to the storage server or to relays."
      >
        {(p) => (
          <input
            {...p}
            className="input"
            value={name}
            maxLength={MAX_NAME}
            autoComplete="name"
            autoFocus={autoFocus}
            onChange={(e) => onName(e.target.value)}
          />
        )}
      </Field>
    </div>
  )
}
