import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('offline tracker is hidden while log search, splits and the manual EMV workspace remain available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-emv-visibility-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const source = '10-24 12:00:00.000 123 456 I Payment: Tag 95: 8000000000'
    const path = join(directory, 'payment.log')
    await writeFile(path, source)
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), path)
    if (!opened.ok) throw new Error(opened.error)
    const panel = page.locator('.tab-panel:not([hidden])')
    await expect(panel.locator('tbody')).toContainText('Tag 95: 8000000000')
    await expect(panel.getByRole('button', { name: 'Track EMV tags' })).toHaveCount(0)
    await expect(panel.locator('.emv-tag, .emv-notice, .emv-inspector')).toHaveCount(0)
    await expect(panel.locator('.viewer-status')).not.toContainText('EMV')
    await page.keyboard.press('Control+f')
    await panel.getByLabel('Search logs', { exact: true }).fill('95')
    await expect(panel.getByRole('search').getByRole('status')).toHaveText('1 of 1 matches')
    await expect(panel.locator('mark.current-find')).toHaveText('95')
    await panel.getByRole('button', { name: 'Close find', exact: true }).click()
    await panel.getByRole('button', { name: 'Split view', exact: true }).click()
    await expect(panel.locator('.split-pane')).toHaveCount(2)
    await expect(panel.locator('.split-pane').nth(1).locator('tbody')).toContainText('Tag 95')
    await expect(panel.getByRole('button', { name: 'Track EMV tags' })).toHaveCount(0)
    await expect(panel.locator('.emv-tag, .emv-inspector')).toHaveCount(0)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'EMV', exact: true }).click()
    await panel.getByLabel('EMV tag', { exact: true }).selectOption('95')
    await panel.getByLabel('EMV value', { exact: true }).fill('8000000000')
    await panel.getByRole('button', { name: 'Decode value', exact: true }).click()
    await expect(panel.getByLabel('Original tag value')).toContainText('8000000000')
    await panel.getByRole('button', { name: /Byte 1 bit 8/ }).click()
    await expect(panel.getByLabel('Modified tag value')).toContainText('0000000000')
    expect(await readFile(path, 'utf8')).toBe(source)
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
