import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { version } from '../../package.json'

test('GitHub checks use the main-process version and leave unconfigured website downloads disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-update-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = directory
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    await expect(page.locator('.brand-logo')).toBeVisible()
    await expect.poll(() => page.locator('.brand-logo').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    const homeLogo = page.locator('.home .page-brand-logo')
    await expect(homeLogo).toBeVisible()
    await expect.poll(() => homeLogo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await desktop.evaluate(() => {
      globalThis.fetch = async (url, init) => {
        if (String(url) !== 'https://raw.githubusercontent.com/Prasanna-13-RV/logdeck/main/version.json' ||
            init?.redirect !== 'error') throw new Error('Unexpected version request')
        return Response.json({ version: '1.10.0', releaseNotes: 'GitHub main-process integration' })
      }
    })
    await page.getByRole('button', { name: /Updates/ }).click()
    const update = page.locator('.tab-panel:not([hidden])')
    await expect(update.getByRole('img', { name: 'LogDeck', exact: true })).toBeVisible()
    await expect.poll(() => update.locator('.page-brand-logo').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect(update.getByLabel('Installed version')).toHaveText(version)
    await expect(update.getByRole('button', { name: 'Check for updates' })).toBeEnabled()
    await expect(update.getByRole('button', { name: 'Official download page' })).toBeDisabled()
    await update.getByRole('button', { name: 'Check for updates' }).click()
    await expect(update.getByLabel('Latest GitHub version')).toHaveText('1.10.0')
    await expect(update.getByRole('region', { name: 'Release notes' })).toContainText('GitHub main-process integration')
    const checked = await page.evaluate(() => window.logdeck.checkForUpdates())
    expect(checked.ok && checked.value.currentVersion).toBe(version)
    expect(await page.evaluate(() => ({
      nodeRequire: 'require' in window, nodeProcess: 'process' in window,
      unrestrictedIpc: 'ipcRenderer' in window.logdeck
    }))).toEqual({ nodeRequire: false, nodeProcess: false, unrestrictedIpc: false })
    await desktop.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('updates:check')
      ipcMain.handle('updates:check', () => ({ ok: false, error: 'GitHub version.json was not found (404). Confirm the public repository, configured branch, and published file path.' }))
    })
    await update.getByRole('button', { name: 'Check for updates' }).click()
    await expect(update.getByRole('alert')).toContainText('GitHub version.json was not found (404)')
    await expect(update.getByLabel('Latest GitHub version')).toHaveText('Not checked')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('startup notification is dismissible and appears only for a successful newer-version result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-startup-update-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = directory
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible()
    await desktop.evaluate(({ ipcMain }, currentVersion) => {
      ipcMain.removeHandler('updates:startup')
      ipcMain.handle('updates:startup', () => ({ ok: true, value: {
        configured: true, currentVersion, latestVersion: '99.0.0', updateAvailable: true,
        releaseNotes: 'Synthetic release notes', publishedAt: '2026-10-25T08:00:00.000Z', checkedAt: new Date().toISOString()
      } }))
      ipcMain.removeHandler('updates:info')
      ipcMain.handle('updates:info', () => ({ ok: true, value: { configured: true, currentVersion } }))
    }, version)
    await page.reload()
    const notice = page.getByRole('status', { name: 'Startup update notice', exact: true })
    await expect(notice).toContainText('LogDeck 99.0.0 is available')
    await expect(notice).toContainText(`Installed: ${version}`)
    await expect(notice).toContainText('Latest: 99.0.0')
    await expect(notice).toContainText('Synthetic release notes')
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeEnabled()
    await expect(notice.getByRole('button')).toHaveCount(1)
    await page.getByRole('button', { name: 'Updates', exact: true }).click()
    await expect(page.locator('.tab-panel:not([hidden])').getByLabel('Latest GitHub version')).toHaveText('99.0.0')
    await notice.getByRole('button', { name: 'Dismiss update notice', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await desktop.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('updates:startup')
      ipcMain.handle('updates:startup', () => ({ ok: false, error: 'Synthetic offline check' }))
    })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Updates', exact: true }).click()
    await expect(page.locator('.tab-panel:not([hidden])').getByRole('alert')).toContainText('Synthetic offline check')
    await expect(notice).toHaveCount(0)
    await desktop.evaluate(({ ipcMain }, currentVersion) => {
      ipcMain.removeHandler('updates:startup')
      ipcMain.handle('updates:startup', () => ({ ok: true, value: {
        configured: true, currentVersion, latestVersion: '0.0.0', updateAvailable: false,
        releaseNotes: '', checkedAt: new Date().toISOString()
      } }))
    }, version)
    await page.reload()
    await page.getByRole('button', { name: 'Updates', exact: true }).click()
    await expect(page.locator('.tab-panel:not([hidden])').getByLabel('Latest GitHub version')).toHaveText('0.0.0')
    await expect(notice).toHaveCount(0)
    await desktop.evaluate(({ ipcMain }, currentVersion) => {
      ipcMain.removeHandler('updates:startup')
      ipcMain.handle('updates:startup', () => ({ ok: true, value: {
        configured: true, currentVersion, latestVersion: currentVersion, updateAvailable: false,
        releaseNotes: 'Current release', publishedAt: '2026-10-25T08:00:00.000Z', checkedAt: new Date().toISOString()
      } }))
    }, version)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Updates', exact: true }).click()
    await expect(page.locator('.tab-panel:not([hidden])').getByLabel('Latest GitHub version')).toHaveText(version)
    await expect(notice).toHaveCount(0)
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
