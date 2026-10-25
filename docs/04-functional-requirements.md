# LogDeck Functional Requirements

## Release Scope (confirmed 2026-10-24)

Release 1: saved-file log/logcat viewer (primary), search/filter/highlighting,
independent windows, themes/settings/saved filters, local EMV, and an independent
Beyond Compare-style two-pane editable text tool.

Later phases: FR-016, FR-027/028, FR-036-039, FR-045/046/048/049,
FR-050-053, and FR-056. These remain roadmap requirements, not release-1
dependencies. FR-037/039/068 apply when database updates are introduced.
FR-047 privacy applies from release 1. Hide unavailable account/cloud controls,
except the explicitly labeled future Firebase Login explanation.
The [release experience specification](spec.md) adds REQ-001 through REQ-030 for
the clarified UI, advanced queries, split views, exports, and working increments.
See [the consolidated specification](LogDeck-technical-documentation.md) for
performance targets and edge-case behavior.

## FR-001: Platform

The initial product must support Windows.

---

## FR-002: File Types

The application must support:

- `.logcat`
- `.log`

---

## FR-003: File Opening

Users must be able to open logs through:

- Drag and drop
- File picker
- Windows "Open with LogDeck"

---

## FR-004: File Association

Windows should provide:

> Right click → Open with LogDeck

The application must receive the file path safely.

Missing or invalid paths must produce a controlled error rather than an undefined-path exception.

---

## FR-005: Home Page

When opened normally, LogDeck displays a home page with:

- Drag-and-drop area
- File opening controls
- Navbar
- Feature cards below the drag-and-drop section
- Features navbar button navigating to the home feature section
- Compare
- Settings

Navbar includes Login labeled "Coming later", opening an explanatory future-Firebase
dialog. Actual authentication is added only in the later cloud/auth phase.

---

## FR-006: Large Files

Support expected files up to approximately 500 MB and approximately 10 million lines.

The application must not load the entire file into renderer memory.

---

## FR-007: Indexing

Large files must be indexed incrementally.

Index records should include:

- Line number
- Byte offset
- Byte length

Indexes must be persisted on disk.

---

## FR-008: Index Reuse

If an existing valid index belongs to the same file version/identity, reuse it.

If the file has changed, rebuild the index.

---

## FR-009: Log Format Detection

Automatically detect whether the input resembles:

- Android logcat
- Plain text log

---

## FR-010: Log Viewer

The viewer should resemble Android Studio Logcat.

Columns:

1. Time
2. PID
3. TID
4. Level
5. Tag
6. Message

---

## FR-011: Smooth Scrolling

Scrolling from top to bottom must remain responsive even for very large files.

No full-file DOM rendering.

No full-file React state.

No visible loading spinner during ordinary scrolling.

---

## FR-012: Virtualization

The viewer must use row virtualization.

Only visible rows and a small overscan region should be rendered.

---

## FR-013: Multiple Windows

Multiple log viewer windows must be supported.

Each viewer must maintain independent state.

---

## FR-014: Ctrl+N

`Ctrl + N` creates a new window.

---

## FR-015: Settings Window

Settings opens in a separate window.

Opening Settings must not close or replace an existing log viewer.

---

## FR-016: Login Window

Login opens in a separate window.

Opening Login must not close or replace an existing log viewer.

---

## FR-017: Search

Search must support:

- General text
- AND semantics
- OR and NOT operators with grouping parentheses
- Column-specific search
- Regex
- Exact phrase
- Tag
- PID
- TID
- Level
- Message

Provide source line identification, resize/reorder/show-hide column controls,
severity styling in both themes, raw-text fallback, and wrapped message details.
- Time where supported

---

## FR-018: Search Syntax

Support syntax concepts such as:

```text
tag:MCEMV
level:E
pid:844
message:timeout
```

Queries can combine multiple terms.

Default logical behavior is AND.

Explicit precedence is parentheses, NOT, AND, OR. Adjacent clauses imply AND.
Uppercase operators are reserved; quoted text is literal. Invalid/unknown syntax
must show an error. Regex mode and expression mode are clearly distinguished.
Device/package/app fields are enabled only when trustworthy metadata is available.

---

## FR-019: Search Highlighting

All visible matching occurrences must be highlighted.

Highlighting must not require scanning/rendering the entire DOM.

---

## FR-020: Advanced Filters

The left sidebar must support:

- Level
- Tag
- PID
- TID
- Time range
- Include patterns
- Exclude patterns
- Text
- Regex
- Saved filters

---

## FR-021: Filter Combination

The complete query expression combines with sidebar filter categories by AND;
multiple selected values within a category combine by OR; excludes remove matches.

---

## FR-022: Saved Filters

Release 1 users can save, name, reapply, rename, and delete filter/search configurations.

Examples:

- EMV Errors
- NEXO Debug
- Payment Failures

---

## FR-023: Themes

Support:

- Light
- Dark

Include follow-system mode and persist explicit choice. All screens and highlights
must work in both themes. Subtle finite animations respect reduced motion; never
animate individual log rows or block interactions.

Future appearance customization may include:

- Background
- Text
- Log-level colors
- Search highlight colors
- Custom rules

---

## FR-024: Compare

Compare must open in a separate window.

Compare is a secondary, independent text editing/comparison tool, not a log
comparison pipeline. The UI must have two editable panes:

```text
Left editable text | Right editable text
Inline difference highlighting
```

---

## FR-025: Compare Input

Compare must support:

- Two text files
- Pasted text

Initial limits: 10 MB and 100,000 lines per side, enforced for files, paste, and
edits without silent truncation. Viewer limits remain separate.
Folder comparison/synchronization and binary comparison are out of scope.

---

## FR-026: Compare Differences

Support:

- Line differences
- Word-level differences
- Difference highlighting
- Difference navigation

- Copy a selected change left-to-right or right-to-left
- Save and Save As, overwrite confirmation, and unsaved-change warnings
- Detect externally changed source files before saving

Diff computation must be cancellable and run outside renderer/main event loops.

---

## FR-027: Authentication

Support:

- Google authentication
- Email/password

---

## FR-028: Email Verification

Email/password accounts require email verification.

---

## FR-029: Unauthenticated Log Usage

Users must be able to view/search/filter logs without authentication.

---

# EMV Requirements

## FR-030: EMV Toggle

EMV parser is optional.

It should be enabled/disabled by a UI toggle.

---

## FR-031: EMV Multiselect

When enabled, show a multiselect tag input.

Suggestions should be based on tags detected in the current log.

---

## FR-032: Manual EMV Tags

Users can manually enter tags that are not automatically detected.

---

## FR-033: Selected Tags Only

Only tags selected in the multiselect/manual input should be parsed and highlighted.

---

## FR-034: EMV Detection

Detection must work with real-world messy log formats.

Examples:

```text
9F01
9f01
9F 01
tag[31]:9f01
9F02[6]:00 00 00 00 00 12
```

---

## FR-035: EMV Local Metadata

The application must maintain local EMV definitions.

---

## FR-036: EMV Central Database

The company maintains a central EMV database.

The desktop application can synchronize additional EMV data.

---

## FR-037: Database Version

The central database must have a version.

Every add/edit/delete/update affecting the data increments the version.

---

## FR-038: Database Synchronization

If local and server versions match:

> Do not download.

If the server version is newer:

> Download and install the newer database.

Never automatically downgrade to an older server version.

---

## FR-039: Safe Database Updates

Database downloads must be:

- Temporary
- Validated
- Integrity checked
- Atomically installed

If synchronization fails, keep the old database.

---

## FR-040: Offline EMV

Without internet:

- Local EMV detection works
- Local definitions work
- Static decoding works

Company AI is unavailable.

---

## FR-041: EMV Definitions Without Values

If a tag exists in the log but has no value:

- Show the tag
- Show its definition
- Show value as unavailable

Do not require a value to show the definition.

---

## FR-042: EMV Static Decoder

If a valid value exists, the local static decoder should attempt deterministic decoding.

The decoder must not invent values.

---

## FR-043: Invalid EMV Data

If EMV-looking data fails validation:

> Show "Unverified EMV data."

Do not represent it as confirmed.

---

## FR-044: EMV Sidebar

Clicking an EMV tag opens the right sidebar with:

- Tag
- Name
- Value
- Decoded value
- Definition
- Source
- Company AI explanation when available

---

# Company AI Requirements

## FR-045: AI Provider

The only AI provider is the company's AI.

Do not use:

- Ollama
- Gemini
- OpenAI
- Other generic AI providers

---

## FR-046: Company AI EMV Explanation

Company AI may provide:

- Meaning
- Full form
- Explanation
- Parsing explanation
- Contextual interpretation

---

## FR-047: Privacy

The application must not automatically send an entire log to Company AI.

Only minimum required information should be transmitted.

---

## FR-048: AI Cache

Company AI responses may be cached.

Cache keys should include relevant EMV database version and context where necessary.

---

## FR-049: AI Command Palette

Future/general AI functionality may provide a Spotlight/Start-like overlay for:

- Rephrasing sentences
- Rephrasing code
- Explaining logs
- Asking developer questions

This uses Company AI only.

---

# Future Live Log Requirements

## FR-050: Live Logs

Future versions should support live logs, preferably through an Android Studio-like source such as ADB.

---

## FR-051: Bounded Live Buffer

Live mode should keep only a configurable recent number of lines.

---

## FR-052: Pause/Resume

Live logs must support:

- Pause
- Resume

---

## FR-053: EMV While Paused

When live logs are paused, users can investigate the snapshot and run EMV parsing.

---

# Settings Requirements

## FR-054: Settings Categories

Settings should include:

- General
- Appearance
- Search
- Filters
- EMV
- Performance
- Privacy
- Account

---

## FR-055: Local Persistence

Settings must persist locally.

---

## FR-056: Account Synchronization

Where appropriate, user settings/preferences can synchronize with the account.

---

# Performance Requirements

## FR-057

Never render millions of rows.

## FR-058

Never load the complete large log into React memory.

## FR-059

Never send a complete large log through IPC.

## FR-060

Search must not block the viewer.

## FR-061

Indexing must be cancellable.

## FR-062

Large operations must execute outside both the React renderer and the Electron
main event loop. Synchronous SQLite work runs in background workers.
Measure the consolidated performance targets before claiming 500 MB /
10-million-line support.

---

# Security Requirements

## FR-063

Renderer must not directly access filesystem APIs.

## FR-064

Electron context isolation must be enabled.

## FR-065

Node integration must not be exposed to the renderer.

## FR-066

Company AI credentials must not be exposed to renderer code.

## FR-067

IPC inputs must be validated.

## FR-068

EMV database downloads must be integrity checked.

---

# Architecture Non-Negotiables

1. TypeScript throughout.
2. Windows first.
3. Electron + Node.js.
4. electron-vite + React.
5. Zustand.
6. Virtualized log rendering.
7. Disk-backed indexes.
8. Local EMV database.
9. Versioned central EMV database.
10. Company AI only.
11. No Ollama.
12. No Gemini.
13. No OpenAI.
14. No full-log external transmission.
15. Definitions available without EMV values.
16. Static decoder remains local.
17. Multiple independent windows.
18. Future live logs must reuse the existing viewer architecture.
