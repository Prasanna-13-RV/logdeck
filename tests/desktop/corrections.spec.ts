import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { receiptHex } from '../fixtures/receipt'

async function launch() {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-corrections-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  const page = await desktop.firstWindow()
  await page.waitForFunction(() => Boolean(window.logdeck))
  return { directory, desktop, page }
}

test('sidebar filtering is separate from highlight search, severity styling and disjoint copy/export', async () => {
  const { directory, desktop, page } = await launch()
  const previousClipboard = await desktop.evaluate(({ clipboard }) => clipboard.readText())
  try {
    const lines = [
      '10-24 12:00:00.000 1 2 E Core.Api: failure needle',
      '10-24 12:00:00.000 1 2 D Core.Dal: excluded needle',
      '10-24 12:00:00.000 1 2 W Core.UI: warning',
      '10-24 12:00:00.000 1 2 I Other: unrelated',
      `10-24 12:00:00.000 1 2 D Core.Api: ${'long '.repeat(5000)}needle`
    ]
    const source = join(directory, 'corrections.log')
    await writeFile(source, lines.join('\n'))
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), source)
    if (!opened.ok) throw new Error(opened.error)
    const panel = page.locator('.tab-panel:not([hidden])')
    await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeEnabled()
    await panel.getByLabel('Filter expression', { exact: true }).fill('Core. -tag:Core.Dal')
    await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(panel.getByRole('status').filter({ hasText: 'matching records' })).toContainText('3 matching records')
    await expect(panel.locator('tbody tr')).toHaveCount(3)
    await expect(panel.locator('mark')).toHaveCount(0)
    expect(await panel.locator('.file-sidebar').getByLabel('Filter mode').count()).toBe(1)
    expect(await panel.locator('.viewer-toolbar').getByLabel('Search logs', { exact: true }).count()).toBe(1)
    await expect(panel.locator('.range-navigation')).not.toContainText(/Matches|Records|Source lines|\//)
    await panel.getByLabel('Search logs', { exact: true }).fill('needle')
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.locator('tbody tr')).toHaveCount(3)
    await expect(panel.getByRole('table')).toHaveAttribute('aria-rowcount', '4')
    await expect(panel.locator('mark')).toHaveText(['needle'])
    await panel.getByLabel('Search logs', { exact: true }).fill('NOT-PRESENT')
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.locator('mark')).toHaveCount(0)
    await expect(panel.locator('tbody tr')).toHaveCount(3)
    await panel.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(panel.getByLabel('Filter expression')).toHaveValue('Core. -tag:Core.Dal')

    await panel.getByLabel('Severity color style').selectOption('background')
    const first = panel.locator('tbody tr').nth(0)
    const warning = panel.locator('tbody tr').nth(1)
    expect(await first.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    expect(await first.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await warning.evaluate(node => getComputedStyle(node).backgroundColor))
    for (const theme of ['Light', 'Dark']) {
      await page.getByRole('button', { name: 'Appearance and settings' }).click()
      await page.getByRole('button', { name: theme, exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
      expect(await first.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await warning.evaluate(node => getComputedStyle(node).backgroundColor))
      await page.screenshot({ path: test.info().outputPath(`viewer-${theme.toLowerCase()}.png`) })
    }
    await panel.getByLabel('Severity color style').selectOption('text')
    expect(await first.locator('.time-cell').evaluate(node => getComputedStyle(node).color)).toBe(await first.locator('.message-cell').evaluate(node => getComputedStyle(node).color))
    expect(await first.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await first.locator('.line-cell').click()
    await expect(first).toHaveAttribute('aria-selected', 'true')
    await first.locator('.line-cell').click()
    await expect(first).toHaveAttribute('aria-selected', 'false')
    await expect(panel.getByRole('button', { name: 'Copy selection', exact: true })).toBeDisabled()
    await first.locator('.line-cell').click()
    await panel.locator('tbody tr').nth(2).locator('.line-cell').click({ modifiers: ['Control'] })
    await expect(panel.locator('tr.selected')).toHaveCount(2)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
    await panel.locator('tbody tr').nth(2).press('Control+c')
    await expect.poll(() => page.getByRole('alert').allTextContents()).toEqual([])
    await expect.poll(() => desktop.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${lines[0]}\n${lines[4]}`)
    const destination = join(directory, 'disjoint.txt')
    await desktop.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, destination)
    await panel.getByRole('button', { name: 'Export selection', exact: true }).click()
    await expect.poll(() => readFile(destination, 'utf8').catch(() => '')).toBe(`${lines[0]}\n${lines[4]}\n`)
    await first.locator('.line-cell').click({ modifiers: ['Control'] })
    await expect(first).toHaveAttribute('aria-selected', 'false')
    await expect(panel.locator('tr.selected')).toHaveCount(1)
    await first.locator('.line-cell').click({ modifiers: ['Shift'] })
    await expect(panel.locator('tr.selected')).toHaveCount(1)
    await panel.locator('tbody tr').nth(2).locator('.line-cell').click({ modifiers: ['Shift'] })
    await expect(panel.locator('tr.selected')).toHaveCount(3)
    await panel.getByLabel('Search logs', { exact: true }).fill('warning')
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await panel.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await expect(panel.locator('tbody tr')).toHaveCount(5)
    await expect(panel.locator('mark')).toHaveText(['warning'])
    await panel.getByRole('button', { name: 'Clear search', exact: true }).click()
    await panel.getByLabel('Filter mode').selectOption('regex')
    await panel.getByLabel('Filter expression').fill('Core\\.(Api|UI)')
    await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(panel.getByRole('status').filter({ hasText: 'matching records' })).toContainText('3 matching records')
    await expect(panel.locator('mark')).toHaveCount(0)
    await page.reload()
    await expect(panel.getByLabel('Severity color style')).toHaveValue('text')
    expect(await readFile(source, 'utf8')).toBe(lines.join('\n'))
  } finally {
    await desktop.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard)
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('dump notation recognizes known/unknown EMV tags, bit tables use two columns, receipt converts losslessly', async () => {
  const { directory, desktop, page } = await launch()
  const previousClipboard = await desktop.evaluate(({ clipboard }) => clipboard.readText())
  try {
    const messages = ['#[T]: 70      L:   41', '#[T]: 61      L:   39',
      '  T:  4F      L:    7    V: A0000000031010', '  T:  50      L:   11    V: 5649534120435245444954',
      '  T:  87      L:    1    V: 01', '  T:  9F12    L:   11    V: 5649534120435245444954',
      'T: 9f33 L: 3 V: E0F8C8', 'T: 9f13 L: 2 V: 0001', 'T: DF01 L: 1 V: AB']
    const source = join(directory, 'dump.logcat')
    const json = JSON.stringify({ logcatMessages: messages.map(message => ({
      header: { logLevel: 'INFO', pid: 848, tid: 6264, tag: 'MCEMV', timestamp: { seconds: 0, nanos: 0 } }, message
    })) })
    await writeFile(source, json)
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), source)
    if (!opened.ok) throw new Error(opened.error)
    const panel = page.locator('.tab-panel:not([hidden])')
    await expect(panel.locator('.emv-tag')).toHaveCount(9)
    await panel.getByRole('button', { name: 'Inspect EMV tag 9F13', exact: true }).click()
    const inspector = panel.getByRole('complementary', { name: 'EMV tag definition' })
    await expect(inspector).toContainText('Last Online Application Transaction Counter')
    await expect(inspector).toContainText('0001')
    await panel.getByRole('button', { name: 'Inspect EMV tag DF01', exact: true }).click()
    await expect(inspector).toContainText('Unknown tag')
    await expect(inspector).toContainText('AB')
    await panel.getByRole('button', { name: 'Inspect EMV tag 70', exact: true }).click()
    await expect(inspector).toContainText('unavailable')
    await panel.getByRole('button', { name: 'Inspect EMV tag 9F33', exact: true }).click()
    await inspector.getByRole('button', { name: 'Open value in EMV editor' }).click()
    await panel.getByRole('button', { name: 'Decode value', exact: true }).click()
    await expect(panel.getByLabel('Original tag value')).toContainText('E0F8C8')
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1700, 1000))
    const cards = panel.locator('.emv-byte-grid > .tool-card')
    await expect(cards).toHaveCount(3)
    await expect.poll(async () => {
      const a = await cards.nth(0).boundingBox()
      const b = await cards.nth(1).boundingBox()
      return Boolean(a && b && Math.abs(a.y - b.y) < 2 && b.x > a.x)
    }).toBe(true)
    await panel.getByRole('button', { name: /Byte 1 bit 8/ }).click()
    await expect(panel.getByLabel('Modified tag value')).not.toHaveText('E0F8C8')
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 850))
    await expect.poll(async () => {
      const a = await cards.nth(0).boundingBox()
      const b = await cards.nth(1).boundingBox()
      return Boolean(a && b && b.y > a.y && Math.abs(a.x - b.x) < 2)
    }).toBe(true)
    await page.getByRole('button', { name: /Hex \/ ASCII/ }).click()
    await panel.getByLabel('Hex input', { exact: true }).fill(receiptHex)
    await panel.getByRole('button', { name: '← Hex to ASCII', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('above 7F')
    await panel.getByLabel('Conversion encoding').selectOption('latin1')
    await panel.getByRole('button', { name: '← Hex to Latin-1', exact: true }).click()
    await expect(panel.getByLabel('ASCII input', { exact: true })).toHaveValue(/MONTANT : 1.12 EUR/)
    await expect(panel.getByLabel('Escaped ASCII preview')).toContainText('##QRCode##\\u0080\\u0013')
    await panel.getByRole('button', { name: 'Latin-1 to hex →', exact: true }).click()
    expect((await panel.getByLabel('Hex input', { exact: true }).inputValue()).replace(/ /g, '')).toBe(receiptHex)
    await panel.getByRole('button', { name: 'Copy hex', exact: true }).click()
    await expect.poll(() => desktop.evaluate(async ({ clipboard }) => (await clipboard.readText()).replace(/ /g, ''))).toBe(receiptHex)
    const oversized = await page.evaluate(() => window.logdeck.writeClipboard('A'.repeat(512_001)))
    expect(oversized.ok).toBe(false)
    expect(await readFile(source, 'utf8')).toBe(json)
  } finally {
    await desktop.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard)
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
