import { parseReleaseManifest, type ReleaseManifest } from './releases'
import configuration from '../release.config.json'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub returned invalid release data.')
  return value as Record<string, unknown>
}

export function githubReleaseManifest(value: unknown): ReleaseManifest {
  const release = record(value)
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' ||
      !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name) || !Array.isArray(release.assets)) {
    throw new Error('A published stable GitHub release is required.')
  }
  const version = release.tag_name.slice(1)
  const filename = `LogDeck-${version}-windows-x64.exe`
  const assets = release.assets.map(record)
  const executable = assets.find(asset => asset.name === filename && asset.state === 'uploaded')
  const checksum = assets.find(asset => asset.name === 'SHA256SUMS.txt' && asset.state === 'uploaded')
  if (!executable || !checksum || typeof executable.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(executable.digest) ||
      typeof executable.size !== 'number' || executable.size < 1_000_000) {
    throw new Error('The GitHub release is missing a complete portable EXE, digest or checksum asset.')
  }
  const base = `https://github.com/${configuration.repository}/releases/download/${release.tag_name}`
  if (executable.browser_download_url !== `${base}/${filename}` || checksum.browser_download_url !== `${base}/SHA256SUMS.txt`) {
    throw new Error('GitHub release assets do not match the official repository.')
  }
  return parseReleaseManifest(JSON.stringify({
    latestVersion: version, publishedAt: release.published_at, releaseNotes: release.body,
    downloadUrl: executable.browser_download_url, checksumUrl: checksum.browser_download_url,
    sha256: executable.digest.slice(7)
  }))
}

export async function latestGithubRelease(request: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<ReleaseManifest> {
  const response = await request(`https://api.github.com/repos/${configuration.repository}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'LogDeck-release-metadata' },
    signal: AbortSignal.timeout(8000), redirect: 'error'
  })
  if (!response.ok) throw new Error(`GitHub release information is unavailable (${response.status}).`)
  if (!response.body || Number(response.headers.get('content-length')) > 262_144) throw new Error('GitHub release response is empty or too large.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > 262_144) { await reader.cancel(); throw new Error('GitHub release response is too large.') }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return githubReleaseManifest(JSON.parse(new TextDecoder().decode(bytes)))
}
