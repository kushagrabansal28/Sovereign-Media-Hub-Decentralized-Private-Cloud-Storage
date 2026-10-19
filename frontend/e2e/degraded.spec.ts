import { expect, test, type Page } from '@playwright/test'
import {
  PASSPHRASE,
  SHOTS,
  chooseFiles,
  createIdentity,
  makeJpegs,
  openApp,
  startStack,
  type Stack,
} from './helpers'

/** What the user sees when the storage server stops answering. */
let stack: Stack
let page: Page

test.beforeAll(async ({ browser }) => {
  stack = await startStack()
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
})
test.afterAll(async () => {
  await page.context().close()
  await stack.stop()
})

test('storage server down: honest banner, unavailable previews, failed upload with retry', async () => {
  test.setTimeout(80_000)
  await createIdentity(page, stack)
  await makeJpegs(page, [
    { seed: 1, w: 800, h: 533, name: 'a.jpg' },
    { seed: 2, w: 533, h: 800, name: 'b.jpg' },
    { seed: 3, w: 800, h: 450, name: 'c.jpg' },
  ])
  await chooseFiles(page)
  await expect(page.getByRole('region', { name: 'Uploads' }).getByRole('heading')).toHaveText(
    /3 files finished/,
    {
      timeout: 60_000,
    },
  )
  await expect(page.locator('.tile__main')).toHaveCount(3)

  await stack.server.stop()
  await page.reload()
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByText('The storage server is not reachable')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('.nav__status')).toContainText('Unreachable')
  await page.screenshot({ path: `${SHOTS}/server-down-laptop.png` })

  // Opening an item says what is wrong instead of showing an empty frame.
  await page.locator('.tile__main').first().click()
  await expect(page.getByText('This file could not be loaded')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.viewer__error')).toContainText(
    /could not be reached|cannot display|did not finish/,
  )
  await page.screenshot({ path: `${SHOTS}/viewer-missing-laptop.png` })
  await page.keyboard.press('Escape')

  // Uploads fail with a reason and a retry, not a silent spinner.
  await makeJpegs(page, [{ seed: 99, w: 600, h: 400, name: 'late.jpg' }])
  await chooseFiles(page)
  const panel = page.getByRole('region', { name: 'Uploads' })
  await expect(panel.getByText(/Could not reach the storage server/)).toBeVisible({
    timeout: 30_000,
  })
  await expect(panel.getByRole('button', { name: /Retry late.jpg/ })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/upload-failed-laptop.png` })
  void openApp
})
