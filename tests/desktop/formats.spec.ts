import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseAndroidRecord } from '../../src/workers/androidJson'
import { parseLogLine } from '../../src/workers/logCore'

test.use({ trace: 'off' })

test('both structured and text adapters populate the same real table', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-formats-'))
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  delete env.ELECTRON_RUN_AS_NODE
  const desktop = await electron.launch({ args: [resolve('.')], env })
  try {
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => Boolean(window.logdeck))
    const record = {
      header: { logLevel: 'WARN', pid: 101, tid: 202, tag: 'Synthetic', applicationId: 'example.synthetic',
        timestamp: { seconds: 0, nanos: 123000000 } },
      message: 'synthetic JSON value with \\ and "quotes" 世界\nsecond message line'
    }
    const syntheticPath = join(directory, 'synthetic-structured.logcat')
    const json = JSON.stringify({ metadata: { device: 'synthetic' }, logcatMessages: [record, record] }, null, 2)
    await writeFile(syntheticPath, json)
    const fixtures: { path: string; real: boolean }[] = [{ path: syntheticPath, real: false }]
    const sampleDirectory = resolve('dummy')
    if (existsSync(sampleDirectory)) {
      const names = await readdir(sampleDirectory)
      for (const name of names.filter(name => /\.(log|logcat)$/i.test(name))) {
        fixtures.push({ path: join(sampleDirectory, name), real: true })
      }
    }
    for (const fixture of fixtures) {
      const bytes = await readFile(fixture.path)
      const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
      const structured = text.trimStart().startsWith('{')
      const opened = await page.evaluate(async path => window.logdeck.openDroppedFile(path), fixture.path)
      expect(opened.ok, 'Fixture must open without a format error').toBe(true)
      if (!opened.ok) continue
      await expect.poll(async () => page.evaluate(async () => {
        const result = await window.logdeck.getSession()
        return result.ok ? result.value?.status : result.error
      }), { timeout: 40_000 }).toBe('ready')
      const result = await page.evaluate(async id => window.logdeck.readRange({ id, start: 1, count: 3 }), opened.value.id)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.value.length).toBeGreaterThan(0)
      const current = await page.evaluate(() => window.logdeck.getSession())
      if (!current.ok || !current.value) throw new Error('Missing session')
      for (const line of new Set([Math.ceil(current.value.lines / 2), current.value.lines])) {
        const sample = await page.evaluate(async request => window.logdeck.readRange(request),
          { id: opened.value.id, start: line, count: 1 })
        expect(sample.ok).toBe(true)
        if (sample.ok) result.value.push(...sample.value)
      }
      if (structured) {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null || !('logcatMessages' in parsed) ||
            !Array.isArray(parsed.logcatMessages)) throw new Error('Fixture is not an Android export')
        expect(current.value.lines === parsed.logcatMessages.length).toBe(true)
        for (const actual of result.value) {
          const expected = parseAndroidRecord(JSON.stringify(parsed.logcatMessages[actual.line - 1]))
          expect(actual.pid === expected.pid && actual.tid === expected.tid &&
            actual.tag === expected.tag && actual.level === expected.level &&
            actual.time === expected.time && actual.message === expected.message.slice(0, 16_384)).toBe(true)
        }
      } else {
        const physical = text.split(/\r?\n/)
        if (physical[physical.length - 1] === '') physical.pop()
        expect(current.value.lines === physical.length).toBe(true)
        for (const actual of result.value) {
          const expected = parseLogLine(physical[actual.line - 1])
          expect(actual.pid === expected.pid && actual.tid === expected.tid &&
            actual.tag === expected.tag && actual.level === expected.level &&
            actual.time === expected.time && actual.message === expected.message).toBe(true)
        }
      }
      await expect(page.getByRole('table')).toBeVisible()
      expect(await page.locator('tbody tr').count()).toBeLessThan(150)
      // Never attach screenshots or raw customer log contents to test reports.
      expect(fixture.real || current.value.lines === 2).toBe(true)
      await page.getByRole('button', { name: 'Close file', exact: true }).click()
    }
  } finally {
    await desktop.close()
    await rm(directory, { recursive: true, force: true })
  }
})
