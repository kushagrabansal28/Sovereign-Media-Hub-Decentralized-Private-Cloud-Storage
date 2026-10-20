import { useEffect, useRef } from 'react'

type Mode = 'idle' | 'link' | 'open' | 'play' | 'text'

const INTERACTIVE =
  'a[href],button:not(:disabled),[role="button"],[role="menuitem"],[role="option"],summary,label[for],select,.choice'

function modeOf(target: Element | null): Mode {
  if (!target) return 'idle'
  const tile = target.closest('.tile__main')
  if (tile) return tile.querySelector('.tile__badge') ? 'play' : 'open'
  if (target.closest('input:not([type=checkbox]):not([type=radio]),textarea')) return 'text'
  if (target.closest(INTERACTIVE)) return 'link'
  return 'idle'
}

/**
 * A soft ring that trails the pointer and changes with what is underneath it. It only exists
 * for fine pointers and is switched off for people who asked for less motion. The real cursor
 * stays, so nothing depends on this.
 */
export function Cursor() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    if (!matchMedia('(pointer: fine)').matches) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let x = 0
    let y = 0
    let tx = 0
    let ty = 0
    let frame = 0
    let shown = false

    const tick = () => {
      x += (tx - x) * 0.22
      y += (ty - y) * 0.22
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(tick) : 0
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      tx = e.clientX
      ty = e.clientY
      if (!shown) {
        shown = true
        x = tx
        y = ty
        el.dataset.shown = 'true'
      }
      el.dataset.mode = modeOf(e.target as Element | null)
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onDown = () => (el.dataset.down = 'true')
    const onUp = () => delete el.dataset.down
    const onLeave = () => {
      shown = false
      delete el.dataset.shown
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={root} className="cursor" data-mode="idle" aria-hidden="true">
      <span className="cursor__ring" />
    </div>
  )
}
