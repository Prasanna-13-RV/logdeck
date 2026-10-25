import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('automatic offline EMV highlighting, definition/value states, editing handoff and independent views', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-emv-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const requests: string[] = []
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
    const text = [
      '10-24 12:00:00.095 95 82 I Payment: amount 95 counter 82 id A9F0200',
      '10-24 12:00:00.000 123 456 I Payment: Tag 95: 8000000000',
      '10-24 12:00:00.000 123 456 I Payment: tag: 9f 02[6]: 00 00 00 00 01 00',
      '10-24 12:00:00.000 123 456 I Payment: Tag 82',
      '10-24 12:00:00.000 123 456 I Payment: Tag 95: GG',
      '10-24 12:00:00.000 123 456 I Payment: Tag DF01: AB',
      '10-24 12:00:00.000 123 456 I Payment: TLV: 770795058000000000',
      '10-24 12:00:00.000 123 456 I Payment: TLV: 950500'
    ].join('\n')
    const path = join(directory, 'emv-synthetic.log')
    await writeFile(path, text)
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), path)
    if (!opened.ok) throw new Error(opened.error)
    const panel = page.locator('.tab-panel:not([hidden])')
    await expect(panel.locator('tbody tr').first()).toContainText('amount 95')
    await expect(panel.getByRole('button', { name: 'Track EMV tags' })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.locator('tbody tr').first().locator('.emv-tag')).toHaveCount(0)
    await expect(panel.locator('.emv-tag')).toHaveCount(7)
    await expect(panel.getByRole('note').filter({ hasText: 'TLV not parsed' })).toBeVisible()
    const off = await page.evaluate(id => window.logdeck.readRange({ id, start: 1, count: 8, emv: false }), opened.value.id)
    expect(off.ok && off.value.every(row => row.emv === undefined)).toBe(true)
    const on = await page.evaluate(id => window.logdeck.readRange({ id, start: 1, count: 8, emv: true }), opened.value.id)
    expect(on.ok && on.value[1].emv?.occurrences[0].value).toBe('8000000000')

    await panel.getByRole('button', { name: 'Inspect EMV tag 95', exact: true }).first().focus()
    await page.keyboard.press('Enter')
    const inspector = panel.getByRole('complementary', { name: 'EMV tag definition' })
    await expect(inspector).toContainText('Terminal Verification Results')
    await expect(inspector).toContainText('Record 2')
    await expect(inspector).toContainText('8000000000')
    await expect(inspector).toContainText('Dictionary 1.1.0')
    await expect(panel.locator('tr.selected')).toHaveCount(0)
    await expect(page.getByText('MESSAGE DETAILS', { exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Inspect EMV tag 82', exact: true }).click()
    await expect(inspector).toContainText('unavailable')
    await expect(inspector.getByRole('button', { name: 'Open value in EMV editor' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Inspect EMV tag 95', exact: true }).nth(1).click()
    await expect(inspector).toContainText('invalid')
    await panel.getByRole('button', { name: 'Inspect EMV tag DF01', exact: true }).click()
    await expect(inspector).toContainText('Unknown tag')

    await panel.getByLabel('Filter expression', { exact: true }).fill('"Tag 95"')
    await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await expect(panel.getByRole('status').filter({ hasText: 'matching records' })).toContainText('Complete')
    await expect(panel.locator('mark')).toHaveCount(0)
    await panel.getByLabel('Search logs', { exact: true }).fill('Tag 95')
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(panel.locator('tbody tr').first().locator('mark')).toHaveText(['Tag ', '95'])
    await panel.getByRole('button', { name: 'Wrap all columns' }).click()
    await panel.getByRole('button', { name: 'Inspect EMV tag 95', exact: true }).first().click()
    await inspector.getByRole('button', { name: 'Open value in EMV editor' }).click()
    await expect(panel.getByLabel('EMV tag', { exact: true })).toHaveValue('95')
    await expect(panel.getByLabel('EMV value', { exact: true })).toHaveValue('8000000000')
    await panel.getByRole('button', { name: 'Decode value', exact: true }).click()
    await expect(panel.getByLabel('Original tag value', { exact: true })).toContainText('8000000000')
    await page.getByRole('tab', { name: 'emv-synthetic.log', exact: true }).click()
    await panel.getByRole('button', { name: 'Track EMV tags' }).click()
    await expect(panel.locator('.emv-tag')).toHaveCount(0)
    await expect(panel.getByRole('complementary', { name: 'EMV tag definition' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await panel.getByRole('button', { name: 'Split view', exact: true }).click()
    const primary = panel.locator('.split-pane').nth(0)
    const secondary = panel.locator('.split-pane').nth(1)
    await expect(primary.getByRole('button', { name: 'Track EMV tags' })).toHaveAttribute('aria-pressed', 'false')
    await expect(secondary.getByRole('button', { name: 'Track EMV tags' })).toHaveAttribute('aria-pressed', 'true')
    await expect(secondary.locator('.emv-tag')).toHaveCount(7)
    await panel.getByRole('button', { name: 'Close split' }).click()

    const jsonPath = join(directory, 'emv-synthetic.logcat')
    const json = JSON.stringify({ logcatMessages: [{
      header: { logLevel: 'INFO', pid: 95, tid: 82, tag: 'Payment', timestamp: { seconds: 0, nanos: 0 } },
      message: 'amount 95\nTag 9f33: E0F8C8\nTag 95: 8000000000'
    }] }, null, 2)
    await writeFile(jsonPath, json)
    const structured = await page.evaluate(path => window.logdeck.openDroppedFile(path), jsonPath)
    if (!structured.ok) throw new Error(structured.error)
    await expect(panel.getByRole('button', { name: 'Inspect EMV tag 9F33' })).toBeVisible()
    await panel.getByRole('button', { name: 'Inspect EMV tag 95' }).click()
    await expect(panel.getByRole('complementary', { name: 'EMV tag definition' })).toContainText('8000000000')
    await panel.getByRole('button', { name: 'Wrap all columns' }).click()
    await panel.getByRole('button', { name: 'Inspect EMV tag 9F33' }).click()
    await expect(panel.getByRole('complementary', { name: 'EMV tag definition' })).toContainText('E0F8C8')
    await page.getByRole('button', { name: 'Appearance and settings' }).click()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(panel.getByRole('button', { name: 'Inspect EMV tag 9F33' })).toBeVisible()
    await page.getByRole('button', { name: 'Appearance and settings' }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(panel.getByRole('button', { name: 'Inspect EMV tag 9F33' })).toBeVisible()
    expect(requests).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(text)
    expect(await readFile(jsonPath, 'utf8')).toBe(json)
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('segmented EMV values stay unverified until a complete local value is available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-emv-segments-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const path = join(directory, 'emv-segments.log')
    const text = `Tag 95: ${'00'.repeat(20_000)}; Tag 9F33: E0F8C8`
    await writeFile(path, text)
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), path)
    if (!opened.ok) throw new Error(opened.error)
    const panel = page.locator('.tab-panel:not([hidden])')
    await panel.getByRole('button', { name: 'Inspect EMV tag 95', exact: true }).click()
    const inspector = panel.getByRole('complementary', { name: 'EMV tag definition' })
    await expect(inspector).toContainText('unverified')
    await expect(inspector.getByRole('button', { name: 'Open value in EMV editor' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Close EMV definition' }).click()
    await panel.getByRole('button', { name: 'Next text segment' }).click()
    await expect(panel.locator('tbody')).toContainText('bytes 16384')
    await panel.getByRole('button', { name: 'Next text segment' }).click()
    await panel.getByRole('button', { name: 'Inspect EMV tag 9F33', exact: true }).click()
    await expect(inspector).toContainText('segment byte offset 32768')
    await expect(inspector).toContainText('valid:')
    await expect(inspector).toContainText('E0F8C8')
    await inspector.getByRole('button', { name: 'Close EMV definition' }).click()
    await panel.getByRole('button', { name: 'Track EMV tags' }).click()
    await panel.getByRole('button', { name: 'Track EMV tags' }).click()
    await panel.getByRole('button', { name: 'Inspect EMV tag 95', exact: true }).click()
    await expect(inspector).toContainText('unverified')
    expect(await readFile(path, 'utf8')).toBe(text)
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
