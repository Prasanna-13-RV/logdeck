import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { windowsIntegrationScript, type WindowsIntegrationInfo } from '../../shared/windowsIntegration'

const execute = promisify(execFile)

function executablePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
}

async function run(action: 'status' | 'register' | 'remove') {
  if (process.platform !== 'win32' || !app.isPackaged) throw new Error('Windows integration is available only in the packaged Windows app.')
  const executable = executablePath()
  if (!(await stat(executable)).isFile()) throw new Error('The portable EXE was moved or removed. Run it from its permanent location.')
  const script = windowsIntegrationScript(action, executable)
  const { stdout } = await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000, maxBuffer: 64_000 })
  return stdout.trim()
}

export async function windowsIntegrationInfo(): Promise<WindowsIntegrationInfo> {
  const available = process.platform === 'win32' && app.isPackaged
  if (!available) return { available, executablePath: executablePath(), registeredPath: null }
  const output = await run('status')
  const command: unknown = output ? JSON.parse(output) : null
  if (command !== null && typeof command !== 'string') throw new Error('Windows returned an invalid file association.')
  const match = typeof command === 'string' ? /^"(.+)" "%1"$/.exec(command) : null
  if (command && !match) throw new Error('The LogDeck file association was modified outside the app. Inspect Windows settings before changing it.')
  return { available, executablePath: executablePath(), registeredPath: match?.[1] ?? null }
}

export async function changeWindowsIntegration(action: 'register' | 'remove') {
  await run(action)
  return windowsIntegrationInfo()
}
