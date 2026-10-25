import { describe, expect, it, vi } from 'vitest'
import { checkRelease, fetchReleaseManifest, isNewerVersion, parseReleaseManifest, releaseConfiguration, startupReleaseCheck } from '../../shared/releases'

const manifest = {
  latestVersion: '1.2.0',
  publishedAt: '2026-10-25T08:00:00.000Z',
  releaseNotes: 'Performance improvements and release notes.'
}

describe('desktop release information', () => {
  it('checks once per startup across concurrent windows and allows explicit retries', async () => {
    const configuration = { manifestUrl: 'https://logdeck.example/updates/windows.json', websiteUrl: 'https://logdeck.example/' }
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(manifest)))
    const startup = startupReleaseCheck(configuration, '1.1.0', request)
    const [first, second] = await Promise.all([startup(), startup()])
    expect(first).toEqual(second)
    expect(first?.updateAvailable).toBe(true)
    expect(first?.currentVersion).toBe('1.1.0')
    await startup()
    expect(request).toHaveBeenCalledTimes(1)
    await checkRelease(configuration, '1.2.0', request)
    expect(request).toHaveBeenCalledTimes(2)
    const unavailable = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }))
    const failed = startupReleaseCheck(configuration, '1.1.0', unavailable)
    await expect(failed()).rejects.toThrow('503')
    await expect(failed()).rejects.toThrow('503')
    expect(unavailable).toHaveBeenCalledTimes(1)
    const unconfigured = startupReleaseCheck(null, '1.1.0', request)
    expect(await unconfigured()).toBeNull()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('compares semantic versions, including stable and prerelease precedence', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true)
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false)
    expect(isNewerVersion('1.2.0-beta.11', '1.2.0-beta.2')).toBe(true)
    expect(isNewerVersion('1.2.0-beta.2', '1.2.0-beta.11')).toBe(false)
    expect(isNewerVersion('1.2.0', '1.2.0-rc.1')).toBe(true)
    expect(isNewerVersion('1.2.0-rc.1', '1.2.0')).toBe(false)
    expect(isNewerVersion('1.2.0+build.5', '1.2.0+build.1')).toBe(false)
    expect(() => isNewerVersion('1.02.0', '1.0.0')).toThrow('semantic versioning')
  })

  it('validates manifest fields and bounded printable notes', () => {
    expect(parseReleaseManifest(JSON.stringify(manifest))).toEqual(manifest)
    for (const value of [
      { ...manifest, latestVersion: 'not-a-version' },
      { ...manifest, releaseNotes: '' },
      { ...manifest, releaseNotes: 'invalid\u0000notes' },
      { ...manifest, publishedAt: 'no-date' }
    ]) expect(() => parseReleaseManifest(JSON.stringify(value))).toThrow()
    expect(parseReleaseManifest(JSON.stringify({ ...manifest, unexpected: 'ignored' }))).toEqual(manifest)
    expect(() => parseReleaseManifest(' '.repeat(32_769))).toThrow('32 KB')
  })

  it('requires a same-origin HTTPS manifest and official website URL', () => {
    expect(releaseConfiguration('', '')).toBeNull()
    expect(releaseConfiguration('https://logdeck.example/updates/windows.json', 'https://logdeck.example')).toEqual({
      manifestUrl: 'https://logdeck.example/updates/windows.json',
      websiteUrl: 'https://logdeck.example/'
    })
    for (const [manifestUrl, websiteUrl] of [
      ['http://logdeck.example/updates/windows.json', 'https://logdeck.example'],
      ['https://evil.example/updates/windows.json', 'https://logdeck.example'],
      ['https://logdeck.example/updates/windows.json?token=x', 'https://logdeck.example'],
      ['https://logdeck.example/other.json', 'https://logdeck.example'],
      ['https://logdeck.example/updates/windows.json', 'https://user:password@logdeck.example']
    ]) expect(() => releaseConfiguration(manifestUrl, websiteUrl)).toThrow()
    expect(() => releaseConfiguration('https://logdeck.example/updates/windows.json', '')).toThrow()
  })

  it('fetches a bounded manifest with redirects disabled and propagates unavailable responses', async () => {
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe('error')
      return new Response(JSON.stringify(manifest), { status: 200 })
    })
    expect(await fetchReleaseManifest('https://logdeck.example/updates/windows.json', request)).toEqual(manifest)
    expect(request).toHaveBeenCalledTimes(1)
    await expect(fetchReleaseManifest('https://logdeck.example/updates/windows.json', vi.fn(async () =>
      new Response('Unavailable', { status: 503 })))).rejects.toThrow('503')
    await expect(fetchReleaseManifest('https://logdeck.example/updates/windows.json', vi.fn(async () =>
      new Response(' '.repeat(32_769))))).rejects.toThrow('32 KB')
  })
})
