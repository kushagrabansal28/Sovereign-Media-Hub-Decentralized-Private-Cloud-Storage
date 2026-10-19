import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { authorization } from '../src/lib/blossom/client'
import { buildMediaEvent } from '../src/lib/nostr/events'
import { generateKey, nsecOf, signWithKey } from '../src/lib/nostr/keys'
import { makePng } from '../tools/png'
import { createHash } from 'node:crypto'
import { PASSPHRASE, SHOTS, startStack, type Stack } from './helpers'

/**
 * Gallery performance with a large library. Results are written to
 * docs/benchmarks/gallery.csv; assertions only guard the properties the design
 * promises (bounded DOM, no original requested while browsing).
 */
const COUNT = 3000
const OUT = path.resolve(import.meta.dirname, '../../docs/benchmarks/gallery.csv')

let stack: Stack
let page: Page
const metrics: [string, string, number | string, string][] = []
const record = (metric: string, detail: string, value: number | string, unit: string) =>
  metrics.push([metric, detail, typeof value === 'number' ? Number(value.toFixed(1)) : value, unit])

test.describe.configure({ mode: 'serial' })

const secret = generateKey()

test.beforeAll(async ({ browser }) => {
  stack = await startStack()
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

  // Real blobs: six originals (larger) and six thumbnails (small), uploaded to the server.
  const sign = async (t: Parameters<typeof signWithKey>[1]) => signWithKey(secret, t)
  const thumbs: { hash: string }[] = []
  const originals: { hash: string; size: number }[] = []
  for (let i = 0; i < 6; i++) {
    for (const [list, bytes] of [
      [thumbs, makePng(100 + i, 120, 60)],
      [originals, makePng(200 + i, 700, 90)],
    ] as const) {
      const hash = createHash('sha256').update(bytes).digest('hex')
      const token = await authorization(sign, {
        verb: 'upload',
        serverUrl: stack.server.url,
        hashes: [hash],
        content: 'seed',
      })
      const res = await fetch(`${stack.server.url}/upload`, {
        method: 'PUT',
        headers: { Authorization: token, 'X-SHA-256': hash },
        body: bytes as BodyInit,
      })
      expect([200, 201]).toContain(res.status)
      ;(list as { hash: string; size?: number }[]).push({ hash, size: bytes.length })
    }
  }

  // 3 000 events with distinct hashes, varied shapes, spread over three years.
  const shapes = [
    [4000, 3000],
    [3000, 4000],
    [4000, 2250],
    [3000, 3000],
    [6000, 2000],
  ]
  const now = Date.now()
  for (let i = 0; i < COUNT; i++) {
    const hash = createHash('sha256').update(`seed-${i}`).digest('hex')
    const [w, h] = shapes[i % shapes.length]!
    const t = thumbs[i % thumbs.length]!
    const o = originals[i % originals.length]!
    const ev = signWithKey(
      secret,
      buildMediaEvent({
        // A distinct query string gives every tile its own URL, so request counts are real.
        url: `${stack.server.url}/${o.hash}.png?i=${i}`,
        sha256: hash,
        mime: 'image/png',
        size: o.size,
        width: w,
        height: h,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        thumb: { url: `${stack.server.url}/${t.hash}.png?t=${i}`, sha256: t.hash },
        now: () => now - i * 30 * 60 * 1000,
      }),
    )
    stack.relay.events.set(ev.id, ev)
  }
})

test.afterAll(async () => {
  await page.context().close()
  await stack.stop()
  writeFileSync(
    OUT,
    'metric,detail,value,unit\n' + metrics.map((m) => m.join(',')).join('\n') + '\n',
  )
})

test('first load of a 3 000 item library', async () => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  page.on('console', (m) => m.type() === 'error' && process.stdout.write(`[console] ${m.text()}
`))
  page.on('pageerror', (e) => process.stdout.write(`[pageerror] ${e.message}
`))

  await page.goto('/')
  await page.getByRole('button', { name: /Use an existing key/ }).click()
  await page.getByLabel('nsec or hex private key').fill(nsecOf(secret))
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Repeat passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Storage server').fill(stack.server.url)
  await page.getByRole('button', { name: /Save and test/ }).click()
  await page.getByText(/Reachable ·/).waitFor()
  for (const remove of await page.getByRole('button', { name: /^Remove ws/ }).all())
    await remove.click()
  await page.getByLabel('Add a relay').fill(stack.relay.url)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page
    .getByText(/Connected · opened in/)
    .first()
    .waitFor()

  const before = requests.length
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Open library' }).click()
  await page.locator('.tile__main').first().waitFor()
  record('first_tile_visible', 'click Open library → first tile in DOM', Date.now() - t0, 'ms')
  await page.locator('.tile__main img[data-loaded]').first().waitFor()
  record(
    'first_thumbnail_decoded',
    'click Open library → first thumbnail loaded',
    Date.now() - t0,
    'ms',
  )
  await expect(page.getByRole('group', { name: `Library, ${COUNT} items` })).toBeVisible({
    timeout: 60_000,
  })
  record(
    'all_events_rendered',
    `${COUNT} events fetched in pages of 500 and laid out`,
    Date.now() - t0,
    'ms',
  )

  await page.waitForTimeout(800)
  const initial = requests.slice(before)
  const thumbReq = initial.filter((u) => u.includes('?t=')).length
  const origReq = initial.filter((u) => u.includes('?i=')).length
  record('thumbnail_requests_initial', 'before any scrolling', thumbReq, 'count')
  record('original_requests_initial', 'before opening any item', origReq, 'count')
  expect(origReq).toBe(0)

  const dom = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.tile').length,
    elements: document.querySelectorAll('*').length,
    gridHeight: (document.querySelector('.grid') as HTMLElement).offsetHeight,
  }))
  record('dom_tiles_rendered', `of ${COUNT} items`, dom.tiles, 'count')
  record('dom_elements_total', 'whole page', dom.elements, 'count')
  record('grid_height', 'full virtual height', dom.gridHeight, 'px')
  expect(dom.tiles).toBeLessThan(400)
  await page.screenshot({ path: `${SHOTS}/library-3000-1440.png` })

  // Scroll the whole library in viewport-sized steps and watch the DOM stay small.
  const before2 = requests.length
  const maxTiles = await page.evaluate(async () => {
    const root = document.querySelector('[data-scroll-root]') as HTMLElement
    let max = 0
    const t0 = performance.now()
    for (let y = 0; y < root.scrollHeight; y += root.clientHeight * 0.8) {
      root.scrollTop = y
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      max = Math.max(max, document.querySelectorAll('.tile').length)
    }
    ;(window as unknown as { __scrollMs: number }).__scrollMs = performance.now() - t0
    return max
  })
  const scrollMs = await page.evaluate(
    () => (window as unknown as { __scrollMs: number }).__scrollMs,
  )
  record('dom_tiles_max_while_scrolling', `of ${COUNT} items`, maxTiles, 'count')
  record('scroll_through_library', 'viewport-sized steps; 2 frames each', scrollMs, 'ms')
  record(
    'thumbnail_requests_scrolling',
    'unique thumbnail URLs requested while scrolling the whole library',
    new Set(requests.slice(before2).filter((u) => u.includes('?t='))).size,
    'count',
  )
  record(
    'original_requests_scrolling',
    'originals requested while scrolling',
    requests.slice(before2).filter((u) => u.includes('?i=')).length,
    'count',
  )
  expect(maxTiles).toBeLessThan(400)
  expect(requests.slice(before2).filter((u) => u.includes('?i=')).length).toBe(0)
})

test('opening an item loads the original on demand', async () => {
  await page.evaluate(
    () => ((document.querySelector('[data-scroll-root]') as HTMLElement).scrollTop = 0),
  )
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.locator('.tile__main').first().click()
  const t0 = Date.now()
  await page.locator('img.viewer__image[data-ready]').waitFor()
  record(
    'first_original_ready',
    'click tile → full-resolution image decoded',
    Date.now() - t0,
    'ms',
  )
  record(
    'originals_requested_on_open',
    'one item opened',
    requests.filter((u) => u.includes('?i=')).length,
    'count',
  )
  await page.keyboard.press('Escape')
})

test('library from the local cache with the relay down', async () => {
  await stack.relay.close()
  const t0 = Date.now()
  await page.reload()
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.locator('.tile__main').first().waitFor()
  record('cache_first_tile', 'reload; unlock; relay down → first tile', Date.now() - t0, 'ms')
  await expect(page.getByRole('group', { name: `Library, ${COUNT} items` })).toBeVisible({
    timeout: 30_000,
  })
  record(
    'cache_all_items',
    `reload; unlock; relay down → all ${COUNT} items laid out`,
    Date.now() - t0,
    'ms',
  )
  await expect(page.getByText('No relay is reachable')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${SHOTS}/library-3000-offline-1440.png` })
})
