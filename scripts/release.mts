import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { nextVersion, releaseLinks, releaseOptions } from './releaseHelpers.ts'
import { parseReleaseManifest, releaseConfiguration } from '../shared/releases.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const options = releaseOptions(process.argv.slice(2))
const require = createRequire(import.meta.url)
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this script through npm run release.')
const config = JSON.parse(await readFile('release.config.json', 'utf8'))
const website = releaseConfiguration(`${config.websiteUrl}/updates/windows.json`, config.websiteUrl)
if (!website) throw new Error('Configure the production website in release.config.json.')
if (process.platform !== 'win32') throw new Error('Prepare Windows releases on Windows (or use the Windows GitHub runner).')
const originalPackage = await readFile('package.json')
const originalLock = await readFile('package-lock.json')
const manifestPath = 'website/public/updates/windows.json'
const originalManifest = await readFile(manifestPath)
const pkg = JSON.parse(originalPackage.toString())
const version = options.ci ? pkg.version : nextVersion(pkg.version, options.bump)
const links = releaseLinks(config.repository, version)
const output = resolve('release', version)
try {
  await access(output)
  throw new Error(`Release ${version} already has local artifacts. Move that exact folder aside before retrying.`)
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
}
const manifest = options.ci ? parseReleaseManifest(originalManifest.toString()) : {
  latestVersion: version,
  publishedAt: new Date().toISOString(),
  releaseNotes: options.notes?.trim() || `LogDeck ${version}: portable Windows release. Download and run without an installer.`
}
if (manifest.latestVersion !== version) throw new Error('Package and committed release manifest versions differ.')
if (options.ci && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Release tag must match package.json.')
parseReleaseManifest(JSON.stringify(manifest))

function run(command: 'npm' | 'builder' | 'node', args: string[]) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const entry = command === 'npm' ? [npmCli!, ...args] : command === 'builder' ? [require.resolve('electron-builder/cli.js'), ...args] : args
  const result = spawnSync(process.execPath, entry, {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_WEBSITE_URL: website!.websiteUrl,
      VITE_UPDATE_MANIFEST_URL: website!.manifestUrl
    }
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status}, signal ${result.signal}).`)
}

let changed = false
try {
  if (!options.ci) {
    changed = true
    run('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts'])
  }
  run('npm', ['test'])
  run('npm', ['run', 'build'])
  run('builder', ['--config', 'electron-builder.config.cjs', '--win', 'portable', '--x64', '--publish', 'never', `--config.directories.output=${output}`])
  run('node', ['scripts/verify-package.mts', output, version])
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(output, links.filename))) hash.update(chunk)
  const sha256 = hash.digest('hex')
  const published = { ...manifest, downloadUrl: links.downloadUrl, checksumUrl: links.checksumUrl, sha256 }
  await writeFile(join(output, 'SHA256SUMS.txt'), `${sha256}  ${links.filename}\n`)
  await writeFile(join(output, 'windows.json'), `${JSON.stringify(published, null, 2)}\n`)
  await writeFile(join(output, 'release-notes.txt'), `${manifest.releaseNotes}\n`)
  if (!options.ci) await writeFile(manifestPath, `${JSON.stringify(published, null, 2)}\n`)
  run('npm', ['run', 'build:website'])
  console.log(`\nPrepared LogDeck ${version}: ${output}\nSHA-256: ${sha256}\nNothing was committed, tagged, pushed or uploaded.`)
  if (!options.ci) console.log(`Review changes, commit the release sources and manifest, then run:\n  git tag v${version}\n  git push origin main\n  git push origin v${version}\nThe tag workflow rebuilds, tests and publishes a GitHub Release.`)
} catch (error) {
  if (changed) {
    await writeFile('package.json', originalPackage)
    await writeFile('package-lock.json', originalLock)
    await writeFile(manifestPath, originalManifest)
    console.error('Restored the original version/manifest. Failed build artifacts, if any, remain under:', output)
  }
  throw error
}
