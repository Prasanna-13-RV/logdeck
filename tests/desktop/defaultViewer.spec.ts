import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('default viewer settings offer the Windows-confirmed flow and report failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-default-viewer-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    await page.getByRole('button', { name: 'Appearance and settings', exact: true }).click()
    const button = page.getByRole('button', { name: 'Choose LogDeck as default viewer', exact: true })
    await expect(button).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await desktop.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('windows:integration-info')
      ipcMain.removeHandler('windows:integration-change')
      ipcMain.handle('windows:integration-info', () => ({ ok: true, value: { available: true, executablePath: 'C:\\Apps\\LogDeck.exe', registeredPath: null } }))
      ipcMain.handle('windows:integration-change', (_event, action) => ({ ok: false, error: `Synthetic ${action}: Windows Settings could not be opened.` }))
    })
    await page.getByRole('button', { name: 'Appearance and settings', exact: true }).click()
    await expect(button).toBeEnabled()
    await expect(page.getByText(/Your defaults are not changed silently/)).toBeVisible()
    await button.click()
    await expect(page.getByRole('alert').filter({ hasText: 'Synthetic defaults: Windows Settings could not be opened.' })).toBeVisible()
    await expect(button).toBeEnabled()
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
})
