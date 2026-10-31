import { fetchReleaseText, isNewerVersion, type UpdateCheckResult } from './releases'

export interface GitHubVersionConfiguration {
  owner: string
  repository: string
  branch: string
}

export function githubVersionUrl({ owner, repository, branch }: GitHubVersionConfiguration): string {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner) ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(repository) || repository === '.' || repository === '..' ||
      !branch || branch.length > 255 || branch.startsWith('/') || branch.endsWith('/') ||
      branch.split('/').some(part => !part || part === '.' || part === '..') ||
      /[\s~^:?*[\]\\#%]/.test(branch)) {
    throw new Error('Configure a valid GitHub owner, repository and branch in version-check.config.json.')
  }
  return `https://raw.githubusercontent.com/${owner}/${repository}/${branch.split('/').map(encodeURIComponent).join('/')}/version.json`
}

export function parseGitHubVersion(raw: string): { version: string; releaseNotes: string } {
  if (new TextEncoder().encode(raw).length > 32_768) throw new Error('GitHub version file exceeds 32 KB.')
  let value: unknown
  try { value = JSON.parse(raw) }
  catch { throw new Error('GitHub version file is not valid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub version file must be an object.')
  const data = value as Record<string, unknown>
  if (typeof data.version !== 'string' || data.version.length > 128) throw new Error('GitHub version file is missing a valid version.')
  isNewerVersion(data.version, data.version)
  if (data.releaseNotes !== undefined && (typeof data.releaseNotes !== 'string' ||
      data.releaseNotes.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.releaseNotes))) {
    throw new Error('GitHub releaseNotes must be printable text of at most 4,000 characters.')
  }
  return { version: data.version, releaseNotes: typeof data.releaseNotes === 'string' ? data.releaseNotes.trim() : '' }
}

export async function checkGitHubVersion(configuration: GitHubVersionConfiguration, currentVersion: string, request?: typeof fetch): Promise<UpdateCheckResult> {
  let manifest: ReturnType<typeof parseGitHubVersion>
  try { manifest = parseGitHubVersion(await fetchReleaseText(githubVersionUrl(configuration), request)) }
  catch (failure) {
    if (failure instanceof Error && failure.message.includes('Release check failed (404)')) {
      throw new Error('GitHub version.json was not found (404). Confirm the public repository, configured branch, and published file path.')
    }
    throw failure
  }
  return {
    configured: true, currentVersion, latestVersion: manifest.version, releaseNotes: manifest.releaseNotes,
    updateAvailable: isNewerVersion(manifest.version, currentVersion), checkedAt: new Date().toISOString()
  }
}

export function startupGitHubVersionCheck(configuration: GitHubVersionConfiguration, currentVersion: string, request?: typeof fetch) {
  let result: Promise<UpdateCheckResult> | undefined
  return () => result ??= checkGitHubVersion(configuration, currentVersion, request)
}
