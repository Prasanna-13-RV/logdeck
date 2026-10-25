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
