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
  await expect(page.getByRole('button', { name: 'Download not published yet' })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'LogDeck for Windows' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('navigation').getByRole('link', { name: 'Home', exact: true }).click()
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
