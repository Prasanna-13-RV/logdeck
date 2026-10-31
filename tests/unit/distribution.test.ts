import { describe, expect, it, vi } from 'vitest'
import { nextVersion, releaseLinks, releaseOptions, waitForPortablePage } from '../../scripts/releaseHelpers'
import { windowsIntegrationScript } from '../../shared/windowsIntegration'
import { githubReleaseManifest, latestGithubRelease } from '../../shared/githubRelease'
import { parseReleaseManifest } from '../../shared/releases'
import handler from '../../netlify/functions/windows-release'

const base = 'https://github.com/Prasanna-13-RV/logdeck/releases/download/v1.2.3'
const digest = 'a'.repeat(64)
const published = {
  tag_name: 'v1.2.3', draft: false, prerelease: false,
  body: 'Portable release with improved log viewing.',
  published_at: '2026-10-25T00:00:00.000Z',
  assets: [
    { name: 'LogDeck-1.2.3-windows-x64.exe', state: 'uploaded', size: 90_000_000, digest: `sha256:${digest}`, browser_download_url: `${base}/LogDeck-1.2.3-windows-x64.exe` },
    { name: 'SHA256SUMS.txt', state: 'uploaded', browser_download_url: `${base}/SHA256SUMS.txt` }
  ]
}

describe('portable distribution preparation', () => {
  it('waits for a navigated Electron renderer rather than just the browser port', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([{ type: 'page', url: 'about:blank' }, { type: 'worker', url: 'file:///out/renderer/index.html' }]))
      .mockResolvedValueOnce(Response.json([{ type: 'page', url: 'file:///C:/Temp/app/resources/app.asar/out/renderer/index.html' }]))
    vi.stubGlobal('fetch', request)
    try {
      await waitForPortablePage('http://127.0.0.1:12345', { exitCode: null, signalCode: null })
      expect(request).toHaveBeenCalledTimes(3)
      expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:12345/json/list')
      expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    } finally { vi.unstubAllGlobals() }
  })

  it('reports launcher exits and bounded startup failures with target diagnostics', async () => {
    await expect(waitForPortablePage('http://127.0.0.1:12345', { exitCode: 1, signalCode: null })).rejects.toThrow('launcher exited')
    await expect(waitForPortablePage('http://127.0.0.1:12345', { exitCode: null, signalCode: 'SIGTERM' })).rejects.toThrow('SIGTERM')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ type: 'page', url: 'about:blank' }])))
    try {
      await expect(waitForPortablePage('http://127.0.0.1:12345', { exitCode: null, signalCode: null }, 20)).rejects.toThrow('about:blank')
    } finally { vi.unstubAllGlobals() }
  })

  it('retries transient DevTools connections but fails explicitly on invalid responses', async () => {
    const request = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json([{ type: 'page', url: 'file:///C:/Temp/out/renderer/index.html' }]))
    vi.stubGlobal('fetch', request)
    const launcher = { exitCode: null, signalCode: null }
    try {
      await waitForPortablePage('http://127.0.0.1:12345', launcher)
      expect(request).toHaveBeenCalledTimes(2)
      request.mockResolvedValueOnce(new Response('', { status: 503 }))
      await expect(waitForPortablePage('http://127.0.0.1:12345', launcher)).rejects.toThrow('HTTP 503')
      request.mockResolvedValueOnce(Response.json({}))
      await expect(waitForPortablePage('http://127.0.0.1:12345', launcher)).rejects.toThrow('invalid target list')
    } finally { vi.unstubAllGlobals() }
  })

  it('bumps stable versions without git operations and validates CLI choices', () => {
    expect(nextVersion('0.1.9', 'patch')).toBe('0.1.10')
    expect(nextVersion('1.9.9', 'minor')).toBe('1.10.0')
    expect(nextVersion('1.9.9', 'major')).toBe('2.0.0')
    expect(releaseOptions([])).toEqual({ bump: 'patch', notes: undefined, ci: false })
    expect(releaseOptions(['--notes', 'Fixes', '--bump', 'minor']).notes).toBe('Fixes')
    for (const args of [['--push'], ['--bump'], ['--notes'], ['--bump', 'invalid']]) expect(() => releaseOptions(args)).toThrow()
    expect(() => nextVersion('1.0.0-beta', 'patch')).toThrow()
    expect(() => releaseLinks('invalid/repo/extra', '1.0.0')).toThrow()
    expect(releaseLinks('Prasanna-13-RV/logdeck', '1.2.3').downloadUrl).toBe(`${base}/LogDeck-1.2.3-windows-x64.exe`)
  })

  it('quotes Unicode and apostrophes in fixed per-user registry scripts without changing defaults', () => {
    const script = windowsIntegrationScript('register', "C:\\Users\\O'Brien\\世界\\LogDeck.exe")
    expect(script).toContain("O''Brien")
    expect(script).toContain('OpenWithProgids')
    expect(script).toContain('\'"\' + $exe + \'" "%1"\'')
    expect(script).not.toContain('HKEY_LOCAL_MACHINE')
    expect(script).not.toContain('UserChoice')
    const remove = windowsIntegrationScript('remove', 'C:\\Apps\\LogDeck.exe')
    expect(remove).toContain("Remove-ItemProperty -LiteralPath $key -Name 'LogDeck.LogFile'")
    expect(remove).not.toContain('Remove-Item -LiteralPath $classes')
    expect(() => windowsIntegrationScript('register', 'C:\\Apps\\evil"\n.exe')).toThrow()
  })
})

describe('published GitHub metadata boundary', () => {
  it('selects the matching public stable EXE and actual GitHub asset digest', () => {
    const manifest = githubReleaseManifest(published)
    expect(manifest.latestVersion).toBe('1.2.3')
    expect(manifest.sha256).toBe(digest)
    expect(parseReleaseManifest(JSON.stringify(manifest))).toEqual(manifest)
    for (const release of [
      { ...published, draft: true }, { ...published, prerelease: true },
      { ...published, tag_name: 'v1.2.3-beta' }, { ...published, assets: [] },
      { ...published, assets: [{ ...published.assets[0], browser_download_url: 'https://evil.example/download.exe' }, published.assets[1]] },
      { ...published, assets: [{ ...published.assets[0], digest: null }, published.assets[1]] }
    ]) expect(() => githubReleaseManifest(release)).toThrow()
    expect(() => parseReleaseManifest(JSON.stringify({ ...githubReleaseManifest(published), sha256: 'invalid' }))).toThrow()
  })

  it('bounds upstream responses, disables redirects and surfaces GitHub outages', async () => {
    const request = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://api.github.com/repos/Prasanna-13-RV/logdeck/releases/latest')
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Response.json(published)
    })
    expect((await latestGithubRelease(request)).sha256).toBe(digest)
    await expect(latestGithubRelease(vi.fn(async () => new Response('', { status: 404 })))).rejects.toThrow('404')
    await expect(latestGithubRelease(vi.fn(async () => new Response(' '.repeat(262_145))))).rejects.toThrow('too large')
  })

  it('serves cacheable same-origin metadata and never returns success during an upstream failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(published)))
    try {
      const response = await handler(new Request('https://logdeck.netlify.app/updates/windows.json'))
      expect(response.status).toBe(200)
      expect(response.headers.get('netlify-cdn-cache-control')).toContain('300')
      expect((await response.json()).latestVersion).toBe('1.2.3')
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const unavailable = await handler(new Request('https://logdeck.netlify.app/updates/windows.json'))
        expect(unavailable.status).toBe(503)
        expect(unavailable.headers.get('cache-control')).toBe('no-store')
        expect(log).toHaveBeenCalled()
      } finally { log.mockRestore() }
      expect((await handler(new Request('https://logdeck.netlify.app/updates/windows.json', { method: 'POST' }))).status).toBe(405)
    } finally { vi.unstubAllGlobals() }
  })
})
