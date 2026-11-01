import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('tools reuse untouched tabs and create independent tabs after use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-tool-tabs-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    const panel = page.locator('.tab-panel:not([hidden])')
    await desktop.evaluate(({ shell }) => { shell.openExternal = async () => {} })
    for (const tool of [
      { button: 'Hex / ASCII', tab: 'Hex / ASCII' },
      { button: 'EMV', tab: 'EMV workspace' },
      { button: 'Updates', tab: 'Updates' },
      { button: 'Compare', tab: 'Text Compare' }
    ]) {
      const open = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: tool.button, exact: true })
      const tabs = page.getByRole('tab', { name: tool.tab, exact: true })
      await open.click()
      await expect(tabs).toHaveCount(1)
      const originalId = await tabs.first().getAttribute('id')
      await page.getByRole('button', { name: 'LogDeck home', exact: true }).click()
      await open.click()
      await open.click()
      await expect(tabs).toHaveCount(1)
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
      if (tool.button === 'Hex / ASCII') await panel.getByLabel('ASCII input', { exact: true }).fill('retained text')
      if (tool.button === 'EMV') await panel.getByLabel('EMV value', { exact: true }).fill('0000000000')
      if (tool.button === 'Updates') await page.getByRole('button', { name: 'Official download page', exact: true }).click()
      if (tool.button === 'Compare') {
        await panel.getByLabel('Left comparison text', { exact: true }).click()
        await page.keyboard.type('retained comparison')
      }
      await open.click()
      await expect(tabs).toHaveCount(2)
      await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
      const newId = await tabs.last().getAttribute('id')
      expect(newId).not.toBe(originalId)
      await open.click()
      await expect(tabs).toHaveCount(2)
      await expect(tabs.last()).toHaveAttribute('id', newId!)
      await tabs.first().click()
      if (tool.button === 'Hex / ASCII') await expect(panel.getByLabel('ASCII input', { exact: true })).toHaveValue('retained text')
      if (tool.button === 'EMV') await expect(panel.getByLabel('EMV value', { exact: true })).toHaveValue('0000000000')
      if (tool.button === 'Compare') await expect(panel.getByLabel('Left comparison text', { exact: true })).toContainText('retained comparison')
      await open.click()
      await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
    }
    await expect(page.getByRole('alert')).toHaveCount(0)
    const homes = page.getByRole('tab', { name: 'New tab', exact: true })
    const before = await homes.count()
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await expect(homes).toHaveCount(before + 2)
  } finally {
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1 })
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('cancelled file pick leaves Compare reusable; a loaded saved document permits another tab', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-tool-load-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    const panel = page.locator('.tab-panel:not([hidden])')
    const open = page.getByRole('button', { name: 'Compare', exact: true })
    const tabs = page.getByRole('tab', { name: 'Text Compare', exact: true })
    await open.click()
    await desktop.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await page.getByRole('button', { name: 'Open left', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open left', exact: true })).toBeEnabled()
    await open.click()
    await expect(tabs).toHaveCount(1)
    const path = join(directory, 'saved.txt')
    await writeFile(path, 'already saved document')
    await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
    await page.getByRole('button', { name: 'Open left', exact: true }).click()
    await expect(panel.getByLabel('Left comparison text')).toContainText('already saved document')
    await open.click()
    await expect(tabs).toHaveCount(2)
    await open.click()
    await expect(tabs).toHaveCount(2)
    await page.getByRole('button', { name: 'Close Text Compare', exact: true }).last().click()
    await open.click()
    await expect(tabs).toHaveCount(2)
    await expect(panel.getByLabel('Left comparison text')).not.toContainText('already saved document')
    await tabs.first().click()
    await expect(panel.getByLabel('Left comparison text')).toContainText('already saved document')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('opening a log value reuses a blank EMV tab and preserves its seeded data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-tool-seed-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    const panel = page.locator('.tab-panel:not([hidden])')
    const openEmv = page.getByRole('button', { name: 'EMV', exact: true })
    const tabs = page.getByRole('tab', { name: 'EMV workspace', exact: true })
    await openEmv.click()
    const id = await tabs.first().getAttribute('id')
    const path = join(directory, 'value.log')
    await writeFile(path, '10-24 12:00:00.000 123 456 I Payment: Tag 95: 0000000000')
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), path)
    expect(opened.ok).toBe(true)
    await panel.getByRole('button', { name: 'Inspect EMV tag 95', exact: true }).click()
    await panel.getByRole('button', { name: 'Open value in EMV editor', exact: true }).click()
    await expect(tabs).toHaveCount(1)
    await expect(tabs.first()).toHaveAttribute('id', id!)
    await expect(panel.getByLabel('EMV value')).toHaveValue('0000000000')
    await openEmv.click()
    await expect(tabs).toHaveCount(2)
    await expect(panel.getByLabel('EMV value')).toHaveValue('8000000000')
    await tabs.first().click()
    await expect(panel.getByLabel('EMV value')).toHaveValue('0000000000')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
