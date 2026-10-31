import { _electron as electron, chromium, type Page } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { releaseLinks } from './releaseHelpers.ts'
import { windowsIntegrationScript } from '../shared/windowsIntegration.ts'
import { randomUUID } from 'node:crypto'

const directory = resolve(process.argv[2])
const version = process.argv[3]
const checkVersionFile = process.argv.slice(4).includes('--check-version-file')
const { filename } = releaseLinks('Prasanna-13-RV/logdeck', version)
assert((await stat(join(directory, filename))).size > 1_000_000, 'Portable EXE must exist.')
const userData = await mkdtemp(join(tmpdir(), 'logdeck-packaged-'))
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
env.LOGDECK_TEST_USER_DATA = userData
delete env.ELECTRON_RUN_AS_NODE
const fixture = join(userData, 'threadtime.log')
const content = '10-25 12:00:00.123  123  456 I LogDeck: Synthetic packaged release verification\n'
await writeFile(fixture, content)
const secondFixture = join(userData, 'second log 世界.logcat')
await writeFile(secondFixture, content)
async function verify(page: Page, executablePath: string) {
  await page.waitForFunction(() => Boolean(window.logdeck))
  const result = await page.evaluate(() => window.logdeck.updatePageInfo())
  assert(result.ok && result.value.currentVersion === version, 'Packaged version must match the release.')
  assert(result.value.configured, 'Release builds must embed the GitHub version checker.')
  assert((await page.title()).includes('LogDeck'), 'The native window title must identify LogDeck.')
  const { stdout } = await promisify(execFile)('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/verify-windows-branding.ps1'),
    '-Executable', executablePath, '-Icon', resolve('images/app-icon.ico')
  ], { timeout: 20_000 })
  console.log(stdout.trim())
  if (checkVersionFile) {
    const checked = await page.evaluate(() => window.logdeck.startupUpdateCheck())
    assert(checked.ok, `Packaged GitHub request failed: ${checked.ok ? '' : checked.error}`)
    assert(checked.value && checked.value.currentVersion === version, 'GitHub check must use the packaged app version.')
    console.log(`Packaged GitHub check PASS: installed ${checked.value.currentVersion}, remote ${checked.value.latestVersion}`)
  }
  await page.waitForFunction(async () => {
    const sources = await window.logdeck.getSessions()
    return sources.ok && sources.value.some(file => file.name === 'threadtime.log' && file.status === 'ready' && file.lines > 0)
  })
  const native = await page.evaluate(async () => {
    const sessions = await window.logdeck.getSessions()
    if (!sessions.ok || !sessions.value[0]) throw new Error('No packaged file session.')
    return window.logdeck.readRange({ id: sessions.value[0].id, start: 1, count: 1 })
  })
  assert(native.ok && native.value[0]?.message.includes('Synthetic packaged release verification'), 'The packaged SQLite-backed worker must query the indexed record.')
  const integration = await page.evaluate(() => window.logdeck.windowsIntegrationInfo())
  assert(integration.ok && integration.value.available, 'Packaged Windows integration must be available.')
  assert.equal(integration.value.executablePath.toLowerCase(), executablePath.toLowerCase(), 'Registration must use the outer portable EXE, never its extracted runtime.')
  return integration
}

async function associationExecutable(executable: string) {
  const root = `HKCU:\\Software\\LogDeck.PackageTests\\${randomUUID()}`
  const isolated = (action: 'register' | 'remove') => windowsIntegrationScript(action, executable)
    .replaceAll('HKCU:\\Software\\Classes', `${root}\\Classes`)
    .replaceAll('HKCU:\\Software\\LogDeck\\Capabilities', `${root}\\Capabilities`)
    .replaceAll('HKCU:\\Software\\RegisteredApplications', `${root}\\RegisteredApplications`)
  const script = `
try {
  ${isolated('register')}
  $command = (Get-Item -LiteralPath "$prog\\shell\\open\\command").GetValue('')
  $icon = (Get-Item -LiteralPath "$prog\\DefaultIcon").GetValue('')
  if ($icon -ne ('"' + $exe + '",0')) { throw 'The registered file icon must use the branded EXE.' }
  if (-not ((Get-Item -LiteralPath "$classes\\.logcat\\OpenWithProgids").GetValueNames() -contains 'LogDeck.LogFile')) { throw 'Missing .logcat association.' }
  ${isolated('remove')}
  $command | ConvertTo-Json -Compress
} finally { if (Test-Path -LiteralPath '${root}') { Remove-Item -LiteralPath '${root}' -Recurse -Force } }
`
  const { stdout } = await promisify(execFile)('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { timeout: 20_000 })
  const command: unknown = JSON.parse(stdout)
  assert(typeof command === 'string', 'Registration must return an open command.')
  const match = /^"(.+)" "%1"$/.exec(command)
  assert(match && match[1] === executable, 'Open with must target the actual EXE with a quoted file argument.')
  return match[1]
}

async function waitForDebugPort(profile: string, child: ReturnType<typeof spawn>) {
  const end = Date.now() + 120_000
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`Portable launcher exited (${child.exitCode}) before its browser was ready.`)
    try {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
      if (/^\d+$/.test(port)) return port
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && ['ENOENT', 'EBUSY', 'EPERM'].includes(String(error.code)))) throw error
    }
    await delay(200)
  }
  throw new Error('Portable EXE did not expose its test browser within 120 seconds.')
}

async function cleanLauncher(child: ReturnType<typeof spawn>, extraPids: number[] = []) {
  if (!child.pid || ((child.exitCode !== null || child.signalCode !== null) && !extraPids.length)) return
  const end = Date.now() + 15_000
  while (child.exitCode === null && child.signalCode === null && Date.now() < end) await delay(100)
  if ((child.exitCode !== null || child.signalCode !== null) && !extraPids.length) return
  if (extraPids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error('Invalid test process ID.')
  const script = `
$ErrorActionPreference = 'Stop'
$all = Get-CimInstance Win32_Process
$ids = [System.Collections.Generic.List[int]]::new()
$ids.Add(${child.pid})
${extraPids.map(pid => `$ids.Add(${pid})`).join('\n')}
for ($i = 0; $i -lt $ids.Count; $i++) {
  foreach ($item in $all) { if ($item.ParentProcessId -eq $ids[$i] -and -not $ids.Contains([int]$item.ProcessId)) { $ids.Add([int]$item.ProcessId) } }
}
for ($i = $ids.Count - 1; $i -ge 0; $i--) {
  $process = Get-Process -Id $ids[$i] -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $ids[$i] -Force -ErrorAction SilentlyContinue
    try { if (-not $process.WaitForExit(10000)) { throw "Test process $($ids[$i]) did not stop." } } catch [System.InvalidOperationException] { }
  }
}
# A silenced Stop-Process failure would otherwise leak a non-zero exit code; only live survivors are errors.
$alive = @($ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
if ($alive.Count -gt 0) { throw "Test processes still running: $($alive -join ', ')" }
exit 0`
  console.error(`Stopping test-owned launcher process tree ${child.pid} after cleanup timeout.`)
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
}

async function portableMainPids(profile: string): Promise<number[]> {
  const script = `
$ErrorActionPreference = 'Stop'
$profile = '${profile.replaceAll("'", "''")}'
$all = Get-CimInstance Win32_Process
$ids = @($all | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } | Select-Object -ExpandProperty ParentProcessId -Unique)
ConvertTo-Json -InputObject $ids -Compress
`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 15_000 })
  const ids: unknown = JSON.parse(stdout)
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Could not identify test-owned portable processes.')
  return ids
}

// Both the extracted runtime and the self-extracting portable entry point must work.
try {
  const extracted = join(directory, 'win-unpacked', 'LogDeck.exe')
  {
    env.LOGDECK_TEST_USER_DATA = join(userData, 'extracted-profile')
    const desktop = await electron.launch({ executablePath: extracted, args: [fixture], env, timeout: 90_000 })
    try {
      const page = await desktop.firstWindow()
      const integration = await verify(page, extracted)
      await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
      const cancelled = await page.evaluate(() => window.logdeck.changeWindowsIntegration('register'))
      assert.deepEqual(cancelled, integration, 'Cancel must not register or alter Windows associations.')
      const newWindow = desktop.waitForEvent('window')
      const registeredExe = await associationExecutable(extracted)
      const second = spawn(registeredExe, [secondFixture], { env, stdio: 'ignore' })
      second.on('error', error => console.error('Second-instance launch failed:', error))
      const forwarded = await newWindow
      await forwarded.waitForFunction(async () => {
        const result = await window.logdeck.getSessions()
        return result.ok && result.value.some(file => file.name === 'second log 世界.logcat' && file.status === 'ready')
      })
      assert.equal(await readFile(fixture, 'utf8'), content, 'Opening a file must not rewrite it.')
      console.log(`Packaged runtime PASS: ${extracted}`)
    } finally { await desktop.close() }
  }
  const portable = join(directory, filename)
  const profile = join(userData, 'portable-profile')
  env.LOGDECK_TEST_USER_DATA = profile
  const child = spawn(portable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', fixture], { env, stdio: 'ignore' })
  child.on('error', error => console.error('Portable launch failed:', error))
  let secondPortable: ReturnType<typeof spawn> | undefined
  let browserPids: number[] = []
  try {
    // The NSIS launcher does not relay Electron inspector stderr; attach to its actual browser.
    const started = Date.now()
    const port = await waitForDebugPort(profile, child)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    try {
      const context = browser.contexts()[0]
      // Playwright can miss the page event for a window that already existed when CDP attached, so poll instead.
      let page = context.pages()[0]
      for (const end = Date.now() + 120_000; !page && Date.now() < end; page = browser.contexts().flatMap(item => item.pages())[0]) await delay(500)
      if (!page) throw new Error('Portable EXE did not open a window within 120 seconds.')
      browserPids = await portableMainPids(profile)
      await verify(page, portable)
      console.log(`Portable startup and indexed read: ${((Date.now() - started) / 1000).toFixed(1)}s`)
      const newPage = context.waitForEvent('page', { timeout: 120_000 })
      const registeredExe = await associationExecutable(portable)
      secondPortable = spawn(registeredExe, [secondFixture], { env, stdio: 'ignore' })
      console.log(`Testing portable second-instance forwarding (launcher ${secondPortable.pid}).`)
      secondPortable.on('error', error => console.error('Portable second-instance launch failed:', error))
      const forwarded = await newPage
      await forwarded.waitForFunction(async () => {
        const result = await window.logdeck.getSessions()
        return result.ok && result.value.some(file => file.name === 'second log 世界.logcat' && file.status === 'ready')
      })
      console.log(`Portable EXE PASS: ${portable}`)
    } finally {
      for (const page of browser.contexts().flatMap(context => context.pages())) {
        void page.evaluate(() => window.close()).catch(error => {
          if (!page.isClosed() && browser.isConnected()) console.error('Test window close failed:', error)
        })
      }
      await cleanLauncher(child, browserPids)
      await browser.close()
    }
  } finally {
    if (secondPortable) await cleanLauncher(secondPortable)
    await cleanLauncher(child)
  }
} finally { await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) }
