import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('offline cached company tags retain both sources without enabling unconfigured cloud', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-company-ui-'))
  const profile = join(directory, 'profile')
  await mkdir(profile)
  const pack = { schemaVersion: 1, companyId: 'example-company', version: 3, name: 'Synthetic company tags', tags: [
    { tag: 'DF8101', name: 'Company-only status', description: 'Private synthetic status definition', bytes: 2 },
    { tag: '9F33', name: 'Company capability context', description: 'Company meaning alongside global reference', bytes: 1 }
  ] }
  await writeFile(join(profile, 'company-emv-tags.json'), JSON.stringify(pack))
  const source = '10-24 12:00:00.000 123 456 I Payment: DF8101: AABB; 9F33: E0F8C8'
  const path = join(directory, 'company-synthetic.log')
  await writeFile(path, source)
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = profile
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const network: string[] = []
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    const opened = await page.evaluate(path => window.logdeck.openDroppedFile(path), path)
    expect(opened.ok).toBe(true)
    const panel = page.locator('.tab-panel:not([hidden])')
    await panel.getByRole('button', { name: 'Inspect EMV tag DF8101', exact: true }).click()
    const inspector = panel.getByRole('complementary', { name: 'EMV tag definition' })
    await expect(inspector).toContainText('Company-only status')
    await expect(inspector).toContainText('Synthetic company tags v3')
    await expect(inspector).toContainText('Company length check: matches')
    await panel.getByRole('button', { name: 'Inspect EMV tag 9F33', exact: true }).click()
    await expect(inspector).toContainText('Terminal Capabilities')
    await expect(inspector).toContainText('Company capability context')
    await expect(inspector).toContainText('Company length check: mismatch')
    await expect(inspector).toContainText('valid:')
    await page.getByRole('button', { name: /Login/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Firebase is not configured')
    await expect(dialog).toContainText('version 3')
    await expect(dialog.getByRole('button', { name: 'Download EMV tags' })).toBeDisabled()
    await expect(dialog.getByLabel('Company account password')).toBeDisabled()
    expect(network).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(source)
  } finally { await desktop.close(); await rm(directory, { recursive: true, force: true }) }
})
