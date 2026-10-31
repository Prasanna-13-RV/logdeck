# GitHub version notifications

## Architecture and changed files

LogDeck is an Electron + React **TypeScript** project. Its entry points are
`src/main/index.ts`, `src/preload/index.ts`, and `src/renderer/src/main.tsx`
with `App.tsx`. The current electron-builder configuration produces a portable
Windows x64 EXE, **not an installer**. This feature does not change that target.

- `version.json`: public remote version and optional release notes.
- `version-check.config.json`: GitHub owner, repository and branch.
- `electron.vite.config.ts`: embeds that configuration in the main-process bundle.
- `shared/githubVersion.ts`: URL construction, JSON validation and cached startup check.
- `shared/releases.ts`: reused bounded HTTP fetch and numeric semantic-version comparison.
- `src/main/index.ts`: uses `app.getVersion()` and existing dedicated update IPC.
- `src/renderer/src/components/UpdateNotice.jsx`: reusable, dismissible notification.
- `src/renderer/src/App.tsx`: asynchronous startup request and notice integration.
- `src/renderer/src/components/UpdatePage.tsx`: existing manual check/diagnostics page.
- `src/renderer/src/styles.css`: existing theme-compatible notice styling.
- `tsconfig.json`: allows the requested JSX component; JSDoc plus `@ts-check`
  preserves its prop checking.
- `scripts/verify-package.mts`: optional real-network packaged EXE check.
- `tests/unit/githubVersion.test.ts` and `tests/desktop/releaseUpdates.spec.ts`:
  parser, comparison, request, IPC and notification regressions.

No dependency, package-version, build-script or packaging-target change is
required. The existing preload already exposes only dedicated functions through
`contextBridge`: `startupUpdateCheck()`, `checkForUpdates()` and `updatePageInfo()`.
No generic IPC sender, Node API, remote URL argument or filesystem access was added.
`contextIsolation: true`, `nodeIntegration: false` and sandboxing remain enabled.

## GitHub setup

Commit the root `version.json` to the configured branch:

```json
{
  "version": "0.1.1",
  "releaseNotes": "LogDeck desktop release."
}
```

The initial value matches the current `package.json`; do not advertise `1.2.0`
unless that version is actually available. Versions use `MAJOR.MINOR.PATCH`
semantic versioning, without a `v` prefix. Numeric segments compare numerically:
`1.10.0` is newer than `1.2.0`. Prerelease/build suffixes are supported.
`releaseNotes` may be omitted or empty; if provided it must be a string of at most
4,000 printable characters. Notes are rendered as text, never as HTML.

Configuration:

```json
{
  "owner": "Prasanna-13-RV",
  "repository": "logdeck",
  "branch": "main"
}
```

This constructs:

```text
https://raw.githubusercontent.com/Prasanna-13-RV/logdeck/main/version.json
```

General format:
`https://raw.githubusercontent.com/GITHUB_USERNAME/GITHUB_REPOSITORY/BRANCH/version.json`.
The repository/file must be publicly accessible without authentication. Do not add
a token to the URL, the renderer, or the shipped application. This JSON is public
metadata, unrelated to the website's company-tag JSON or Firebase credentials.
Changing the configured repository/branch requires rebuilding and redistributing
the app; changing the contents of the remote version file does not.

## Startup and failure behavior

React invokes the existing `updates:startup` handler through preload.
The main process fetches the fixed GitHub URL using a 10-second abort deadline,
redirects disabled, no-store request caching and a 32 KB response limit.
It validates the JSON, required version and optional notes before comparing.
The installed version always comes from Electron `app.getVersion()`, backed by
the packaged `package.json`; React has no hardcoded installed version.

One promise is shared across startup calls, React StrictMode, renderer reloads and
multiple windows in the same main-process lifetime. Successes and failures are both
cached. A new app launch checks again; an explicit check in Updates is retryable.
GitHub/CDN propagation can still delay newly committed content briefly.

The home/log viewer is not blocked while the request is pending. Equal/older
remote versions display no startup notification. Offline, timeout, HTTP, missing
file, invalid JSON and validation failures also display **no update notification**.
They are logged as warnings and available as errors in the Updates page, not
converted into a fake successful result.

Only a successful newer version displays installed version, latest version,
optional notes and a dismiss button. Nothing downloads, runs, installs or replaces
an EXE. The existing manually opened official download-page link remains in
Updates when website configuration is available.

The website is unchanged: Netlify, its release-metadata function, company-tag
administration and existing download distribution still work as before. The
desktop no longer uses the website manifest to decide whether an update exists.

## Run, build and test

From the repository root on Windows:

```powershell
npm.cmd run dev
npm.cmd run build
npm.cmd start
npm.cmd test
npm.cmd run test:desktop -- releaseUpdates.spec.ts
```

Use separate terminals for the development server and other commands. `build`
type-checks and compiles the main/preload/renderer bundles; it does not package
an EXE. No additional npm packages are needed.

For the existing full Windows release preparation:

```powershell
npm.cmd run release -- --notes "Bug fixes and improvements"
```

This existing command increments the package version by default, runs tests,
builds, packages and smoke-tests the EXE, and prepares the website metadata. It
does not upload or commit anything. **It does not update root `version.json`**:
publish that file deliberately when the corresponding binary is ready, so users
are not notified about an unavailable release.

## Publishing future versions

1. Update the version in `package.json` and its lockfile (for example,
   `npm.cmd version 0.1.2 --no-git-tag-version`), then build and test the Windows
   application. Alternatively use the existing release command, which performs
   its own version bump; do not bump twice.
2. Prepare the new root `version.json` with exactly the built version and release
   notes. Keep it staged/unpublished until the new binary is ready to download.
3. Distribute the tested EXE through the existing website/GitHub Releases/download
   channel. Then commit/push the version JSON to the configured branch. If using
   the tag workflow, wait for successful release publication before advertising it
   in root `version.json`. The website's separate `windows.json` is still maintained
   by the existing release workflow.
4. Confirm the raw GitHub URL returns the expected JSON, not a GitHub HTML page.
5. Existing installations **containing this checker and its configured URL** detect
   the newer version on their next app launch. Already-running instances do not poll.

Older EXEs without this implementation (or builds still using the previous website
checker) cannot acquire it just by adding `version.json`. Users must first manually
install/run a build containing this implementation.

## Packaged Windows verification and test plan

The normal release smoke test already checks the packaged version through the
real IPC bridge, SQLite and file opening in both the extracted runtime and the
outer portable EXE. After the GitHub file has been published, also run:

```powershell
# Replace 0.1.2 with the actual built version and output folder.
node scripts\verify-package.mts release\0.1.2 0.1.2 --check-version-file
```

The flag additionally requires a successful **real GitHub request from each packaged
app**, validates its returned installed version, and prints installed/remote
versions. HTTP or network failures fail the smoke test explicitly. It does not
publish, download another EXE, or change Windows associations.
The release script's default smoke test stays offline-tolerant because the new
GitHub file might not have been published yet.

For manual testing, use a public **test repository/branch** configured in a test
build. Never advertise fictitious high versions on the production branch.

| Scenario | Test file / action | Expected |
|---|---|---|
| Identical versions | Unit test; publish the installed version in test JSON | No startup notice |
| Newer GitHub version | Unit test (`1.10.0` vs `1.2.0`); launch test EXE against higher version | Notice shows both versions and notes; dismiss works |
| Installed version newer | Unit test; publish a lower test version | No startup notice |
| No internet | Unit test rejects fetch; disable network before launching test EXE | Logs still work, no notice; Updates shows an error |
| Timeout | Unit test aborts at 10 seconds; delay/block the test request | No notice and no blocked startup |
| Invalid JSON, missing version, malformed version | Unit validation; publish malformed test data | No notice; explicit diagnostic |
| HTTP 404/403/500/503 | Unit request tests; missing/inaccessible test file | No notice; explicit diagnostic |
| Notes omitted | Unit parser; test JSON with only `version` | A newer-version notice still works without notes |
| Repeated startup calls/windows | Cached-promise unit test; renderer reload/second window | One startup HTTP request per main process |
| Secure main/preload/React path | Electron regression test | Real main comparison and version; sandbox settings retained |
| Packaged version | Normal package smoke test and Updates installed-version label | Equals the packaged `package.json` version |
| Packaged remote access | `--check-version-file` after publication | Raw JSON fetched and validated from the actual EXE |

Fully close all app windows/processes between startup scenarios, then relaunch.
For local development only, a renderer reload resets dismissal state but reuses
the main-process startup result. Never verify a new implementation using a stale
previously packaged EXE.
