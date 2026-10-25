import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Search, Square, WrapText, X } from 'lucide-react'
import { limits, type FindMatch, type LogRow, type SessionInfo, type SearchFilters, type SearchInfo, type LogLevel, type ExportInfo } from '../../../../shared/contracts'
import { defaultColumns, validColumns, validPresets, validDisplay, validSeverityStyle, usePreference, type SeverityStyle, type ColumnId, type Preset } from '../preferences'
import { literalHighlightSpans } from '../../../workers/search'
import { containsPosition, selectionCount, togglePosition, type PositionRange } from '../../../../shared/selection'
import type { EmvOccurrence, EmvSeed } from '../../../../shared/emvTracker'
import { EmvInspector, type EmvSelection } from './EmvInspector'
import type { CompanyTagPack } from '../../../../shared/companyTags'

export function formatBytes(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1000).toFixed(1)} KB`
}

function Highlight({ text, terms, caseSensitive, emv = [], onTag, current }: {
  text: string; terms: string[]; caseSensitive: boolean; emv?: EmvOccurrence[]; onTag?: (occurrence: EmvOccurrence) => void; current?: { start: number; end: number }
}) {
  const spans = literalHighlightSpans(text, terms, caseSensitive)
  if (current) { spans.push(current); spans.sort((a, b) => a.start - b.start || a.end - b.end) }
  const merged: { start: number; end: number }[] = []
  for (const span of spans) {
    const previous = merged[merged.length - 1]
    if (previous && span.start < previous.end) previous.end = Math.max(previous.end, span.end)
    else merged.push({ ...span })
  }
  const highlighted = (start: number, end: number) => {
    const parts: React.ReactNode[] = []
    let offset = start
    for (const span of merged) {
      if (span.end <= start || span.start >= end) continue
      const from = Math.max(start, span.start)
      const to = Math.min(end, span.end)
      parts.push(text.slice(offset, from), <mark key={from} className={current && from < current.end && to > current.start ? 'current-find' : undefined}>{text.slice(from, to)}</mark>)
      offset = to
    }
    parts.push(text.slice(offset, end))
    return parts
  }
  if (emv.length && onTag) {
    const parts: React.ReactNode[] = []
    let offset = 0
    for (const occurrence of emv) {
      if (occurrence.start < offset || occurrence.end > text.length) continue
      parts.push(<span key={`text-${offset}`}>{highlighted(offset, occurrence.start)}</span>,
        <button key={occurrence.start} className={`emv-tag emv-${occurrence.status}`} aria-label={`Inspect EMV tag ${occurrence.tag}`} title={`EMV ${occurrence.tag} · ${occurrence.status}`}
          onClick={event => { event.stopPropagation(); onTag(occurrence) }} onKeyDown={event => event.stopPropagation()}>
          {highlighted(occurrence.start, occurrence.end)}
        </button>)
      offset = occurrence.end
    }
    parts.push(<span key={`text-${offset}`}>{highlighted(offset, text.length)}</span>)
    return <>{parts}</>
  }
  return <>{highlighted(0, text.length)}</>
}

function messageWidthOf(text: string) {
  let width = 0
  for (const line of text.split(/\r\n|\r|\n/)) width = Math.max(width, line.length * 7.2 + 40)
  return width
}

export function LogViewer({ session, active, onError, onSplit, onEmv, keyboardActive = true }: {
  session: SessionInfo; active: boolean; onError: (message: string) => void; onSplit?: () => void; onEmv: (seed: EmvSeed) => void; keyboardActive?: boolean
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const cache = useRef(new Map<number, LogRow>())
  const inFlight = useRef(false)
  const generation = useRef(0)
  const mounted = useRef(true)
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState(0)
  const [targetLine, setTargetLine] = useState('1')
  const [controls, setControls] = useState(true)
  const [advancedFilters, setAdvancedFilters] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [emvEnabled, setEmvEnabled] = useState(true)
  const [emvSelection, setEmvSelection] = useState<EmvSelection | null>(null)
  const [companyPack, setCompanyPack] = useState<CompanyTagPack | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [selection, setSelection] = useState<PositionRange[]>([])
  const [readError, setReadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [highlightQuery, setHighlightQuery] = useState('')
  const [appliedHighlight, setAppliedHighlight] = useState('')
  const [highlightCaseSensitive, setHighlightCaseSensitive] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findInfo, setFindInfo] = useState<SearchInfo | null>(null)
  const [findError, setFindError] = useState<string | null>(null)
  const [findOrdinal, setFindOrdinal] = useState(0)
  const [findMatch, setFindMatch] = useState<FindMatch | null>(null)
  const findGeneration = useRef(0)
  const findNavigation = useRef(0)
  const findCursor = useRef(0)
  const findReveal = useRef(false)
  const expandedFindRow = useRef<number | null>(null)
  const [filters, setFilters] = useState<SearchFilters>({})
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [columns, saveColumns] = usePreference('logdeck-columns', defaultColumns, validColumns, onError)
  const [presets, savePresets] = usePreference<Preset[]>('logdeck-presets', [], validPresets, onError)
  const [display] = usePreference('logdeck-display', { fontSize: 11, defaultWrap: false }, validDisplay, onError)
  const [severityStyle, saveSeverityStyle] = usePreference<SeverityStyle>('logdeck-severity-style', 'text', validSeverityStyle, onError)
  const [presetName, setPresetName] = useState('')
  const [presetId, setPresetId] = useState('')
  const [exportInfo, setExportInfo] = useState<ExportInfo | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const resizing = useRef<{ id: ColumnId; x: number; width: number } | null>(null)
  const [search, setSearch] = useState<SearchInfo | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [messageWidth, setMessageWidth] = useState(650)
  const [tagWidth, setTagWidth] = useState(150)
  const scrollMemory = useRef(0)
  const total = search ? search.matches : session.lines
  const pageSize = wrap ? 200 : limits.pageLines
  const count = Math.max(0, Math.min(pageSize, total - page))
  const virtual = useVirtualizer({
    count, getScrollElement: () => viewport.current, enabled: active,
    initialOffset: () => scrollMemory.current,
    estimateSize: () => wrap ? 54 : limits.rowHeight, overscan: wrap ? 5 : 12, paddingEnd: 32
  })
  const items = virtual.getVirtualItems()
  const first = items[0]?.index ?? 0
  const last = items[items.length - 1]?.index ?? -1
  const visible = items.filter(item => item.end > (virtual.scrollOffset ?? 0) && item.start < (virtual.scrollOffset ?? 0) + (virtual.scrollRect?.height ?? 0))
  const firstVisible = Math.min(total, page + (visible[0]?.index ?? 0) + 1)
  const version = search?.version
  const visibleColumns = columns.filter(column => column.visible)
  const widthOf = (column: typeof columns[number]) => column.width !== defaultColumns.find(value => value.id === column.id)!.width ? column.width : Math.max(column.width, column.id === 'message' ? messageWidth : column.id === 'tag' ? tagWidth : column.width)
  const grid = visibleColumns.map(column => wrap ? `minmax(0, ${column.width}fr)` : `${widthOf(column)}px`).join(' ')
  const tableWidth = visibleColumns.reduce((sum, column) => sum + widthOf(column), 0)
  const selectedCount = selectionCount(selection)
  const highlightTerms = appliedHighlight ? [appliedHighlight] : []

  useEffect(() => {
    let stopped = false
    const refresh = () => {
      void window.logdeck.companyTagStatus().then(result => {
        if (stopped) return
        if (!result.ok) { onError(result.error); return }
        setCompanyPack(result.value.installed)
        generation.current++
        cache.current.clear()
        setEmvSelection(null)
        setRevision(value => value + 1)
      }).catch(error => { if (!stopped) onError(String(error)) })
    }
    refresh()
    const unsubscribe = window.logdeck.onCompanyTagsChanged(refresh)
    return () => { stopped = true; unsubscribe() }
  }, [session.id])

  useEffect(() => { setWrap(display.defaultWrap) }, [display.defaultWrap])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++ }
  }, [])
  useEffect(() => {
    if (!active) {
      generation.current++
      cache.current.clear()
      return
    }
    const frame = requestAnimationFrame(() => virtual.scrollToOffset(scrollMemory.current))
    return () => cancelAnimationFrame(frame)
  }, [active])
  useEffect(() => {
    virtual.measure()
  }, [wrap, emvSelection !== null])

  function resetView() {
    pendingPosition.current = null
    generation.current++
    cache.current.clear()
    setReadError(null)
    setPage(0)
    setSelected(null)
    setSelection([])
    scrollMemory.current = 0
    virtual.scrollToOffset(0)
    virtual.measure()
    setRevision(value => value + 1)
  }

  useEffect(() => {
    if (!active || inFlight.current || readError || session.status === 'error') return
    const missing = items.find(item => !cache.current.has(page + item.index + 1))
    if (!missing) return
    const start = page + missing.index + 1
    const current = generation.current
    inFlight.current = true
    void window.logdeck.readRange({ id: session.id, start, count: Math.min(wrap ? 40 : 120, total - start + 1), searchVersion: version, emv: emvEnabled })
      .then(result => {
        if (!mounted.current || generation.current !== current) return
        if (!result.ok) { setReadError(result.error); return }
        let width = messageWidth
        let tags = tagWidth
        for (const [index, row] of result.value.entries()) {
          const position = start + index
          const existing = cache.current.get(position)
          if (!existing || existing.segmentOffset || existing.message.length <= row.message.length) cache.current.set(position, row)
          width = Math.max(width, messageWidthOf(row.message))
          tags = Math.max(tags, row.tag.length * 7.2 + 24)
        }
        setMessageWidth(width)
        setTagWidth(tags)
        while (cache.current.size > 1800) cache.current.delete(cache.current.keys().next().value!)
      })
      .catch(error => { if (mounted.current && generation.current === current) setReadError(String(error)) })
      .finally(() => { inFlight.current = false; if (mounted.current) setRevision(value => value + 1) })
  }, [active, first, last, page, session.id, session.lines, session.status, revision, readError, total, version, wrap, emvEnabled])

  useEffect(() => {
    if (!search || search.status !== 'running') return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await window.logdeck.searchStatus(session.id)
        if (stopped) return
        if (!result.ok) { setSearchError(result.error); return }
        if (result.value.version !== version) return
        setSearch(result.value)
        if (result.value.status === 'running') timer = setTimeout(() => void poll(), 200)
      } catch (error) { if (!stopped) setSearchError(String(error)) }
    }
    timer = setTimeout(() => void poll(), 200)
    return () => { stopped = true; clearTimeout(timer) }
  }, [version, search?.status, session.id])

  const pendingPosition = useRef<number | null>(null)
  function scrollToRow(index: number) {
    const offset = virtual.getOffsetForIndex(index, 'start')
    if (offset) virtual.scrollToOffset(offset[0])
  }
  function goToPosition(position: number, select = true) {
    if (!total) return
    const bounded = Math.min(total, Math.max(1, position))
    const nextPage = Math.floor((bounded - 1) / pageSize) * pageSize
    pendingPosition.current = bounded - nextPage - 1
    if (nextPage !== page) setPage(nextPage)
    else { scrollToRow(pendingPosition.current); setRevision(value => value + 1) }
    if (select) {
      setSelected(bounded)
      setSelection([{ start: bounded, end: bounded }])
    }
  }
  useEffect(() => {
    if (pendingPosition.current === null) return
    const index = pendingPosition.current
    const row = viewport.current?.querySelector<HTMLElement>(`tr[data-index="${index}"]`)
    if (row && cache.current.has(page + index + 1)) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      pendingPosition.current = null
    } else scrollToRow(index)
  }, [page, count, wrap, first, last, revision])

  function toggleWrap() {
    const size = wrap ? limits.pageLines : 200
    const nextPage = Math.floor((Math.max(1, firstVisible) - 1) / size) * size
    pendingPosition.current = Math.max(1, firstVisible) - nextPage - 1
    setPage(nextPage)
    setWrap(!wrap)
  }

  async function goToSource() {
    const line = Number(targetLine)
    if (!Number.isSafeInteger(line) || line < 1 || line > session.lines) {
      onError(`Enter a source ${session.format === 'android-json' ? 'record' : 'line'} between 1 and ${session.lines.toLocaleString()}.`)
      return
    }
    if (!search) { goToPosition(line); return }
    const result = await window.logdeck.locate({ id: session.id, line, searchVersion: search.version })
    if (!result.ok) onError(result.error)
    else if (result.value === null) onError('That source entry is filtered out or has not been scanned yet. Clear filters to view it.')
    else goToPosition(result.value)
  }

  async function applySearch() {
    setSearchBusy(true)
    setSearchError(null)
    try {
      const result = await window.logdeck.startSearch({ id: session.id, query, filters, caseSensitive, mode: 'regex' })
      if (!result.ok) setSearchError(result.error)
      else { resetView(); setSearch(result.value) }
    } catch (error) { setSearchError(String(error)) }
    finally { setSearchBusy(false) }
  }
  async function cancelSearch() {
    const result = await window.logdeck.cancelSearch(session.id)
    if (!result.ok) setSearchError(result.error)
    else {
      const status = await window.logdeck.searchStatus(session.id)
      if (status.ok) setSearch(status.value)
      else setSearchError(status.error)
    }
  }
  async function clearSearch() {
    setSearchBusy(true)
    try {
      if (search) {
        const result = await window.logdeck.cancelSearch(session.id)
        if (!result.ok) { setSearchError(result.error); return }
      }
      resetView(); setSearch(null); setQuery(''); setFilters({}); setSearchError(null)
    } finally { setSearchBusy(false) }
  }

  const findColumnKey = visibleColumns.map(column => column.id).join(',')
  useEffect(() => {
    const current = ++findGeneration.current
    ++findNavigation.current
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    setFindInfo(null); setFindError(null); setFindMatch(null); setFindOrdinal(0); findCursor.current = 0
    setAppliedHighlight('')
    const poll = async (initial: boolean) => {
      try {
        const result = initial ? await window.logdeck.startFind({
          id: session.id, query: highlightQuery, caseSensitive: highlightCaseSensitive,
          columns: visibleColumns.map(column => column.id), searchVersion: version
        }) : await window.logdeck.findStatus(session.id)
        if (stopped || current !== findGeneration.current) return
        if (!result.ok) { setFindError(result.error); return }
        setAppliedHighlight(highlightQuery)
        setFindInfo(result.value)
        if (result.value.status === 'running') timer = setTimeout(() => void poll(false), 150)
      } catch (error) { if (!stopped) setFindError(String(error)) }
    }
    if (findOpen && active && highlightQuery && session.status === 'ready' && (!search || search.status === 'ready')) {
      timer = setTimeout(() => void poll(true), 180)
    }
    return () => {
      stopped = true
      clearTimeout(timer)
      void window.logdeck.cancelFind(session.id).then(result => { if (mounted.current && !result.ok) onError(result.error) }).catch(error => { if (mounted.current) onError(String(error)) })
    }
  }, [findOpen, active, highlightQuery, highlightCaseSensitive, version, search?.status, session.status, findColumnKey])

  async function navigateFind(ordinal: number) {
    if (!findInfo?.matches || findInfo.status !== 'ready') return
    const next = ((ordinal - 1) % findInfo.matches + findInfo.matches) % findInfo.matches + 1
    findCursor.current = next
    const navigation = ++findNavigation.current
    const current = findGeneration.current
    try {
      const result = await window.logdeck.findMatch({ id: session.id, version: findInfo.version, ordinal: next, emv: emvEnabled })
      if (current !== findGeneration.current || navigation !== findNavigation.current) return
      if (!result.ok) { setFindError(result.error); return }
      if (expandedFindRow.current !== null && expandedFindRow.current !== result.value.position) cache.current.delete(expandedFindRow.current)
      expandedFindRow.current = result.value.row.message.length > limits.segmentBytes ? result.value.position : null
      cache.current.set(result.value.position, result.value.row)
      findReveal.current = true
      setFindMatch(result.value); setFindOrdinal(next)
      setMessageWidth(value => Math.max(value, messageWidthOf(result.value.row.message)))
      setRevision(value => value + 1)
      goToPosition(result.value.position, false)
    } catch (error) { if (current === findGeneration.current) setFindError(String(error)) }
  }
  useEffect(() => {
    if (findInfo?.status === 'ready' && findInfo.matches) void navigateFind(findCursor.current || 1)
  }, [findInfo?.version, findInfo?.status, emvEnabled])
  useEffect(() => {
    if (!findMatch || !active || !findReveal.current) return
    const frame = requestAnimationFrame(() => {
      const mark = viewport.current?.querySelector('.current-find')
      if (mark) {
        mark.scrollIntoView({ block: 'center', inline: 'nearest' })
        findReveal.current = false
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [findMatch, page, revision, first, last])
  async function copySelection() {
    if (!selectedCount) { onError('Select one or more records before copying.'); return }
    const result = await window.logdeck.copyRecords({ id: session.id, searchVersion: version, ranges: selection })
    if (!result.ok) { onError(result.error); return }
    const copied = await window.logdeck.writeClipboard(result.value)
    if (!copied.ok) onError(copied.error)
  }
  async function startExport(selectedOnly: boolean) {
    setExportBusy(true)
    try {
      const result = await window.logdeck.exportRecords({
        id: session.id, searchVersion: version,
        ...(selectedOnly ? { ranges: selection } : {})
      })
      if (!result.ok) onError(result.error)
      else if (result.value) setExportInfo(result.value)
    } catch (error) { onError(String(error)) }
    finally { setExportBusy(false) }
  }
  useEffect(() => {
    if (exportInfo?.status !== 'running') return
    let stopped = false
    const timer = setInterval(() => {
      void window.logdeck.exportStatus(session.id).then(result => {
        if (stopped) return
        if (!result.ok) { onError(result.error); setExportInfo(null) }
        else setExportInfo(result.value)
      }).catch(error => { if (!stopped) { onError(String(error)); setExportInfo(null) } })
    }, 200)
    return () => { stopped = true; clearInterval(timer) }
  }, [exportInfo?.status, session.id])
  function storePreset(rename = false) {
    const name = presetName.trim()
    if (!name) { onError('Enter a preset name.'); return }
    const existing = presets.find(preset => preset.id === presetId)
    if (rename && !existing) { onError('Select a saved preset to rename.'); return }
    if (!rename && presets.length >= 50) { onError('Delete a preset before adding another (50 maximum).'); return }
    const preset: Preset = rename ? { ...existing!, name } :
      { id: crypto.randomUUID(), name, query, filters, caseSensitive, mode: 'regex' }
    if (savePresets(rename ? presets.map(value => value.id === preset.id ? preset : value) : [...presets, preset])) setPresetId(preset.id)
  }
  function selectRow(position: number, extend: boolean, additive: boolean) {
    if (extend && selected !== null) {
      setSelection([{ start: Math.min(selected, position), end: Math.max(selected, position) }])
      return
    }
    const next = additive ? togglePosition(selection, position) :
      containsPosition(selection, position) ? [] : [{ start: position, end: position }]
    if (next.length > 500) { onError('At most 500 disjoint selection ranges are supported. Use Shift+click for a continuous range.'); return }
    setSelection(next)
    setSelected(next.length ? position : null)
  }
  async function segment(position: number, offset: number) {
    const row = cache.current.get(position)
    if (!row) return
    const current = generation.current
    const result = await window.logdeck.readSegment({ id: session.id, line: row.line, offset, emv: emvEnabled })
    if (generation.current !== current) return
    if (!result.ok) onError(result.error)
    else {
      cache.current.set(position, { ...row, ...result.value })
      setMessageWidth(value => Math.max(value, result.value.raw.length * 7.2 + 300))
      setRevision(value => value + 1)
    }
  }
  useEffect(() => {
    if (!active || !keyboardActive) return
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault(); setFindOpen(true)
        requestAnimationFrame(() => { searchInput.current?.focus(); searchInput.current?.select() })
      }
      if (event.key === 'F3') { event.preventDefault(); setFindOpen(true); void navigateFind(findCursor.current + (event.shiftKey ? -1 : 1)) }
      if (event.key === 'Escape' && findOpen) { event.preventDefault(); setFindOpen(false); viewport.current?.focus() }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.ctrlKey && !event.altKey && !event.metaKey &&
        selectedCount === 1 && selected !== null && event.target instanceof Element &&
        event.target.closest('.table-scroll') && !event.target.closest('button, input, textarea, select, [contenteditable=true], [role=separator]')) {
        event.preventDefault()
        goToPosition(selected + (event.key === 'ArrowUp' ? -1 : 1))
        viewport.current?.focus({ preventScroll: true })
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'g') { event.preventDefault(); document.getElementById(`line-${session.id}`)?.focus() }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); void copySelection().catch(error => onError(String(error))) }
      else if (event.ctrlKey && event.key.toLowerCase() === 'c' && selectedCount &&
        event.target instanceof Element && event.target.closest('.table-section') && !window.getSelection()?.toString()) {
        event.preventDefault(); void copySelection().catch(error => onError(String(error)))
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, keyboardActive, selected, selection, page, total, wrap, version, findOpen, findInfo])

  const progress = session.size ? Math.min(100, session.indexedBytes / session.size * 100) : 100
  return (
    <main className="viewer" aria-label={`Viewer ${session.name}`}>
      {controls && <div className="viewer-toolbar">
        <form className="search-form" onSubmit={event => { event.preventDefault(); if (!searchBusy && session.status === 'ready') void applySearch() }}>
          <span className="filter-mode-label">Regex</span>
          <input aria-label="Regex filter" placeholder="Regex on raw records - press Enter to filter" maxLength={2000} value={query} onChange={event => setQuery(event.target.value)} />
          <label className="filter-check"><input aria-label="Filter case sensitive" type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} /> Aa</label>
          <button className="secondary-button" disabled={searchBusy || session.status !== 'ready'}>Apply filters</button>
          <button type="button" className="text-button" onClick={() => void clearSearch().catch(error => onError(String(error)))}>Reset filters</button>
          <button type="button" className="text-button" aria-expanded={advancedFilters} onClick={() => setAdvancedFilters(!advancedFilters)}>More filters</button>
        </form>
        <button className="icon-button" aria-label="Find text (Ctrl+F)" onClick={() => { setFindOpen(true); requestAnimationFrame(() => searchInput.current?.focus()) }}><Search size={16} /></button>
        <button className={`icon-button ${wrap ? 'pressed' : ''}`} aria-label="Wrap all columns" aria-pressed={wrap} title="Wrap all columns" onClick={toggleWrap}><WrapText size={18} /></button>
        <button className="text-button" aria-label="Track EMV tags" aria-pressed={emvEnabled}
          title="Context-aware detection on displayed records only; no whole-file scan" onClick={() => {
            generation.current++; cache.current.clear(); setReadError(null); setEmvSelection(null)
            setEmvEnabled(value => !value); setRevision(value => value + 1)
          }}>EMV {emvEnabled ? 'on' : 'off'}</button>
        <button className="icon-button" aria-label="Copy selected records" onClick={() => void copySelection().catch(error => onError(String(error)))}><Copy size={16} /></button>
        {onSplit && <button className="text-button" disabled={session.status !== 'ready'} onClick={onSplit}>Split view</button>}
        <form className="line-jump" onSubmit={event => { event.preventDefault(); void goToSource().catch(error => onError(String(error))) }}>
          <label htmlFor={`line-${session.id}`}>{session.format === 'android-json' ? 'Record' : 'Line'}</label>
          <input id={`line-${session.id}`} aria-label={session.format === 'android-json' ? 'Record number' : 'Source line number'} type="number" min="1" max={session.lines} value={targetLine} onChange={event => setTargetLine(event.target.value)} />
          <button className="icon-button" aria-label={session.format === 'android-json' ? 'Go to record' : 'Go to source line'} disabled={searchBusy || !session.lines}><ArrowRight size={16} /></button>
        </form>
        <button className="icon-button" aria-label="Hide filters and toolbar" onClick={() => setControls(false)}><X size={16} /></button>
      </div>}
      {(session.warning || session.error || readError || session.status === 'cancelled') && <div className="viewer-notice" role={session.error || readError ? 'alert' : 'status'}>
        {session.error || readError || session.warning || 'Indexing cancelled. Only indexed entries are available; reopen to finish.'}
        {readError && <button className="text-button" onClick={() => setReadError(null)}>Retry</button>}
      </div>}
      {(searchError || search?.error) && <div className="viewer-notice" role="alert">{searchError || search?.error}</div>}
      {/* {controls && search && <div className="search-summary" role="status">
        <span>{search.matches.toLocaleString()} matching records · {search.scanned.toLocaleString()} / {search.total.toLocaleString()} scanned
          {search.status === 'running' ? ' · Searching (partial)' : search.status === 'cancelled' ? ' · Cancelled (partial)' : search.status === 'error' ? ' · Failed (incomplete)' : ' · Complete'}</span>
        {search.status === 'running' && <button className="text-button" onClick={() => void cancelSearch().catch(error => onError(String(error)))}>Cancel search</button>}
        <button className="text-button" onClick={() => goToPosition((selected ?? 0) - 1)}>Previous match</button>
        <button className="text-button" onClick={() => goToPosition((selected ?? 0) + 1)}>Next match</button>
        <button className="text-button" disabled={searchBusy} onClick={() => void clearSearch().catch(error => onError(String(error)))}>Clear filters</button>
      </div>} */}
      {/* {controls && <div className="export-toolbar">
        <span>{selectedCount ? `${selectedCount.toLocaleString()} selected · Ctrl+click toggles; Shift+click extends` : 'Click to select/deselect; Ctrl+click adds rows; Shift+click selects a range'}</span>
        <button className="text-button" disabled={!selectedCount} onClick={() => void copySelection().catch(error => onError(String(error)))}>Copy selection</button>
        <button className="text-button" disabled={!selectedCount || exportBusy || exportInfo?.status === 'running' || session.status !== 'ready' || Boolean(search && search.status !== 'ready')} onClick={() => void startExport(true)}>Export selection</button>
        <button className="text-button" disabled={!total || exportBusy || exportInfo?.status === 'running' || session.status !== 'ready' || Boolean(search && search.status !== 'ready')} onClick={() => void startExport(false)}>Export {search ? 'results' : 'all'}</button>
        {exportInfo && <span role="status">{exportInfo.status === 'ready' ? 'Export complete' : exportInfo.status === 'error' ? `Export failed: ${exportInfo.error}` : exportInfo.status === 'cancelled' ? 'Export cancelled' : 'Exporting'} · {exportInfo.written.toLocaleString()} / {exportInfo.total.toLocaleString()}</span>}
        {exportInfo?.status === 'running' && <button className="text-button" onClick={() => void window.logdeck.cancelExport(session.id).then(result => { if (!result.ok) onError(result.error) }).catch(error => onError(String(error)))}>Cancel export</button>}
      </div>} */}
        {controls && advancedFilters && <section className="filter-options" aria-label="File information and filters"
          onKeyDown={event => {
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.getAttribute('aria-label') !== 'Preset name') {
              event.preventDefault(); if (!searchBusy && session.status === 'ready') void applySearch()
            }
          }}>
          <fieldset className="level-filters"><legend>Levels (OR)</legend>{(['V', 'D', 'I', 'W', 'E', 'F', 'A'] as LogLevel[]).map(level => <label key={level}>
            <input type="checkbox" aria-label={`Level ${level}`} checked={filters.levels?.includes(level) ?? false} onChange={event => setFilters(value => ({ ...value, levels: event.target.checked ? [...(value.levels ?? []), level] : value.levels?.filter(item => item !== level) }))} />
            <span className={`level level-${level}`}>{level}</span>
          </label>)}</fieldset>
          {(['tag', 'pid', 'tid', 'application', 'include', 'exclude', 'from', 'to'] as const).map(field => <label className="filter-field" key={field}>
            {{ tag: 'Tag contains', pid: 'PID exact', tid: 'TID exact', application: 'Application contains', include: 'Include raw text', exclude: 'Exclude raw text', from: 'Time from (inclusive)', to: 'Time to (inclusive)' }[field]}
            <input aria-label={`Filter ${field}`} disabled={field === 'application' && session.format !== 'android-json'} maxLength={256} value={filters[field] ?? ''} onChange={event => setFilters(value => ({ ...value, [field]: event.target.value }))} />
          </label>)}
          <label className="filter-field">Severity color<select aria-label="Severity color style" value={severityStyle} onChange={event => saveSeverityStyle(event.target.value === 'background' ? 'background' : 'text')}><option value="text">Text only</option><option value="background">Row background</option></select></label>
          <select aria-label="Saved preset" value={presetId} onChange={event => {
            setPresetId(event.target.value)
            const preset = presets.find(value => value.id === event.target.value)
            if (preset) {
              setPresetName(preset.name)
              if (preset.mode !== 'regex') { onError('This saved preset uses the retired expression syntax. It was not loaded. Recreate it as regex with the advanced filters; the original preset is preserved.'); return }
              setQuery(preset.query); setFilters(preset.filters); setCaseSensitive(preset.caseSensitive)
            }
          }}><option value="">Choose preset</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}{preset.mode === 'expression' ? ' (legacy expression)' : ''}</option>)}</select>
          <p className="muted">Selecting loads controls; Apply filters runs the saved investigation.</p>
          <input aria-label="Preset name" maxLength={80} value={presetName} onChange={event => setPresetName(event.target.value)} placeholder="Name this investigation" />
          <div className="preset-actions"><button className="text-button" onClick={() => storePreset()}>Save new preset</button><button className="text-button" disabled={!presetId} onClick={() => storePreset(true)}>Rename preset</button><button className="text-button" disabled={!presetId} onClick={() => { if (savePresets(presets.filter(value => value.id !== presetId))) { setPresetId(''); setPresetName('') } }}>Delete preset</button></div>
          <details className="search-help"><summary>Filter syntax</summary><p>Regex tests raw records with JavaScript Unicode syntax, without / delimiters. Use Core\. or Receipt|Payment; use More filters for exact PID/TID, levels and include/exclude categories. An empty regex allows every record passing the advanced filters. Expression syntax is no longer offered.</p><p>Time bounds use source timestamp strings in the same format. Categories combine by AND; checked levels by OR. Press Enter or Apply filters to run. Regex runs in an isolated worker with a 500 ms batch watchdog. Records above 1 MB fail explicitly.</p><p>Ctrl+F finds literal occurrences across visible columns in all filtered records without hiding rows. Enter / F3 moves to the next occurrence; Shift+Enter / Shift+F3 moves to the previous one, wrapping at the ends. Counts include off-screen records and repeated occurrences. Clear search does not clear filters. Reset filters preserves find text and recounts. At most 400 highlights per cell plus the current occurrence are drawn. Records above 1 MB fail explicitly.</p></details>
          <details className="file-metadata"><summary>File details</summary><dl><dt>Size</dt><dd>{formatBytes(session.size)}</dd><dt>Indexed {session.format === 'android-json' ? 'records' : 'lines'}</dt><dd>{session.lines.toLocaleString()}</dd><dt>Index</dt><dd>{session.cacheHit ? 'Reused local cache' : session.status}</dd><dt>Format</dt><dd>{session.format === 'android-json' ? 'Android Studio JSON · UTC' : 'UTF-8 / threadtime + raw'}</dd></dl></details>
        </section>}
      <div className="workspace-body">
        <section className="table-section" aria-label="Log records">
          {findOpen && <div className="find-popup" role="search" aria-label="Find in filtered logs">
            <form className="search-form" onSubmit={event => { event.preventDefault(); void navigateFind(findCursor.current + 1) }}>
              <Search size={16} /><input ref={searchInput} aria-label="Search logs" placeholder="Find text in filtered logs" maxLength={2000} value={highlightQuery} onChange={event => setHighlightQuery(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void navigateFind(findCursor.current + (event.shiftKey ? -1 : 1)) } }} />
              <label className="filter-check"><input aria-label="Search case sensitive" type="checkbox" checked={highlightCaseSensitive} onChange={event => setHighlightCaseSensitive(event.target.checked)} /> Aa</label>
              <button type="button" className="icon-button" aria-label="Previous text match" disabled={findInfo?.status !== 'ready' || !findInfo.matches} onClick={() => void navigateFind(findCursor.current - 1)}><ArrowUp size={16} /></button>
              <button className="icon-button" aria-label="Next text match" disabled={findInfo?.status !== 'ready' || !findInfo.matches}><ArrowDown size={16} /></button>
              <button type="button" className="text-button" onClick={() => { setHighlightQuery(''); setAppliedHighlight('') }}>Clear search</button>
              <button type="button" className="icon-button" aria-label="Close find" onClick={() => setFindOpen(false)}><X size={16} /></button>
            </form>
            <div role="status">{findError || findInfo?.error ? `Find failed: ${findError || findInfo?.error}` :
              findInfo ? `${findOrdinal.toLocaleString()} of ${findInfo.matches.toLocaleString()} matches${findInfo.status === 'running' ? ' (counting...)' : findInfo.status === 'cancelled' ? ' (cancelled, incomplete)' : ''}` :
                !highlightQuery ? 'Type to find text · Enter: next · Shift+Enter: previous' : search && search.status !== 'ready' ? 'Complete or reset filters before finding text.' : session.status !== 'ready' ? 'Wait for indexing to finish.' : 'Finding...'}</div>
          </div>}
          <div className="table-scroll" ref={viewport} tabIndex={0} aria-label="Scrollable log table" onScroll={event => { if (active) scrollMemory.current = event.currentTarget.scrollTop }}>
            <table className={`log-table ${wrap ? 'wrap-table' : 'nowrap-table'} severity-${severityStyle}`} aria-label={session.format === 'android-json' ? 'Log records' : 'Log lines'} aria-rowcount={total + 1}
              style={{ width: wrap ? '100%' : `${tableWidth}px`, '--columns': grid, fontSize: display.fontSize } as React.CSSProperties}>
              <thead><tr>{visibleColumns.map(column => <th key={column.id}>{column.id === 'line' ? session.format === 'android-json' ? 'RECORD' : 'LINE' : column.id.toUpperCase()}
                <span className="column-resize" role="separator" aria-label={`Resize ${column.id} column`} aria-orientation="vertical" aria-valuenow={column.width} aria-valuemin={40} aria-valuemax={4000} tabIndex={0}
                  onPointerDown={event => { resizing.current = { id: column.id, x: event.clientX, width: column.width }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
                  onPointerMove={event => {
                    const resize = resizing.current
                    if (!resize || resize.id !== column.id) return
                    const width = Math.min(4000, Math.max(40, Math.round(resize.width + event.clientX - resize.x)))
                    saveColumns(columns.map(value => value.id === column.id ? { ...value, width } : value))
                  }} onPointerUp={() => { resizing.current = null }} onPointerCancel={() => { resizing.current = null }}
                  onKeyDown={event => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    saveColumns(columns.map(value => value.id === column.id ? { ...value, width: Math.min(4000, Math.max(40, column.width + (event.key === 'ArrowLeft' ? -10 : 10))) } : value))
                  }} />
              </th>)}</tr></thead>
              <tbody style={{ height: virtual.getTotalSize() }}>
                {items.map(item => {
                  const position = page + item.index + 1
                  const row = cache.current.get(position)
                  const currentFor = (column: ColumnId) => findMatch?.position === position && findMatch.column === column ? findMatch : undefined
                  return <tr key={position} ref={virtual.measureElement} data-index={item.index} aria-rowindex={position + 1}
                    className={`severity-${row?.level || 'unknown'} ${containsPosition(selection, position) ? 'selected' : ''} ${findMatch?.position === position ? 'find-row' : ''}`} aria-selected={containsPosition(selection, position)}
                    style={{ transform: `translateY(${item.start}px)` }} tabIndex={0}
                    onClick={event => selectRow(position, event.shiftKey, event.ctrlKey || event.metaKey)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRow(position, event.shiftKey, event.ctrlKey || event.metaKey) } }}>
                    {visibleColumns.map(column => <td key={column.id} className={`${column.id}-cell`}>
                      {column.id === 'line' ? row ? <Highlight text={String(row.line)} terms={highlightTerms} caseSensitive={highlightCaseSensitive} current={currentFor(column.id)} /> : '…' : column.id === 'level' ? row?.level && <span className={`level level-${row.level}`}><Highlight text={row.level} terms={highlightTerms} caseSensitive={highlightCaseSensitive} current={currentFor(column.id)} /></span> :
                        column.id === 'message' ? row ? <><Highlight text={row.segmentOffset ? row.raw : row.message} terms={highlightTerms} caseSensitive={highlightCaseSensitive} current={currentFor(column.id)}
                          emv={emvEnabled ? row.emv?.occurrences : undefined} onTag={occurrence => setEmvSelection({ occurrence, line: row.line, sourceLine: row.sourceLine, segmentOffset: row.segmentOffset })} />
                          {emvEnabled && row.emv?.notices.map((notice, index) => <span className="emv-notice" key={index} role="note">{notice}</span>)}</> : <span className="muted">Reading indexed range...</span> :
                          row && <Highlight text={row[column.id]} terms={highlightTerms} caseSensitive={highlightCaseSensitive} current={currentFor(column.id)} />}
                      {column.id === 'message' && row?.truncated && <span className="segment-controls"> [bytes {row.segmentOffset}–{row.nextOffset} of {row.byteLength}]
                        <button className="text-button" disabled={!row.segmentOffset} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void segment(position, 0).catch(error => onError(String(error))) }}>First text segment</button>
                        <button className="text-button" disabled={row.nextOffset >= row.byteLength} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void segment(position, row.nextOffset).catch(error => onError(String(error))) }}>Next text segment</button>
                      </span>}
                    </td>)}
                  </tr>
                })}
              </tbody>
            </table>
            {!total && <div className="table-empty"><h3>{search ? 'No matching records' : session.status === 'ready' ? 'This file is empty' : 'Preparing the first records'}</h3><p>{search ? 'Change your query or clear filters.' : 'Records appear as they are indexed.'}</p></div>}
          </div>
          <div className="range-navigation">
            <button className="icon-button" aria-label="First line" disabled={!total} onClick={() => goToPosition(1)}><ArrowUp size={15} /></button>
            <button className="icon-button" aria-label="Previous line segment" disabled={!page} onClick={() => goToPosition(Math.max(1, page - pageSize + 1))}><ArrowLeft size={15} /></button>
            <input aria-label="Global source position" type="range" min="1" max={Math.max(1, total)} value={Math.max(1, firstVisible)} onChange={event => goToPosition(Number(event.target.value))} disabled={!total} />
            <button className="icon-button" aria-label="Next line segment" disabled={page + count >= total} onClick={() => goToPosition(page + pageSize + 1)}><ArrowRight size={15} /></button>
            <button className="icon-button" aria-label="Last line" disabled={!total} onClick={() => goToPosition(total)}><ArrowDown size={15} /></button>
          </div>
        </section>
        {emvEnabled && emvSelection && <EmvInspector selection={emvSelection} companyPack={companyPack} onClose={() => setEmvSelection(null)} onEdit={onEmv} />}
      </div>
      <footer className="viewer-status"><span><span className="status-dot" />{session.status === 'indexing' ? `Indexing ${progress.toFixed(0)}%` : session.status} · {session.lines.toLocaleString()} {session.format === 'android-json' ? 'records' : 'lines'}</span>
        {!controls && <button className="text-button" onClick={() => setControls(true)}>Show filters and toolbar</button>}
        {session.status === 'indexing' && <><progress value={progress} max="100" aria-label="Indexing progress" /><button className="text-button" onClick={() => void window.logdeck.cancel(session.id).then(result => { if (!result.ok) onError(result.error) }).catch(error => onError(String(error)))}><Square size={12} /> Cancel</button></>}
        <span className="toolbar-spacer" /><span>Read-only source · {emvEnabled ? 'EMV: displayed records only · ' : ''}{wrap ? 'Wrap on' : 'Horizontal scroll'} · Local only</span>
      </footer>
    </main>
  )
}
