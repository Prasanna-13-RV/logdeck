import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

function hash(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex') }

function environment(profile: string): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = profile
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

test('real Electron foundation: themes, local files, cache, bounded ranges, isolation and errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-desktop-'))
  const path = join(directory, 'synthetic unicode 世界.logcat')
  const file = Array.from({ length: 120_005 }, (_, i) =>
    `10-24 12:01:02.123  1423  1560 ${i % 9 === 0 ? 'E' : 'I'} Synthetic: record ${i + 1} 世界`
  ).join('\r\n')
  await writeFile(path, `\uFEFF${file}`)
  const originalHash = hash(await readFile(path))
  const env = environment(join(directory, 'profile'))
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByRole('heading', { name: 'Less noise. More understanding.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible()
    await page.screenshot({ path: 'test-results/home-initial.png', fullPage: true })

    await page.getByRole('button', { name: /Login/ }).click()
    await expect(page.getByRole('dialog')).toContainText('Firebase')
    await expect(page.getByRole('dialog')).toContainText('Firebase is not configured')
    await page.getByRole('button', { name: 'Got it' }).click()
    await page.getByRole('button', { name: 'Appearance and settings' }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Got it' }).click()
    await page.screenshot({ path: 'test-results/home-dark.png', fullPage: true })
    await page.getByRole('button', { name: 'Appearance and settings' }).click()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await page.getByRole('button', { name: 'Got it' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.screenshot({ path: 'test-results/home-light.png', fullPage: true })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    const transfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['not a disk file'], 'synthetic.log'))
      return transfer
    })
    await page.getByLabel('Drop a log file', { exact: true }).dispatchEvent('drop', { dataTransfer: transfer })
    await expect(page.getByRole('alert')).toContainText('local file')
    await page.getByRole('button', { name: 'Dismiss error' }).click()

    await desktop.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
    }, path)
    await page.getByRole('button', { name: 'Browse files' }).click()
    await expect(page.getByRole('table', { name: 'Log lines' })).toBeVisible()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok ? result.value?.status : result.error
    }), { timeout: 40_000 }).toBe('ready')
    const current = await page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      if (!result.ok || !result.value) throw new Error('No active session')
      return result.value
    })
    expect(current.lines).toBe(120_005)
    expect(current.cacheHit).toBe(false)
    await expect(page.locator('tbody tr').first()).toContainText('record 1 世界')
    expect(await page.locator('tbody tr').count()).toBeLessThan(150)

    await page.getByLabel('Source line number', { exact: true }).fill('120005')
    await page.getByRole('button', { name: 'Go to source line', exact: true }).click()
    const last = page.locator('tbody tr').filter({ hasText: 'record 120005 世界' })
    await expect(last).toBeVisible()
    await last.click()
    await expect(page.getByRole('complementary', { name: 'Message details', exact: true })).toHaveCount(0)
    await expect(last).not.toHaveClass(/selected/)
    await last.click()
    await expect(last).toHaveClass(/selected/)
    await page.screenshot({ path: 'test-results/viewer-light.png', fullPage: true })
    await page.getByRole('button', { name: 'Appearance and settings' }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.getByRole('button', { name: 'Got it' }).click()
    await expect(last).toBeVisible()
    await page.screenshot({ path: 'test-results/viewer-dark.png', fullPage: true })

    const firstRange = await page.evaluate(async id => window.logdeck.readRange({ id, start: 1, count: 2 }), current.id)
    expect(firstRange.ok && firstRange.value[0].raw).toContain('record 1 世界')
    if (firstRange.ok) expect(firstRange.value[0].raw).not.toContain('\uFEFF')
    const invalidRange = await page.evaluate(async id => window.logdeck.readRange({ id, start: 1, count: 501 }), current.id)
    expect(invalidRange.ok).toBe(false)

    await page.getByRole('button', { name: 'Close file', exact: true }).click()
    await page.getByRole('button', { name: 'Browse files' }).click()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok && result.value?.cacheHit
    })).toBe(true)

    const newWindow = desktop.waitForEvent('window')
    await page.evaluate(() => window.logdeck.newWindow())
    const second = await newWindow
    await expect(second.getByRole('button', { name: 'Browse files' })).toBeVisible()
    const unauthorized = await second.evaluate(async id => window.logdeck.readRange({ id, start: 1, count: 1 }), current.id)
    expect(unauthorized.ok).toBe(false)
    await second.getByRole('button', { name: /Open a synthetic demo/ }).click()
    await expect(second.getByRole('table')).toBeVisible()
    await second.close()
    await expect(page.getByRole('table')).toBeVisible()

    const badPath = join(directory, 'unsupported.txt')
    const bad = await page.evaluate(async path => window.logdeck.openDroppedFile(path), badPath)
    expect(bad.ok).toBe(false)
    await expect(page.getByRole('table')).toBeVisible()

    const changed = await page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      if (!result.ok || !result.value) throw new Error('No active session')
      return result.value
    })

    expect(hash(await readFile(path))).toBe(originalHash)
    await writeFile(path, 'changed\n')
    const stale = await page.evaluate(async id => window.logdeck.readRange({ id, start: 1, count: 1 }), changed.id)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error).toContain('changed')
    expect(errors).toEqual([])
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('empty files, UTF-16 rejection, long UTF-8 segments and safe raw rendering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-content-'))
  const env = environment(join(directory, 'profile'))
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const openFile = async (name: string, data: string | Buffer) => {
      const path = join(directory, name)
      await writeFile(path, data)
      return page.evaluate(async path => window.logdeck.openDroppedFile(path), path)
    }
    const empty = await openFile('empty.log', '')
    expect(empty.ok).toBe(true)
    await expect(page.getByText('This file is empty')).toBeVisible()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok ? result.value?.status : result.error
    })).toBe('ready')
    const rejected = await openFile('utf16.log', Buffer.from([255, 254, 65, 0]))
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toContain('UTF-8')
    const raw = '<script>window.untrusted=true</script>' + '世界'.repeat(20_000)
    const opened = await openFile('long.log', raw)
    if (!opened.ok) throw new Error(opened.error)
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok ? result.value?.status : result.error
    })).toBe('ready')
    const id = opened.value.id
    let offset = 0
    let assembled = ''
    for (;;) {
      const result = await page.evaluate(async ({ id, offset }) => window.logdeck.readSegment({ id, line: 1, offset }), { id, offset })
      if (!result.ok) throw new Error(result.error)
      expect(result.value.raw).not.toContain('\uFFFD')
      assembled += result.value.raw
      expect(result.value.nextOffset).toBeGreaterThan(offset)
      offset = result.value.nextOffset
      if (offset >= result.value.byteLength) break
    }
    expect(assembled).toBe(raw)
    expect(await page.evaluate(() => 'untrusted' in window)).toBe(false)
    const range = await page.evaluate(async id => window.logdeck.readRange({ id, start: 1, count: 500 }), id)
    expect(Buffer.byteLength(JSON.stringify(range))).toBeLessThan(1_000_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Appearance and settings' }).click()
    expect(await page.getByRole('dialog').evaluate(node => getComputedStyle(node).animationName)).toBe('none')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('cancel, reopen, and reuse an index across application restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-lifecycle-'))
  const path = join(directory, 'synthetic-many-lines.log')
  await writeFile(path, 'x\n'.repeat(2_000_000))
  const env = environment(join(directory, 'profile'))
  let desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    let page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const opened = await page.evaluate(async path => window.logdeck.openDroppedFile(path), path)
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.value.status).toBe('indexing')
    const cancelled = await page.evaluate(async id => window.logdeck.cancel(id), opened.value.id)
    expect(cancelled.ok).toBe(true)
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok ? result.value?.status : result.error
    })).toBe('cancelled')
    const reopened = await page.evaluate(async path => window.logdeck.openDroppedFile(path), path)
    if (!reopened.ok) throw new Error(reopened.error)
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok ? result.value?.status : result.error
    }), { timeout: 40_000 }).toBe('ready')
    expect(await page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok && result.value?.lines
    })).toBe(2_000_000)
    await desktop.close()
    desktop = await electron.launch({ args: [resolve('.'), path], env })
    page = await desktop.firstWindow()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.logdeck.getSession()
      return result.ok && result.value?.cacheHit
    })).toBe(true)
    const session = await page.evaluate(async () => window.logdeck.getSession())
    if (!session.ok || !session.value) throw new Error('No cached session')
    const last = await page.evaluate(async id => window.logdeck.readRange({ id, start: 2_000_000, count: 1 }), session.value.id)
    if (!last.ok) throw new Error(last.error)
    expect(last.value[0].raw).toBe('x')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('metadata-only changes reuse verified content but middle edits rebuild the index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-metadata-'))
  const path = join(directory, 'synthetic-metadata.log')
  const timestamp = new Date('2020-01-01T00:00:00.000Z')
  await writeFile(path, 'x\n'.repeat(20_000))
  await utimes(path, timestamp, timestamp)
  const desktop = await electron.launch({ args: [resolve('.')], env: environment(join(directory, 'profile')) })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    async function openFixture() {
      const opened = await page.evaluate(async path => window.logdeck.openDroppedFile(path), path)
      if (!opened.ok) throw new Error(opened.error)
      await expect.poll(async () => page.evaluate(async () => {
        const result = await window.logdeck.getSession()
        return result.ok ? result.value?.status : result.error
      })).toBe('ready')
      const session = await page.evaluate(() => window.logdeck.getSession())
      if (!session.ok || !session.value) throw new Error('Missing metadata fixture session')
      return session.value
    }
    await openFixture()
    await page.getByRole('button', { name: 'Close file', exact: true }).click()
    await utimes(path, timestamp, timestamp)
    const unchanged = await openFixture()
    expect(unchanged.cacheHit).toBe(true)
    const closed = await page.evaluate(id => window.logdeck.closeFile(id), unchanged.id)
    expect(closed.ok).toBe(true)
    await writeFile(path, `${'x\n'.repeat(10_000)}y\n${'x\n'.repeat(9_999)}`)
    await utimes(path, timestamp, timestamp)
    const changed = await openFixture()
    expect(changed.cacheHit).toBe(false)
    const row = await page.evaluate(async id => window.logdeck.readRange({ id, start: 10_001, count: 1 }), changed.id)
    if (!row.ok) throw new Error(row.error)
    expect(row.value[0].raw).toBe('y')
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
