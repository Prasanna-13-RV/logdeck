export interface ReleaseManifest {
  latestVersion: string
  releaseNotes: string
  publishedAt: string
  downloadUrl?: string
  checksumUrl?: string
  sha256?: string
}

export interface ReleaseConfiguration {
  manifestUrl: string
  websiteUrl: string
}

export interface UpdatePageInfo {
  configured: boolean
  currentVersion: string
}

export interface UpdateCheckResult extends UpdatePageInfo, ReleaseManifest {
  updateAvailable: boolean
  checkedAt: string
}

export async function checkRelease(configuration: ReleaseConfiguration, currentVersion: string, request?: typeof fetch): Promise<UpdateCheckResult> {
  const manifest = await fetchReleaseManifest(configuration.manifestUrl, request)
  return { configured: true, currentVersion, ...manifest,
    updateAvailable: isNewerVersion(manifest.latestVersion, currentVersion), checkedAt: new Date().toISOString() }
}

export function startupReleaseCheck(configuration: ReleaseConfiguration | null, currentVersion: string, request?: typeof fetch) {
  let result: Promise<UpdateCheckResult | null> | undefined
  return () => result ??= configuration ? checkRelease(configuration, currentVersion, request) : Promise.resolve(null)
}

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function versionParts(version: string) {
  const match = versionPattern.exec(version)
  if (!match) throw new Error('Release version must follow semantic versioning (for example, 1.2.3).')
  return { numbers: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? null }
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = versionParts(candidate)
  const installed = versionParts(current)
  for (let index = 0; index < 3; index++) {
    if (next.numbers[index] !== installed.numbers[index]) return next.numbers[index] > installed.numbers[index]
  }
  if (!next.prerelease) return Boolean(installed.prerelease)
  if (!installed.prerelease) return false
  for (let index = 0; index < Math.max(next.prerelease.length, installed.prerelease.length); index++) {
    const left = next.prerelease[index]
    const right = installed.prerelease[index]
    if (left === undefined) return false
    if (right === undefined) return true
    if (left === right) continue
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) return BigInt(left) > BigInt(right)
    if (leftNumeric !== rightNumeric) return !leftNumeric
    return left > right
  }
  return false
}

export function parseReleaseManifest(raw: string): ReleaseManifest {
  if (new TextEncoder().encode(raw).length > 32_768) throw new Error('Release manifest exceeds 32 KB.')
  let value: unknown
  try { value = JSON.parse(raw) }
  catch { throw new Error('Release manifest is not valid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Release manifest must be a JSON object.')
  const data = value as Record<string, unknown>
  if (typeof data.latestVersion !== 'string') throw new Error('Release manifest is missing latestVersion.')
  versionParts(data.latestVersion)
  if (typeof data.releaseNotes !== 'string' || !data.releaseNotes.trim() || data.releaseNotes.length > 4_000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.releaseNotes)) {
    throw new Error('Release notes must contain 1-4,000 printable characters.')
  }
  if (typeof data.publishedAt !== 'string' || !Number.isFinite(Date.parse(data.publishedAt))) {
    throw new Error('Release manifest publishedAt must be a valid date.')
  }
  const manifest: ReleaseManifest = { latestVersion: data.latestVersion, releaseNotes: data.releaseNotes.trim(), publishedAt: data.publishedAt }
  if (data.downloadUrl !== undefined || data.checksumUrl !== undefined || data.sha256 !== undefined) {
    const download = secureHttpsUrl(data.downloadUrl, 'Download URL')
    const checksum = secureHttpsUrl(data.checksumUrl, 'Checksum URL')
    if (typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error('Release SHA-256 must contain 64 lowercase hexadecimal characters.')
    manifest.downloadUrl = download.href
    manifest.checksumUrl = checksum.href
    manifest.sha256 = data.sha256
  }
  return manifest
}

function secureHttpsUrl(value: unknown, label: string): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error(`${label} must be an HTTPS URL.`)
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error(`${label} must be an HTTPS URL.`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be HTTPS without credentials, query or fragment.`)
  }
  return url
}

export function releaseConfiguration(manifestUrl: unknown, websiteUrl: unknown): ReleaseConfiguration | null {
  if (!manifestUrl && !websiteUrl) return null
  const manifest = secureHttpsUrl(manifestUrl, 'Release manifest URL')
  const website = secureHttpsUrl(websiteUrl, 'Website URL')
  if (manifest.origin !== website.origin || website.pathname !== '/' ||
      !manifest.pathname.endsWith('/updates/windows.json')) {
    throw new Error('Release manifest and website must share an HTTPS origin; manifest path must end in /updates/windows.json.')
  }
  return { manifestUrl: manifest.href, websiteUrl: website.href }
}

export async function fetchReleaseManifest(url: string, request: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<ReleaseManifest> {
  const target = secureHttpsUrl(url, 'Release manifest URL')
  const response = await request(target.href, { signal: AbortSignal.timeout(10_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Release check failed (${response.status}). Try again later.`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 32_768) throw new Error('Release manifest exceeds 32 KB.')
  if (!response.body) throw new Error('Release server returned an empty response.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let output = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 32_768) { await reader.cancel(); throw new Error('Release manifest exceeds 32 KB.') }
      output += decoder.decode(chunk.value, { stream: true })
    }
    output += decoder.decode()
  } finally { reader.releaseLock() }
  return parseReleaseManifest(output)
}
