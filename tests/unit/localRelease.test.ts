import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { localReleaseMiddleware } from '../../website/vite.config.mts'

it('local Vite release routing overrides the static snapshot but preserves other routes', async () => {
  const network = globalThis.fetch
  const base = 'https://github.com/Prasanna-13-RV/logdeck/releases/download/v1.0.1'
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    tag_name: 'v1.0.1', draft: false, prerelease: false, body: 'Release LogDeck 1.0.1',
    published_at: '2026-11-01T10:31:35.134Z', assets: [
      { name: 'LogDeck-1.0.1-windows-x64.exe', state: 'uploaded', size: 100_000_000,
        digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `${base}/LogDeck-1.0.1-windows-x64.exe` },
      { name: 'SHA256SUMS.txt', state: 'uploaded', browser_download_url: `${base}/SHA256SUMS.txt` }
    ]
  })))
  const server = createServer((request, response) => localReleaseMiddleware(request, response, () => response.end('Other route')))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const response = await network(`${url}/updates/windows.json?test=1`)
    expect(response.status).toBe(200)
    expect((await response.json()).downloadUrl).toBe(`${base}/LogDeck-1.0.1-windows-x64.exe`)
    expect(await (await network(`${url}/features`)).text()).toBe('Other route')
    expect((await network(`${url}/updates/windows.json`, { method: 'POST' })).status).toBe(405)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllGlobals()
  }
})
