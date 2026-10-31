import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkGitHubVersion, githubVersionUrl, parseGitHubVersion, startupGitHubVersionCheck } from '../../shared/githubVersion'
import configuration from '../../version-check.config.json'
import manifest from '../../version.json'
import { version } from '../../package.json'

afterEach(() => vi.useRealTimers())

describe('GitHub desktop version checks', () => {
  it('ships valid metadata and builds the configured raw GitHub URL', () => {
    expect(parseGitHubVersion(JSON.stringify(manifest))).toEqual(manifest)
    expect(githubVersionUrl(configuration)).toBe('https://raw.githubusercontent.com/Prasanna-13-RV/logdeck/main/version.json')
    expect(githubVersionUrl({ ...configuration, branch: 'release/stable' })).toContain('/release/stable/version.json')
    for (const override of [
      { owner: '' }, { repository: '..' }, { repository: 'bad/repo' }, { branch: '../main' },
      { branch: '' }, { branch: 'main?token=x' }, { branch: 'main#fragment' }
    ]) expect(() => githubVersionUrl({ ...configuration, ...override })).toThrow('Configure')
  })

  it.each([
    ['1.2.0', '1.2.0', false],
    ['1.10.0', '1.2.0', true],
    ['1.2.0', '1.10.0', false],
    ['2.0.0', '1.99.99', true],
    ['1.0.0-beta.11', '1.0.0-beta.2', true],
    ['1.0.0', '1.0.0-rc.1', true],
    ['1.0.0+build.2', '1.0.0+build.1', false],
    ['9007199254740993.0.0', '9007199254740992.0.0', true]
  ])('compares GitHub %s against installed %s', async (latest, installed, available) => {
    const request = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(githubVersionUrl(configuration))
      expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Response.json({ version: latest, releaseNotes: 'Fixes\nand improvements' })
    })
    expect(await checkGitHubVersion(configuration, installed, request)).toMatchObject({
      currentVersion: installed, latestVersion: latest, updateAvailable: available, releaseNotes: 'Fixes\nand improvements'
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('accepts absent notes and rejects invalid JSON, missing fields and malformed versions', () => {
    expect(parseGitHubVersion('{"version":"1.2.0"}')).toEqual({ version: '1.2.0', releaseNotes: '' })
    for (const raw of [
      '<html>not JSON</html>', 'null', '[]', '{}',
      ...['v1.2.0', '1.2', '1.02.0', '1.2.0\n', '1.2.0-beta.01', 'bad', 12].map(version => JSON.stringify({ version })),
      JSON.stringify({ version: '1.2.0', releaseNotes: 12 }),
      JSON.stringify({ version: '1.2.0', releaseNotes: 'bad\u0000notes' }),
      JSON.stringify({ version: '1.2.0', releaseNotes: 'x'.repeat(4_001) }),
      ' '.repeat(32_769)
    ]) expect(() => parseGitHubVersion(raw)).toThrow()
  })

  it('propagates network, HTTP, body-size, missing-body and JSON errors, never an available result', async () => {
    for (const status of [403, 404, 500, 503]) {
      await expect(checkGitHubVersion(configuration, version, async () => new Response('', { status }))).rejects.toThrow(String(status))
    }
    await expect(checkGitHubVersion(configuration, version, async () => new Response('', { status: 404 })))
      .rejects.toThrow('Confirm the public repository, configured branch, and published file path.')
    await expect(checkGitHubVersion(configuration, version, async () => { throw new TypeError('offline') })).rejects.toThrow('offline')
    await expect(checkGitHubVersion(configuration, version, async () => new Response('invalid'))).rejects.toThrow('valid JSON')
    await expect(checkGitHubVersion(configuration, version, async () => new Response(null))).rejects.toThrow('empty')
    await expect(checkGitHubVersion(configuration, version, async () => new Response(' '.repeat(32_769)))).rejects.toThrow('32 KB')
    await expect(checkGitHubVersion(configuration, version, async () =>
      new Response('{}', { headers: { 'content-length': '32769' } }))).rejects.toThrow('32 KB')
  })

  it('passes a 10-second abort deadline through the HTTP request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), milliseconds)
      return controller.signal
    })
    try {
      const request = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      }))
      const check = checkGitHubVersion(configuration, version, request)
      const assertion = expect(check).rejects.toThrow('timed out')
      expect(deadline).toHaveBeenCalledWith(10_000)
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally { deadline.mockRestore() }
  })

  it('shares one startup request across concurrent callers and caches successes and failures', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ version: '1.10.0' }))
    const startup = startupGitHubVersionCheck(configuration, '1.2.0', request)
    expect(startup()).toBe(startup())
    const [first, second] = await Promise.all([startup(), startup()])
    expect(first).toEqual(second)
    expect(first.updateAvailable).toBe(true)
    await startup()
    expect(request).toHaveBeenCalledTimes(1)
    const offline = vi.fn<typeof fetch>(async () => { throw new Error('offline') })
    const failed = startupGitHubVersionCheck(configuration, version, offline)
    await expect(failed()).rejects.toThrow('offline')
    await expect(failed()).rejects.toThrow('offline')
    expect(offline).toHaveBeenCalledTimes(1)
    await checkGitHubVersion(configuration, version, request)
    expect(request).toHaveBeenCalledTimes(2)
  })
})
