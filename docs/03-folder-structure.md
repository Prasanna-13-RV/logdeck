# LogDeck Folder Structure

> Current foundation uses `src/main`, `src/preload`, `src/workers`,
> `src/renderer`, `shared`, and `tests`. Detailed module trees below describe
> the proposed expanded release, not a claim that every listed file exists. See
> [the consolidated specification](LogDeck-technical-documentation.md).
> Create future auth, AI, cloud-sync, and live modules only in their dedicated phases.

## Root

```text
logdeck/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── src/
│   ├── main/
│   ├── preload/
│   ├── workers/
│   └── renderer/
└── shared/
```

The project uses TypeScript throughout. All files use `.ts` or `.tsx`.

---

# src/main

Electron main process: privileged entry points, windows, session ownership, and
bounded job coordination. Processing engines execute under `src/workers`, not main.

```text
src/main/
├── index.ts
├── windowManager.ts
│
├── ipc/
│   ├── indexing.ipc.ts
│   ├── viewer.ipc.ts
│   ├── search.ipc.ts
│   ├── emv.ipc.ts
│   ├── compare.ipc.ts
│   ├── auth.ipc.ts
│   └── settings.ipc.ts
│
├── jobs/
│   ├── workerPool.ts
│   └── jobScheduler.ts
│
├── sessions/
│   └── fileSessionManager.ts
│
├── emv/
│   └── databaseSync.ts
│
├── ai/
│   ├── companyAiClient.ts
│   ├── aiCache.ts
│   └── prompts.ts
│
├── storage/
│   ├── appData.ts
│   ├── settingsStore.ts
│   └── cacheManager.ts
│
├── security/
└── live/
    └── future
```

---

# src/preload

Electron preload script. Exposes the typed IPC bridge via `contextBridge`.

```text
src/preload/
└── index.ts
```

---

# src/workers

Processing engines and worker-owned database access:

```text
src/workers/
├── indexing/
│   ├── fileStreamer.ts
│   ├── lineIndexer.ts
│   ├── indexCache.ts
│   └── formatDetector.ts
├── search/
│   ├── searchEngine.ts
│   ├── queryParser.ts
│   └── matcher.ts
├── viewer/
│   └── rangeReader.ts
├── compare/
│   └── diffEngine.ts
└── emv/
    ├── detector.ts
    ├── extractor.ts
    ├── staticDecoder.ts
    ├── tagMatcher.ts
    └── databaseManager.ts
```

Keep `databaseSync.ts` in main for future network/update coordination, delegating
database validation to workers. Database connections belong to their opening worker.
These are module boundaries, not one process per module; share a bounded worker
pool across windows.

---

# src/renderer

Vite + React renderer. UI only — no direct filesystem or SQLite access.

```text
src/renderer/
├── index.html
└── src/
    ├── App.tsx
    │
    ├── pages/
    │   ├── home/
    │   │   └── HomePage.tsx
    │   ├── viewer/
    │   │   ├── LogViewer.tsx
    │   │   ├── LogTable.tsx
    │   │   ├── LogRow.tsx
    │   │   ├── ColumnHeader.tsx
    │   │   ├── ViewerToolbar.tsx
    │   │   ├── SearchBar.tsx
    │   │   ├── FilterSidebar.tsx
    │   │   └── EmvSidebar.tsx
    │   ├── compare/
    │   │   ├── CompareEditor.tsx
    │   │   ├── ComparePane.tsx
    │   │   └── DiffToolbar.tsx
    │   ├── settings/
    │   │   └── SettingsPage.tsx
    │   └── login/
    │       └── LoginPage.tsx
    │
    ├── components/
    │
    ├── state/
    │   ├── appStore.ts
    │   ├── viewerStore.ts
    │   ├── searchStore.ts
    │   └── emvStore.ts
    │
    └── styles/
```

---

# shared

Shared TypeScript types, constants, and utilities accessible by both main and renderer.

```text
shared/
├── types/
├── constants/
└── utilities/
```

Use TypeScript interfaces and types here. This replaces the old JSDoc-only approach.

---

# Architectural Responsibilities

## src/main

Privileged operations only.

Coordinates worker-based processing; never runs CPU-heavy scans or synchronous
SQLite work in the main event loop.

Contains:

- Filesystem
- Indexing
- Search
- EMV engine
- Database synchronization
- Company AI (LiteLLM HTTP client)
- Window management
- Secure IPC

Never:

- Render UI
- Import renderer code

## src/renderer

UI and renderer-safe state only.

Never:

- Read files directly
- Open SQLite directly
- Call filesystem APIs
- Store Company AI credentials

---

# Window Isolation

Each window must have isolated UI state.

Conceptual windows:

```text
Main/Home
Viewer A
Viewer B
Compare
Settings
Login
Company AI
```

A viewer's state must not accidentally be overwritten by another viewer.

---

# Growth Rule

New features should be added as modules.

Do not turn:

```text
index.ts
App.tsx
LogViewer.tsx
```

into monolithic files.

The architecture should remain modular as phases are implemented.
