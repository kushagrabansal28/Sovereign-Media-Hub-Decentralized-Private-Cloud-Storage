import { flushSync } from 'react-dom'

interface TransitionOptions {
  /** Element that becomes the starting point of a shared-element transition. */
  source?: HTMLElement | null
  /** True once the new screen is in the document. */
  until?: () => boolean
}

type StartViewTransition = (update: () => Promise<void> | void) => unknown

/**
 * Runs a state change inside a View Transition when the browser has them and the person has
 * not asked for reduced motion. Elsewhere the change simply happens.
 */
export function withTransition(update: () => void, { source, until }: TransitionOptions = {}) {
  const start = (document as unknown as { startViewTransition?: StartViewTransition })
    .startViewTransition
  if (!start || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  if (source) source.style.setProperty('view-transition-name', 'hero')
  start.call(document, async () => {
    source?.style.removeProperty('view-transition-name')
    flushSync(update)
    // Router updates may be scheduled as transitions; wait until the new screen is there.
    const deadline = performance.now() + 400
    while (until && !until() && performance.now() < deadline) {
      await new Promise((r) => requestAnimationFrame(r))
    }
  })
}
