# Feature Specification: LogDeck Release 1 Experience

**Created:** 2026-10-24  
**Status:** Viewer, advanced offline controls, local tools and Compare implemented; remaining release gates/gaps are explicit below.
**Feature branch:** Not created; workspace is not a Git repository.  
**Governance:** Existing local-first, privacy, isolation, and performance principles
in [the technical specification](LogDeck-technical-documentation.md).

## Implementation Snapshot

The working increment includes the Electron/React shell, home/drop UI, themes,
worker-backed indexing, virtual table, navigation, cancellation, cache reuse,
browser-style tabs, and independent windows. It supports the supplied Android Studio
JSON export and threadtime text formats. JSON uses record IDs; plain text retains
physical lines. Parsing extracts columns without reordering source records.

Sidebar expression/regex filters and independent top-bar literal highlight-only
search, all-column wrap, whole-table horizontal scroll, a
synchronized position slider, strict ASCII/hex and lossless Latin-1 byte conversion, and local EMV/TLV
original-versus-edited tools are implemented. Clicking rows now only selects them;
the Message Details panel was removed at the product owner's request.

Explicit isolated regex, saved presets, column controls, stacked independent split
views, full-record selection/copy/export, local display/cache controls, and lazy
two-pane Compare are implemented. Compare uses a virtualized editor, bounded worker
diffs, selected-block word previews, safe saves and dirty-close confirmation.

Context-aware EMV highlighting is automatic on bounded displayed records, with an
offline versioned dictionary, clickable definition/value states and explicit editor
handoff. Each view can disable tracking. There is no full-file EMV inventory.
Regex occurrence highlighting and full individual-occurrence navigation remain
gaps in REQ-015. Broader authorized scheme definitions remain later work.
This snapshot does not mark all
36 release requirements complete.
Maximum-size/reference-hardware performance and installed Windows integration
have not been certified. See [run instructions and current bounds](../README.md).

## Scope Baseline

- **Discovery method:** Read the five existing product documents and resolve the
  expanded feature/UI scope through direct product-owner questions.
- **Total items discovered:** 68 existing FR identifiers plus 36 release-experience
  requirements below. These identifiers have different namespaces and are not
  counts of independent features.
- **Items in scope:** All 36 REQ requirements below for the complete release,
  delivered in working increments. Existing future-phase FR requirements remain deferred.
- This specification owns the clarified UX/query scope. It supplements, rather than
  replaces, the existing FR identifiers and technical performance contracts.
- "Android Studio-inspired" means the explicitly enumerated saved-file capabilities
  here, not exact feature/syntax parity with any unspecified Android Studio version.
- "Beyond Compare-inspired" means bounded two-pane text editing/comparison, not
  folder synchronization, binary comparison, or a complete product clone.

## User Scenarios & Testing

### User Story 1 - Open and inspect a saved log (Priority: P1)

As a developer, I can open a file from a clear home screen and inspect its contents
without login or waiting for every line to be indexed.

**Why this priority:** Saved-file viewing is the primary product.

**Independent Test:** Open a synthetic threadtime fixture and a plain-text fixture;
check the first viewport, preserved raw text, navigation, and source immutability.

**Acceptance Scenarios:**

1. **Given** the home page, **when** I choose or drop a supported file, **then**
   readable rows appear, indexing progress is visible, and I can cancel ongoing work.
2. **Given** an unknown line format, **when** it is displayed, **then** its raw
   content remains available rather than being dropped or assigned invented metadata.
3. **Given** a file is missing or unreadable, **when** I open it, **then** I receive
   a meaningful error and the previous working session is preserved.

### User Story 2 - Find relevant records (Priority: P1)

As a developer, I can combine query expressions and filters, navigate occurrences,
and export the records I need.

**Why this priority:** Investigation depends on accurate, responsive search.

**Independent Test:** Use a known fixture with expected match line numbers and
verify query results, selection, and export against those numbers.

**Acceptance Scenarios:**

1. **Given** known tags/levels, **when** I enter
   `(tag:Payment OR tag:Network) AND NOT level:D`, **then** only matching records
   appear, subject to enabled sidebar filters.
2. **Given** an invalid query or regex, **when** submitted, **then** its error is
   shown explicitly rather than returning a success-shaped empty result.
3. **Given** two split views, **when** I change one query/selection/scroll position,
   **then** the other view is unchanged unless scroll linking was explicitly enabled.
4. **Given** a completed filtered result, **when** I export it, **then** output
   contains exactly the requested records in source order and does not alter the input.

### User Story 3 - Use a polished, accessible workspace (Priority: P1)

As a developer, I can switch between dark and light appearances, navigate with
the keyboard, and work without distracting motion.

**Why this priority:** Both appearance modes and a compact usable table are required.

**Independent Test:** Exercise the same home/viewer controls in both themes and with
reduced motion enabled; restart and confirm saved appearance.

**Acceptance Scenarios:**

1. **Given** either theme, **when** I open the viewer, **then** controls, rows,
   highlights, focus, and errors remain readable and consistent.
2. **Given** reduced motion, **when** panels open or controls change, **then**
   nonessential animation is disabled.
3. **Given** the Login entry, **when** activated, **then** an accessible dialog
   offers optional company-tag sign-in only when Firebase is configured, otherwise
   clearly explains why credentials and downloads are disabled. Local viewing never requires login.

### User Story 4 - Inspect local EMV information (Priority: P2)

As a developer, I see context-aware EMV tags in opened logs and can inspect their
definitions offline, disable tracking, or explicitly open supported values for editing.

**Why this priority:** It adds local analysis without making the primary viewer depend on it.

**Independent Test:** Use labeled synthetic tags/values; verify valid, missing,
unknown, and invalid-value states with networking unavailable.

**Acceptance Scenarios:**

1. **Given** a newly opened view, **when** a bounded range is displayed, **then**
   contextual tags are highlighted automatically without a full-log EMV job.
2. **Given** a selected known tag without a value, **when** inspected, **then**
   its definition is shown with "Value unavailable."
3. **Given** a disabled view, **when** a range is read, **then** no tracker metadata
   is requested and no tag annotations or definition panel are shown.
4. **Given** a versioned reference, **when** shown, **then** incomplete coverage,
   validation limits and scheme-specific semantics are explicit.

### User Story 5 - Compare and edit text (Priority: P2)

As a developer, I can compare text independently of the viewer and deliberately
copy/save changes without accidental file replacement.

**Why this priority:** Compare is a secondary tool, not the log ingestion pipeline.

**Independent Test:** Open two small text fixtures, edit/copy/undo, save a copy,
and exercise limit/conflict/dirty-close cases.

**Acceptance Scenarios:**

1. **Given** two documents, **when** compared, **then** two editable panes show
   line differences and bounded word differences with previous/next navigation.
2. **Given** an edit or paste would exceed either limit, **when** attempted,
   **then** it is rejected with a clear message, preserving the previous buffer.
3. **Given** an external source edit or dirty close, **when** saving/closing,
   **then** an explicit decision is required and unsaved content is not silently lost.

### Edge Cases

- Empty, oversized, malformed, locked, deleted, or externally modified files.
- Very long records, mixed newlines, missing dates/timezones, and unknown columns.
- Missing package/app/device metadata: disable or explain unavailable filters,
  never infer it from PID alone.
- Ten-million-line scrolling and source-line navigation within filtered results.
- Query replacement during a scan, all-match searches, cancellation, regex timeout.
- Closing one split/window while another uses the same file.
- Canceled or failed export; sensitive data copied/exported only through explicit action.
- Compare limits measured in encoded bytes and lines, including copy-change actions.
- OS theme change, keyboard-only use, high DPI, reduced motion, and error dialogs.

## Requirements

### Functional Requirements

- **REQ-001:** Local viewing/search/filtering MUST work without login or network access.
- **REQ-002:** Home MUST have a prominent file-drop area, equivalent file-picker
  action, supported-format guidance, and visible open/error feedback.
- **REQ-003:** Home MUST list feature cards below the drop area; cards distinguish
  available, planned, and demonstration-only capabilities.
- **REQ-004:** The navbar MUST provide Home, Features, Open, Compare, Settings,
  appearance control, and Login; Features navigates to the home feature section.
- **REQ-005:** Login MUST open optional Firebase email/password company-tag access.
  Without configuration its credential/download controls MUST remain disabled.
  Authentication MUST never be required for local viewing or simulated as successful.
- **REQ-006:** Light, dark, and follow-system appearance MUST be available and
  persisted; log data/query/selection MUST survive a theme change.
- **REQ-007:** Workspace MUST use a compact log table with Time, PID, TID, Level,
  Tag, Message, source line identification, and raw-text fallback.
- **REQ-008:** Users MUST be able to resize, reorder, and show/hide columns and
  restore defaults; column preferences persist without modifying file content.
- **REQ-009:** Severity styling MUST remain readable in both themes and use level
  text/icons, not color alone.
  Users MUST be able to persistently choose full-row background or text-only color.
- **REQ-010:** A collapsible left sidebar MUST contain level/tag/PID/TID/time
  filters, include/exclude rules, and saved query/filter access.
  Expression/regex filtering MUST be in the sidebar; literal search MUST remain in the top bar.
- **REQ-011:** Queries MUST support AND/OR/NOT, parentheses, quoted phrases,
  general text, and available column fields; adjacent clauses mean AND.
  `-field:value` MUST exclude that field match, including `Core. -tag:Core.Dal`.
- **REQ-012:** Operator precedence MUST be parentheses, NOT, AND, OR; uppercase
  operators are reserved and quoted text is literal. Unknown fields/syntax produce errors.
- **REQ-013:** Regex mode MUST be explicit, validate syntax, support cancellation/
  timeout, and explain its matching semantics. It MUST NOT silently alter query grammar.
- **REQ-014:** Sidebar categories MUST combine by AND with the query expression;
  selected values within one category combine by OR; excludes remove matches.
- **REQ-015 (revised):** Top-bar literal search MUST highlight visible occurrences
  without hiding records or changing sidebar filter results. Filtering MUST NOT
  highlight. Clearing either control MUST preserve the other. Full individual-occurrence
  navigation and counts remain a release target; filtered-record scan progress
  MUST clearly label partial results.
- **REQ-016:** Users MUST be able to save, name, reapply, rename, and delete local
  queries/filter presets.
- **REQ-017:** Users MUST be able to split the same file into independently filtered
  views and close a split without closing the source; scrolling is independent by default.
- **REQ-018:** Go to Line MUST navigate by original physical source line number.
  A filtered-out target MUST be explained, not silently mapped to a different record.
- **REQ-019:** Users MUST be able to select/copy records and explicitly export
  selected or filtered records in source order, with progress/cancellation for large exports.
  Ctrl/Meta-click MUST toggle disjoint rows; repeated plain-click MUST deselect.
  Full-record copying MUST include off-screen segments in source order and support Ctrl+C.
- **REQ-020 (revised):** Row clicks MUST select without opening Message Details.
  The table MUST offer optional all-column wrapping using measured variable-height
  visible rows; default no-wrap uses one horizontal scroller for the whole table.
  Long raw content MUST remain accessible through labeled inline byte segments.
- **REQ-021:** Device/package/app filtering MUST only be enabled when trustworthy
  metadata is present. No live device controls are required in release 1.
- **REQ-022:** Keyboard shortcuts MUST cover open, new window, find, next/previous
  match, go-to-line, copy, new/close/switch tab, and dialog dismissal, with a discoverable shortcut reference.
- **REQ-023 (revised):** EMV recognition MUST default on for bounded displayed
  records, run in the file worker and be independently disableable per view.
  A bundled versioned dictionary MUST supply clickable definitions without network
  access. Context matching MUST avoid bare-number/hex-substring false positives and
  preserve separate occurrences, source locations and explicit validation states.
  No full-file discovery or comprehensive scheme support may be implied.
  Editing MUST remain selected-tag driven in a dedicated tool tab, via manual input
  or explicit handoff of a structurally valid supported value.
  Original/modified raw and decoded values MUST be shown
  together, with explicit scheme selection and unsupported/validation states.
  Explicit `T: ... L: ... V: ...` and `#[T]: ... L: ...` dump formats MUST recognize
  unknown tags without a per-tag parser branch; missing/mismatched values MUST be explicit.
- **REQ-024:** Compare MUST be a separate two-pane editable text tool with
  line/word differences, navigation, copy changes, undo/redo, and explicit safe saving.
- **REQ-025:** Compare MUST enforce both 10,000,000 encoded bytes and 100,000 lines
  per side for load/paste/edit/copy actions, with no silent truncation.
- **REQ-026:** Multiple windows/splits MUST isolate query, scroll, selection, and
  analysis state; closing one MUST NOT break another.
- **REQ-027:** Animations MUST be subtle, finite, respect reduced motion, and
  never animate individual arriving log rows or block file/search interaction.
- **REQ-028:** Initial fixtures and any unverified EMV sample metadata MUST be
  labeled synthetic; no complete real-log/EMV coverage claims without evidence.
- **REQ-029:** Unimplemented controls MUST be absent or clearly explain their
  status; mock results MUST NOT be presented as successful real operations.
- **REQ-030:** Delivery MUST use verified working increments: core shell/home/table,
  advanced viewer, local EMV, then independent Compare. This is delivery order,
  not a claim that every secondary feature requires the preceding feature.
- **REQ-031:** The bottom range/position indicator MUST track actual visible
  positions while scrolling and support global dragging/navigation without
  confusing the current viewport with the entire logical segment.
  The slider MUST remain without the redundant textual Records/Matches range counter.
- **REQ-032:** Multiple file/home/tool tabs MUST coexist in each independent window.
  The active filename/tool MUST update the native window title; closing a tab
  MUST preserve others, and tab switching MUST retain query/layout/vertical position.
- **REQ-033:** A local calculator MUST convert strict ASCII (00-7F) to hex and
  hex to ASCII, reject malformed/non-ASCII values, expose control-byte previews,
  and offer copying without changing source logs.
  Explicit Latin-1 byte mode MUST preserve all 00-FF bytes losslessly, reject
  unrepresentable Unicode and expose C0/C1 controls without guessing another encoding.
- **REQ-034:** The EMV editor MUST expose 95, 82, 9F33, 9F34, Visa CTQ (9F6C),
  and Visa TTQ (9F66), with Visa/Mastercard selection. Unverified 9F6E and
  kernel-specific layouts MUST remain explicitly raw-only. Editable bit/field
  changes MUST update final hex, preserve the original and unrelated bits, and
  distinguish CVM combined codes from independent flags.
  Byte/bit tables MUST use two columns on wide windows and stack on narrow windows.
- **REQ-035:** A bounded local BER-TLV parser MUST preserve original input,
  offsets, duplicate occurrences, and nested templates. Editing supported
  leaf values MUST produce a modified full sequence without changing its
  tags, lengths, or unrelated values.
- **REQ-036:** Desktop MUST offer an Update page that displays the installed
  version and, only after explicit user action, checks a bounded same-origin HTTPS
  release manifest for the latest website version and notes. Updates MUST remain
  manual, and release checks MUST NOT upload logs or run at startup.
  Windows distribution uses a portable x64 EXE with optional confirmed per-user
  Open with registration for .log/.logcat, without replacing default apps.
  Local release preparation MUST synchronize the version/lockfile, test and package
  the native runtime, produce a checksum and metadata, and never commit or push.
  A pushed version tag triggers GitHub publication. The Netlify production endpoint
  MUST reflect a complete published stable release, not an unuploaded local build.

### Non-Functional Requirements

The existing large-file, privacy, worker isolation, disk indexing, bounded memory,
and proposed performance budgets remain in force. Adding split views or animation
does not waive them. Source files remain read-only outside deliberate Compare saves.

### Key Entities

- **File session:** Authorized source, physical line identities, indexing progress/version.
- **View:** File reference, query, filters, layout, scroll, selection, match navigation.
- **Saved preset:** User-provided name plus reusable query/filter configuration.
- **Appearance preference:** Light/dark/system mode, density, column and motion preferences.
- **EMV occurrence:** Source location, tag/value, definition version, validation state.
- **Compare document:** Input/source, editable content, encoding/newlines, dirty/conflict state.
- **Feature status:** Available, planned, or synthetic-demo label for discoverability.

### Assumptions and UI Defaults

- Modern developer-tool styling, not pixel-for-pixel reproduction of another app.
- Dark: charcoal/slate surfaces; light: white/off-white surfaces; restrained blue/
  teal accents. Final colors must meet contrast tests rather than rely on these names.
- Use monospaced log content, clear typography, compact toolbar, and restrained cards.
- Theme follows the system initially; manual override persists.
- Hover/focus/panel transitions use approximately 120-180 ms and inexpensive opacity/
  transform effects. No perpetual gradients, animated backgrounds, or auto-playing demos.
- Normal text contrast target is at least 4.5:1; large text and meaningful UI
  boundaries at least 3:1; keep keyboard focus visible.
- Revised on 2026-10-24: optional main-table wrap replaces click-to-open details.
  Wrapped logical segments use 200 entries versus 50,000 no-wrap entries to
  constrain browser spacer height; global navigation still reaches all entries.
  Inactive tabs release row caches but retain investigation/view state.
- Exports default to original raw lines; format changes require an explicit choice.
- For the initial advanced-query design, regex mode matches raw records and combines
  with sidebar filters; field expressions apply in expression mode. The mode switch
  is explicit, with distinct input/help so expressions are not unexpectedly reinterpreted.
- Parser behavior for escapes, time ranges, absent fields, and literal operator
  text must be documented with examples and covered by tests before query implementation.
- Firebase is optional and limited to company-tag identity and publication/download.
  No startup network calls, log uploads, automatic release checks/installations, or bundled privileged
  credentials are allowed. Public web configuration is supplied at build time.
  See [setup and pack schema](Firebase-and-website-setup.md).
- Synthetic fixtures are approved initially; real parser coverage and production
  EMV decoding require sanitized examples and an authorized dataset later.

## Success Criteria

### Measurable Outcomes

- **SC-001:** A supported file's first readable viewport appears within the proposed
  1-second target on the reference PC; verify using production builds and documented fixtures.
- **SC-002:** Every query fixture returns exactly its expected physical source lines,
  including NOT/grouping and combined sidebar filters.
- **SC-003:** Switching theme preserves the open file, query, selection, and scroll
  position; both themes pass the documented contrast and keyboard checks.
- **SC-004:** Reduced-motion checks find no nonessential panel/hover animation or
  perpetual motion; table rows never animate individually.
- **SC-005:** Selected/filtered export matches the expected ordered source records,
  and input file hashes remain unchanged after viewer actions.
- **SC-006:** Split views demonstrate independent filters/scroll; closing either
  preserves the remaining view.
- **SC-007:** Compare boundary tests pass below/at/above both limits, and save/
  conflict/cancel tests produce no silent data loss.
- **SC-008:** Every visible feature entry either performs its implemented action
  or clearly states planned/demo status; Login never reports an authenticated user.
- **SC-009:** Maximum-size navigation/search tests retain the technical specification's
  performance targets; a small-file UI demo is not sufficient evidence.
- **SC-010:** User acceptance demonstrates the open/filter/find/export and compare/
  copy/save journeys in both themes using keyboard and pointer.
