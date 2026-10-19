/** Viewfinder corners around a filled square: a frame, and the thing it addresses. */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <rect x="9" y="9" width="6" height="6" fill="var(--accent)" stroke="none" />
    </svg>
  )
}

export function Wordmark({ full }: { full?: boolean }) {
  return (
    <span className="wordmark">
      <LogoMark />
      <span className="wordmark__text">{full ? 'Sovereign Media Hub' : 'Media Hub'}</span>
    </span>
  )
}
