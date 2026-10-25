import { test, expect } from '@playwright/test'

test('configured admin validates privately, requires role and publishes only on explicit action (mocked REST)', async ({ page }) => {
  let role = 'member'
  let currentVersion = 1
  const commits: unknown[] = []
  const requests: string[] = []
  await page.route('https://*.googleapis.com/**', async route => {
    const request = route.request()
    const url = request.url()
    requests.push(url)
    let body: unknown
    if (url.includes('signInWithPassword')) {
      role = request.postDataJSON().email.startsWith('admin') ? 'admin' : 'member'
      body = { idToken: 'synthetic-id', refreshToken: 'synthetic-refresh', localId: 'synthetic-admin', expiresIn: '3600' }
    } else if (url.includes('/members/')) body = { fields: { active: { booleanValue: true }, role: { stringValue: role } } }
    else if (url.includes('/catalog/')) body = { fields: { version: { integerValue: String(currentVersion) } }, updateTime: '2026-01-01T00:00:00Z' }
    else if (url.endsWith(':commit')) {
      const value = request.postDataJSON()
      commits.push(value)
      currentVersion = Number(value.writes[1].update.fields.version.integerValue)
      body = { writeResults: [] }
    } else throw new Error(`Unexpected network call in admin test: ${url}`)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/admin')
  expect(requests).toEqual([])
  await page.getByLabel('Company ID', { exact: true }).fill('example-company')
  await page.getByLabel('Email', { exact: true }).fill('member@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: 'Sign in as company admin' }).click()
  await expect(page.getByRole('alert')).toContainText('not a company administrator')
  await expect(page.getByLabel('Company tag JSON')).toHaveCount(0)
  await page.getByLabel('Email', { exact: true }).fill('admin@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: 'Sign in as company admin' }).click()
  const upload = page.getByLabel('Company tag JSON')
  await expect(upload).toBeVisible()
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
  await expect(page.getByRole('alert')).toBeVisible()
  expect(commits).toHaveLength(0)
  const pack = { schemaVersion: 1, companyId: 'example-company', version: 2, name: 'Synthetic UI pack', tags: [
    { tag: '9F33', name: 'Company capability context', description: 'Synthetic reference', bytes: 3 }
  ] }
  await upload.setInputFiles({ name: 'wrong-company.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...pack, companyId: 'wrong-company' })) })
  await expect(page.getByRole('alert')).toContainText('authorized company')
  await upload.setInputFiles({ name: 'tags.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) })
  await expect(page.getByText('Validated locally. Nothing has been published yet.')).toBeVisible()
  await expect(page.getByText('1 also have global definitions.', { exact: false })).toBeVisible()
  expect(commits).toHaveLength(0)
  await page.getByRole('button', { name: 'Publish version 2' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Published Synthetic UI pack v2' })).toBeVisible()
  expect(commits).toHaveLength(1)
  await upload.setInputFiles({ name: 'same-version.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) })
  await page.getByRole('button', { name: 'Publish version 2' }).click()
  await expect(page.getByRole('alert')).toContainText('higher than 2')
  expect(commits).toHaveLength(1)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByLabel('Company tag JSON')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign in as company admin' })).toBeVisible()
})
