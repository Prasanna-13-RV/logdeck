import { describe, expect, it, vi } from 'vitest'
import configuration from '../../vercel.json'
import handler from '../../api/windows-release'

const base = 'https://github.com/Prasanna-13-RV/logdeck/releases/download/v1.2.3'
const release = {
  tag_name: 'v1.2.3', draft: false, prerelease: false,
  body: 'Windows release.', published_at: '2026-11-01T00:00:00.000Z',
  assets: [
    { name: 'LogDeck-1.2.3-windows-x64.exe', state: 'uploaded', size: 100_000_000,
      digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `${base}/LogDeck-1.2.3-windows-x64.exe` },
    { name: 'SHA256SUMS.txt', state: 'uploaded', browser_download_url: `${base}/SHA256SUMS.txt` }
  ]
}

describe('Vercel hosting', () => {
  it('builds from the root and keeps API/assets outside the SPA fallback', () => {
    expect(configuration.buildCommand).toBe('npm run build:website')
    expect(configuration.outputDirectory).toBe('website/dist')
    expect(configuration.build.env.VITE_ENABLE_COMPANY_TAGS).toBe('false')
    expect(configuration.rewrites[0]).toEqual({ source: '/updates/windows.json', destination: '/api/windows-release' })
    const fallback = new RegExp(`^${configuration.rewrites[1].source}$`)
    for (const path of ['/', '/features', '/download', '/admin']) expect(fallback.test(path)).toBe(true)
    for (const path of ['/api/windows-release', '/updates/windows.json', '/assets/app.js', '/favicon.ico', '/favicon.png']) expect(fallback.test(path)).toBe(false)
    expect(configuration.headers[0].headers.some(header => header.key === 'Content-Security-Policy' && header.value.includes("frame-ancestors 'none'"))).toBe(true)
  })

  it('serves verified GET/HEAD metadata and explicitly rejects invalid releases and methods', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(release)))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await handler.fetch(new Request('https://example.vercel.app/updates/windows.json'))
      expect(response.status).toBe(200)
      expect(response.headers.get('cdn-cache-control')).toContain('300')
      expect((await response.json()).downloadUrl).toBe(`${base}/LogDeck-1.2.3-windows-x64.exe`)
      const head = await handler.fetch(new Request('https://example.vercel.app/updates/windows.json', { method: 'HEAD' }))
      expect(head.status).toBe(200)
      expect(await head.text()).toBe('')
      const post = await handler.fetch(new Request('https://example.vercel.app/updates/windows.json', { method: 'POST' }))
      expect(post.status).toBe(405)
      expect(post.headers.get('allow')).toBe('GET, HEAD')
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...release, assets: [] })))
      const invalid = await handler.fetch(new Request('https://example.vercel.app/updates/windows.json'))
      expect(invalid.status).toBe(503)
      expect(invalid.headers.get('cache-control')).toBe('no-store')
      expect(log).toHaveBeenCalled()
      const failedHead = await handler.fetch(new Request('https://example.vercel.app/updates/windows.json', { method: 'HEAD' }))
      expect(failedHead.status).toBe(503)
      expect(await failedHead.text()).toBe('')
    } finally { log.mockRestore(); vi.unstubAllGlobals() }
  })
})
