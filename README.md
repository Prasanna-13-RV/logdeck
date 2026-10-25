# LogDeck

A local-first Electron desktop viewer built with electron-vite, React, and
TypeScript. The viewer, browser-style tabs, search, local tools, and text Compare
are working increments, not the complete release.

## Run on Windows

Use a current Node.js version compatible with Vite 8 and npm. Development was
verified with Node.js 26.5.1; Electron uses its own bundled Node.js runtime.
Run these commands from the project directory:

```powershell
npm.cmd install
npm.cmd run dev
```

To build and open the production renderer:

```powershell
npm.cmd run build
npm.cmd start
```

`npm.cmd` avoids PowerShell's blocked `npm.ps1` on machines using a restricted
script execution policy. No policy change is needed. Installation downloads
Electron and requires network access; normal local file viewing does not.

## Working now

- Home with file picker, drag/drop, synthetic demo, feature cards, and navbar.
- Light, dark, and system themes with persisted appearance and reduced motion.
- Read-only saved-file viewing with worker-owned SQLite byte-offset indexes.
- Virtualized Time / PID / TID / Level / Tag / Message table.
- Collapsible filter/regex sidebar and bounded complete-record copying.
- Entire-table horizontal scroll or optional all-column, measured row wrapping.
- Row clicks select; they do not open a Message Details panel.
- Go-to-line/record and segmented navigation to avoid huge browser scroll areas.
- The bottom position indicator follows actual scrolling as well as slider dragging.
- Chrome-style file/home/tool tabs; active filename updates the native window title.
- Each file tab keeps its query, filters, wrap mode, selection and vertical position.
- Worker-backed AND/OR/NOT filtering, separate top-bar highlight-only search, matching-record navigation,
  cancellation, explicit errors, and partial/complete counts.
- Isolated, watchdog-protected regex filtering; persisted severity text/row-background styles.
- Persistent column visibility/order/width, named query/filter presets, and
  two independently filtered/scrolled panes of the same log, stacked top/bottom.
- Click-to-deselect, Ctrl/Meta multi-selection, continuous Shift-selection, bounded full-record copying, and cancellable
  full-record export of all, selected, or completed filtered results.
- Lazy-loaded virtualized two-pane text Compare: line/word differences,
  previous/next change, copying changes, undo/redo, safe Save/Save As.
- Local font/default-wrap settings and inactive-index cleanup.
- Strict hex/ASCII and lossless Latin-1 byte conversion; a local original-versus-edited EMV workspace.
- Automatic context-aware EMV tag highlights in displayed log records, clickable
  offline definitions/value checks, per-view disable and supported-value editor handoff.
- Index progress, cancellation/reopen, cache reuse, and independent windows.
- Explicit errors for invalid input, unsupported encoding, and source changes.
- Future Firebase login explanation; no credentials collected or fake login.

## Supported formats

Content determines the adapter, not the filename alone. Both `.log` and
`.logcat` are accepted.

| Input | Mapping |
|---|---|
| Android Studio JSON export containing `logcatMessages` | Each message object becomes one table record; header fields supply the columns |
| Android threadtime text | A tested whitespace-tolerant regex extracts timestamp, PID, TID, level, tag, and message |
| Other plain-text lines | Original text stays visible in Message; unavailable metadata stays blank |

Text records remain in source order. Parsing is not chronological sorting.
Buffer markers, continuation lines, and stack traces are preserved rather than
guessed into unrelated columns. Text timestamps retain their original meaning;
no missing year or timezone is invented.

JSON timestamps use explicit UTC with nanosecond precision. Application ID and
process name are available for field search; JSON table identities are record IDs,
not pretty-printed physical source lines. The underlying records retain source-line metadata.
Supported input is UTF-8, optionally BOM-prefixed, with LF/CRLF line endings.
UTF-16 and detected binary input are rejected. Invalid UTF-8 produces a warning.
Malformed/unsupported JSON produces an error instead of silently becoming text.

## Bounds and cache

- Viewer input limits: 500,000,000 bytes and 10,000,000 indexed entries.
- JSON: at most 1,000,000 bytes per record and nesting depth 64.
- Displayed records use 16,384-byte segments; inline First/Next text segment
  controls preserve access to long raw entries without a details panel. Copying
  displayed text copies that segment, not an unbounded full record.
- A scroll segment covers at most 50,000 entries without wrap, or 200 wrapped
  entries to bound browser spacer height. Global navigation reaches later entries.
- Renderer cache: at most 1,800 row objects in the active file tab; inactive tabs
  release row caches and stop viewport reads while preserving view state.
- Each window permits 12 file sessions (including split panes), 20 total
  file/home/tool tabs, and at most two Compare workspaces.
- Indexes live in `%LOCALAPPDATA%\LogDeck\indexes`; themes, display, columns,
  and presets use local renderer storage. These preferences are shared by windows;
  each view's live query/selection/scroll stays independent.

Source files are opened read-only and never rewritten. Cache lookup uses canonical
path, identity, size, modification time, parser version, and prefix/tail samples.
A full SHA-256 is computed during indexing. Metadata-time changes trigger a full
hash check, allowing Windows metadata-only updates without reusing changed content.
Checks still cannot prove immutability if another program deliberately preserves
all observed metadata and sampled bytes. Always-full verification and automatic
cache eviction remain future work. Settings can explicitly clear inactive
recognized index files; active indexes and original logs are preserved.

The byte/entry limits are enforced bounds, **not measured performance certification**.
Tests include a 2-million-line synthetic file and both supplied local sample formats;
500 MB, 10-million-line, reference-PC memory, and installer benchmarks are not yet done.

## Search and filters

**Sidebar = filtering:** enter an expression or select Regex, then click **Apply filters**
(Enter in the expression input also applies). Filters hide nonmatching records and
do not highlight text. Filter scans wait for indexing to finish.

**Top bar = searching:** enter literal text and press Enter/**Search** to highlight
visible occurrences without hiding records or changing the active filter. **Clear search**
does not clear filters; **Clear filters / Reset filters** do not clear the top search.
Search has its own case-sensitive checkbox and works on displayed text, not a separate
whole-file occurrence index.

```text
timeout
"response delayed"
(tag:Payment OR tag:Network) AND NOT level:D
pid:1423 tid:1560 message:timeout
app:"example.application" process:payment
Core. -tag:Core.Dal
```

Precedence: parentheses, NOT, AND, OR. Adjacent terms imply AND. Operators must
be uppercase; quote them for literal text. Quoted text supports `\"` and `\\`.
Fields: `raw`, `message`, `tag`, `time`, `level`, `pid`, `tid`, `app`, `process`,
and `line`. PID/TID/level/line match exactly; other fields use substring matching.
Unfielded text searches the raw record (including raw JSON for structured input).
Case sensitivity is explicit. `-tag:Core.Dal` is equivalent to `NOT tag:Core.Dal`;
the same exclusion syntax works with other supported fields. Top-bar literal
search highlights up to 400 occurrences per visible cell, retaining original Unicode
offsets. Previous/Next match and F3 still navigate filtered records, not individual
text occurrences.

Checked levels combine by OR. Other categories and the expression combine by AND;
include/exclude act on raw text. Time bounds compare source timestamp strings
lexically and inclusively: use the same date/time format and precision as the
source. Missing timestamps do not match time bounds. No year/timezone is invented.

Results map matching ordinals back to original source IDs in disk-backed SQLite
temporary tables. Large match lists never become a renderer array. Each query has
a generation; stale range requests fail explicitly. Cancelled/failed scans are
labeled incomplete. Go to Line/Record reports when a source entry is filtered out.

Search bounds: 2,000 query characters, 256 tokens, 32 nested expression levels,
1,000,000 bytes per source record, two minutes per scan. A larger text record
stops the search with an explicit error instead of silently excluding it.
At most two scans run simultaneously across all windows/views. Explicit **Regex**
mode tests each raw record using JavaScript Unicode regex (`u`, or `iu` for
case-insensitive mode), without `/` delimiters or expression-field syntax. Sidebar
filters still apply. Each bounded batch has a 500 ms watchdog in a disposable
32 MB worker; timeout/cancellation never claims a complete result. Regex occurrence
highlighting is unavailable; regex never executes on the renderer.

Save up to 50 named query/filter presets; select one to load controls, then Apply
to execute it. Column controls persist show/hide/order/width, with pointer/keyboard
header resizing and restore defaults. Message remains visible. Split view creates
a second independently filtered/scrolled view of the same indexed source, without
duplicating the source index. Column/display preferences are shared.

## Selection, copy and export

Click to select a record; clicking a selected record again clears selection.
Ctrl/Meta+click toggles individual records without losing other selections.
Shift+click or Shift+Enter selects a continuous range from the anchor.
Selections use at most 500 compact ordered ranges, including off-screen records.
**Copy selection** or Ctrl+C while a table row is focused copies complete raw records,
not just displayed segments, up to 500 records / 512,000 bytes. Larger selections
receive an explicit instruction to Export. Native selected text keeps normal Ctrl+C;
Ctrl+Shift+C explicitly copies selected records. Clipboard writes use a bounded,
write-only desktop bridge; no clipboard-reading permission is exposed.

In **Row appearance**, choose **Text only** or **Row background** severity coloring.
The choice persists across views/windows and uses both themes' existing level colors.
Selected rows retain an accent background/stripe and levels remain labeled.
The bottom position slider remains; the redundant textual range counter is removed.

Export all, the selection, or completed filtered results through a native save
dialog. Export streams original record bytes in source order and appends LF
separators. Structured records remain raw JSON objects, including their original
internal newlines. Output defaults to `.txt`: it is neither guaranteed JSONL nor
a reconstructed Android Studio export container.
Progress and cancellation are visible. Export uses a destination-adjacent
temporary file and replaces the destination only after completion and source/
destination checks. Cancellation retains an existing destination and removes
temporary output. Open source logs cannot be overwritten. Query changes are
blocked while that view exports so its result generation remains stable.

## Independent text Compare

Compare opens a separate tool tab; the virtualized CodeMirror editor is loaded
only on demand. Each side accepts valid UTF-8, optionally BOM-prefixed, with LF
or CRLF. Mixed newlines, standalone CR, invalid UTF-8, binary/NUL input and
unpaired Unicode surrogates are rejected explicitly. Load/paste/edit/copy enforce
both **10,000,000 encoded bytes and 100,000 lines per side** without truncation.

- Editable line-numbered panes highlight changed lines; the selected change has
  an original/modified word preview. Previous/next navigates both editors.
- Copy the selected block in either direction; Undo/Redo preserves up to 50
  snapshots / 20 MB of history per pane. These are bounded editing histories,
  not persistent recovery files.
- Ignore-case/whitespace toggles affect comparison only, not saved text.
- Diff runs in a disposable worker after a 250 ms debounce, with cancellation,
  stale-generation checks, a five-second watchdog and an internal work budget.
  Worst-case input may stop with an explicit timeout/budget error.
- Word refinement is limited to 4,000 combined characters / 200 tokens per side
  in the selected block. Larger blocks retain line navigation and explicitly
  label skipped word refinement.
- Explicit Save/Save As preserves the selected BOM/newline format. External
  changes require Cancel / Save As / Overwrite. Writes use a temporary file,
  flush, destination recheck and replacement; errors retain the dirty buffer.
- Dirty tab/window closure requires confirmation. Any file open in a read-only
  log viewer is protected from Compare saves. Documents belong to their window.

This is bounded text comparison, not folder sync, binary comparison, unrestricted
log editing, or complete Beyond Compare parity.

## Hex / ASCII and EMV

Opening a log enables **EMV on** for that view. The file worker recognizes explicit
`Tag 95: 8000000000`, `tag: 9f 02[6]: ...`, `tag[31]:9f01`, known multi-byte
`9F02[6]:...` pairs, `T: 9F33 L: 3 V: E0F8C8`, `#[T]: 70 L: 41` container
headers, and complete single-line `TLV:...` payloads. Bare numbers such as
95/82 in PIDs, timestamps or amounts are not highlighted. Click a tag (or focus it
and press Enter) for its local name/definition, source location, original hex,
validation reason and dictionary version. Normal row clicks still only select.

This uses a bundled **60-tag** common reference dictionary, **version 1.1.0**, not live
internet queries. Definitions do not require Firebase, AI or uploading your logs.
Detection follows displayed/prefetched records as you navigate: **not a whole-file
scan or EMV inventory**. Each segment is limited to 16,384 characters, 64 tag
occurrences and 256 retained value bytes; incomplete/invalid data is explicitly
marked. Turn tracking off independently in each tab/split. Unknown explicit tags
show no-definition status; reference coverage is broader than editable decoders.
Explicit dump recognition does not require hardcoding each tag: unknown tags are
still clickable. A maintained local dictionary supplies known names/definitions;
9F33 is included, and 9F13 identifies the Last Online Application Transaction Counter.
`L` is a decimal byte count; declared/fixed-length mismatches are reported. Container
headers without `V` correctly show an unavailable value rather than borrowing another row.
For a valid supported value, **Open value in EMV editor** prefills an independent
tool tab. Verify the scheme and press **Decode value** before editing its baseline.
Logs are never rewritten. Proprietary/scheme-specific layouts are not inferred.

Navbar buttons open independent local tool tabs. No payment data is sent to
paymentcardtools.com or another service, and editing never modifies a source log.
This is an independently implemented workflow, not a complete clone of that site.

- **Hex / ASCII:** complete hexadecimal byte pairs, optional whitespace; strict
  ASCII bytes 00–7F, including controls, by default. Select **Latin-1 byte mode**
  for lossless 00–FF conversion, including receipts containing byte `80`.
  This maps bytes directly, not UTF-8 or Windows-1252: `80` is a control, not a euro sign.
  Maximum 32,768 bytes; malformed pairs and unrepresentable characters are rejected.
  An escaped preview makes C0/C1 controls visible, including `\u0080` and `\u0013`.
- **EMV:** select Visa or Mastercard explicitly, then a tag and raw value.
  Decode establishes an immutable original; toggles update the modified hex
  immediately, highlight changed rows and show original/modified bit values.
  Byte/bit tables appear two per row on wide screens and stack on smaller windows.
- Common EMV layouts: **95 (TVR), 82 (AIP byte 1), 9F33 (Terminal Capabilities),
  9F34 (CVM Results)**. CVM method/condition/result use coded selectors, not
  misleading independent-flag labels.
- **9F66 (TTQ) and 9F6C (CTQ)** use Visa layouts only. They are explicitly
  unverified/unsupported as Mastercard decoders, rather than reusing Visa meanings.
- **9F6E:** raw original/modified hex and binary comparison only. A verified
  scheme/kernel/version layout is not bundled. AIP byte 2 is likewise raw-only.
  RFU bits are preserved and have no semantic toggle.
- **BER-TLV:** nested templates, raw unknown tags, duplicate-tag occurrences,
  exact offsets and lengths. Select a supported leaf to edit it; the modified
  full sequence updates beside the original while preserving tag/length bytes.
  Values must retain their original byte length. Limits: 65,536 bytes, 2,000 nodes,
  16 nesting levels. APDU headers/status words and padding are not automatically
  stripped; supply a complete TLV sequence.

For the requested TVR example, `8000000000` with byte 1 bit 8 set to **0** becomes
`0000000000`; other bits remain unchanged. The initial TVR is labeled synthetic.
Definitions are a limited common-EMV/legacy Visa reference, not a scheme
certification dataset. See [EMV scope and references](docs/LogDeck-technical-documentation.md#10-local-emv).

## Shortcuts

| Action | Shortcut |
|---|---|
| Open file | Ctrl+O |
| New / close tab | Ctrl+T / Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Independent window | Ctrl+N |
| Focus search | Ctrl+F |
| Next / previous matching record | F3 / Shift+F3 |
| Go to source line/record | Ctrl+G |
| Copy selected complete records | Ctrl+C in table (without native text selection), or Ctrl+Shift+C |
| Toggle additional records | Ctrl/Meta+click |
| Extend record selection | Shift+click / Shift+Enter |
| Resize focused column separator | Left / Right |
| Compare undo / redo | Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z) |

## Verify

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:desktop
```

Desktop tests run real Electron against the production build. Unit tests cover
streaming offsets, text parsing, JSON mapping, UTF-8/BOM boundaries, and errors.
Desktop tests cover themes, virtualization, navigation, isolation, cancellation,
restart cache reuse, metadata-only changes, same-size middle edits, whole-table
scrolling/wrapping, slider synchronization, tab position/title changes, search
generations/cancellation, strict conversion, EMV/TLV editing, automatic contextual
EMV recognition/definitions/handoff and toggle isolation, presets/columns/splits,
regex watchdogs, repeated exports/cancellation, complete-record copying, cache cleanup,
Compare diff/copy/history/conflicts/dirty close, source protection and document ownership.
Correction regressions also cover filter/search independence, `-tag:` exclusion,
both severity styles/themes, disjoint ordered copy/export, dump-format tags,
two-column/responsive EMV tables, Latin-1 control-byte round-trips and clipboard bounds.
The exact 10 MB / 100,000-line Compare boundary is exercised with fewer than 200
rendered editor lines and a saved-byte equality check after a rejected edit.
This is functional boundary evidence, not a reference-hardware performance budget.

If the local ignored `dummy` directory exists, format tests also check its `.log`
and `.logcat` files locally. No sample is bundled, uploaded, or modified; that test
disables traces and does not attach screenshots or raw customer log contents.

## Next increments

Whole-file EMV discovery/inventory, broader authorized/versioned scheme definitions,
regex occurrence highlighting, full individual-occurrence navigation, automatic
cache eviction and always-full cache verification remain unfinished. Live ADB
capture, Firebase authentication, Company AI and cloud sync are deferred integrations.

There is no installer, signing, automatic update, or Windows Open With registration
yet. Local command-line file opening exists, but is not an installed association.

See [the release requirements](docs/spec.md) and
[the technical specification](docs/LogDeck-technical-documentation.md).
Keep the four numbered companion documents for now: they still contain referenced
architecture and requirement detail.
