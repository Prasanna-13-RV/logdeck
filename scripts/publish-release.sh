#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
  shift
fi
[[ $# -ge 1 && $# -le 2 ]] || fail 'Usage: bash scripts/publish-release.sh [--dry-run] <version> ["commit message"]'
version="${1#v}"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail 'Use a stable version such as 1.0.0 (optional v prefix).'
tag="v$version"
message="${2:-Release LogDeck $version}"
[[ -n "${message//[[:space:]]/}" ]] || fail 'Commit message must not be blank.'

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
for command in git node npm; do
  command -v "$command" >/dev/null || fail "$command is required."
done
[[ "$(git branch --show-current)" == "main" ]] || fail 'Switch to main before publishing.'
git remote get-url origin >/dev/null || fail 'The origin remote is missing.'
if git show-ref --verify --quiet "refs/tags/$tag"; then
  fail "$tag already exists locally. Choose a new version; tags are never replaced."
fi
remote_tag="$(git ls-remote --tags origin "refs/tags/$tag")"
[[ -z "$remote_tag" ]] || fail "$tag already exists on origin. Choose a new version."
git diff --check

if "$dry_run"; then
  printf 'Dry run: no files, commits, tags or remote refs will be changed.\n'
  printf 'Version: %s\nTag: %s\nCommit: %s\n' "$version" "$tag" "$message"
  printf 'Would update package/lockfile, version.json and the website release manifest;\n'
  printf 'run unit tests, website build and website tests; stage ALL changes;\n'
  printf 'commit, push main, create an annotated tag and push that tag.\n'
  exit 0
fi

printf 'Preparing %s. ALL non-ignored changes will be staged and committed.\n' "$tag"
current="$(node -p "require('./package.json').version")"
if [[ "$current" != "$version" ]]; then
  npm version "$version" --no-git-tag-version --ignore-scripts
fi

node --input-type=module - "$version" "$message" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const [version, notes] = process.argv.slice(2)
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
save('version.json', { version, releaseNotes: notes })
const path = 'website/public/updates/windows.json'
const manifest = JSON.parse(readFileSync(path, 'utf8'))
if (manifest.latestVersion !== version) {
  // A new CI-built EXE needs its own checksum and download metadata.
  save(path, { latestVersion: version, publishedAt: new Date().toISOString(), releaseNotes: notes })
} else {
  save(path, { ...manifest, releaseNotes: notes })
}
NODE

npm test
npm run build:website
npm run test:website
git diff --check
git add .
git diff --cached --quiet && fail 'Nothing to commit. No commit, push or tag was created.'
git commit -m "$message" -m 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
git push origin main
git tag -a "$tag" -m "LogDeck $version"
git push origin "refs/tags/$tag"
printf 'Published source and tag %s. GitHub Actions will build and publish the Windows release.\n' "$tag"
