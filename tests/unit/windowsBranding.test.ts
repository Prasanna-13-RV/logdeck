import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { windowsIntegrationScript } from '../../shared/windowsIntegration'

describe('Windows branding and associations', () => {
  it('ships a padded 256px mark and Windows icons through 256px', async () => {
    const icon = await readFile('images\\app-icon.ico')
    expect(icon.readUInt16LE(2)).toBe(1)
    const sizes = Array.from({ length: icon.readUInt16LE(4) }, (_, i) => {
      const at = 6 + i * 16
      const size = icon[at] || 256
      expect(icon[at + 1] || 256).toBe(size)
      const offset = icon.readUInt32LE(at + 12)
      expect(icon.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a')
      return size
    })
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
    const mark = await readFile('images\\brand-mark.png')
    expect([mark.readUInt32BE(16), mark.readUInt32BE(20)]).toEqual([256, 256])
  })

  it.skipIf(process.platform !== 'win32')('registers, reads and removes commands/icons in isolated per-user registry keys without changing defaults', async () => {
    const root = `HKCU:\\Software\\LogDeck.BrandingTests\\${randomUUID()}`
    const executable = "C:\\Apps\\O'Brien\\世界\\LogDeck.exe"
    const isolated = (action: 'register' | 'status' | 'remove') => windowsIntegrationScript(action, executable)
      .replaceAll('HKCU:\\Software\\Classes', `${root}\\Classes`)
      .replaceAll('HKCU:\\Software\\LogDeck\\Capabilities', `${root}\\Capabilities`)
      .replaceAll('HKCU:\\Software\\RegisteredApplications', `${root}\\RegisteredApplications`)
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = '${root}'
try {
  New-Item -Path "$root\\Classes\\.logcat" -Force | Out-Null
  Set-Item -LiteralPath "$root\\Classes\\.logcat" -Value 'Existing.Viewer'
  ${isolated('register')}
  $icon = (Get-Item -LiteralPath "$prog\\DefaultIcon").GetValue('')
  $friendly = (Get-Item -LiteralPath $application).GetValue('FriendlyAppName')
  $supported = (Get-Item -LiteralPath "$application\\SupportedTypes").GetValueNames()
  $applicationCommand = (Get-Item -LiteralPath "$application\\shell\\open\\command").GetValue('')
  $status = & { ${isolated('status')} } | ConvertFrom-Json
  ${isolated('remove')}
  @{
    command = $status; applicationCommand = $applicationCommand; icon = $icon
    friendly = $friendly; supported = $supported
    default = (Get-Item -LiteralPath "$root\\Classes\\.logcat").GetValue('')
    removed = -not (Test-Path -LiteralPath $prog) -and -not (Test-Path -LiteralPath $application)
  } | ConvertTo-Json -Compress
} finally { if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force } }
`
    const { stdout } = await promisify(execFile)('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { timeout: 20_000 })
    expect(JSON.parse(stdout)).toMatchObject({
      command: `"${executable}" "%1"`, applicationCommand: `"${executable}" "%1"`,
      icon: `"${executable}",0`, friendly: 'LogDeck', default: 'Existing.Viewer', removed: true
    })
    expect(JSON.parse(stdout).supported).toEqual(expect.arrayContaining(['.log', '.logcat']))
  }, 25_000)
})
