import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { makePng } from '../tools/png'
import { startRelay, type DevRelay } from '../tools/dev-relay/relay.mjs'
import { startBlossom, type RunningServer } from '../tools/blossom-server'

export const PASSPHRASE = 'correct horse battery staple'
export const PROFILE_NAME = 'Kushagra Bansal'
export const SHOTS = path.resolve(import.meta.dirname, '../../docs/screenshots')

export interface Stack {
  server: RunningServer
  relay: DevRelay
  tmp: string
  stop(): Promise<void>
}

export async function startStack(): Promise<Stack> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'smh-e2e-'))
  const server = await startBlossom({ dataDir: path.join(tmp, 'data') })
  const relay = await startRelay({ persist: path.join(tmp, 'relay.jsonl') })
  mkdirSync(SHOTS, { recursive: true })
  return {
    server,
    relay,
    tmp,
    async stop() {
      await server.stop()
      await relay.close()
      rmSync(tmp, { recursive: true, force: true })
    },
  }
}

/** Runs in the page: draws a landscape-like JPEG so thumbnails look like photographs, not flat colour. */
export async function makeJpegs(
  page: Page,
  specs: { seed: number; w: number; h: number; name: string }[],
): Promise<void> {
  await page.evaluate(async (list) => {
    const files: File[] = []
    for (const { seed, w, h, name } of list) {
      let s = seed * 9301 + 49297
      const r = () => (s = (s * 9301 + 49297) % 233280) / 233280
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      const hue = Math.floor(r() * 360)
      const sky = g.createLinearGradient(0, 0, 0, h * 0.7)
      sky.addColorStop(0, `hsl(${hue},55%,${30 + r() * 20}%)`)
      sky.addColorStop(1, `hsl(${(hue + 40) % 360},70%,${60 + r() * 20}%)`)
      g.fillStyle = sky
      g.fillRect(0, 0, w, h)
      g.fillStyle = `hsla(${(hue + 60) % 360},90%,85%,0.9)`
      g.beginPath()
      g.arc(w * (0.2 + r() * 0.6), h * (0.2 + r() * 0.25), h * (0.06 + r() * 0.05), 0, 7)
      g.fill()
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `hsl(${(hue + 120 + i * 20) % 360},${30 + i * 8}%,${22 - i * 5}%)`
        g.beginPath()
        g.moveTo(0, h)
        const base = h * (0.6 + i * 0.12)
        for (let x = 0; x <= w; x += w / 24) {
          g.lineTo(x, base + Math.sin((x / w) * (3 + i) + r() * 6) * h * 0.06 + r() * h * 0.02)
        }
        g.lineTo(w, h)
        g.fill()
      }
      // Texture without a per-pixel loop: a few hundred faint specks.
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.05)`
        g.fillRect(r() * w, r() * h, 2 + r() * 10, 2 + r() * 10)
      }
      const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.86))
      files.push(
        new File([blob], name, {
          type: 'image/jpeg',
          lastModified: 1_790_847_000_000 + seed * 86_400_000,
        }),
      )
    }
    ;(window as unknown as { __files: File[] }).__files = files
  }, specs)
}

/** Adds the recorded WebM fixture (see fixtures/make-webm.mjs) to the files prepared in the page. */
export async function makeWebm(page: Page, name: string): Promise<void> {
  const base64 = readFileSync(path.join(import.meta.dirname, 'fixtures/clip.webm')).toString(
    'base64',
  )
  await page.evaluate(
    ([data, fileName]) => {
      const bytes = Uint8Array.from(atob(data!), (c) => c.charCodeAt(0))
      const file = new File([bytes], fileName!, {
        type: 'video/webm',
        lastModified: 1_792_402_200_000,
      })
      const w = window as unknown as { __files?: File[] }
      w.__files = [...(w.__files ?? []), file]
    },
    [base64, name],
  )
}

/** Hands the files prepared in the page to the app's hidden file input. */
export async function chooseFiles(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __files: File[] }
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    const dt = new DataTransfer()
    w.__files.forEach((f) => dt.items.add(f))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    w.__files = []
  })
}

export async function createIdentity(page: Page, stack: Stack): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /Create a new identity/ }).click()
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await page.getByLabel('Repeat passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('heading', { name: 'Back up your key' }).waitFor({ timeout: 30_000 })
  await page.getByLabel(/I have stored a backup/).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await fillProfile(page)
  await configureConnections(page, stack)
  await page.getByRole('button', { name: 'Open library' }).click()
}

/** The "What should we call you?" step: a name and a photo. Submits unless told not to. */
export async function fillProfile(page: Page, opts: { submit?: boolean } = {}): Promise<void> {
  await page.getByRole('heading', { name: 'What should we call you?' }).waitFor()
  await page.getByLabel('Your name').fill(PROFILE_NAME)
  await page.locator('input[aria-label="Choose a profile photo"]').setInputFiles({
    name: 'profile.png',
    mimeType: 'image/png',
    buffer: Buffer.from(makePng(11, 480, 40)),
  })
  await expect(page.locator('.profile-fields__photo .avatar img')).toBeVisible()
  if (opts.submit !== false) await page.getByRole('button', { name: 'Continue' }).click()
}

export async function configureConnections(page: Page, stack: Stack): Promise<void> {
  const server = page.getByLabel('Storage server')
  await server.fill(stack.server.url)
  await page.getByRole('button', { name: /Save and test/ }).click()
  await page.getByText(/Reachable ·/).waitFor()
  // Replace whatever relays are preconfigured with the test relay.
  for (const remove of await page.getByRole('button', { name: /^Remove ws/ }).all())
    await remove.click()
  await page.getByLabel('Add a relay').fill(stack.relay.url)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page
    .getByText(/Connected · opened in/)
    .first()
    .waitFor()
}

/** Loads a path and unlocks the saved identity if the page asks for the passphrase. */
export async function openApp(page: Page, url = '/'): Promise<void> {
  await page.goto(url)
  const landing = page
    .locator('h1:has-text("Unlock your identity"), nav[aria-label="Main"]')
    .first()
  await landing.waitFor()
  if (await page.getByRole('heading', { name: 'Unlock your identity' }).isVisible()) {
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.locator('nav[aria-label="Main"]').waitFor()
  }
}
