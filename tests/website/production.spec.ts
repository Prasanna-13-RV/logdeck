import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  const configuration = await readFile('netlify.toml', 'utf8')
  const policy = /Content-Security-Policy = "([^"]+)"/.exec(configuration)?.[1]
  if (!policy) throw new Error('Netlify Content-Security-Policy is missing.')
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') { await route.continue(); return }
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy, 'x-content-type-options': 'nosniff' } })
  })
})

test('production assets and direct routes work under the Netlify content policy', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', event => { console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`) })
  })
  await page.route('**/updates/windows.json', route => route.fulfill({ json: {
    latestVersion: '1.0.0', releaseNotes: 'Synthetic published release for deployment verification.',
    publishedAt: '2026-11-01T00:00:00Z'
  } }))
  for (const path of ['/', '/features', '/download', '/admin']) {
    await page.goto(path)
    await expect(page.locator('main h1')).toBeVisible()
    await page.reload()
    await expect(page.locator('main h1')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Company admin' })).toHaveCount(0)
    for (const image of await page.locator('img').all()) {
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    }
    expect(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  }
  await page.goto('/')
  await page.getByRole('button', { name: /Switch to .* theme/ }).click()
  const theme = await page.locator('html').getAttribute('data-theme')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme!)
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  const icon = await page.locator('link[rel="icon"]').getAttribute('href')
  const response = await page.request.get(icon!)
  expect(response.headers()['content-type']).toContain('image/png')
  expect((await response.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(errors).toEqual([])
})

test('production download shows only verified release links and reports unavailability', async ({ page }) => {
  const base = 'https://github.com/Prasanna-13-RV/logdeck/releases/download/v1.0.0'
  await page.route('**/updates/windows.json', route => route.fulfill({ json: {
    latestVersion: '1.0.0', releaseNotes: 'Synthetic 1.0.0 fixture, not a published artifact.',
    publishedAt: '2026-11-01T00:00:00Z', downloadUrl: `${base}/LogDeck-1.0.0-windows-x64.exe`,
    checksumUrl: `${base}/SHA256SUMS.txt`, sha256: 'a'.repeat(64)
  } }))
  await page.goto('/download')
  await expect(page.getByText('LATEST RELEASE · 1.0.0')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download Windows app' })).toHaveAttribute('href', `${base}/LogDeck-1.0.0-windows-x64.exe`)
  await page.route('**/updates/windows.json', route => route.fulfill({ status: 503, json: { error: 'No release published' } }))
  await page.reload()
  await expect(page.getByText('Release details unavailable (503).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download not published yet' })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'Download Windows app' })).toHaveCount(0)
})
