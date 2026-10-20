import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  PASSPHRASE,
  PROFILE_NAME,
  SHOTS,
  fillProfile,
  chooseFiles,
  createIdentity,
  openApp,
  makeJpegs,
  makeWebm,
  startStack,
  type Stack,
} from './helpers'

/**
 * Visual and accessibility review of the running application at the four
 * viewport sizes used for the final review, plus intermediate widths where the
 * layout changes. Screenshots land in docs/screenshots and are the evidence
 * used in the report.
 */

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const

const photos = Array.from({ length: 30 }, (_, i) => {
  const shapes = [
    [1600, 1067],
    [1067, 1600],
    [1600, 900],
    [1200, 1200],
    [2000, 800],
    [1280, 960],
  ] as const
  const [w, h] = shapes[i % shapes.length]!
  return {
    seed: i + 1,
    w: Math.round(w / 2),
    h: Math.round(h / 2),
    name: `photo-${String(i + 1).padStart(2, '0')}.jpg`,
  }
})

let stack: Stack
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  stack = await startStack()
  page = await (await browser.newContext({ viewport: VIEWPORTS.laptop })).newPage()
})
test.afterAll(async () => {
  await page.context().close()
  await stack.stop()
})

async function noHorizontalOverflow(p: Page, label: string) {
  const { scroll, inner } = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(scroll, `${label}: page is wider than the viewport`).toBeLessThanOrEqual(inner)
}

async function axe(p: Page, label: string) {
  const results = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.html.slice(0, 120)}`,
  )
  expect(summary, `${label}: accessibility violations`).toEqual([])
}

test('first-run screens at four sizes', async ({ browser }) => {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: size })
    const p = await ctx.newPage()
    await p.goto('/')
    await p.getByRole('heading', { name: 'Your library. Your server.' }).waitFor()
    await noHorizontalOverflow(p, `welcome ${name}`)
    await p.waitForTimeout(1300) // entrance animations and the logo draw-in
    await p.screenshot({ path: `${SHOTS}/welcome-${name}.png` })
    if (name === 'laptop') await axe(p, 'welcome')
    await ctx.close()
  }
})

test('the address demo shows the real SHA-256 of what is typed', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.laptop })
  const p = await ctx.newPage()
  await p.goto('/')
  await p.getByLabel('Text to fingerprint').fill('abc')
  // FIPS 180-2 test vector.
  await expect(p.getByTestId('hashdemo-hash')).toHaveText(
    'ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 96177a9c b410ff61 f20015ad',
  )
  await p.getByLabel('Text to fingerprint').fill('abd')
  await expect(p.getByTestId('hashdemo-hash')).not.toHaveText(/^ba7816bf/)
  await ctx.close()
})

test('a new key walks through every setup step even if setup was finished before', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.laptop })
  // A browser that finished setup earlier and then removed its identity.
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('smh.settings.v1'))
      localStorage.setItem(
        'smh.settings.v1',
        JSON.stringify({
          serverUrl: 'http://localhost:8787',
          relays: ['ws://localhost:7777'],
          theme: 'system',
          confirmed: true,
        }),
      )
  })
  const p = await ctx.newPage()
  await p.goto('/')
  await p.getByRole('button', { name: /Create a new identity/ }).click()
  await p.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await p.getByLabel('Repeat passphrase').fill(PASSPHRASE)
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('heading', { name: 'Back up your key' }).waitFor({ timeout: 30_000 })
  await p.getByLabel(/I have stored a backup/).check()
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('heading', { name: 'What should we call you?' }).waitFor()
  await ctx.close()
})

test('identity setup steps', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.laptop })
  const p = await ctx.newPage()
  await p.goto('/')
  await p.getByRole('button', { name: /Create a new identity/ }).click()
  await p.getByRole('heading', { name: 'Protect the key on this device' }).waitFor()
  await p.screenshot({ path: `${SHOTS}/setup-protect-laptop.png` })
  await axe(p, 'setup protect')

  // Validation feedback is specific.
  await p.getByLabel('Passphrase', { exact: true }).fill('short')
  await p.getByLabel('Repeat passphrase').fill('short')
  await p.getByRole('button', { name: 'Continue' }).click()
  await expect(p.getByText('Use at least 8 characters.')).toBeVisible()
  await p.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await p.getByLabel('Repeat passphrase').fill(PASSPHRASE + 'x')
  await p.getByRole('button', { name: 'Continue' }).click()
  await expect(p.getByText('The two passphrases are different.')).toBeVisible()
  await p.getByLabel('Repeat passphrase').fill(PASSPHRASE)
  await p.getByRole('button', { name: 'Continue' }).click()

  await p.getByRole('heading', { name: 'Back up your key' }).waitFor({ timeout: 30_000 })
  // The secret key is hidden until asked for, and is never in the page text before that.
  await expect(p.locator('body')).not.toContainText('nsec1')
  await p.getByRole('button', { name: /Show secret key/ }).click()
  await expect(p.getByLabel('Secret key')).toContainText('nsec1')
  await p.screenshot({ path: `${SHOTS}/setup-backup-laptop.png` })

  // Skipping the backup needs an explicit confirmation.
  await p.getByRole('button', { name: 'Skip backup' }).click()
  await expect(p.getByRole('dialog')).toContainText('Continue without a backup?')
  await p.screenshot({ path: `${SHOTS}/setup-skip-backup-laptop.png` })
  await p.keyboard.press('Escape')
  await expect(p.getByRole('dialog')).toBeHidden()

  // Then the name and photo: required name, optional photo, kept on this device.
  await p.getByLabel(/I have stored a backup/).check()
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('heading', { name: 'What should we call you?' }).waitFor()
  await expect(p.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await p.screenshot({ path: `${SHOTS}/setup-profile-laptop.png` })
  await axe(p, 'setup profile')
  await fillProfile(p, { submit: false })
  await expect(p.getByText(`Signed in as ${PROFILE_NAME}`)).toBeVisible()
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${SHOTS}/setup-profile-filled-laptop.png` })
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('heading', { name: 'Connect your storage and relays' }).waitFor()
  const profiles = await p.evaluate(() => localStorage.getItem('smh.profiles.v1') ?? '')
  expect(profiles).toContain(PROFILE_NAME)
  await ctx.close()

  // The secret key must not be reachable from storage or the URL.
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  await p2.goto('/')
  await p2.getByRole('button', { name: /Create a new identity/ }).click()
  await p2.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await p2.getByLabel('Repeat passphrase').fill(PASSPHRASE)
  await p2.getByRole('button', { name: 'Continue' }).click()
  await p2.getByRole('heading', { name: 'Back up your key' }).waitFor({ timeout: 30_000 })
  const stored = await p2.evaluate(() => ({
    identity: localStorage.getItem('smh.identity.v1'),
    everything: JSON.stringify({ ...localStorage, ...sessionStorage, url: location.href }),
    sessionItems: sessionStorage.length,
  }))
  const parsed = JSON.parse(stored.identity!) as Record<string, string>
  // Only the public key and the encrypted (NIP-49) form are stored: no field can hold a plaintext secret.
  expect(Object.keys(parsed).sort()).toEqual(['ncryptsec', 'pubkey', 'source', 'v'])
  expect(parsed.ncryptsec).toMatch(/^ncryptsec1/)
  expect(stored.everything).not.toMatch(/nsec1[0-9a-z]{50,}/)
  expect(stored.sessionItems).toBe(0)
  await ctx2.close()
})

test('library with 31 items at four sizes, light and dark', async () => {
  await createIdentity(page, stack)
  await makeJpegs(page, photos)
  await makeWebm(page, 'clip.webm')
  await chooseFiles(page)
  const panel = page.getByRole('region', { name: 'Uploads' })
  await expect(panel.getByRole('heading')).toHaveText(/31 files finished/, { timeout: 120_000 })
  await expect(page.locator('.tile__main')).toHaveCount(31)
  await expect
    .poll(() => page.locator('.tile__main img[data-loaded]').count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(25)
  await panel.getByRole('button', { name: 'Clear' }).click()

  for (const [name, size] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(size)
    await page.waitForTimeout(250)
    await noHorizontalOverflow(page, `library ${name}`)
    await page.screenshot({ path: `${SHOTS}/library-${name}.png` })
  }
  await page.setViewportSize(VIEWPORTS.laptop)
  await axe(page, 'library')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/library-dark-laptop.png` })
  await axe(page, 'library dark')
  await page.emulateMedia({ colorScheme: 'light' })
})

test('ledger view at tablet and phone width', async () => {
  for (const [name, size] of [
    ['tablet', VIEWPORTS.tablet],
    ['mobile', VIEWPORTS.mobile],
  ] as const) {
    await page.setViewportSize(size)
    await page.getByRole('button', { name: 'Ledger view' }).click()
    await expect(page.locator('table.ledger')).toBeVisible()
    await page.waitForTimeout(700)
    await noHorizontalOverflow(page, `ledger ${name}`)
    await axe(page, `ledger ${name}`)
    await page.screenshot({ path: `${SHOTS}/ledger-${name}.png` })
    await page.getByRole('button', { name: 'Grid view' }).click()
  }
  await page.setViewportSize(VIEWPORTS.laptop)
})

test('selection, search and empty results', async () => {
  await page.setViewportSize(VIEWPORTS.laptop)
  await page.getByRole('button', { name: 'Select items' }).click()
  const tiles = page.locator('.tile__main')
  await tiles.nth(0).click()
  await tiles.nth(2).click()
  await tiles.nth(3).click({ modifiers: ['Shift'] })
  await expect(page.getByText(/\d+ selected/)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/selection-laptop.png` })
  await page.getByRole('button', { name: 'Cancel selection' }).click()

  await page.getByLabel('Search library').fill('zzz-nothing')
  await expect(page.getByRole('heading', { name: /No matches for/ })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/search-empty-laptop.png` })
  await page.getByRole('button', { name: 'Clear search and filters' }).click()
  await page.getByRole('button', { name: /Videos/ }).click()
  await expect(page.locator('.tile__main')).toHaveCount(1)
  await page.getByRole('button', { name: /^All$/ }).click()
  await expect(page.locator('.tile__main')).toHaveCount(31)
})

test('viewer at four sizes', async () => {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(size)
    await openApp(page, '/')
    const first = page
      .locator('.tile__main')
      .filter({ hasNot: page.locator('.tile__badge') })
      .first()
    await first.click()
    const viewer = page.getByRole('dialog')
    await expect(viewer.locator('img.viewer__image[data-ready]')).toBeVisible()
    await page.waitForTimeout(350) // let the fade-in finish before capturing
    await noHorizontalOverflow(page, `viewer ${name}`)
    await page.screenshot({ path: `${SHOTS}/viewer-${name}.png` })
    if (name === 'mobile') {
      await page.getByRole('button', { name: /Details/ }).click()
      await page.screenshot({ path: `${SHOTS}/viewer-details-mobile.png` })
    }
    if (name === 'laptop') await axe(page, 'viewer')
    await page.keyboard.press('Escape')
  }
})

test('video viewer', async () => {
  await page.setViewportSize(VIEWPORTS.laptop)
  await openApp(page, '/')
  await page.getByRole('button', { name: /Videos/ }).click()
  await page.locator('.tile__main').first().click()
  const video = page.locator('.viewer video')
  await expect(video).toBeVisible()
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1)
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640)
  await page.screenshot({ path: `${SHOTS}/viewer-video-laptop.png` })
  await page.keyboard.press('Escape')
})

test('settings at four sizes', async () => {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(size)
    await openApp(page, '/settings')
    await page.getByRole('heading', { name: 'Settings' }).waitFor()
    await noHorizontalOverflow(page, `settings ${name}`)
    await page.screenshot({ path: `${SHOTS}/settings-${name}.png`, fullPage: name === 'laptop' })
  }
  await page.setViewportSize(VIEWPORTS.laptop)
  await page.getByRole('button', { name: 'Measure storage' }).click()
  await expect(page.getByText('Files on server')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/settings-measured-laptop.png`, fullPage: true })
  await axe(page, 'settings')
})

test('layout holds at intermediate widths', async () => {
  await openApp(page, '/')
  // The grid renders only the rows near the viewport, so not all 31 tiles are in the page.
  await expect.poll(() => page.locator('.tile__main').count()).toBeGreaterThanOrEqual(20)
  for (const w of [1280, 1100, 1099, 960, 768, 720, 719, 600, 480, 360]) {
    await page.setViewportSize({ width: w, height: 800 })
    await page.waitForTimeout(150)
    await noHorizontalOverflow(page, `library ${w}px`)
    // Toolbar controls stay inside the viewport and never overlap the grid.
    const toolbar = await page.locator('.toolbar').boundingBox()
    expect(toolbar!.x).toBeGreaterThanOrEqual(0)
    expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(w + 1)
    // Every tile must lie inside the grid horizontally.
    const bad = await page.locator('.tile').evaluateAll(
      (els, width) =>
        els.filter((e) => {
          const r = e.getBoundingClientRect()
          return r.right > (width as number) + 1 || r.left < -1
        }).length,
      w,
    )
    expect(bad, `tiles outside viewport at ${w}px`).toBe(0)
  }
})

test('keyboard: grid is one tab stop with arrow navigation; focus is visible', async () => {
  await page.setViewportSize(VIEWPORTS.laptop)
  await openApp(page, '/')
  await expect(page.locator('.tile__main')).toHaveCount(31)
  // Tab from the page start reaches the skip link, nav and toolbar, then one grid tile, then leaves the grid.
  const onTile = () => page.evaluate(() => document.activeElement?.classList.contains('tile__main'))
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  let reached = false
  for (let i = 0; i < 20 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = !!(await onTile())
  }
  expect(reached, 'a tile is reachable with Tab').toBe(true)
  await page.keyboard.press('Tab')
  expect(await onTile(), 'the next Tab stop is not another tile').toBe(false)
  await page.keyboard.press('Shift+Tab')
  expect(await onTile()).toBe(true)
  // Arrow keys move between tiles.
  const before = await page.evaluate(() => document.activeElement?.getAttribute('data-index'))
  await page.keyboard.press('ArrowRight')
  const after = await page.evaluate(() => document.activeElement?.getAttribute('data-index'))
  expect(Number(after)).toBe(Number(before) + 1)
  await page.keyboard.press('ArrowDown')
  expect(
    Number(await page.evaluate(() => document.activeElement?.getAttribute('data-index'))),
  ).toBeGreaterThan(Number(after))
  // Focus ring is drawn.
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
  expect(outline).toBe('solid')
  await page.screenshot({ path: `${SHOTS}/focus-grid-laptop.png` })
})

test('reduced motion removes transitions', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page, '/')
  const dur = await page.evaluate(() => {
    const el = document.querySelector('.tile__main img') as HTMLElement
    return getComputedStyle(el).transitionDuration
  })
  expect(parseFloat(dur)).toBeLessThan(0.01)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
})

test('unlock screen', async ({ browser }) => {
  await page.close()
  const ctx = page.context()
  page = await ctx.newPage()
  await page.setViewportSize(VIEWPORTS.mobile)
  await page.goto('/')
  await page.getByRole('heading', { name: 'Unlock your identity' }).waitFor()
  await expect(page.getByText('Welcome back')).toBeVisible()
  await expect(page.getByText(PROFILE_NAME, { exact: true })).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/unlock-mobile.png` })
  await page.getByLabel('Passphrase').fill('wrong passphrase')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('Wrong passphrase, or the backup is damaged.')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/unlock-error-mobile.png` })
  await axe(page, 'unlock')
  expect(browser).toBeTruthy()
})
