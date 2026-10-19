import { describe, expect, it } from 'vitest'
import { justifiedLayout, MAX_RATIO, MIN_RATIO, visibleRows } from './layout'

const opts = { width: 1000, targetRowHeight: 200, gap: 4 }

describe('justifiedLayout', () => {
  it('returns nothing for an empty list or zero width', () => {
    expect(justifiedLayout({ ...opts, ratios: [] })).toEqual({ rows: [], height: 0 })
    expect(justifiedLayout({ ...opts, width: 0, ratios: [1, 1] }).rows).toHaveLength(0)
  })

  it('fills every full row to the container width', () => {
    const ratios = Array.from({ length: 40 }, (_, i) => 0.7 + (i % 5) * 0.3)
    const { rows } = justifiedLayout({ ...opts, ratios })
    for (const row of rows.slice(0, -1)) {
      const last = row.cells[row.cells.length - 1]!
      expect(last.left + last.width).toBeCloseTo(1000, 6)
    }
  })

  it('keeps cell aspect ratios inside a row', () => {
    const ratios = [1.5, 0.75, 1, 1.78, 1, 1.33, 0.8]
    const { rows } = justifiedLayout({ ...opts, ratios })
    for (const row of rows) {
      for (const c of row.cells) expect(c.width / row.height).toBeCloseTo(ratios[c.index]!, 6)
    }
  })

  it('does not stretch the last row', () => {
    const { rows } = justifiedLayout({ ...opts, ratios: [1, 1, 1, 1, 1, 1, 1, 1, 1] })
    expect(rows[rows.length - 1]!.height).toBe(200)
  })

  it('places each item exactly once, in order', () => {
    const ratios = Array.from({ length: 123 }, (_, i) => 0.6 + (i % 7) * 0.25)
    const { rows } = justifiedLayout({ ...opts, ratios })
    expect(rows.flatMap((r) => r.cells.map((c) => c.index))).toEqual(ratios.map((_, i) => i))
  })

  it('total height equals the bottom of the last row', () => {
    const { rows, height } = justifiedLayout({ ...opts, ratios: Array(30).fill(1.3) })
    const last = rows[rows.length - 1]!
    expect(height).toBeCloseTo(last.top + last.height, 6)
  })

  it('clamps extreme ratios and replaces invalid ones', () => {
    const { rows } = justifiedLayout({ ...opts, ratios: [100, 0.001, NaN, -1, 0] })
    const widths = rows.flatMap((r) => r.cells.map((c) => c.width / r.height))
    expect(Math.max(...widths)).toBeLessThanOrEqual(MAX_RATIO + 1e-9)
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(MIN_RATIO - 1e-9)
  })

  it('is deterministic', () => {
    const ratios = [1, 1.5, 0.8, 1.2, 2, 1]
    expect(justifiedLayout({ ...opts, ratios })).toEqual(justifiedLayout({ ...opts, ratios }))
  })

  it('handles a single item wider than the container', () => {
    const { rows } = justifiedLayout({ width: 100, targetRowHeight: 200, gap: 4, ratios: [1.5] })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cells[0]!.width).toBeCloseTo(100, 6)
  })
})

describe('visibleRows', () => {
  const { rows } = justifiedLayout({ ...opts, ratios: Array(200).fill(1.5) })

  it('selects only rows near the viewport', () => {
    const [a, b] = visibleRows(rows, 2000, 800, 200)
    expect(b - a).toBeLessThan(rows.length / 2)
    expect(rows[a]!.top + rows[a]!.height).toBeGreaterThanOrEqual(1800)
    expect(rows[a - 1]!.top + rows[a - 1]!.height).toBeLessThan(1800)
    expect(rows[b - 1]!.top).toBeLessThanOrEqual(3000)
  })

  it('starts at the first row at the top', () => {
    expect(visibleRows(rows, 0, 800, 0)[0]).toBe(0)
  })

  it('returns an empty range for no rows', () => {
    expect(visibleRows([], 0, 800, 0)).toEqual([0, 0])
  })
})
