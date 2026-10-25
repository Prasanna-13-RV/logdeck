import { useEffect, useMemo, useRef, useState } from 'react'
import type { TextDocument } from '../../../../shared/contracts'
import { validateText } from '../../../../shared/text'
import { wordDifference, type Difference } from '../tools/diff'
import { EditorView } from '@codemirror/view'
import CompareEditor from './CompareEditor'

interface Pane {
  text: string; saved: string; document?: TextDocument
  newline: '\n' | '\r\n'; bom: boolean; savedNewline: '\n' | '\r\n'; savedBom: boolean
  undo: string[]; redo: string[]
}
const blank = (): Pane => ({ text: '', saved: '', newline: '\n', savedNewline: '\n', bom: false, savedBom: false, undo: [], redo: [] })
const dirty = (pane: Pane) => pane.text !== pane.saved || pane.newline !== pane.savedNewline || pane.bom !== pane.savedBom
function history(values: string[], text: string) {
  const next = [...values, text]
  let size = next.reduce((sum, item) => sum + item.length * 2, 0)
  while (next.length > 50 || size > 20_000_000) size -= next.shift()!.length * 2
  return next
}

export default function Compare({ tabId, active, onStatus, onError }: { tabId: string; active: boolean; onStatus: (id: string, dirty: boolean, busy: boolean) => void; onError: (message: string) => void }) {
  const [panes, setPanes] = useState<[Pane, Pane]>([blank(), blank()])
  const panesRef = useRef(panes)
  panesRef.current = panes
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [differences, setDifferences] = useState<Difference[]>([])
  const [current, setCurrent] = useState(0)
  const [status, setStatus] = useState('Waiting')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  busyRef.current = busy
  const [revision, setRevision] = useState(0)
  const worker = useRef<Worker | null>(null)
  const comparisonGeneration = useRef(0)
  const editors = [useRef<EditorView>(null), useRef<EditorView>(null)]
  const [changed, setChanged] = useState(false)
  const hasChanges = panes.some(dirty)
  useEffect(() => { onStatus(tabId, hasChanges, busy) }, [tabId, hasChanges, busy, onStatus])
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (panesRef.current.some(dirty) || busyRef.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', prevent)
    return () => {
      window.removeEventListener('beforeunload', prevent)
      worker.current?.terminate()
      for (const pane of panesRef.current) if (pane.document) void window.logdeck.releaseText(pane.document.id).then(result => { if (!result.ok) onError(result.error) }).catch(error => onError(String(error)))
    }
  }, [])
  useEffect(() => {
    const generation = ++comparisonGeneration.current
    worker.current?.terminate()
    setDifferences([])
    setCurrent(0)
    setStatus(active ? 'Comparing...' : 'Paused while tab is inactive')
    if (!active) return
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      if (cancelled || comparisonGeneration.current !== generation) return
      const job = new Worker(new URL('../tools/diffWorker.ts', import.meta.url), { type: 'module' })
      worker.current = job
      timeout = setTimeout(() => { job.terminate(); if (comparisonGeneration.current === generation) { worker.current = null; setStatus('Diff timed out after 5 seconds. Edit the input or Retry.') } }, 5000)
      job.onmessage = event => {
        if (generation !== comparisonGeneration.current) return
        clearTimeout(timeout)
        job.terminate()
        worker.current = null
        if (event.data.ok) { setDifferences(event.data.differences); setStatus('Complete') }
        else setStatus(`Diff failed: ${String(event.data.error)}`)
      }
      job.onerror = () => {
        clearTimeout(timeout)
        job.terminate()
        if (generation !== comparisonGeneration.current) return
        worker.current = null
        setStatus('Diff worker failed. Retry or reopen Compare.')
      }
      job.postMessage({ left: panes[0].text, right: panes[1].text, options: { ignoreCase, ignoreWhitespace } })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(timeout); worker.current?.terminate(); worker.current = null }
  }, [panes[0].text, panes[1].text, ignoreCase, ignoreWhitespace, active, revision])

  function update(index: number, updater: (pane: Pane) => Pane) {
    setPanes(previous => previous.map((pane, i) => i === index ? updater(pane) : pane) as [Pane, Pane])
  }
  function edit(index: number, text: string) {
    const pane = panesRef.current[index]
    try {
      validateText(text, pane.newline, pane.bom)
      update(index, value => ({ ...value, text, undo: history(value.undo, value.text), redo: [] }))
      setChanged(true)
    } catch (error) { onError(String(error)) }
  }
  async function openPane(index: number) {
    if (busy) return
    setBusy(true)
    try {
      if (dirty(panesRef.current[index])) {
        const response = await window.logdeck.confirmDiscard()
        if (!response.ok) throw new Error(response.error)
        if (!response.value) return
      }
      const result = await window.logdeck.openText()
      if (!result.ok) throw new Error(result.error)
      if (!result.value) return
      const old = panesRef.current[index].document
      if (old) {
        const released = await window.logdeck.releaseText(old.id)
        if (!released.ok) {
          await window.logdeck.releaseText(result.value.id)
          throw new Error(released.error)
        }
      }
      const document = result.value
      update(index, () => ({ ...blank(), text: document.text, saved: document.text, newline: document.newline, savedNewline: document.newline, bom: document.bom, savedBom: document.bom, document }))
    } catch (error) { onError(String(error)) }
    finally { setBusy(false) }
  }
  async function save(index: number, saveAs: boolean) {
    if (busy) return
    setBusy(true)
    const pane = panesRef.current[index]
    try {
      const result = await window.logdeck.saveText({ id: pane.document?.id, text: pane.text, newline: pane.newline, bom: pane.bom, saveAs })
      if (!result.ok) throw new Error(result.error)
      if (result.value) update(index, value => ({ ...value, saved: pane.text, savedNewline: pane.newline, savedBom: pane.bom, document: result.value! }))
    } catch (error) { onError(String(error)) }
    finally { setBusy(false) }
  }
  function travel(index: number, redo: boolean) {
    if (busyRef.current) return
    const current = panesRef.current[index]
    const historyFrom = redo ? current.redo : current.undo
    if (!historyFrom.length) return
    try { validateText(historyFrom[historyFrom.length - 1], current.newline, current.bom) }
    catch (error) { onError(String(error)); return }
    update(index, pane => {
      const from = redo ? pane.redo : pane.undo
      if (!from.length) return pane
      const text = from[from.length - 1]
      return { ...pane, text, undo: redo ? history(pane.undo, pane.text) : pane.undo.slice(0, -1), redo: redo ? pane.redo.slice(0, -1) : history(pane.redo, pane.text) }
    })
  }
  const selected = differences[current]
  const chunks = useMemo(() => selected ? [panes[0].text.split('\n').slice(selected.aStart, selected.aEnd).join('\n'), panes[1].text.split('\n').slice(selected.bStart, selected.bEnd).join('\n')] : ['', ''], [selected, panes[0].text, panes[1].text])
  const words = useMemo(() => wordDifference(chunks[0], chunks[1]), [chunks[0], chunks[1]])
  function navigate(index: number) {
    if (!differences.length) return
    const next = (index + differences.length) % differences.length
    setCurrent(next)
    const difference = differences[next]
    ;[difference.aStart, difference.bStart].forEach((line, pane) => {
      const editor = editors[pane].current
      if (!editor) return
      const target = editor.state.doc.line(Math.min(line + 1, editor.state.doc.lines))
      editor.dispatch({ selection: { anchor: target.from, head: target.to }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
    })
  }
  function copyChange(to: number) {
    if (!selected || status !== 'Complete') return
    const from = 1 - to
    const source = panes[from].text.split('\n').slice(from === 0 ? selected.aStart : selected.bStart, from === 0 ? selected.aEnd : selected.bEnd)
    const target = panes[to].text.split('\n')
    const start = to === 0 ? selected.aStart : selected.bStart
    target.splice(start, (to === 0 ? selected.aEnd : selected.bEnd) - start, ...source)
    edit(to, target.join('\n'))
  }
  return <main className="compare-workspace" aria-label="Text Compare">
    <div className="compare-toolbar">
      <div><h2>Text Compare</h2><p className="muted">Independent editable UTF-8 documents · 10 MB / 100,000 lines per side</p></div>
      <label><input type="checkbox" checked={ignoreCase} onChange={event => setIgnoreCase(event.target.checked)} />Ignore case</label>
      <label><input type="checkbox" checked={ignoreWhitespace} onChange={event => setIgnoreWhitespace(event.target.checked)} />Ignore whitespace</label>
      <button className="secondary-button" onClick={() => setRevision(value => value + 1)}>Retry comparison</button>
      <button className="text-button" disabled={status !== 'Comparing...'} onClick={() => { comparisonGeneration.current++; worker.current?.terminate(); worker.current = null; setStatus('Comparison cancelled. Retry to compare again.') }}>Cancel comparison</button>
    </div>
    <div className="compare-status" role="status">{status} · {differences.length} changed blocks {differences.length > 0 && `· ${current + 1} selected`}{changed && ' · Editing is local until Save'}</div>
    <div className="compare-editors">{panes.map((pane, index) => <section className="compare-pane" key={index} aria-label={`${index === 0 ? 'Left' : 'Right'} document`}>
      <div className="compare-pane-toolbar"><strong>{pane.document?.name ?? 'Untitled'}{dirty(pane) ? ' *' : ''}</strong>
        <button className="text-button" disabled={busy} onClick={() => void openPane(index)}>Open {index === 0 ? 'left' : 'right'}</button>
        <button className="text-button" disabled={busy} onClick={() => void save(index, false)}>Save {index === 0 ? 'left' : 'right'}</button>
        <button className="text-button" disabled={busy} onClick={() => void save(index, true)}>Save {index === 0 ? 'left' : 'right'} as</button>
        <button className="text-button" disabled={busy || !pane.undo.length} onClick={() => travel(index, false)}>Undo {index === 0 ? 'left' : 'right'}</button>
        <button className="text-button" disabled={busy || !pane.redo.length} onClick={() => travel(index, true)}>Redo {index === 0 ? 'left' : 'right'}</button>
      </div>
      <CompareEditor editorRef={editors[index]} label={`${index === 0 ? 'Left' : 'Right'} comparison text`} text={pane.text} newline={pane.newline} bom={pane.bom}
        differences={differences.map(change => index === 0 ? { start: change.aStart, end: change.aEnd } : { start: change.bStart, end: change.bEnd })}
        readOnly={busy} onChange={text => edit(index, text)} onHistory={redo => travel(index, redo)} onError={onError} />
      <div className="compare-format"><span>{pane.text.split('\n').length.toLocaleString()} lines</span>
        <select aria-label={`${index === 0 ? 'Left' : 'Right'} newline`} value={pane.newline} onChange={event => {
          const newline = event.target.value as '\n' | '\r\n'
          try { validateText(pane.text, newline, pane.bom); update(index, value => ({ ...value, newline })) } catch (error) { onError(String(error)) }
        }}><option value={'\n'}>UTF-8 / LF</option><option value={'\r\n'}>UTF-8 / CRLF</option></select>
        <label><input type="checkbox" checked={pane.bom} onChange={event => {
          try { validateText(pane.text, pane.newline, event.target.checked); update(index, value => ({ ...value, bom: event.target.checked })) } catch (error) { onError(String(error)) }
        }} />UTF-8 BOM</label>
      </div>
    </section>)}</div>
    <div className="compare-toolbar">
      <button className="secondary-button" disabled={!differences.length} onClick={() => navigate(current - 1)}>Previous difference</button>
      <button className="secondary-button" disabled={!differences.length} onClick={() => navigate(current + 1)}>Next difference</button>
      <button className="secondary-button" disabled={!selected || busy || status !== 'Complete'} onClick={() => copyChange(1)}>Copy change left to right</button>
      <button className="secondary-button" disabled={!selected || busy || status !== 'Complete'} onClick={() => copyChange(0)}>Copy change right to left</button>
    </div>
    {selected && <div className="difference-preview" aria-label="Selected difference">
      <p>Left {selected.aStart === selected.aEnd ? `insertion at line ${selected.aStart + 1}` : `lines ${selected.aStart + 1}-${selected.aEnd}`} / Right {selected.bStart === selected.bEnd ? `insertion at line ${selected.bStart + 1}` : `lines ${selected.bStart + 1}-${selected.bEnd}`} · {words ? 'Word changes highlighted' : 'Word refinement skipped: block exceeds 4,000 characters / 200 tokens per side'}</p>
      <div className="tool-columns">{([0, 1] as const).map(index => <pre key={index}>{words ? words[index === 0 ? 'left' : 'right'].map((part, i) => part.changed ? <mark key={i}>{part.text}</mark> : part.text) : chunks[index].slice(0, 4000) + (chunks[index].length > 4000 ? '\n[Preview clipped; full text remains in editor]' : '')}</pre>)}</div>
    </div>}
  </main>
}
