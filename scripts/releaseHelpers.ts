import type { ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export async function waitForPortablePage(endpoint: string, launcher: Pick<ChildProcess, 'exitCode' | 'signalCode'>, timeout = 120_000) {
  const end = Date.now() + timeout
  let diagnostic = 'No DevTools targets returned.'
  while (Date.now() < end) {
    if (launcher.exitCode !== null || launcher.signalCode !== null) {
      throw new Error(`Portable launcher exited (exit ${launcher.exitCode}, signal ${launcher.signalCode}) before its window was ready.`)
    }
    try {
      const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(Math.min(5000, Math.max(1, end - Date.now()))) })
      if (!response.ok) throw new Error(`Portable DevTools returned HTTP ${response.status}.`)
      const targets: unknown = await response.json()
      if (!Array.isArray(targets)) throw new Error('Portable DevTools returned an invalid target list.')
      // Electron exposes the browser port before its BrowserWindow has a renderer.
      // Attaching Playwright to that initial target can permanently lose the page.
      if (targets.some((target: unknown) => typeof target === 'object' && target !== null &&
        'type' in target && target.type === 'page' && 'url' in target && typeof target.url === 'string' &&
        target.url.startsWith('file:') && target.url.endsWith('/out/renderer/index.html'))) return
      diagnostic = `DevTools targets: ${JSON.stringify(targets)}`
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof Error && error.name === 'TimeoutError')) throw error
      diagnostic = `DevTools request failed: ${error.message}`
    }
    await delay(Math.max(0, Math.min(200, end - Date.now())))
  }
  throw new Error(`Portable EXE did not load its window within ${timeout / 1000} seconds. ${diagnostic}`)
}

export function nextVersion(current: string, bump: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(current)) throw new Error('Releases require a stable semantic version.')
  const parts = current.split('.').map(Number)
  if (parts.some(value => !Number.isSafeInteger(value))) throw new Error('Version components are too large.')
  const index = ['major', 'minor', 'patch'].indexOf(bump)
  if (index < 0) throw new Error('Choose patch, minor or major.')
  parts[index]++
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0
  return parts.join('.')
}

export function releaseLinks(repository: string, version: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release repository or version.')
  const filename = `LogDeck-${version}-windows-x64.exe`
  const base = `https://github.com/${repository}/releases/download/v${version}`
  return { filename, downloadUrl: `${base}/${filename}`, checksumUrl: `${base}/SHA256SUMS.txt` }
}

export function releaseOptions(args: string[]) {
  let bump = 'patch'
  let notes: string | undefined
  let ci = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ci') ci = true
    else if (args[i] === '--bump') bump = args[++i]
    else if (args[i] === '--notes') notes = args[++i]
    else throw new Error(`Unknown release option: ${args[i]}`)
  }
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('--bump requires patch, minor or major.')
  if (args.includes('--notes') && (!notes?.trim() || notes.length > 4000)) throw new Error('--notes requires 1-4,000 characters.')
  return { bump, notes, ci }
}
