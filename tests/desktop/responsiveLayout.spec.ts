import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function expectFits(page: Page, selector: string) {
  for (const element of await page.locator(selector).all()) {
    expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth + 1),
      `${selector} must not clip its contents horizontally`).toBe(true)
  }
}

test('desktop navigation, home, tools and split log controls fit compact and large windows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-responsive-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    for (const [width, height] of [[1440, 900], [1024, 768], [940, 640]]) {
      await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
      await expectFits(page, '.navbar, .navbar nav, .navbar-actions, .home .hero, .feature-grid')
      for (const button of await page.locator('.navbar button').all()) {
        const box = await button.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        await expect(button).toBeInViewport()
      }
      await expect(page.locator('.home .page-brand-logo')).toBeVisible()
    }
    await page.getByRole('button', { name: 'Updates', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Updates, on your terms.' })).toBeVisible()
    await expectFits(page, '.update-hero, .update-card, .update-version-grid')
    await page.getByRole('button', { name: 'Appearance and settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectFits(page, '.modal, .modal-content')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Hex / ASCII', exact: true }).click()
    await expectFits(page, '.tool-page, .tool-columns')
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    await expect(page.locator('.compare-editors')).toBeVisible()
    await expectFits(page, '.compare-workspace, .compare-toolbar, .compare-editors')

    const file = join(directory, 'responsive.logcat')
    await writeFile(file, '10-25 12:00:00.123  123  456 I LogDeck: Synthetic responsive layout\n')
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), file)
    if (!opened.ok) throw new Error(opened.error)
    const panel = page.locator('.tab-panel:not([hidden])')
    await expect(panel.getByRole('button', { name: 'Split view', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: 'Split view', exact: true }).click()
    await panel.getByRole('button', { name: 'Split side by side', exact: true }).click()
    await expect(panel.locator('.split-pane')).toHaveCount(2)
    await expectFits(page, '.tab-panel:not([hidden]) .viewer-toolbar, .split-heading')
    const positions = await panel.locator('.split-pane').evaluateAll(nodes => nodes.map(node => ({
      x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y
    })))
    expect(positions[1].x).toBeGreaterThan(positions[0].x)
    expect(positions[1].y).toBe(positions[0].y)
    await panel.locator('tbody tr').first().click()
    await page.keyboard.press('Control+f')
    await expect(panel.getByRole('search')).toBeVisible()
    await expectFits(page, '.find-popup')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 })
  }
})
