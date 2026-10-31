# LogDeck: Product and Technical Specification

**Updated:** 2026-10-24  
**Status:** Viewer, advanced offline controls, local tools and Compare implemented; remaining release gates/gaps are explicit.
**Primary product:** A responsive, local-first Windows log/logcat viewer.  
**Desktop runtime:** Electron.  
**Recommended UI:** Vite + React + TypeScript, built with electron-vite.

## 1. How to use this document

This document replaces the old concatenated documentation, which mixed Next.js,
JavaScript, and newer Vite/TypeScript designs. It is the source of truth for the
confirmed release scope and the recommendations below.

Companion documents:

- [Release experience specification](spec.md): confirmed UI, advanced query,
  split-view/export scope, and testable release acceptance criteria.
- [Architecture](01-master-architecture-specification.md): component responsibilities.
- [Technical stack](02-technical-stack.md): technology choices and constraints.
- [Folder structure](03-folder-structure.md): proposed source layout.
- [Functional requirements](04-functional-requirements.md): stable FR-001 through
  FR-068 identifiers, including later-phase requirements.

The workspace now contains a working Electron/Vite/React/TypeScript viewer.
See [the README](../README.md) for commands, supported formats, current bounds,
and implemented versus deferred features. Unit and real Electron tests provide
foundation evidence; numerical budgets below remain acceptance criteria, not
verified maximum-size/reference-hardware performance claims.

## 2. Confirmed decisions

The following decisions were clarified with the product owner:

| Area | Decision |
|---|---|
| Main purpose | Saved `.log` and `.logcat` viewing and analysis |
| Runtime | Use Electron |
| Release 1 | Viewer, search/filters, local EMV, independent Compare, windows/themes/settings |
| Live Android capture | ADB integration comes later |
| Cloud features | Optional company-tag login is implemented; Company AI and log sync come later |
| Reference PC | Windows 10/11, 8 GB RAM, SSD, modern four-core CPU |
| Viewer workload | Existing target: approximately 200 MB typical; up to 500 MB and 10 million lines |
| Compare purpose | Independent Beyond Compare-style text tool, not a specialized log comparison workflow |
| Compare layout | Two editable side-by-side panes, not four panes |
| Compare features | Text files/paste, line/word diffs, navigation, copying changes, saving |
| Compare limits | At most 10 MB and 100,000 lines per side, including edits and paste |
| Visual direction | Modern developer tool; polished home, compact Android Studio-inspired table workspace |
| Themes/motion | Dark/light/system, persisted choice, subtle reduced-motion-aware transitions |
| Home/navigation | Drop area, feature cards below, Features button, optional company-tag Login entry |
| Optional company login | Configured Firebase email/password; disabled with explanation until configured |
| Advanced viewer | Multiline messages, whole-table scroll/wrap, collapsible headers/filters, counted Find, columns, presets, stacked/side-by-side splits and export |
| Query expansion | AND/OR/NOT, parentheses, phrases, explicit regex mode, available metadata fields |
| Development data | Labeled synthetic fixtures plus two supplied local log formats; authorized EMV data still pending |
| Delivery | Verified working increments; no application code before clarification completes |

For test fixtures and byte limits in this specification, MB means 1,000,000 bytes.
The viewer must support a file satisfying both maximum byte and line limits;
these are separate constraints, not a guarantee for arbitrary 10-million-line files.

## 3. Vite + React versus Next.js

**Recommendation: use Electron + electron-vite + React + TypeScript.**

Vite is a build tool, React is the UI library, and Next.js is a React framework.
The practical comparison is a Vite-built React renderer versus a Next.js renderer.

| Consideration | Vite + React | Next.js |
|---|---|---|
| Packaged desktop UI | Direct static renderer bundle | Possible using static export, with routing/asset considerations |
| Production server | Not needed | Not needed for static export; needed for server-dependent features |
| SSR/SEO | Unnecessary for local logs | Valuable for some websites, not this desktop viewer |
| Local filesystem/ADB | Electron IPC and background services | Still needs Electron IPC and background services |
| Toolchain fit | electron-vite separates main, preload, renderer | Additional framework conventions without a required desktop benefit |
| Large-file speed | Depends on data pipeline, workers, and virtualization | Same; the framework does not solve large-file processing |
| Future website | Can be built separately | A reasonable independent choice for marketing/admin web surfaces |

Do not run a Next.js server, local HTTP backend, Python server, or AI model merely
to display logs. Vite's development server is a development tool, not a packaged
runtime dependency.

Next.js is not inherently wrong or always slow, and it does not always require
a server. Vite is recommended because it is the simpler fit for this local desktop
workflow, not because changing the bundler guarantees lower memory or faster search.

### Electron and "lightweight"

Electron includes Chromium and Node.js and is not a tiny native executable.
The realistic objective is a lean, responsive Electron application with bounded
working data, lazy features, and measured process-wide resource use.

Do not promise single-digit MB installation size or negligible baseline RAM.
Vite cannot remove Electron's runtime overhead. Avoid background windows, duplicate
file indexes, always-on polling, unnecessary dependencies, and full-log objects.

## 4. Release scope and priority

### Release 1A: prove the core viewer first

- Open saved logs through file picker, drag/drop, and Windows Open With.
- Show a useful initial viewport before full indexing completes.
- Detect supported logcat formats; preserve raw text for unknown formats.
- Display Time, PID, TID, Level, Tag, Message and a plain-text fallback.
- Stream and index files incrementally with progress and cancellation.
- Virtualize rows, bound caches, reuse persisted indexes, and support independent windows.
- Search, column queries, include/exclude filters, visible highlighting, saved filters.
- Regex-only viewer input, independent split views, column resizing/reordering/
  visibility, go-to-line, selection/copy/export, keyboard help, and wrapped details.
- Light/dark themes and persisted local settings.
- Validate maximum-file behavior on the reference PC before expanding scope.

### Release 1B: local analysis and secondary tool

- Toggleable local EMV detection, tag multiselect/manual entry, extraction,
  definitions, deterministic decoding, right sidebar.
- Bundled versioned EMV metadata; no network required.
- Separate, lazy-loaded two-pane text Compare with explicit limits and safe saves.
- Release 1A remains the priority if secondary features threaten its budgets.

### Later phases

- Automatic multi-pack EMV database sync and broader management backend.
- Google OAuth, verification, password-reset UI and account preference sync.
- Company AI explanations and optional command palette.
- Live ADB ingestion, bounded buffer, pause/resume and paused EMV analysis.
- Expanded visual customization and custom columns.

The Vite/React marketing website and private company-tag publishing UI are separate
from Electron. Firebase Auth/Firestore are optional external identity/definition services.
The desktop reads a small public raw GitHub `version.json` once per app
launch, asynchronously, and on manual checks from Updates. A nonblocking startup
notice shows only a successfully validated newer version; check errors are logged
and available in Updates, not shown as startup notices. The download page opens manually;
there is no automatic download or installation. The AI gateway is still
deferred. Folder sync, binary comparison,
full IDE functionality, and full Beyond Compare feature parity are not promised.

## 5. Recommended technology choices

| Layer | Recommendation | Constraint |
|---|---|---|
| Runtime | Supported stable Electron | Test chosen Windows version, CPU architecture, and native modules |
| Build | electron-vite + TypeScript | Separate main, preload, renderer, worker outputs |
| UI | React, small scoped styles/components | No full-log state or expensive work during rendering |
| State | Zustand | Per-window viewer/query/selection state; narrow subscriptions |
| Viewer rendering | `@tanstack/react-virtual` or equivalent | Prove extreme scroll ranges; DOM virtualization alone is insufficient |
| Data processing | Node worker threads, bounded scheduler | Keep main and renderer event loops responsive |
| Storage | SQLite via `better-sqlite3` | Worker-owned connections; batched writes, ABI/package validation |
| Diff | Bounded Myers line diff and selected-block word refinement | Dedicated worker, work/trace limits, watchdog/cancellation; no instant worst-case promise |
| Compare editor | CodeMirror 6, lazy tool chunk | Virtualized lines; exact 10 MB / 100,000-line load/rejected-edit/save exercised |
| Packaging | electron-builder portable Windows x64 EXE | Native unpacking, optional per-user Open With, manual replacement, configurable signing |
| Tests | Existing/future project runner plus Electron UI tests | No tooling installed solely for this documentation task |

Tested dependency versions are recorded in the manifest and lockfile. Electron
45.0.0 and better-sqlite3 13.0.3 were verified through real worker/database desktop
tests. Electron supplies its own Node.js; build-time Node.js is distinct.

SQLite 13 ships a compatible Node-API prebuild, so the packaging configuration
disables unnecessary compiler rebuilds and unpacks the module from ASAR.
Release preparation must launch both the packaged runtime and portable EXE and
verify SQLite plus worker-backed file opening; a successful development build alone
does not satisfy this gate. Signing still requires a real publisher certificate.

Distribution uses a no-installer portable Windows x64 EXE. Optional Settings
registration adds per-user OpenWithProgids/capabilities without overriding default
apps. Users must register again after moving or replacing the versioned EXE.
GitHub Releases hosts binaries/checksums; Netlify hosts the website and a bounded
same-origin metadata proxy for the latest complete public stable release. Updates
include one asynchronous startup check, retryable manual checks and manual EXE replacement.
Desktop checks use the independent root GitHub `version.json`, not the website
proxy. See [GitHub version notifications](GitHub-version-checking.md).
`npm run release` prepares locally, defaults to a patch bump, and never commits or
pushes. The pushed matching tag triggers CI publication.
See [distribution setup](Firebase-and-website-setup.md).

## 6. Process architecture

```text
React renderer (one per opened window)
  - visible rows, input, selection, small state/cache
        |
        | narrow contextBridge API, validated requests
        v
Electron main coordinator
  - windows, dialogs, session ownership, job scheduling, permissions
        |
        | bounded jobs, progress, cancellation, versioned results
        v
Background workers
  - stream/index, range reads, search/filters, EMV, diff, SQLite
        |
        v
Original read-only logs + local disk indexes + bundled EMV metadata
```

Main owns privileged entry points but does not perform synchronous scans or
SQLite queries. Moving work out of React and into main alone is insufficient.
Start with a small shared worker pool, initially at most two CPU-heavy jobs on
the four-core reference PC. Reserve capacity/priority for viewport reads.
Treat that count as a profiling starting point, not an immutable product limit.

Use utility processes if crash containment is required. Do not create a worker,
database duplicate, or background service per component/window without a budget.
Allow multiple windows on the same unchanged file to reuse a shared index while
keeping selection, scroll position, queries, and filters independent.

Workers release jobs, streams, connections, and subscriptions when their final
owning session closes. Closing one window must not cancel another window's session.

## 7. File ingestion and line indexing

### Pipeline

1. Validate a user-authorized path, file existence, access, and supported input.
2. Open a read-only source handle and capture identity/version metadata.
3. Read a bounded prefix for preview and format/encoding detection.
4. Stream byte chunks; do not call whole-file `readFile()` or `split()` on large logs.
5. Carry partial records across chunks; identify newlines at the encoding's byte level.
6. Persist line number, byte offset, and byte length using batched transactions.
7. Publish indexed progress and available ranges without per-line IPC.
8. Mark an index complete only after successful completion and source revalidation.

Initially use SQLite line records with indexed numeric line IDs. Do not duplicate
every raw message into SQL/FTS or JS objects by default. A fixed-width packed index
is a fallback only if the benchmark proves SQLite misses the budgets.

At 10 million lines, even an illustrative 16-byte packed entry is about 160 MB on
disk before other metadata. SQLite adds overhead. Disk-backed is not disk-free:
display cache size, support eviction, and measure actual amplification.

### Text correctness

- Proposed baseline: UTF-8 with/without BOM, CRLF/LF, and no final newline.
- Retain CRLF byte accounting while displaying line content without terminators.
- Handle UTF-8 characters and CRLF split across chunks without corrupting offsets.
- Empty files and mixed newlines must not invent or drop source content.
- Malformed UTF-8 requires an explicit warning; preserve original bytes.
- UTF-16, legacy encodings, and binary inputs require explicit detection and a
  supported decoder or a clear unsupported-format message, never silent UTF-8 corruption.
- Never turn an exceptionally long line into an unbounded allocation. Display a
  labeled bounded segment and allow chunked inspection/copy of further segments.
  Search must report any imposed record limit, never silently omit content.
- A malformed logcat line remains visible as raw text; do not drop it.
- Multiline stack traces retain physical line numbers; parsed continuation
  attribution must not hide original source lines.

Use explicit supported logcat parsers, initially prioritize threadtime, and test
additional layouts against representative samples. Do not claim all logcat
formats or a reliable year/timezone when the input does not contain them.

### Implemented format adapters

- Threadtime text: whitespace-tolerant regex extraction into Time, PID, TID,
  Level, Tag, and Message. Raw/continuation/buffer-marker lines remain visible;
  absent metadata stays blank and source order is unchanged.
- Android Studio JSON export: a streaming tokenizer validates `logcatMessages`
  and indexes individual object byte spans instead of pretty-printed physical
  lines. Each object is one table record; original JSON line, application ID,
  and process name are retained for search. Epoch seconds/nanos display as UTC
  with nanosecond precision.
- Current JSON bounds: 1,000,000 bytes per record, 1 MB string buffer, depth 64.
  Malformed/unsupported JSON fails explicitly. These limits do not impose an
  equivalent whole-line allocation on ordinary text.
- The two supplied local formats and synthetic fixtures are covered by tests.
  Other Android export layouts and encodings are not implicitly supported.

### Source changes and recovery

Release 1 opens saved-file snapshots, not live tails. If a source grows, truncates,
is replaced, or changes during reading, mark the session stale and offer reload.
Never combine offsets from one generation with bytes from another.

Show explicit errors for missing files, permission denial, unsupported encoding,
disk full, corrupt cache, oversized input, and interrupted processing.
Cancellation must not leave a partial index labeled complete. Clean/rebuild
or safely resume a validated partial index; do not guess.

### Persistent cache

Use `%LOCALAPPDATA%\LogDeck\indexes` for rebuildable local indexes, not roaming
AppData. Persist settings separately through Electron's configured user-data path.

Cache identity includes canonical file identity/path, size, high-resolution
timestamps, parser/index schema versions, and bounded content fingerprints.
Compute a full hash during the first streaming pass where possible, not through
an unnecessary second read.

The current implementation uses one shared worker and schema `offset-index-v3`.
Metadata change time is stored with the completed index, not included in its
lookup key: Windows may update it without changing file content. A changed
metadata time triggers full SHA-256 validation; changed content rebuilds a cached
index or invalidates an active session. Unchanged content can safely reuse offsets.
Completed source size/modification time/identity are also checked on range reads.

Fast validation is heuristic: metadata and sampled bytes cannot prove that an
arbitrary same-size/same-timestamp file was unchanged. Document that limitation;
provide full content verification/rebuild for correctness-sensitive investigations.
If identity is uncertain, rebuild rather than knowingly reuse stale offsets.

Track last access and cache bytes; evict unused entries by a configured disk budget.
Protect active sessions, surface low-disk conditions, and allow explicit cache clear.
Log-derived indexes and search results can be sensitive; never sync them to accounts.
Eviction, cache-clear UI, and user-requested always-full verification are not yet
implemented; these paragraphs define the remaining release contract.

## 8. Viewer rendering and scroll design

- Fixed-height, no-wrap rows by default, with one whole-table horizontal scrollbar.
  The product owner replaced click-to-open details with row selection and an
  optional all-column wrap toggle. Wrap measures visible variable-height rows.
  Inline byte-segment controls preserve long raw content without a side panel.
- Render visible rows plus bounded overscan, typically 50-150 rows, depending on
  viewport and font. Never render the full dataset.
- Fetch bounded ranges, prefetch adjacent ranges, and use an LRU cache.
- Coalesce repeated requests; cancel or discard responses for outdated generations.
- Initial proposed IPC caps: 500 rows or 1 MB per range response, whichever comes
  first; split long-record payloads explicitly. Limit outstanding requests and queue bytes.
- Keep raw log strings and result ID arrays out of full-file React/Zustand state.
- Long messages need horizontal clipping/virtualization or segmented details;
  row virtualization does not protect against a single massive DOM text node.

The implemented segments contain at most 50,000 no-wrap or 200 wrapped entries.
The bottom thumb/range follows actual viewport positions, not just segment starts.
File/home/conversion/EMV tabs are window-local; active file/tool updates the native
title. Up to 12 files/20 total tabs per window; inactive file tabs release row
caches and disable viewport reads while retaining query/layout/vertical position.

**Critical: 10 million rows exceed practical browser scroll-height limits.**
At 20 px per row, a naive spacer would be 200 million px. Use a segmented/rebased
logical scroll model, with global line numbers independent of browser pixel height.
Provide Go to Line and test first, middle, last, thumb drag, wheel, keyboard,
selection, and filtered results. Adding a virtualization library alone does not
prove 10-million-line navigation.

For cached ordinary scrolling, aim for no spinner. Cold random seeks can show an
honest non-blocking placeholder rather than freeze or display stale rows.
Preserve raw text, stable line IDs, selectable/copyable content, column controls,
and visible-match highlighting without rescanning unrelated rows.

## 9. Search and filters

Supported concepts:

```text
timeout
connection failed
MCEMV|Payment
Core\.(?!Dal)
```

The UI applies JavaScript Unicode regex on Enter or Apply, without delimiter
slashes. Case sensitivity is explicit. Do not silently treat an
invalid query as a successful empty result.

- Expression parsing remains an internal compatibility API, not a viewer mode.
  Legacy expression presets are preserved but rejected with an explicit UI warning.
- Regex matches raw records and combines with More filters categories using AND.
  The sidebar and expression selector are removed. Do not claim exact
  Android Studio query syntax compatibility. See [release requirements](spec.md).
- Within a multi-select category such as levels, selected values are OR.
- Include/exclude behavior must be explicit; excludes remove matching records.
- Raw/plain text supports message/text queries; unavailable columns are explained.
- Time ranges require parseable time data. Explain missing years, zones, or dates.
- Search runs in workers and streams bounded match batches with progress.
- Keep large result sets as a disk-backed mapping/compact structure, not millions
  of JS match objects or one enormous IPC payload.
- Use new query generations to suppress stale results after user edits.
- Initial search-input debounce recommendation: 150-250 ms.
- Highlight all occurrences in visible content; distinguish active match from
  other matches and keep Previous/Next usable.
- Show partial versus complete result counts while indexing/scanning continues.

An offset index enables line lookup, not instant substring or regex search.
Initial text search may stream the source. Add metadata/search indexes only
after measurements justify their storage, write cost, and actual semantics.
FTS token matching is not a substitute for arbitrary substring/regex behavior.

Regex must not be allowed to hang the app. Use an isolated worker with a watchdog
able to terminate a stuck job; cooperative cancellation alone cannot interrupt a
catastrophic JS regex. Validate syntax, bound tasks/results, report timeout, and
recreate the worker. A linear-time engine is an alternative only after documenting
its syntax restrictions. Never silently change regex semantics.

### Implemented search subset

Regex and level/tag/PID/TID/application/include/exclude/time categories
are available in the top filter bar and collapsible More filters section after indexing completes.
Enter or Apply filters runs explicitly rather than
rescanning on every keystroke. Full result IDs remain in SQLite file-backed
temporary tables owned by a session, with generation-checked ranges and original
source-ID lookup. Scans yield between batches and expose progress/cancel/partial/
error states. Closing a tab cancels its scan and drops only its result table.

Bounds: 2,000 characters, 1 MB per complete source entry, two-minute scan timeout.
The internal legacy expression API additionally limits tokens to 256 and depth to 32.
Larger entries fail explicitly. In that API, PID/TID/level/line are
exact fields; other fields contain text, with optional case sensitivity. Time
bounds currently compare inclusive source strings in the same format/precision;
they do not normalize dates/timezones. `-field:value` is unary field exclusion,
equivalent to `NOT field:value`; `Core. -tag:Core.Dal` is supported internally, not in the UI. Filtering does
not highlight. Ctrl+F opens an independent top-right literal Find popup over the
log area. A session-owned SQLite file-backed occurrence table stores filtered
ordinal, source record, visible column and UTF-16 start/end offsets. The renderer
receives counts and one requested occurrence, not the entire result list.
Counts cover repeated and off-screen occurrences; up to 400 highlights per cell
plus the current occurrence are drawn. Enter/F3 and Shift+Enter/Shift+F3 navigate
occurrences with wraparound, without changing copy/export selection. Find has its
own case option and the same 1 MB record / two-minute bounds, with at most two
finds concurrently. Incomplete counts are explicit; navigation waits for completion.
Changing filters or visible columns invalidates/recounts Find. Closing Find cancels
its scan and drops its occurrence table. Regex occurrence highlighting remains a gap.
See [the README grammar](../README.md#search-and-filters).

Regex tests raw records using JavaScript Unicode syntax (`u` or `iu`, without
delimiters) only after advanced filter predicates pass. Each disposable regex worker has
a 32 MB old-generation limit and a 500 ms batch watchdog. Batches contain up to
200 entries / approximately 256 KB (one entry may reach the separate 1 MB bound).
The whole scan retains the two-minute deadline. Cancellation terminates the worker.
At most two searches run concurrently across all views/windows.

Local saved investigations support up to 50 named regex/filter presets,
including apply/rename/delete. Settings > Columns supports persistent width,
order, visibility and defaults; Message remains visible. Two stacked or side-by-side split panes
use separate session/query/selection/scroll state. Splitting the same file shares
its index; Open another log loads/replaces an independent secondary file.
Picker cancellation or failure preserves the previous secondary session.
Main-process session metadata retains parent associations across renderer reloads,
and closing a primary closes its secondary.
Column and display preferences are intentionally shared across views/windows.
Hiding tabs also hides navigation; a fixed top-right restore button brings both back.
F11 remains reversible logs-only mode. Up/Down moves a single selected log through
filtered ordinal positions across virtual pages without stealing input/button keys.

Selections are compact sorted disjoint ordinal ranges, not one object per source
record: click toggles selection off/on, Ctrl/Meta-click toggles individual rows,
and Shift-click/Enter selects an anchor range. Up to 500 disjoint ranges are accepted.
IPC rejects mixed range formats, unordered/overlapping/out-of-bound ranges, and
filtered-result generations are checked. Full-record copy supports up to 500 records /
512,000 bytes in source order, including off-screen/unloaded segments. Ctrl+C in
the table preserves native text selections; Ctrl+Shift+C explicitly copies records.
Clipboard text uses an owned-window, write-only IPC bridge with a 512,000 UTF-8-byte
bound, not blanket browser clipboard permissions.
Export all/selected/completed
filtered results streams original bytes with LF separators through a native
destination picker. Android JSON objects retain their original internal newlines,
so output defaults to `.txt`, not a JSONL claim or reconstructed export container.
Progress/cancel, temporary-file cleanup, source
protection and destination checks preserve existing files on cancel/error. Query
replacement is blocked during the view's export to preserve its result mapping.

The More filters section also exposes a persisted text-only/full-row-background severity choice,
using existing light/dark palette variables. Selected rows override the background
with an accent stripe; the level label remains. File metadata is collapsible below
filter/preset controls. The bottom slider tracks scrolling without the redundant
textual Records/Matches range counter.

Embedded message newlines and spacing are preserved in both horizontal-scroll
and wrap modes; measured virtual rows grow to their content height. Navigation,
tabs and viewer controls can each be hidden and restored. F11 toggles logs-only
mode; a floating Restore headers button remains available.

## 10. Local EMV

### Current local editing workspace

The product owner requested a dedicated parser/editor page instead of a
general message-detail sidebar. Navbar EMV opens a tool tab with an explicit Visa /
Mastercard selector, immutable original, editable modified hex, and per-byte
tables (b8 through b1, meaning, original and modified). Toggle/edit operations
preserve all unrelated bits. RFU fields have no semantic toggle; raw edits remain
possible but are explicitly not compliance validation.
Byte/bit tables use a two-column grid on wide windows and stack below 1,050 px;
each card keeps its own overflow available instead of clipping table content.

Bundled common reference layouts: TVR (95), AIP (82 byte 1), Terminal Capabilities
(9F33), CVM Results (9F34). Visa CTQ (9F6C) and TTQ (9F66) are scheme-gated.
Mastercard selection supports common EMV fields, not guessed Visa qualifiers.
9F6E and kernel-specific AIP byte 2 stay raw-only until verified versioned
definitions are available. CVM method/condition/result are coded fields.
For TVR `8000000000`, clearing byte 1 bit 8 yields `0000000000`.

The local BER-TLV parser validates tag/length/value boundaries, nested containers,
duplicate occurrences and value offsets. Selecting a supported leaf establishes
its original baseline. Fixed-length edits replace only that occurrence in a
separate modified sequence. Bounds: 65,536 bytes, 2,000 nodes, depth 16. Indefinite
lengths, padding and APDU framing are not silently stripped or guessed.

The ASCII/hex tool is also local: strict 00-7F by default, complete byte pairs,
32,768 bytes, explicit invalid-input errors and an escaped control-character preview.
The approved Latin-1 byte mode maps 00-FF directly to Unicode U+0000-U+00FF and
round-trips receipt/control bytes losslessly. It is not Windows-1252 or guessed
UTF-8; byte 80 stays a control. Characters above U+00FF are rejected, and the preview
escapes C0/C1 controls. Both modes share the same input bounds and hex validator.
Neither tool contacts paymentcardtools.com or copies its implementation. This is
not a claim of full site parity, current kernel certification or authoritative
card-configuration validation. Original source logs are never rewritten.

Reference basis: common EMV 4.x Book 3 Annex C data layouts (TVR, AIP, capabilities
and CVM); limited legacy Visa qualifier layouts. Public cross-checks include
[Terminal Capabilities](https://emv.cool/2020/12/23/Terminal-Capabilities-9F33/),
[Visa TTQ](https://emv.cool/2020/12/24/Terminal-Transaction-Qualifiers-TTQ-9F66/),
and the [scheme-specific 9F6E status](https://emvlab.org/emvtags/show/t9F6E/).
These are reference sources, not runtime dependencies or certification evidence.

### Automatic context-aware log tracker

Approved default: each newly opened view enables **EMV on**. It detects candidates
in the file worker while reading bounded displayed ranges (including a small
prefetch), not by a startup full-file scan. New regions are recognized as the user
scrolls/searches/navigates. There is no whole-file EMV inventory or count. Switching
EMV off clears that view's annotations and definition panel, invalidates outstanding
range results, and requests subsequent ranges without recognition. Tabs, splits and
windows keep independent tracking state. Recognition never performs runtime HTTP,
Firebase, AI or log-upload requests. An explicitly downloaded company pack is applied
locally alongside the global dictionary.

The versioned local dictionary (`1.1.0`, 60 entries) contains original short reference summaries
for common tags, separate from the seven-tag editable decoder coverage. Public fact
references include [EMV tag search](https://emvlab.org/emvtags/),
[9F02](https://emvlab.org/emvtags/show/t9F02/) and
[95](https://emvlab.org/emvtags/show/t95/). Names/identifiers are factual references;
no third-party site's implementation or full prose database is copied.

Recognized forms include `Tag 95: 8000000000`, `tag: 9f 02[6]: ...`,
`tag[31]:9f01`, known multi-byte `9F02[6]:00 00 00 00 00 12`, and
`T: 9F33 L: 3 V: E0F8C8` / `#[T]: 70 L: 41` dump notation.
Dump recognition is syntax-driven, including unknown tags without per-tag code.
Local meanings remain dictionary-driven: 9F33 is included and 9F13 now supplies
Last Online Application Transaction Counter reference details. `L` is a decimal
byte count validated against supplied hex and fixed dictionary lengths; missing
container values remain unavailable and do not consume the next record's data.
Short numeric tags need an explicit Tag/EMV context, not just a bare `95` or `82`.
Bare hexadecimal blobs, DOL requests and arbitrary APDU frames are not guessed.
An explicit single-line `TLV: ...` payload is parsed with the same strict BER-TLV
parser as the editor; nested/duplicate tags retain separate source occurrences.
Invalid TLV payloads show a reason and no partially validated annotations.

Recognition is capped at 16,384 displayed characters and 64 occurrences per
segment; retained values are limited to 256 bytes. Truncation/limit notices are
visible. Values or TLVs at a possibly clipped boundary are not decoded/validated.
Worker metadata is included in the existing 900 KB range-response budget.
The dictionary and annotations never become a full-log renderer data structure.

Clicking/focusing a tag and pressing Enter opens only its **EMV definition** panel,
not the removed Message Details. It shows tag/name/summary, record ID, physical
line, segment byte offset, displayed-text character position, reference version,
original hex and validation reason. Character position is relative to the displayed
message/raw segment, not an absolute file byte address. Source record bytes remain
unchanged. Search marks, wrap and horizontal table scroll coexist with tag buttons.

- Known tag without a value: definition plus **unavailable**.
- Malformed hex, declared-length/fixed-length mismatch: **invalid** with reason.
- Clipped/oversized extraction: **unverified**, not passed to a decoder.
- Explicitly labelled unknown tag: **Unknown tag**, never an invented definition.
- Structurally valid value: syntax/available length checks only, not semantic
  certification or proof of a scheme/profile.
- Supported valid value: **Open value in EMV editor** opens an independent tab
  with the input prefilled; user verifies the profile and presses Decode before
  editing. Other tags remain reference/raw-only.
- Sensitive PAN/track/name tags include a local handling warning.

This is not complete EMV/kernel coverage. Broader scheme/proprietary definitions,
authoritative versioned bit layouts and whole-file discovery remain future work.

## 11. Independent Compare tool

This is a secondary Beyond Compare-style **text** tool, not a clone or a promise
of every feature from that product. It can open logs as text, but it does not use
the log viewer's index or treat comparison as a log-analysis pipeline.

- Separate on-demand tool tab; lazy-load editors and diff dependencies. An
  independent window can host its own Compare workspace.
- Two editable panes with virtualized line numbers and changed-line styling;
  the selected block has side-by-side word-highlight previews.
- Open text files or paste text; start from empty buffers where needed.
- Previous/next difference and copying a selected change in either direction.
- Mark documents dirty; support undo/redo and preserve unsaved-change warnings.
- Save/Save As only by explicit action; opening a file never writes it.
- Confirm replacement, check source metadata for external edits, and require a
  user decision on conflict. Do not overwrite an externally changed file silently.
- Preserve detected encoding/newlines where supported; unsupported encodings
  require an explicit conversion choice, not silent corruption.
- Write through a temporary file in the destination directory and a tested
  replacement strategy; report permission/locking failures and retain the dirty buffer.

Both limits apply to each pane: **10,000,000 bytes and 100,000 lines**.
Check before file load and before committing paste/edit/copy-change actions.
For buffers, count encoded bytes, not JavaScript character count.
Reject oversize actions with a clear limit message; never silently truncate.

Debounce recalculation, version jobs, discard stale diff results, and compute line
diffs in workers. Refine word differences only in bounded changed blocks.
Worst-case diff complexity remains significant at these limits: provide cancellation,
a watchdog, and an explicit timeout instead of claiming instant comparison.
If word refinement is skipped, label it and retain line-diff navigation.

Compare resource budgets are measured separately while a large viewer stays open.
Folder comparison/sync, binary formats, and unrestricted 500 MB editing are excluded.

### Implemented bounds and evidence

CodeMirror is loaded only when Compare is opened. A native-textarea prototype
stalled on a high-line-count input; the virtualized editor now validates edits in
its transaction filter before committing document changes. Tests open exactly
10,000,000 bytes / 100,000 lines, keep rendered editor lines below 200, reject an
oversized edit and verify unchanged saved bytes. This is functional limit evidence,
not reference-PC memory/latency certification.

At most two Compare tabs per window. Per pane, undo/redo retains at most 50
snapshots / 20 MB of UTF-16 history. Documents support valid UTF-8 plus optional
BOM, LF or CRLF; invalid encoding, NUL/binary, standalone CR and mixed newlines
are rejected for explicit external conversion rather than silently rewritten.
Byte validation includes the selected newline and BOM representation.

Diff recalculation is debounced 250 ms. Disposable versioned workers have a
five-second watchdog, approximately four-second internal deadline, 1,000,000
trace-cell budget and at most 10,000 changed blocks. A bounded Myers implementation
was chosen to expose these limits explicitly; randomized reconstruction tests
check exact source ranges and duplicate-line preservation. Word refinement runs
only on the selected block, up to 4,000 combined characters / 200 tokens per side;
larger blocks explicitly label skipped refinement. Inactive Compare tabs pause work.

Save uses authorized window-owned document tokens, UTF-8 encoding preservation,
SHA-256 conflict checks, native Cancel / Save As / Overwrite, a flushed destination-
adjacent temporary file and destination rechecks before replacement. Dirty buffers
survive cancel/error; dirty tab/window closure prompts before discarding. Files open
in any read-only log viewer cannot be overwritten by Compare.

## 12. Window lifecycle, settings, and accessibility

Home offers drag/drop, Open, Compare, recent-file actions where configured, and
Settings. Do not create Settings/Compare windows or initialize their libraries
until requested. No login prompt or network prerequisite for local viewing.

Home has a prominent drop zone with an equivalent file-picker button, supported
formats, and feature cards underneath. Navbar contains Home, Features (home section),
Open, Compare, Settings, appearance, and Login. Login opens optional company-tag access.
Unconfigured builds disable credentials and downloading with an explicit explanation.
Features distinguish implemented, planned, and synthetic-demo status.

Use a compact table workspace and collapsible left filters; the current revised
UX uses a separate EMV tool tab, optional all-column wrap, and no automatic
Message Details panel. Independent stacked split views are implemented. Use dark/light/system themes,
persisted appearance, and finite 120-180 ms opacity/transform transitions that respect
reduced motion. No animated log rows or perpetual decorative animation.

- `Ctrl+N`: new independent window.
- Settings and Compare never replace an active viewer.
- If a Windows Open With request reaches an already-running instance, route the
  validated file request to a new viewer without losing existing sessions.
- Use application-local shortcuts unless a later feature explicitly needs a global hotkey.
- Persist themes, display preferences, saved queries/filters, and cache controls.
- Settings exposes a 10-18 px log font, default wrap and inactive-index cleanup.
  Cleanup removes only recognized inactive index files, not active DBs or sources.
  Automatic cache eviction remains future work.
- Account, cloud sync, and Company AI settings appear only in their implementation
  phase; the explicitly labeled Login explanation is the only release-1 auth entry.
- Keyboard-operable controls, readable focus, and non-color-only difference/error
  cues are required. Test high-DPI and display scaling.

## 13. IPC and desktop safety

Use `contextIsolation: true`, `nodeIntegration: false`, and a sandboxed renderer.
Expose a small feature-specific `contextBridge` API, not raw `ipcRenderer`,
`require`, `process`, `fs`, or shell execution.

Main validates sender/window origin, session ownership, request schema, ranges,
payload sizes, file authorization, and save destinations. Do not accept arbitrary
filesystem paths from untrusted log content. Use session IDs for authorized files.
Escape log contents as text; never interpret log HTML or terminal control sequences
as executable markup.

Use a restrictive content security policy, block unapproved navigation/popups,
and open only validated external HTTPS links in the system browser.
Package local assets with no remote script dependency; test the chosen local
file/protocol loading strategy and CSP in the packaged app.

Operational diagnostics must avoid log contents, payment data, credentials, and
unnecessary full local paths. Release 1 needs no telemetry or automatic uploads.
These are design requirements, not the result of a security audit of source code.

## 14. Future cloud, authentication, and live ingestion

### Versioned EMV database synchronization

Maintain separate schema and monotonically increasing data versions.
Equal versions: no download. Newer compatible server version: download to temporary
storage, validate size/schema/checksum and trusted provenance, then activate.
Older server version: no automatic downgrade; report the inconsistency.

Keep a known-good version and recover from failed updates. On Windows, avoid replacing
an open database: install immutable versioned files, close/switch connections safely,
and update a small active-version manifest using a tested crash-safe strategy.
An untrusted checksum beside an untrusted download does not establish authenticity.
Do not contact the update endpoint on the critical startup path.

### Website and company-tag authentication (implemented, requires configuration)

The separate Vite/React website offers Home, Features and Download using the desktop
visual template, plus `/admin` for company pack publication. Route visibility is not
authorization: Firestore rules enforce active company membership and admin-only writes.
Firebase email/password uses bounded REST requests, with no Firebase SDK dependency.
ID/refresh tokens exist in memory only. Desktop network calls run in main, never the
renderer, and no log content is sent. Authentication does not run on startup.

The shared pack validator bounds uploads/downloads to 512,000 UTF-8 bytes, 1,000
unique hexadecimal IDs, safe integer versions and bounded text fields. Admin
publication atomically creates an immutable version and advances the catalog using
compare-and-swap preconditions. Rules disallow membership self-grants, enumeration,
cross-company reads, updates/deletion of packs and non-increasing versions.

Only the Settings **Download EMV tags** action fetches a pack. Main revalidates it,
rejects downgrade or a modified equal version, applies the worker definition set,
and atomically replaces the local cache; failed persistence restores the old worker
pack. One company pack is active per profile. Global definitions and value checks
are never overwritten: inspector displays both sources, versions and separate length
checks. Company definitions do not create new editable bit layouts.

Sign-out/window close discards credentials but not downloaded definitions. Revocation
blocks future cloud access; it cannot revoke an existing offline copy. Local cache
is plaintext JSON protected by the user's OS profile permissions, not DRM or encrypted
storage. See [setup, trust boundaries and operator responsibilities](Firebase-and-website-setup.md).

### Company AI and future authentication

Company AI is the only product-facing AI integration; no local model or generic
provider selector. LiteLLM is a planned backend detail, not a desktop Python dependency.
Actual endpoints, authorization, data handling, and retention policies remain unconfirmed.

Shared gateway/provider keys stay on the backend, never in renderer or main bundles.
Use short-lived per-user authorization. Store refresh tokens with OS-backed
encryption managed by main; never expose raw tokens to UI state.

For Google desktop OAuth, use the system browser, a registered Desktop client,
PKCE, state validation, and a temporary loopback listener. Do not assume a custom
URL scheme is a valid Google desktop redirect. Close listeners on success, failure,
or timeout. A company-brokered HTTPS login is an alternative requiring its own contract.
Email/password verification and password reset belong to an identity backend, not
locally stored desktop passwords.

AI requests require explicit user action, a preview of the minimum necessary
context, and redaction of payment/customer data. Never automatically upload a full log.
Cached explanations must include user/account scope, EMV version, tag, value/context
hash, and relevant explanation configuration; support expiry/clear and avoid raw
sensitive values in cache keys. AI explanation is assistive, not authoritative decoding.

### Live ADB

Reuse normalized records and viewport APIs, not an ever-growing React array.
Introduce a bounded recent-line/byte buffer with drop counts and clear lifecycle.
Pause should preserve an inspectable snapshot while ingestion behavior is defined
explicitly; resume must report dropped data. Device selection, ADB distribution,
disconnect/reconnect, and snapshot retention need decisions in that phase.

## 15. Proposed measurable performance budgets

Reference: Windows 10/11 x64 candidate, 8 GB RAM, SSD, four-core CPU, packaged
production build, no DevTools, no cloud tasks. Exact Windows builds/CPU/SSD and
supported CPU architectures must be fixed before publishing support claims.

| Metric | Initial proposed budget | Measurement definition |
|---|---|---|
| Cold startup | <= 3 s | Launch to interactive home; no prestarted app |
| First useful file viewport | <= 1 s | Valid open request to readable initial rows, index not required complete |
| Cached reopen | <= 1 s | Validated reusable index to interactive viewport |
| Full 200 MB indexing | <= 10 s | Open accepted to durable complete index |
| Full 500 MB / 10M-line indexing | <= 30 s | Both limits satisfied; include DB commit/checkpoint completion |
| Cached scroll response | p95 <= 50 ms | Input to correct newly visible rows; profile frame times separately |
| Scrolling frame goal | Near 60 fps on reference display | Steady cached scroll; count long tasks/dropped frames |
| Cold indexed random seek | p95 <= 200 ms | Seek request to correct readable rows |
| Simple search, 500 MB | <= 5 s complete | Case-defined substring query after full indexing; output disk-backed |
| Job cancellation | <= 250 ms acknowledged | User action to UI/job acknowledgement; blocked regex uses worker termination |
| Idle total memory | <= 250 MB | Sum Windows private bytes across all LogDeck processes, home only |
| One maximum-sized viewer | <= 500 MB steady; <= 750 MB peak | Same process-wide metric, including workers, no Compare |
| Idle CPU | < 1% average | Whole-machine normalized process sum, 60 s after jobs settle |

Targets are intentionally explicit and must be revised transparently if the
prototype disproves them. Do not silently weaken correctness to meet a budget.
Package/download size and Compare memory/time budgets remain to be measured after
the compatible runtime/editor are selected; no invented shipping figures.
Multiple windows do not inherit the single-viewer memory ceiling automatically.

## 16. Verification and release evidence

Tests to implement, not tests already run:

1. **Index correctness:** UTF-8 boundaries, CRLF splits, no final newline, empty
   files, malformed/long lines, count/offset round trips, 10-million-line final seek.
2. **Cache lifecycle:** unchanged reuse, append/truncate/replace, stale fingerprints,
   corrupt DB, cancellation, crash recovery, schema upgrade, disk full.
3. **Viewer/search:** exact phrases, AND/OR filter rules, field validation, invalid/
   pathological regex, no stale results, no giant result IPC, highlight correctness.
4. **Scale:** separate 200 MB, 500 MB, and 10-million-short-line fixtures; all-match/
   no-match searches, long records, sparse/dense matches, cold/warm I/O.
5. **Windows:** Open With while running/not running, paths with spaces/Unicode,
   multiple windows on same/different files, source deletion/locking, high DPI.
6. **EMV:** known/unknown/manual tags, false positives, malformed TLV/lengths,
   missing values, selected-tags-only decoding, no traffic while offline.
7. **Compare:** two-pane edits, undo/redo/copy, limits at/below/above both thresholds,
   UTF-8 byte counts, stale diffs, cancellation, conflict/save failures, dirty-close warning.
8. **Isolation:** index/search/compare while scrolling a viewer; one closed window
   does not corrupt another; memory and file handles settle after repeated open/close.
9. **Packaging:** portable build loads native SQLite and workers, honors CSP,
   requires no production server, opens offline, and retains required file associations.

Record hardware, OS, app/runtime versions, fixture bytes/lines/encoding, cold/warm
cache state, timings, process-wide memory/CPU, cache disk size, and failures.
Use repeated runs; report distributions and p95 for interactive actions.
Do not label results "500 MB supported" based only on a small-file demo.

## 17. Remaining inputs before release completion

The product direction is clear enough for a viewer prototype. These are not
silently assumed complete:

- Additional sanitized formats/encodings, longest records, and real EMV examples;
  two representative saved-file formats have already been supplied and tested locally.
- Authorized bundled EMV dataset, proprietary tag rules, and redistribution rights.
- Windows 10/11 x64 release hardware verification and real publisher signing;
  ARM64 is not currently distributed. Portable/manual-update policy is selected.
- Real-hardware validation of the proposed performance budgets and cache disk budget.
- Compare editor/library selection after measuring the agreed input limits.
- Future backend/auth/AI endpoint contracts, licensing, privacy, and retention policies.

Do not request production payment logs or secrets. Use synthetic or sanitized fixtures.
Finalize the relevant inputs before claiming parser completeness or production readiness.

## 18. Official technical references

Public documentation consulted for design corrections on 2026-10-24:

- [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports):
  static export does not require a production Next.js server.
- [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance):
  measure resource use; avoid blocking both main and renderer.
- [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules):
  native ABI compatibility and rebuild/package validation are required.
- [Google OAuth for installed applications](https://developers.google.com/identity/protocols/oauth2/native-app):
  desktop apps are public clients and use system-browser/loopback authorization.
