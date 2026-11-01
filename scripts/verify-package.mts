import { _electron as electron, type Page } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { releaseLinks } from './releaseHelpers.ts'
import { windowsIntegrationScript } from '../shared/windowsIntegration.ts'

const directory = resolve(process.argv[2])
const version = process.argv[3]
const checkVersionFile = process.argv.slice(4).includes('--check-version-file')
const { filename } = releaseLinks('Prasanna-13-RV/logdeck', version)
const installer = join(directory, filename)
assert((await stat(installer)).size > 1_000_000, 'Windows setup EXE must exist.')
const execute = promisify(execFile)
async function powershell(script: string) {
  const { stdout } = await execute('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, 'utf16le').toString('base64')
  ], { timeout: 180_000 })
  return stdout.trim()
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const registry = `
$entries = @()
foreach ($root in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
  if (Test-Path -LiteralPath $root) {
    $entries += @(Get-ChildItem -LiteralPath $root | Get-ItemProperty | Where-Object { $_.DisplayName -match '^LogDeck(?:\\s|$)' })
  }
}`
await powershell(`${registry}
if ($entries.Count) { throw 'Existing LogDeck installation detected. Verification will not change it. Use a clean Windows runner.' }
if (Test-Path -LiteralPath 'HKCU:\\Software\\Classes\\LogDeck.LogFile') { throw 'Existing LogDeck file associations detected. Use a clean Windows runner.' }
if (Test-Path -LiteralPath 'HKCU:\\Software\\Classes\\Applications\\LogDeck.exe') { throw 'Existing LogDeck application registration detected. Use a clean Windows runner.' }
if (Test-Path -LiteralPath 'HKCU:\\Software\\LogDeck\\Capabilities') { throw 'Existing LogDeck capabilities detected. Use a clean Windows runner.' }
if ((Test-Path -LiteralPath 'HKCU:\\Software\\RegisteredApplications') -and ((Get-Item -LiteralPath 'HKCU:\\Software\\RegisteredApplications').GetValueNames() -contains 'LogDeck')) { throw 'Existing LogDeck RegisteredApplications entry detected. Use a clean Windows runner.' }
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
  if ($folder -and (Test-Path -LiteralPath (Join-Path $folder 'LogDeck.lnk'))) { throw 'Existing LogDeck shortcut detected. Use a clean Windows runner.' }
}`)

const temporary = await mkdtemp(join(tmpdir(), 'logdeck-installer-check-'))
const installDirectory = join(temporary, 'installed')
const installedExecutable = join(installDirectory, 'LogDeck.exe')
const uninstallExecutable = join(installDirectory, 'Uninstall LogDeck.exe')
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
env.LOGDECK_TEST_USER_DATA = join(temporary, 'profile')
await mkdir(env.LOGDECK_TEST_USER_DATA)
const preferences = join(env.LOGDECK_TEST_USER_DATA, 'preservation-check.txt')
await writeFile(preferences, 'Keep existing preferences.\n')
delete env.ELECTRON_RUN_AS_NODE
delete env.PORTABLE_EXECUTABLE_FILE
const fixture = join(temporary, 'threadtime.log')
const content = '10-25 12:00:00.123  123  456 I LogDeck: Synthetic packaged release verification\n'
const secondFixture = join(temporary, 'second log 世界.logcat')
await writeFile(fixture, content)
await writeFile(secondFixture, content)

async function verify(page: Page, executable: string) {
  await page.waitForFunction(() => Boolean(window.logdeck))
  const info = await page.evaluate(() => window.logdeck.updatePageInfo())
  assert(info.ok && info.value.currentVersion === version, 'Packaged version must match the release.')
  assert(info.value.configured, 'GitHub version checker must be configured.')
  const { stdout } = await execute('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/verify-windows-branding.ps1'),
    '-Executable', executable, '-Icon', resolve('images/app-icon.ico')
  ], { timeout: 20_000 })
  console.log(stdout.trim())
  if (checkVersionFile) {
    const checked = await page.evaluate(() => window.logdeck.startupUpdateCheck())
    assert(checked.ok && checked.value?.currentVersion === version, 'Packaged GitHub version check must work.')
  }
  await page.waitForFunction(async () => {
    const sources = await window.logdeck.getSessions()
    return sources.ok && sources.value.some(source => source.name === 'threadtime.log' && source.status === 'ready')
  })
  const rows = await page.evaluate(async () => {
    const sources = await window.logdeck.getSessions()
    if (!sources.ok || !sources.value[0]) throw new Error('No packaged file session.')
    return window.logdeck.readRange({ id: sources.value[0].id, start: 1, count: 1 })
  })
  assert(rows.ok && rows.value[0]?.message.includes('Synthetic packaged release verification'), 'Packaged SQLite worker must read indexed records.')
  const integration = await page.evaluate(() => window.logdeck.windowsIntegrationInfo())
  assert(integration.ok && integration.value.available, 'Packaged Windows integration must be available.')
  assert.equal(integration.value.executablePath.toLowerCase(), executable.toLowerCase(), 'Open with must target the installed app, not setup.')
}

let installationAttempted = false
let verifiedUninstall = false
try {
  installationAttempted = true
  await execute(installer, ['/S', `/D=${installDirectory}`], { timeout: 180_000 })
  await stat(installedExecutable)
  await powershell(`${registry}
if ($entries.Count -ne 1) { throw 'Expected one Installed apps entry.' }
$entry = $entries[0]
if ($entry.DisplayVersion -ne ${literal(version)}) { throw 'Installed version is incorrect.' }
if ($entry.UninstallString -notlike ('*' + ${literal(uninstallExecutable)} + '*')) { throw 'Uninstall command does not target the test installation.' }
if ($entry.DisplayIcon -notlike ('*' + ${literal(installDirectory)} + '*')) { throw 'Installed apps icon is missing.' }
if (!(Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'LogDeck.lnk'))) { throw 'Start menu shortcut is missing.' }`)
  console.log(`Installed apps entry PASS: LogDeck ${version}`)
  for (const mode of ['first', 'repeat']) {
    const started = performance.now()
    const desktop = await electron.launch({ executablePath: installedExecutable, args: [fixture], env, timeout: 90_000 })
    try {
      const page = await desktop.firstWindow()
      await verify(page, installedExecutable)
      assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.getTitle() === 'LogDeck is starting')), false)
      if (mode === 'first') {
        const nextWindow = desktop.waitForEvent('window', { timeout: 30_000 })
        const child = spawn(installedExecutable, [secondFixture], { env, stdio: 'ignore' })
        child.on('error', error => console.error('Second-instance launch failed:', error))
        const forwarded = await nextWindow
        await forwarded.waitForFunction(async () => {
          const sources = await window.logdeck.getSessions()
          return sources.ok && sources.value.some(source => source.name === 'second log 世界.logcat' && source.status === 'ready')
        })
      }
      console.log(`Installed ${mode} launch PASS (${((performance.now() - started) / 1000).toFixed(1)}s including runtime checks): ${installedExecutable}`)
    } finally { await desktop.close() }
  }
  assert.equal(await readFile(fixture, 'utf8'), content)
  await powershell(windowsIntegrationScript('register', installedExecutable))
  await execute(uninstallExecutable, ['/S', `_?=${installDirectory}`], { timeout: 180_000 })
  await powershell(`${registry}
if ($entries.Count) { throw 'Installed apps entry was not removed.' }
if (Test-Path -LiteralPath ${literal(installedExecutable)}) { throw 'Installed runtime was not removed.' }
foreach ($key in @('HKCU:\\Software\\Classes\\LogDeck.LogFile', 'HKCU:\\Software\\Classes\\Applications\\LogDeck.exe', 'HKCU:\\Software\\LogDeck\\Capabilities')) {
  if (Test-Path -LiteralPath $key) { throw ('Owned Open with registration was not removed: ' + $key) }
}
if ((Test-Path -LiteralPath 'HKCU:\\Software\\RegisteredApplications') -and ((Get-Item -LiteralPath 'HKCU:\\Software\\RegisteredApplications').GetValueNames() -contains 'LogDeck')) { throw 'RegisteredApplications entry was not removed.' }
foreach ($ext in @('.log', '.logcat')) {
  $key = 'HKCU:\\Software\\Classes\\' + $ext + '\\OpenWithProgids'
  if ((Test-Path -LiteralPath $key) -and ((Get-Item -LiteralPath $key).GetValueNames() -contains 'LogDeck.LogFile')) { throw 'OpenWithProgids entry was not removed.' }
}
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if (Test-Path -LiteralPath (Join-Path $folder 'LogDeck.lnk')) { throw 'Installed shortcut was not removed.' }
}`)
  verifiedUninstall = true
  assert.equal(await readFile(fixture, 'utf8'), content, 'Uninstall must preserve external log files.')
  assert.equal(await readFile(preferences, 'utf8'), 'Keep existing preferences.\n', 'Uninstall must preserve user data.')
  console.log('Uninstall, association cleanup, log and user-data preservation PASS.')
} finally {
  if (installationAttempted && !verifiedUninstall) {
    // Only this verifier's explicitly selected installation may be removed.
    try {
      await stat(uninstallExecutable)
      await execute(uninstallExecutable, ['/S', `_?=${installDirectory}`], { timeout: 180_000 })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      console.error('Installation did not create an uninstaller; checking for incomplete registration.')
    }
    await powershell(`${registry}
if (@($entries | Where-Object { $_.UninstallString -like ('*' + ${literal(installDirectory)} + '*') }).Count) { throw 'Test installation cleanup failed; registration remains. Test files retained for diagnosis.' }`)
  }
  await rm(temporary, { recursive: true, force: true })
}
