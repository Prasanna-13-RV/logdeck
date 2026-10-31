import { test, expect } from '@playwright/test'

test('public pages, persistent themes, direct routes and mobile layout use the desktop visual template', async ({ page }) => {
  await page.route('**/updates/windows.json', route => route.fulfill({ json: {
    latestVersion: '0.1.0', releaseNotes: 'The website release manifest is maintained independently.',
    publishedAt: '2026-10-25T00:00:00.000Z'
  } }))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Less noise/ })).toBeVisible()
  await expect(page.locator('.brand-logo')).toBeVisible()
  await expect.poll(() => page.locator('.brand-logo').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.locator('main').getByRole('img', { name: 'LogDeck', exact: true })).toBeVisible()
  await expect.poll(() => page.locator('.page-brand-logo').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const favicon = page.locator('link[rel="icon"]')
  const faviconUrl = await favicon.getAttribute('href')
  expect((await page.request.get(faviconUrl!)).ok()).toBe(true)
  await page.getByRole('button', { name: /Switch to .* theme/ }).click()
  const theme = await page.locator('html').getAttribute('data-theme')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme!)
  await page.getByRole('navigation').getByRole('link', { name: 'Features', exact: true }).click()
  await expect(page).toHaveURL(/\/features$/)
  await expect(page.getByText('Both kinds of EMV knowledge.')).toBeVisible()
  await page.getByRole('navigation').getByRole('link', { name: 'Download app' }).click()
  await expect(page.getByText('LATEST RELEASE · 0.1.0')).toBeVisible()
  await expect(page.getByText(/website release manifest is maintained/)).toBeVisible()
  await expect(page.locator('.download-page').getByRole('img', { name: 'LogDeck', exact: true })).toBeVisible()
  await expect.poll(() => page.locator('.download-page .page-brand-logo').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.getByRole('button', { name: 'Download not published yet' })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'LogDeck for Windows' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('navigation').getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.locator('main').getByRole('img', { name: 'LogDeck', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Get LogDeck/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/admin')
  await expect(page.getByText('Firebase is not configured.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in as company admin' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('published GitHub release enables portable download and checksum; metadata failures stay explicit', async ({ page }) => {
  const download = 'https://github.com/Prasanna-13-RV/logdeck/releases/download/v1.2.3/LogDeck-1.2.3-windows-x64.exe'
  await page.route('**/updates/windows.json', route => route.fulfill({ json: {
    latestVersion: '1.2.3', releaseNotes: 'Verified portable release.', publishedAt: '2026-10-25T00:00:00.000Z',
    downloadUrl: download, checksumUrl: download.replace(/LogDeck-.+\.exe$/, 'SHA256SUMS.txt'), sha256: 'a'.repeat(64)
  } }))
  await page.goto('/download')
  await expect(page.getByRole('link', { name: 'Download Windows app' })).toHaveAttribute('href', download)
  await expect(page.getByText('LATEST RELEASE · 1.2.3')).toBeVisible()
  await expect(page.getByText('a'.repeat(64), { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.route('**/updates/windows.json', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.reload()
  await expect(page.getByText('Release details unavailable (503).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download not published yet' })).toBeDisabled()
})

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`public routes remain usable without page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/updates/windows.json', route => route.fulfill({ json: {
      latestVersion: '1.2.3', releaseNotes: `Responsive release ${'a'.repeat(160)}`,
      publishedAt: '2026-10-25T00:00:00.000Z'
    } }))
    for (const path of ['/', '/features', '/download', '/admin']) {
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      if (path === '/download') await expect(page.getByText('LATEST RELEASE · 1.2.3')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${path} must not overflow at ${width}px`).toBe(true)
      for (const link of await page.getByRole('navigation').getByRole('link').all()) {
        const box = await link.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        await expect(link).toBeInViewport()
      }
      if (path === '/' || path === '/download') {
        const logo = page.locator('main').getByRole('img', { name: 'LogDeck', exact: true })
        await expect(logo).toBeVisible()
        const box = await logo.boundingBox()
        expect(box!.width).toBeGreaterThanOrEqual(112)
        expect(box!.width).toBeLessThanOrEqual(160)
        expect(Math.abs(box!.width - box!.height)).toBeLessThan(1)
      }
    }
  })
}
