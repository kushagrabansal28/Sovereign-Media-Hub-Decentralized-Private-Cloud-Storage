import {
  type ComponentPropsWithRef,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Check, Copy } from 'lucide-react'
import { createStore } from '../stores/createStore'

/* Buttons ------------------------------------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-quiet'

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  className,
  type,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    variant === 'ghost' ? '' : `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return <button type={type ?? 'button'} className={cls} {...rest} />
}

interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label'> {
  /** Accessible name and tooltip. Icon-only buttons must have one. */
  label: string
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  type,
  ...rest
}: IconButtonProps) {
  const cls = [
    'btn',
    'btn--icon',
    variant === 'ghost' ? '' : `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type ?? 'button'} className={cls} aria-label={label} title={label} {...rest} />
  )
}

/* Toasts -------------------------------------------------------------- */

interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error'
}

const toasts = createStore<ToastItem[]>([])
let toastId = 0

export function notify(text: string, kind: ToastItem['kind'] = 'info') {
  const id = ++toastId
  toasts.update((t) => [...t.slice(-2), { id, text, kind }])
  setTimeout(
    () => toasts.update((t) => t.filter((x) => x.id !== id)),
    kind === 'error' ? 7000 : 3500,
  )
}

export function Toasts() {
  const items = useSyncExternalStore(toasts.subscribe, toasts.get)
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast${t.kind === 'error' ? ' toast--error' : ''}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

/* Copy ---------------------------------------------------------------- */

export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notify(what)
  } catch {
    notify('The browser blocked clipboard access. Select the text and copy it manually.', 'error')
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      label={label}
      size="sm"
      onClick={async () => {
        await copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check className="icon icon--sm" /> : <Copy className="icon icon--sm" />}
    </IconButton>
  )
}

/* Fields -------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: (props: {
    id: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean
  }) => ReactNode
}) {
  const id = useId()
  const describedBy =
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/* Dialog -------------------------------------------------------------- */

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Prevents Escape and backdrop clicks from closing the dialog. */
  persistent?: boolean
}

/** A modal built on <dialog>: focus is trapped, Escape closes, focus returns to the opener. */
export function Dialog({ open, title, onClose, children, footer, persistent }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        if (!persistent) onClose()
      }}
      onClick={(e) => {
        if (!persistent && e.target === ref.current) onClose()
      }}
      onClose={() => open && !persistent && onClose()}
    >
      {open && (
        <>
          <div className="dialog__header">
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
          </div>
          <div className="dialog__body">{children}</div>
          {footer && <div className="dialog__footer">{footer}</div>}
        </>
      )}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      persistent={busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner" aria-hidden />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

/* Menu ---------------------------------------------------------------- */

export interface MenuOption<T extends string> {
  value: T
  label: string
}

/**
 * A single-choice menu button. Arrow keys move, Enter or Space selects,
 * Escape closes and returns focus to the button.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label: string
  value: T
  options: MenuOption<T>[]
  onChange: (value: T) => void
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    const selected = [...(items ?? [])].find((i) => i.getAttribute('aria-checked') === 'true')
    ;(selected ?? items?.[0])?.focus()
    const onPointer = (e: PointerEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      )
        close(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, close])

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
    ]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus()
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus()
    else if (e.key === 'Home') items[0]?.focus()
    else if (e.key === 'End') items[items.length - 1]?.focus()
    else if (e.key === 'Escape') close(true)
    else if (e.key === 'Tab') close(false)
    else return
    if (e.key !== 'Tab') e.preventDefault()
  }

  return (
    <div style={{ position: 'relative' }}>
      <Button
        ref={buttonRef}
        size="md"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span>{current?.label}</span>
      </Button>
      {open && (
        <div
          className="menu"
          role="menu"
          aria-label={label}
          ref={menuRef}
          onKeyDown={onMenuKey}
          style={{ top: 'calc(100% + 4px)', left: 0 }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className="menu__item"
              onClick={() => {
                onChange(o.value)
                close(true)
              }}
            >
              {o.label}
              {o.value === value && <Check className="icon icon--sm" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="status">
      <span className="spinner" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  )
}
