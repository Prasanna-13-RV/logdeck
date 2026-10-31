# Website, Firebase and company EMV tags

## Current delivery

- Vite/React website: Home `/`, Features `/features`, Download `/download`.
- Same desktop visual template, responsive navigation, persisted light/dark themes.
- Private administration `/admin`: email/password, active admin membership,
  JSON upload, validation preview and explicit publication.
- Optional desktop Settings/Login: email/password and manual **Download EMV tags**.
- Versioned, immutable company definitions cached for offline highlighting.
- No Firebase SDK dependency, analytics, log upload or background version polling.
- Portable Windows x64 packaging, optional per-user Open with registration,
  local release preparation and tag-triggered GitHub release publication.
- Netlify production routing and a GitHub-backed public release metadata function.

This repository does not contain a real Firebase project, deployed site, signing
certificate or published GitHub release. Local tests are not a live production
deployment. `npm run release` builds a portable EXE separately from Vite's code
builds; there is intentionally no installation wizard.

## 1. Create and configure Firebase

1. Create a Firebase project you control. Register a Web app and obtain its public
   Web API key and project ID.
2. Enable **Authentication > Sign-in method > Email/Password**. Provision accounts
   in Authentication through your trusted administrator. This application has no
   public signup, email-verification or password-reset UI.
3. Create the **default Cloud Firestore database** in production mode. Select the
   region according to your company's policy. No Cloud Storage bucket is needed:
   bounded tag packs are Firestore documents, not uploaded files in a public bucket.
4. Deploy [the rules](../firestore.rules) before allowing clients access. Never use
   open/test-mode rules. Browser checks are not an authorization boundary.
5. Configure authorized web domains, API-key restrictions and quotas appropriate
   to your deployment. Firebase web configuration is public, not a secret.
   Test desktop REST access after applying API restrictions: HTTP-referrer-only
   restrictions can block a native desktop client. Rules and per-user identity
   enforce company access; an API key alone never grants membership.

Copy [.env.example](../.env.example) to `.env.local` at the project root and set:

```dotenv
VITE_FIREBASE_API_KEY=YOUR_PUBLIC_FIREBASE_WEB_API_KEY
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_WINDOWS_DOWNLOAD_URL=
```

If Firebase Console gives you a `firebaseConfig` JavaScript object, map
`apiKey` to `VITE_FIREBASE_API_KEY` and `projectId` to
`VITE_FIREBASE_PROJECT_ID`. For the `logdeckrv` project:

```dotenv
VITE_FIREBASE_API_KEY=YOUR_ACTUAL_PUBLIC_WEB_API_KEY
VITE_FIREBASE_PROJECT_ID=logdeckrv
```

Do not paste the whole object into a TypeScript file. This app uses Firebase Auth
and Firestore REST APIs, so `authDomain`, `storageBucket`, `messagingSenderId`,
`appId` and `measurementId` are not read. Analytics is not enabled. Replace
example/dummy values with your project's actual public web API key. Keep
`.env.local` local (it is git-ignored); for Netlify, set the same two variables
in the site's build environment and redeploy.

Both app builds read this configuration. Restart Vite after editing it; rebuild
desktop and website for a changed production configuration. Never place service
account JSON, private keys, Admin SDK credentials or company gateway keys in any
`VITE_` variable or application bundle.

## 2. Bootstrap access through a trusted operator

Use Firebase Console or a trusted server-side Admin SDK, not the website.
Create these documents using the Authentication user's UID:

```text
companies/example-company/members/ADMIN_USER_UID
  active: true       (boolean)
  role: "admin"      (string)

companies/example-company/members/MEMBER_USER_UID
  active: true
  role: "member"
```

Company IDs use 1-64 lowercase letters, digits, `_` or `-`, starting with a letter
or digit. Company users must be given their company ID; enumeration is prohibited.
An account may have memberships in multiple companies.

- Active members can get their own membership and their company's catalog/packs.
- Only active admins can create a new pack and advance its catalog in one batch.
- Clients cannot create, modify or delete memberships, list members/packs, update
  an existing pack, delete versions or downgrade the catalog.
- To revoke future access, set `active` to `false`. Do not rely on hiding `/admin`.
- Do not edit pack/catalog documents manually in the Console during ordinary
  publication: privileged Console/Admin SDK writes bypass rules.

## 3. Pack format and publication

Download [the synthetic JSON template](../website/public/company-tags.example.json).
Only upload definitions you are authorized to distribute. Do not put transaction
values, payment/customer data, passwords or raw logs in a definition pack.

```json
{
  "schemaVersion": 1,
  "companyId": "example-company",
  "version": 1,
  "name": "Company reference",
  "tags": [
    {
      "tag": "DF8101",
      "name": "Company status",
      "description": "An authorized company definition.",
      "bytes": 2,
      "sensitive": false
    }
  ]
}
```

Limits:

- 512,000 UTF-8 bytes before parsing; 1-1,000 unique tags.
- IDs: 1-3 hexadecimal bytes, normalized to uppercase.
- Version: positive safe integer, strictly higher than the published version.
- Pack name/tag names: 1-120 characters; descriptions: 1-1,000 characters;
  empty strings and ASCII controls are rejected.
- Optional `bytes`: integer 0-65,536; omitted means variable/unspecified.
- Optional `sensitive`: boolean. Unknown fields are stripped rather than executed.
- No keyword matching, tag-specific executable code or new bit-decoder layouts.

Open `/admin`, sign in using the company ID and an admin account, choose JSON,
review validation and global-overlap counts, then explicitly **Publish version N**.
Choosing a file alone does not send it to Firebase. Publication uses these documents:

```text
companies/{companyId}/packs/{version}
  companyId: string
  version: integer
  json: string containing sanitized pack JSON

companies/{companyId}/catalog/current
  version: integer
```

Both writes are atomic. Pack creation requires nonexistence; catalog writes use
an update-time precondition to reject concurrent lost updates. On a conflict,
check the latest published version and use a higher version.

Rules validate identity, role, document shape, version, size and atomic linkage.
Firestore rules do not parse the JSON string. The website and desktop independently
validate its schema; an invalid document written by a compromised administrator
is rejected by the desktop rather than installed. Authorized administrators still
control factual definition content; versions are not independent EMV certification.

## 4. Desktop download and offline behavior

1. Open Settings or Login. Sign in with your provisioned email/password.
2. Enter the authorized company ID.
3. Click **Download EMV tags**. There is no automatic startup check or subscription.
4. The app validates membership, catalog identity, pack schema and version before
   installing. Equal identical versions report up-to-date; changed equal versions
   and downgrades fail without replacing the installed pack.
5. Already open viewers refresh their cached annotations. Original log files,
   filter expressions, search and row selection are not rewritten.

One company pack is active per desktop profile. Switching companies replaces only
the company pack. Global definitions always remain available. An overlapping ID
shows separate **Global EMV definition** and **Company definition** sections.
Global length checks/decoders remain authoritative only for their global reference;
company expected lengths are checked and shown separately.

The global dictionary is bundled in source code: **60 common entries, version
1.1.0**. It is neither a live internet lookup nor an exhaustive global EMV catalog.
Explicit `Tag` / `T: ... L: ... V:` / `#[T]:` syntax recognizes unknown IDs even
without a definition; installed company IDs also enable known `ID: value` pairs.
Recognition remains bounded to displayed/prefetched records, not a full-file inventory.

Desktop ID/refresh tokens are held in main-process memory per window. Website
tokens are held in page memory. Closing the window/page or signing out drops
them; no localStorage token persistence is used. Refresh happens only during a
requested cloud action. No password is stored. Website theme preference is localStorage.

The cache is `company-emv-tags.json` under Electron's per-user application-data
directory. It contains plaintext definitions protected by OS account permissions;
it is not encrypted or remotely erasable. Sign-out/revocation does not remove a
downloaded pack. If your company's policy disallows offline retention, do not
distribute the pack until an appropriate retention mechanism is designed.

## 5. Website deployment and real downloads

From the repository root:

```powershell
npm.cmd run dev:website
npm.cmd run build:website
npm.cmd run preview:website
```

Local URL: `http://127.0.0.1:5174`. Production files are in `website/dist`.
The website does not embed Electron or open/upload local logs.

### Netlify production hosting (selected)

The production URL is `https://logdeck.netlify.app`. Import this GitHub repository
in Netlify, use the repository root as the base directory, and use
`netlify.toml` (build: `npm run build:website`, publish: `website/dist`).
Keep dev dependencies enabled during the build. The configuration pins Node 22,
skips downloading Electron for the website, bundles the release function, preserves
SPA routes and adds restrictive response headers. Do not deploy `website/dist`
alone through drag-and-drop: the release endpoint also needs its Netlify Function.

Set `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` in the Netlify build
environment when enabling company administration, and add `logdeck.netlify.app`
to Firebase Auth's authorized domains. These are public client settings, never
service-account credentials. Deploy Firestore rules separately:

```powershell
firebase.cmd deploy --only firestore:rules
```

Netlify rewrites `/updates/windows.json` to the `windows-release` Function with a
200 response (not an external redirect). The function requests only the configured
public repository's latest published stable GitHub release, validates the tag and
matching fully uploaded Windows EXE/checksum assets, and exposes version, notes,
publication time, download URLs and GitHub's actual EXE SHA-256 digest. No GitHub
token is required for a public repository. Browser caching is 60 seconds; Netlify
CDN caching is five minutes. The function bounds requests to eight seconds / 256 KB.
GitHub failures, rate limits, private repositories and missing/incomplete releases
return 503 with an explicit UI error, never an invented version or working download.
The website's release metadata remains same-origin, timeout/size bounded, and
redirect-free. Logs and Firebase credentials never go to this endpoint.

The source static manifest remains useful for local Vite previews, but the forced
Netlify rewrite takes precedence in production. Therefore an early Netlify deploy
does not advertise a GitHub release that has not finished publishing. A new GitHub
release becomes visible after cache expiry without another website deploy.

Verify `/`, `/features`, `/download`, `/admin` (including direct reload) and
`/updates/windows.json` after connecting the repository. Site creation, domain
ownership and production deployment require your Netlify account and have not
been performed here.

### Firebase Hosting alternative (not the selected production host)

With Firebase CLI available and your project selected:

```powershell
firebase.cmd login
firebase.cmd use YOUR_PROJECT_ID
firebase.cmd deploy --only firestore:rules,hosting
```

[firebase.json](../firebase.json) configures SPA route fallback and restrictive
hosting headers, including an explicit Firebase endpoint allowlist. Use equivalent
headers/fallback if hosting elsewhere. Review project, region, pricing and access
before deployment; these commands have not been run against a real project here.

Firebase Hosting does not execute the Netlify Function. It serves the static
release snapshot, which must only be deployed after its corresponding GitHub assets
are published and its SHA-256 updated to match the published binary (CI rebuilds can
produce different bytes). Do not deploy local preparation checksums as if they
verified a different CI-built EXE. Netlify avoids that risk by reading the actual
GitHub digest. There is no automatic installer, macOS or Linux build.

## 6. Portable release preparation and GitHub publication

On Windows x64 with Node 22.18+ and dependencies installed:

```powershell
npm.cmd run release
npm.cmd run release -- --bump minor --notes "Describe the release."
```

Choose one command, not both for the same release. The default is a patch bump.
`--bump major` is also supported. This command performs all **local** preparation:

1. Validate the production HTTPS site/repository in `release.config.json` and
   reject an existing output version rather than overwriting it.
2. Bump `package.json` and `package-lock.json`, without a git commit or tag.
3. Run unit tests, typecheck and desktop production build. The build embeds
   `https://logdeck.netlify.app` and its `/updates/windows.json` endpoint.
4. Package a Windows x64 portable EXE using `electron-builder`. SQLite 13 supplies
   a Node-API prebuild: no compiler rebuild is attempted. Native modules are
   unpacked from ASAR. Both the extracted runtime and the portable launcher must
   open a synthetic log and load SQLite successfully.
5. Write `release/<version>/LogDeck-<version>-windows-x64.exe`, `SHA256SUMS.txt`,
   `windows.json` and `release-notes.txt`; update the local website manifest and
   build the website. The local checksum describes the local EXE, not a later CI build.
6. Print the manual publishing commands. No commit, tag, push, GitHub upload,
   Netlify deployment or Windows registration is performed.

On failure, the version/lockfile/manifest are restored and the command exits nonzero.
Build outputs may remain for diagnosis; move only that version's output folder
aside before retrying. Review changes, include all release sources/configuration,
and commit before tagging. Example for the prepared version:

```powershell
git status
# Review and stage the intended source changes, then commit them.
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

Use the actual prepared version, not always `0.1.1`. The tag-triggered GitHub Actions
workflow checks that tag/package/manifest versions match, rebuilds and smoke-tests
on Windows, and creates a draft with the EXE, checksum and metadata attached before
publishing it as latest. `GITHUB_TOKEN` receives contents-write permission only in
the release job. The repository must be public for unauthenticated public downloads.
No personal access token is stored. A failed publication leaves a draft for manual
inspection; remove/repair that draft before retrying the same tag. The local EXE
is immediately usable even if you choose not to publish.

**Where to upload the EXE:** GitHub Releases in `Prasanna-13-RV/logdeck`, not
Firebase or Netlify. The tag workflow above is the recommended upload path.
For a manual release, attach the matching `LogDeck-<version>-windows-x64.exe`,
`SHA256SUMS.txt` and `windows.json` from the same prepared output folder, use the
matching `v<version>` tag, add release notes, and publish a stable release as latest
(not a draft/prerelease). Never mix metadata/checksums from a different build.
Netlify hosts the website and discovers this release; its Download page stays
unavailable if the release is incomplete or the EXE digest cannot be verified.

For signed binaries, configure GitHub repository secrets `WINDOWS_CSC_LINK` and
`WINDOWS_CSC_KEY_PASSWORD`, and the corresponding local `CSC_LINK`/
`CSC_KEY_PASSWORD` variables when preparing locally. Never commit the certificate
or password. Without these, builds are **unsigned**, and Windows may show SmartScreen
warnings. A SHA-256 checksum checks byte integrity, not publisher identity.
Company-tag configuration in CI can use repository variables
`VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_PROJECT_ID`; these are public web settings.
Real publisher identity/certificate issuance is not automated.

### Users: no setup wizard

Save the EXE in a permanent folder, run it, then optionally select
**Settings > Enable Open with LogDeck**. After a native confirmation, LogDeck adds
only per-user ProgID/OpenWith/capabilities entries for `.log` / `.logcat`.
It does not overwrite extension defaults, Windows `UserChoice`, or other apps.
Select the default in Windows **Settings > Apps > Default apps** if desired.
Spaces and Unicode paths are supported; opened files remain read-only.
Click **Remove Open with registration** before deleting the app.

Desktop checks now read root GitHub `version.json`; see
[GitHub version notifications](GitHub-version-checking.md) for setup and testing.
The startup notice is notification-only; failed checks do not show it.
Users can still use **Updates -> official Download page -> download EXE -> close
the old app -> run the new EXE**. Re-enable Open with from the new version/location.
The old filename registration will not magically follow a moved EXE. Preferences,
company pack cache and indexes remain in the account's app-data folders, so this
is a no-installer distribution, not a zero-footprint or USB-profile mode.

The portable launcher extracts Electron to an isolated temporary folder on each
launch. ZIP extraction favors startup time over the smallest possible download;
the EXE is approximately 162 MB, not a tiny native binary. The final local smoke
run reached an indexed record in 24.5 seconds including extraction and integration
status checks on this development machine. This is a measured development result,
not a cross-machine startup guarantee or a completed performance certification.
The packaged-runtime test also covers opening another log while already running,
including a filename containing spaces and Unicode.

## 7. Verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run build:website
npm.cmd run test:desktop
npm.cmd run test:website
npm.cmd run test:rules
```

Rules tests require Firebase CLI and Java 21+ and run only against the local
Firestore emulator (`demo-logdeck`, `127.0.0.1:8088`), never a production database.
They test membership isolation, admin-only publication, immutable packs,
atomic version/catalog linkage and stale-write rejection. Synthetic test documents
are individually cleaned up. Browser admin tests intercept Firebase REST requests;
they prove UI/HTTP contract behavior, not live Firebase credentials or production
connectivity. Unit tests cover schema, bounds, versions, refresh, downloads and cache.

## 8. Release metadata and development overrides

The website serves the public static manifest at
`website/public/updates/windows.json`, published at
`https://YOUR_SITE/updates/windows.json`. It contains only:

```json
{
  "latestVersion": "0.1.0",
  "publishedAt": "2026-10-25T00:00:00.000Z",
  "releaseNotes": "Describe this release."
}
```

The local preparation command maintains this snapshot. On Netlify the Function
instead reads the published GitHub release as described above. This metadata still
serves the public website/download flow. The desktop now independently compares
`app.getVersion()` with `version` from root GitHub `version.json` once per startup
or on a manual retry; see [the desktop guide](GitHub-version-checking.md).

The existing website/download build uses these settings (the GitHub checker uses
`version-check.config.json` instead):

```dotenv
VITE_WEBSITE_URL=https://YOUR_SITE
VITE_UPDATE_MANIFEST_URL=https://YOUR_SITE/updates/windows.json
# Optional website-only legacy override (normally leave blank on Netlify).
VITE_WINDOWS_DOWNLOAD_URL=
```

The manifest URL must be HTTPS and same-origin with `VITE_WEBSITE_URL`; the
download action opens the fixed `/download` path on that configured website. The
release manifest remains separate from the root GitHub version file.
No download, EXE replacement or installation occurs automatically. Desktop checks
send no logs, sign-in data or company tags, and failures do not produce an update
notice. Publish root `version.json` when a newer binary is actually available.
Changing the app's configured website URL or GitHub repository/branch requires
rebuilding the desktop app.

## 9. Production sign-off

Before production release, verify the deployed site's sign-in and a real
admin-publish/member-download cycle with synthetic definitions on your configured
project, then verify access revocation and your download artifact. Operator account
provisioning, quotas, identity lifecycle, billing and executable signing are not
automatically managed by LogDeck.
