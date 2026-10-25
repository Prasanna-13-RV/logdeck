# LogDeck Technical Stack Specification

> Electron/Vite/React/TypeScript viewer foundation is implemented.
> Current versions and working commands are in [the README](../README.md).
> Later-feature libraries below remain proposed unless present in the manifest.
> Release scope and performance targets are defined in
> [the consolidated specification](LogDeck-technical-documentation.md).

## 1. Platform

- Windows only for the initial release.
- Desktop application distributed as an Electron application.

## 2. Desktop Runtime

### Electron

Responsibilities:

- Native desktop lifecycle
- BrowserWindow management
- Windows file associations
- Global/application shortcuts
- Secure IPC
- Node.js integration
- Future ADB/live-log integration

Use a supported stable Electron version, with Windows compatibility and native
dependencies verified. Electron bundles its own Node.js runtime; build-time
Node.js is a separate toolchain choice.

Do not blindly upgrade Electron after native dependencies are selected. Verify compatibility before each major upgrade.

---

## 3. Backend Runtime

### Node.js

Node.js runs inside Electron's main process and background workers.

Responsibilities:

- File I/O
- Streaming
- Indexing
- SQLite access
- Search
- EMV detection
- Static decoding
- EMV database synchronization
- Company AI API communication
- Authentication-related desktop integration

Heavy work must stay out of both the React renderer and the main event loop.
Run indexing, scans, regex, diff computation, bulk EMV, and synchronous SQLite
queries in a bounded worker pool. Main coordinates jobs, permissions, cancellation,
and windows. Database connections belong to the worker that opens them.

---

## 4. Frontend

### electron-vite + React

Use:

- `electron-vite` as the build toolchain
- React with TypeScript
- Vite as the renderer bundler

`electron-vite` provides separate entry points for main, preload, and renderer — no server process is needed. The renderer loads as a static bundle via `file://` in BrowserWindow.

Choose Vite + React for this desktop app. Next.js can also produce a static export
without a production Node server; it does not always require a server. Its server
features are unnecessary here, and static-export routing and assets add avoidable
integration work. A future public website may independently use Next.js.
Framework choice alone does not guarantee viewer performance.

Use `.ts` and `.tsx` files throughout.

See [the release experience specification](spec.md) for dark/light/system themes,
accessible finite motion, the table workspace, and the home/navigation contract.
Prefer CSS transitions over a new animation runtime for simple interactions.
Firebase authentication is deferred; the Coming later Login explanation needs no
Firebase SDK or network initialization in release 1.

---

## 5. State Management

### Zustand

Use Zustand for:

- Application state
- Viewer state
- Search state
- Filter state
- EMV state
- Settings state where appropriate

Viewer state must be isolated per window/session.

Do not accidentally create one global viewer state that causes separate windows to overwrite each other.

---

## 6. Virtualized Rendering

Use a mature virtualization library such as:

- `@tanstack/react-virtual`

Alternative:

- `react-window`

The implementation must:

- Render only visible rows
- Keep a small overscan buffer
- Avoid full DOM rendering
- Avoid storing all log lines in React state

---

## 7. Local Database

### SQLite — Use `better-sqlite3`

Use `better-sqlite3` for:

- File indexes
- Local EMV data
- Metadata
- Search-related indexes where appropriate
- Application cache metadata

`better-sqlite3` is synchronous: run it in background workers. Do not assume
electron-vite automatically rebuilds native dependencies. Use compatible prebuilt
binaries or an explicit packaging/rebuild step such as `@electron/rebuild`, and
verify the packaged Windows application.

Use WAL mode where appropriate.

Use batched transactions. Initially store offset/length records in SQLite without
duplicating every message. Benchmark the 10-million-line fixture; consider a packed
offset index only if SQLite cannot meet the documented budgets.

Verify `better-sqlite3` ABI compatibility with the chosen Electron version before committing to a version pair. Do not blindly upgrade either without re-testing.

---

## 8. File Indexing

Use Node.js streaming APIs.

Preferred approach:

- `fs.createReadStream`
- Chunked processing
- Byte-level newline detection
- Incremental index writing

Never use a complete `readFile()` for large logs.

Target files:

- ~200 MB typical
- Up to 500 MB
- Approximately 10 million lines

---

## 9. File Hashing

Use Node's cryptographic APIs for file identity/hash generation.

The indexing system should support a strong file identity strategy.

A full SHA-256 can be used where appropriate, but the implementation should avoid unnecessary duplicate full-file reads when file metadata can safely determine whether an existing index remains valid.

The final implementation should balance correctness and startup performance.

---

## 10. IPC

Use Electron:

- `ipcMain`
- `ipcRenderer`
- Secure `contextBridge`

Use window-owned session IDs, bounded range requests and result batches,
request IDs, index generations, cancellation, and subscription cleanup.
Discard stale responses after a query or source version changes.

Enable:

- Context isolation
- Controlled preload APIs
- Explicit IPC channels

Do not expose:

```text
require
process
fs
child_process
```

directly to the renderer.

---

## 11. Security

Electron security requirements:

- `contextIsolation: true`
- `nodeIntegration: false`
- Minimal preload API
- Explicit IPC allowlist
- Validate every IPC input
- Validate all file paths
- Do not expose arbitrary filesystem operations
- Do not expose Company AI credentials 

---

## 12. EMV Static Decoder

Implement as a deterministic local engine.

It must not depend on:

- Ollama
- Gemini
- OpenAI
- Company AI

The static decoder must work offline.

---

## 13. EMV Database

Use a local SQLite database or validated database package downloaded from the company backend.

The database must include a schema version and data version.

The desktop should store:

- Current local database version
- Database checksum/integrity metadata
- Last successful synchronization time

---

## 14. EMV Database Synchronization

Company backend should expose a version/check endpoint.

Conceptual API:

```text
GET /emv/version
```

Response:

```json
{
  "version": 103,
  "checksum": "...",
  "downloadUrl": "..."
}
```

The actual production endpoint is defined by the company backend specification.

If versions match:

```text
No download.
```

If the server version is newer:

```text
Download
→ validate
→ verify
→ atomic install
```

Equal versions require no download. Never automatically downgrade to an older
server version. On Windows, install a validated immutable versioned database and
safely switch an active-version manifest; do not replace a database held open by readers.
Cloud synchronization is later-phase scope; release 1 uses bundled metadata.

---

## 15. Company AI

The desktop should contain a dedicated Company AI client.

The planned company backend uses **LiteLLM**, subject to backend confirmation.
The future client calls an authenticated company-owned HTTPS gateway using simple
request/response. Do not bundle a Python LiteLLM server or a local model.

Conceptual architecture:

```text
ai/
└── companyAiClient.ts
```

The client must be isolated from the rest of the application.

Do not spread Company AI HTTP calls throughout React components or IPC handlers.

---

## 16. Company AI Security

Shared Company AI API keys remain on the backend, not in any desktop bundle,
including main. Short-lived user tokens use OS-backed encrypted storage managed by main.

Never place privileged credentials in:

- React components
- Renderer bundles
- Zustand state
- LocalStorage

---

## 17. Diff Engine

Use a mature library.

Required capabilities:

- Line-level comparison
- Word-level comparison
- Difference ranges
- Efficient large-text handling

Compare is a separate, lazy-loaded two-pane editable text tool, supporting text
files, paste, copy-change actions, and explicit saving, not folder synchronization.
Initial limits are 10 MB and 100,000 lines per side. Run cancellable diff jobs in
workers and limit word diffs to bounded changed blocks. Select an editor only after
proving virtualized rendering and memory behavior at these limits.

Do not implement a diff algorithm from scratch unless there is a demonstrated requirement.

---

## 18. Future Live Logs

The architecture should allow:

- ADB process integration
- Streaming stdout
- Incremental log ingestion
- Pause/resume
- Bounded live buffer

Do not implement live logs before their dedicated phase.

---

## 19. Coding Standards

TypeScript throughout. All files use `.ts` or `.tsx`.

Prefer:

- Small modules
- Single responsibility
- Clear error handling
- Explicit TypeScript interfaces for IPC contracts
- Unit tests for deterministic core logic
- Integration tests for IPC and indexing
- Performance tests for large files

Avoid:

- Giant files
- Giant components
- Hidden global state
- Renderer-side filesystem access
- Full-file React state
- Feature logic inside Electron `main.ts`
