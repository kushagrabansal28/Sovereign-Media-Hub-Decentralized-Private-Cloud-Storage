/**
 * A block seen from above-left. The lit top face is the address; the two lower faces are
 * the content it names. It stands for a content-addressed object: one file, one name.
 */
export function LogoMark({ size = 22, draw = false }: { size?: number; draw?: boolean }) {
  return (
    <svg
      className={draw ? 'logo logo--draw' : 'logo'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path className="logo__top" d="M12 2.5 20.5 7.2 12 12 3.5 7.2Z" fill="var(--accent)" />
      <path className="logo__body" d="M3.5 7.2v9.6L12 21.5l8.5-4.7V7.2M12 12v9.5" pathLength="1" />
    </svg>
  )
}

export function Wordmark({ full, draw }: { full?: boolean; draw?: boolean }) {
  return (
    <span className="wordmark">
      <LogoMark draw={draw} />
      <span className="wordmark__text">{full ? 'Sovereign Media Hub' : 'Media Hub'}</span>
    </span>
  )
}
