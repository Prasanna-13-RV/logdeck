import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { version } from '../../package.json'

test('Update page shows installed version and keeps checks/downloads disabled when unconfigured', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-update-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = directory
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const requests: string[] = []
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
    await page.getByRole('button', { name: /Updates/ }).click()
    const update = page.locator('.tab-panel:not([hidden])')
    await expect(update.getByLabel('Installed version')).toHaveText(version)
    await expect(update.getByLabel('Latest website release')).toHaveText('Not checked')
    await expect(update.getByRole('status')).toContainText('Release checking is not configured')
    await expect(update.getByRole('button', { name: 'Check for updates' })).toBeDisabled()
    await expect(update.getByRole('button', { name: 'Official download page' })).toBeDisabled()
    expect(requests).toEqual([])
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('startup notice shows newer version, opens Updates and surfaces unavailable checks without blocking logs', async () => {
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
      ipcMain.removeHandler('updates:open-download')
      ipcMain.handle('updates:open-download', () => ({ ok: false, error: 'Synthetic download failure' }))
    }, version)
    await page.reload()
    const notice = page.getByRole('status', { name: 'Startup update notice', exact: true })
    await expect(notice).toContainText('LogDeck 99.0.0 is available')
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeEnabled()
    await notice.getByRole('button', { name: 'View update', exact: true }).click()
    await expect(page.locator('.tab-panel:not([hidden])').getByLabel('Latest website release')).toHaveText('99.0.0')
    await notice.getByRole('button', { name: 'Download page', exact: true }).click()
    await expect(notice).toContainText('Synthetic download failure')
    await notice.getByRole('button', { name: 'Dismiss update notice', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await desktop.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('updates:startup')
      ipcMain.handle('updates:startup', () => ({ ok: false, error: 'Synthetic offline check' }))
    })
    await page.reload()
    await expect(notice).toContainText('Could not check for updates: Synthetic offline check')
    await expect(notice.getByRole('button', { name: 'Retry in Updates', exact: true })).toBeVisible()
    await desktop.evaluate(({ ipcMain }, currentVersion) => {
      ipcMain.removeHandler('updates:startup')
      ipcMain.handle('updates:startup', () => ({ ok: true, value: {
        configured: true, currentVersion, latestVersion: currentVersion, updateAvailable: false,
        releaseNotes: 'Current release', publishedAt: '2026-10-25T08:00:00.000Z', checkedAt: new Date().toISOString()
      } }))
    }, version)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible()
    await expect(notice).toHaveCount(0)
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
