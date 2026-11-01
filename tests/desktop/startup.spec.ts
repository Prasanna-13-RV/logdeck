import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('startup shows the viewer, acknowledges readiness and still opens the initial log', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logdeck-startup-'))
  const readyFile = join(directory, 'window.ready')
  const fixture = join(directory, 'initial.log')
  await writeFile(fixture, '10-25 12:00:00.123  123  456 I LogDeck: startup fixture\n')
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.LOGDECK_TEST_USER_DATA = join(directory, 'profile')
  env.LOGDECK_STARTUP_READY_FILE = readyFile
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const desktop = await electron.launch({ args: [resolve('.'), fixture], env })
    try {
      const page = await desktop.firstWindow()
      await expect(async () => {
        expect(await readFile(readyFile, 'utf8')).toBe('ready')
      }).toPass({ timeout: 10_000 })
      await page.waitForFunction(() => Boolean(window.logdeck))
      expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
      await expect.poll(() => page.evaluate(async () => {
        const result = await window.logdeck.getSessions()
        return result.ok && result.value.some(session => session.name === 'initial.log' && session.status === 'ready')
      })).toBe(true)
      const second = desktop.waitForEvent('window')
      await page.evaluate(() => window.logdeck.newWindow())
      const other = await second
      await other.waitForFunction(() => Boolean(window.logdeck))
      await expect.poll(() => other.evaluate(async () => {
        const result = await window.logdeck.getSessions()
        return result.ok && result.value.length === 0
      })).toBe(true)
    } finally { await desktop.close() }
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) }
})
