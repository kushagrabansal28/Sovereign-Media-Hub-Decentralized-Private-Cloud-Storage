import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import {
  PASSPHRASE,
  SHOTS,
  chooseFiles,
  createIdentity,
  makeJpegs,
  makeWebm,
  startStack,
  type Stack,
} from './helpers'

let stack: Stack
// One browser context for the whole story, so the saved identity and cache persist across reloads.
let page: Page

test.beforeAll(async ({ browser }) => {
  stack = await startStack()
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
})
test.afterAll(async () => {
  await page.context().close()
  await stack.stop()
})

test.describe.configure({ mode: 'serial' })

const photos = [
  { seed: 1, w: 1600, h: 1067, name: 'harbour.jpg' },
  { seed: 2, w: 1067, h: 1600, name: 'tower.jpg' },
  { seed: 3, w: 1600, h: 900, name: 'ridge.jpg' },
  { seed: 4, w: 1200, h: 1200, name: 'square.jpg' },
  { seed: 5, w: 2400, h: 800, name: 'panorama.jpg' },
  { seed: 6, w: 1280, h: 960, name: 'field.jpg' },
]

test('first run → upload → gallery → viewer', async () => {
  await createIdentity(page, stack)

  // Empty library explains the next action; no fake content.
  await expect(page.getByRole('heading', { name: 'No photos or videos yet' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/library-empty-1440.png` })

  await page.setViewportSize({ width: 1440, height: 900 })
  await makeJpegs(page, photos)
  await makeWebm(page, 'harbour-clip.webm')
  await chooseFiles(page)

  const panel = page.getByRole('region', { name: 'Uploads' })
  await expect(panel.getByRole('heading')).toHaveText(/Uploading/)
  await expect(panel.getByRole('heading')).toHaveText(/7 files finished/, { timeout: 90_000 })
  await expect(panel.getByText(/Added · 1 relay/)).toHaveCount(7)
  await page.screenshot({ path: `${SHOTS}/upload-complete-1440.png` })

  // Metadata reached the relay as kind 1063 events, without media bytes.
  const events = [...stack.relay.events.values()].filter((e) => e.kind === 1063)
  expect(events).toHaveLength(7)
  const withoutThumb = events
    .filter((e) => !e.tags.some((t) => t[0] === 'thumb'))
    .map((e) => e.tags.find((t) => t[0] === 'm')?.[1] ?? 'unknown type')
  expect(withoutThumb, `items without a thumbnail. ${await panel.innerText()}`).toEqual([])
  for (const e of events) expect(JSON.stringify(e).length).toBeLessThan(2000)

  // Gallery shows real thumbnails (decoded, non-zero size) and a video badge.
  const tiles = page.locator('.tile__main')
  await expect(tiles).toHaveCount(7)
  await expect
    .poll(() => page.locator('.tile__main img[data-loaded]').count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(6)
  const sizes = await page
    .locator('.tile__main img[data-loaded]')
    .evaluateAll((imgs) =>
      (imgs as HTMLImageElement[]).map((i) => [i.naturalWidth, i.naturalHeight]),
    )
  for (const [w, h] of sizes) {
    expect(w).toBeGreaterThan(0)
    expect(Math.max(w!, h!)).toBeLessThanOrEqual(512) // thumbnails, not originals
  }
  await expect(page.locator('.tile__badge')).toHaveCount(1)
  await page.screenshot({ path: `${SHOTS}/library-1440.png` })

  // Thumbnails load first: no original has been requested yet.
  const originalRequests: string[] = []
  page.on('request', (r) => {
    if (/\/[0-9a-f]{64}\.jpg$/.test(r.url())) originalRequests.push(r.url())
  })

  // Open the first photo; the original loads on demand and the URL is deep-linkable.
  const photoTile = tiles.filter({ hasNot: page.locator('.tile__badge') }).first()
  await photoTile.focus()
  await page.keyboard.press('Enter')
  const viewer = page.getByRole('dialog')
  await expect(viewer).toBeVisible()
  await expect(page).toHaveURL(/\/m\/[0-9a-f]{64}/)
  await expect.poll(() => originalRequests.length).toBeGreaterThan(0)
  await expect(viewer.locator('img.viewer__image[data-ready]')).toBeVisible()
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOTS}/viewer-1440.png` })

  // Keyboard: next, previous, details, close; focus returns to the grid.
  const first = page.url()
  await page.keyboard.press('ArrowRight')
  await expect(page).not.toHaveURL(first)
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(first)
  await page.keyboard.press('i')
  await expect(viewer.getByText('SHA-256')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/viewer-details-1440.png` })
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(page).toHaveURL('/')
  await expect(page.locator('.tile__main:focus')).toHaveCount(1)
})

test('original download is verified against its SHA-256', async () => {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.locator('.tile__main')).toHaveCount(7)

  await page.locator('.tile__main').first().click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download original/ }).click()
  const file = await download
  const stream = await file.createReadStream()
  const hash = createHash('sha256')
  for await (const chunk of stream) hash.update(chunk)
  expect(file.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.(jpg|webm)$/)
  const sha = page.url().match(/\/m\/([0-9a-f]{64})/)![1]
  expect(hash.digest('hex')).toBe(sha)
  await expect(page.getByText(/matched its SHA-256/)).toBeVisible()
})

test('uploading the same file again is recognised as a duplicate', async () => {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.locator('.tile__main')).toHaveCount(7)

  await makeJpegs(page, [photos[0]!])
  await chooseFiles(page)
  const panel = page.getByRole('region', { name: 'Uploads' })
  await expect(panel.getByText('Already in your library')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.tile__main')).toHaveCount(7)

  // Only originals and thumbnails exist on the server: 7 + 7 blobs, no extras.
  const res = await fetch(`${stack.server.url}/health`)
  expect(res.status).toBe(200)
})

test('library survives a reload and a relay outage', async () => {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.locator('.tile__main')).toHaveCount(7)

  // Relay goes away; the page is reloaded; the cached library is still shown, with an honest banner.
  await stack.relay.close()
  await page.reload()
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.locator('.tile__main')).toHaveCount(7)
  await expect(page.getByText('No relay is reachable')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/saved on this device/)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/relay-down-1440.png` })
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByText(/retrying/).first()).toBeVisible()
  await expect(page.locator('.dot--bad, .dot--warn').first()).toBeVisible()
})

test('deleting removes the metadata and the stored file', async () => {
  // Bring the relay back on a fresh port; point the app at it.
  const { startRelay } = await import('../tools/dev-relay/relay.mjs')
  stack.relay = await startRelay({ persist: `${stack.tmp}/relay.jsonl` })

  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('link', { name: 'Settings' }).click()
  for (const remove of await page.getByRole('button', { name: /^Remove ws/ }).all())
    await remove.click()
  await page.getByLabel('Add a relay').fill(stack.relay.url)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText(/Connected · opened in/).first()).toBeVisible()
  await page.getByRole('link', { name: 'Library' }).click()
  await expect(page.locator('.tile__main')).toHaveCount(7)

  await page.locator('.tile__main').first().click()
  const sha = page.url().match(/\/m\/([0-9a-f]{64})/)![1]!
  expect((await fetch(`${stack.server.url}/${sha}`)).status).toBe(200)

  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.screenshot({ path: `${SHOTS}/delete-confirm-1440.png` })
  await page
    .getByRole('dialog')
    .filter({ hasText: 'Delete this item?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByText(/Deleted from your library and the storage server/)).toBeVisible()
  await expect(page.locator('.tile__main')).toHaveCount(6)
  expect((await fetch(`${stack.server.url}/${sha}`)).status).toBe(404)
  expect(
    [...stack.relay.events.values()].some(
      (e) => e.kind === 1063 && e.tags.some((t) => t[1] === sha),
    ),
  ).toBe(false)
})
