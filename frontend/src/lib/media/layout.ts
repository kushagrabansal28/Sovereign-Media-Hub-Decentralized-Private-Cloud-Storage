export interface LayoutCell {
  index: number
  left: number
  width: number
}

export interface LayoutRow {
  top: number
  height: number
  cells: LayoutCell[]
}

export interface Layout {
  rows: LayoutRow[]
  height: number
}

export interface LayoutOptions {
  width: number
  targetRowHeight: number
  gap: number
  /** Aspect ratios (width / height), one per item, in display order. */
  ratios: number[]
}

/** Extreme panoramas and tall strips are cropped rather than allowed to wreck a row. */
export const MIN_RATIO = 0.5
export const MAX_RATIO = 2.4

/**
 * Justified rows: items keep their aspect ratio (within clamps), every full row
 * spans the container width exactly, and the last row keeps the target height
 * instead of being stretched. The layout is computed from metadata alone, so
 * nothing moves when images finish loading.
 */
export function justifiedLayout({ width, targetRowHeight, gap, ratios }: LayoutOptions): Layout {
  const rows: LayoutRow[] = []
  if (width <= 0 || ratios.length === 0) return { rows, height: 0 }

  let top = 0
  let start = 0
  let sum = 0

  const flush = (end: number, justify: boolean) => {
    const count = end - start
    const gaps = gap * (count - 1)
    const height = justify ? (width - gaps) / sum : targetRowHeight
    const cells: LayoutCell[] = []
    let left = 0
    for (let i = start; i < end; i++) {
      const w = clamp(ratios[i]!) * height
      cells.push({ index: i, left, width: w })
      left += w + gap
    }
    rows.push({ top, height, cells })
    top += height + gap
    start = end
    sum = 0
  }

  for (let i = 0; i < ratios.length; i++) {
    sum += clamp(ratios[i]!)
    const count = i - start + 1
    const natural = sum * targetRowHeight + gap * (count - 1)
    if (natural >= width) flush(i + 1, true)
  }
  if (start < ratios.length) flush(ratios.length, false)

  return { rows, height: Math.max(0, top - gap) }
}

function clamp(r: number): number {
  return Number.isFinite(r) && r > 0 ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, r)) : 4 / 3
}

/** Index range of rows intersecting [scrollTop, scrollTop + viewport], with overscan in pixels. */
export function visibleRows(
  rows: LayoutRow[],
  scrollTop: number,
  viewport: number,
  overscan: number,
): [number, number] {
  if (!rows.length) return [0, 0]
  const from = scrollTop - overscan
  const to = scrollTop + viewport + overscan
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const row = rows[mid]!
    if (row.top + row.height < from) lo = mid + 1
    else hi = mid
  }
  const first = lo
  let last = first
  while (last < rows.length && rows[last]!.top <= to) last++
  return [first, last]
}
