# LogDeck Master Architecture Specification

> Scope clarified on 2026-10-24. Read [the consolidated specification](LogDeck-technical-documentation.md)
> for release scope, performance budgets, processing contracts, and decision rationale.
> This is a proposed architecture, not an implemented application.
> Release 1 prioritizes saved-file viewing, local EMV, and independent two-pane text comparison.
> Live ADB, cloud EMV synchronization, login, Company AI, and account sync are later phases.
> The [release experience specification](spec.md) defines the clarified UI,
> split views, exports, advanced AND/OR/NOT grammar, and future-Firebase Login explanation.

## 1. Product Overview

**Product:** LogDeck

**Platform:** Windows

**Purpose:** High-performance Android logcat/log analysis desktop application with specialized EMV analysis capabilities.

Primary supported files:

- `.logcat`
- `.log`

Target workload:

- Normal files: ~200 MB
- Maximum expected: ~500 MB
- Up to approximately 10 million lines

Primary UX inspirations:

- Android Studio Logcat
- Beyond Compare

Primary priorities:

1. Performance
2. Reliability
3. Privacy
4. Offline usability
5. Extensibility
6. Clean multi-window behavior

---

## 2. High-Level Architecture

```text
                         Company Website
                    ┌─────────────────────────┐
                    │ EMV DB Management       │
                    │ Marketing               │
                    │ Documentation          │
                    └────────────┬────────────┘
                                 │
                                 │ Versioned API
                                 ▼
                    ┌─────────────────────────┐
                    │ Company EMV Backend     │
                    │ EMV Database             │
                    │ Database Version         │
                    └────────────┬────────────┘
                                 │ HTTPS
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                         LogDeck Desktop                             │
│                                                                  │
│  ┌───────────────────┐        ┌───────────────────────────────┐  │
│  │  Vite + React UI  │        │      Electron Main            │  │
│  │                   │  IPC   │                               │  │
│  │ React             │◄──────►│ Node.js                       │  │
│  │ Zustand           │        │ File system                   │  │
│  │ Virtualization    │        │ Indexing                      │  │
│  │ Search UI         │        │ Search engine                 │  │
│  │ EMV UI            │        │ EMV engine                    │  │
│  └───────────────────┘        │ Company AI client             │  │
│                               │ Window management              │  │
│                               └───────────────┬───────────────┘  │
│                                               │                  │
│                     ┌─────────────────────────┼──────────────┐   │
│                     │                         │              │   │
│                     ▼                         ▼              ▼   │
│               Local Index              Local EMV DB     Company AI│
│               SQLite/DB                Versioned DB      HTTPS   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Major Components

### React Renderer (electron-vite)

Responsible for:

- Home page
- Log viewer
- Search UI
- Filter UI
- Compare UI
- Settings UI
- Login UI
- EMV sidebar
- EMV tag multiselect
- Visual highlighting
- User interaction
- Zustand state
- Virtualized rendering

The renderer must not directly access:

- File system
- SQLite
- Windows APIs
- Company AI credentials
- EMV database files

All privileged operations go through Electron IPC.

### Electron Main Process

The diagram shows logical ownership, not execution on the main thread. Main
coordinates jobs and permissions. CPU-heavy indexing, search, regex, diff, bulk
EMV, and synchronous SQLite work execute in a bounded background worker pool.
Use worker threads initially; use an Electron utility process where crash isolation
is needed. Do not create an unbounded worker pool per window.
Cloud components are future scope and do not start during release-1 local viewing.

Responsible for:

- File system
- File association
- File streaming
- File indexing
- Index caching
- Search
- Log extraction
- EMV processing
- Local EMV database management
- Company AI API communication
- Authentication integration
- Window management
- Global shortcuts
- Future live log ingestion

---

## 4. IPC Architecture

IPC is the security and architectural boundary.

```text
React Renderer (electron-vite)
       │
       │ IPC
       ▼
Electron Main
       │
       ├── File system
       ├── Index
       ├── Search
       ├── EMV
       ├── Company AI
       └── Windows
```

IPC APIs must be:

- Explicit
- Small
- Validated
- Serializable
- Feature-specific

Never expose arbitrary IPC channels.

---

## 5. File Handling

Supported:

- `.log`
- `.logcat`

Input methods:

1. Drag and drop
2. File picker
3. Windows "Open with LogDeck"
4. Future live stream

---

## 6. Large File Architecture

Never load an entire log into memory.

Use:

```text
File
 ↓
Streaming reader
 ↓
Chunk processing
 ↓
Line indexing
 ↓
Disk index
```

The index stores:

- `lineNumber`
- `byteOffset`
- `byteLength`

The viewer retrieves only required line ranges.

---

## 7. Index Cache

Store rebuildable indexes in Windows Local AppData, not roaming AppData:

```text
%LOCALAPPDATA%
└── LogDeck
    └── indexes
        └── <file-hash>
            └── index.db
```

Use canonical file identity, size, timestamps, index schema version, and bounded
content fingerprints for fast cache validation. This is not proof against arbitrary
same-metadata edits. Hash during initial streaming; offer full verification where required.
Invalidate stale or incomplete indexes and rebuild when a source changes.

Indexes must survive application restarts.

---

## 8. Viewer Architecture

The viewer uses strict virtualization.

```text
10,000,000 lines
       ↓
Virtualized viewport
       ↓
Visible rows + small buffer
```

Target approximately 50-100 rendered rows at a time.

No giant DOM.

No full-file React state.

Scrolling should feel continuous with no visible loading spinner during normal scrolling.

---

## 9. Log Columns

Primary columns:

1. Time
2. PID
3. TID
4. Level
5. Tag
6. Message

The architecture should allow future custom columns.

---

## 10. Search

Search runs outside React against indexed data.

Default logic is **AND**.

Support explicit uppercase OR/NOT and grouping with precedence: parentheses, NOT,
AND, OR. Adjacent clauses imply AND. Sidebar filters apply to the resulting
expression, not to individually rewritten clauses. Regex mode is explicitly
separate from field-expression mode; invalid queries show actionable errors.

Examples:

```text
tag:MCEMV Core.NEXO
level:E timeout
```

Support:

- General search
- Tag
- PID
- TID
- Level
- Message
- Time
- Exact phrase
- Regex
- Multiple terms

---

## 11. Search Highlighting

All visible matches should be highlighted.

Expensive highlighting must be limited to visible rows.

Search must not trigger millions of React renders.

---

## 12. Advanced Filter Sidebar

The left sidebar provides:

- Log level
- Tag
- PID
- TID
- Time range
- Include patterns
- Exclude patterns
- Text
- Regex
- Saved filters

Filters combine predictably with search.

---

## 13. Themes

Primary themes:

- Light
- Dark

Include system-following appearance and persist manual choice. The compact table
workspace uses collapsible filter and EMV/detail sidebars. Subtle finite transitions
respect reduced motion and never animate log rows. Home uses a prominent drop area,
feature cards below it, and a navbar Features action.
Show future Firebase Login only as a labeled Coming later explanatory dialog.

Future customization:

- Background colors
- Text colors
- Log-level colors
- Highlight colors
- Custom rules

---

## 14. Multi-Window Architecture

Potential windows:

- Home/Main
- Log Viewer
- Compare
- Settings
- Login
- Company AI palette

A log viewer must never be replaced by Settings, Login, or Compare.

Multiple log viewer windows must remain independent.

`Ctrl + N` creates a new window.

---

## 15. Compare

Compare is a secondary, independent Beyond Compare-style text tool, not a
specialized log comparison workflow. It opens on demand in a separate window.

```text
Left editable text | Right editable text
Inline line/word differences and navigation
```

Support:

- Text files
- Pasted text
- Line diff
- Word-level diff
- Difference highlighting
- Navigation
- Copying a selected change between sides
- Save/Save As with overwrite confirmation and unsaved-change warnings

Use a mature diff library with worker-side computation and cancellation.
Confirmed initial limits: at most 10 MB and 100,000 lines per side, including edits
and paste. Reject oversized inputs explicitly without truncation.
Folder comparison, directory synchronization, and binary comparison are excluded.
The 500 MB viewer target does not apply to editable Compare.

---

## 16. Authentication

Authentication is later-phase scope, not a release-1 dependency.

Normal log viewing does not require login.

Authentication is required for protected cloud/company-AI functionality.

Support:

- Google
- Email/password

Email/password accounts require email verification.

### Google OAuth Desktop Flow

For Google desktop OAuth, use the system browser, a Desktop OAuth client,
authorization code with PKCE and state validation, and a temporary loopback listener
on `127.0.0.1` with a random port. Close the listener on completion or timeout.
Do not assume a custom `logdeck://` redirect is supported for Google's desktop client.
An HTTPS company-brokered flow is a separate future design requiring backend details.
Desktop applications are public clients and cannot protect an embedded client secret.

Tokens must use OS-backed encrypted storage managed by the main process.
Never pass raw tokens to the renderer or bundle shared Company AI API keys.

---

## 17. EMV Architecture

The EMV system is local-first.

```text
Log
 ↓
Deterministic EMV detection
 ↓
Tag selection
 ↓
Value extraction
 ↓
Static decoder
 ↓
Local EMV definition
 ↓
Optional Company AI explanation
```

There is:

- No Ollama
- No Gemini
- No OpenAI
- No generic AI provider abstraction

The only AI provider is **Company AI**.

---

## 18. EMV Database

The company maintains an EMV database through a company website/backend.

The website serves two purposes:

1. EMV database management
2. Marketing/public website

The database can contain:

- Tag
- Name
- Full form
- Description
- Format
- Length
- Parsing rules
- Bit definitions
- Possible values
- Examples
- Additional metadata

Some data is bundled locally; additional data is synchronized from the company database.

---

## 19. EMV Database Versioning

The central EMV database has a monotonically increasing version.

Every meaningful database modification increments the version:

- Add
- Edit
- Delete
- Correction
- Update
- Any data-affecting modification

Example:

```text
100
101
102
103
```

---

## 20. EMV Database Synchronization

```text
LogDeck
 ↓
Read local database version
 ↓
Request server version
 ↓
Server version newer?
 ├── NO  → no download; report unexpected older server versions
 └── YES → download updated database
             ↓
          validate
             ↓
          install atomically
```

If synchronization fails, keep the existing local database.

The desktop application must remain functional offline.

Downloads should be validated for:

- Version
- Integrity/checksum
- Valid database structure

Use temporary storage and atomic replacement.

---

## 21. EMV Detection

There is no AI-based tag detector.

Detection should be deterministic and optimized for messy real-world logs.

Recognize patterns such as:

```text
9F01
9f01
9F 01
tag[31]:9f01
9F02[6]:00 00 00 00 00 12
```

Detection should use both:

- Local known tag metadata
- Robust pattern matching

---

## 22. EMV Tag Selection

When the EMV parser is enabled:

```text
EMV Parser: ON
```

show a multiselect input.

Suggestions come from tags detected in the current log.

Users can also manually enter a tag.

Only selected tags should be parsed/highlighted.

---

## 23. EMV Value Extraction

After a selected tag is found:

```text
Tag
 ↓
Find associated value
 ↓
Value available?
```

If no:

```text
Show definition
Value unavailable
```

If yes:

```text
Value
 ↓
Static decoder
 ↓
Decoded value
```

---

## 24. Static EMV Decoder

The decoder is fully local and deterministic.

It uses:

- EMV metadata
- Parsing rules
- TLV rules
- Format definitions

It must never invent values.

---

## 25. Missing and Invalid Values

If a tag is detected without a value:

- Show tag
- Show definition
- Show "Value unavailable"

If data looks like EMV but fails validation:

- Show "Unverified EMV data"
- Never present it as confirmed

---

## 26. EMV Sidebar

Clicking a detected/selected EMV tag opens the right sidebar.

Example:

```text
EMV Tag
9F02

Name
Amount, Authorised

Value
00 00 00 00 00 12

Decoded Value
...

Definition
...

Source
Local Database

Company AI Explanation
...
```

---

## 27. Company AI

Company AI may provide:

- Meaning
- Full form
- Human-readable explanation
- Parsing explanation
- Contextual interpretation

The static decoder remains responsible for deterministic decoding.

Never send a complete log to Company AI automatically.

Send only the minimum required information.

---

## 28. Company AI Cache

AI responses can be cached.

Cache keys should account for relevant EMV database version, tag, and context so stale explanations are not incorrectly reused after EMV data changes.

Example conceptual key:

```text
<databaseVersion>:<tag>:<context>
```

---

## 29. Offline Mode

Without internet:

- Log viewing works
- Search works
- Filters work
- EMV detection works
- Local EMV definitions work
- Static decoding works

Company AI is unavailable.

The UI should clearly indicate that it is using local/spec-based information.

---

## 30. Future Live Logs

Future live log support should use the same viewer architecture.

Potential source:

```text
ADB/live log stream
 ↓
Electron
 ↓
Live ingestion buffer
 ↓
Virtualized viewer
```

Only a configurable recent number of lines should remain in the live buffer.

Live mode should support:

- Live
- Pause
- Resume

When paused, users can investigate the snapshot and run EMV parsing.

---

## 31. Settings

Categories:

### General

- Startup
- File associations
- Keyboard shortcuts

### Appearance

- Light/dark
- Colors

### Search

- Search defaults
- Regex
- Case sensitivity

### Filters

- Saved filters
- Default filters

### EMV

- Parser settings
- Local database
- Database version
- Synchronization
- Last synchronization
- Company AI

### Performance

- Cache
- Indexing
- Virtualization

### Privacy

- Company AI usage
- Data transmission information

### Account

- Login
- Verification
- Account status

---

## 32. Recommended Technology Stack

- Electron
- Node.js
- electron-vite
- React
- TypeScript
- Zustand
- better-sqlite3 (SQLite)
- `@tanstack/react-virtual` for virtualization
- Mature diff library
- LiteLLM (Company AI)

No Next.js.

No Ollama.

No Gemini.

No OpenAI.

---

## 33. Architecture Principles

1. Performance first
2. Local first
3. Deterministic parsing before AI
4. AI is assistive, not authoritative
5. Never automatically send complete logs externally
6. Definitions remain available without values
7. User controls which EMV tags are parsed
8. Company AI is the only AI provider
9. EMV database is versioned
10. Matching database versions require no download
11. Database updates are atomic
12. Offline functionality must remain useful
13. Windows are isolated
14. Virtualization is mandatory
15. Disk-backed indexing is mandatory
16. Future live logs must reuse the existing viewer architecture
