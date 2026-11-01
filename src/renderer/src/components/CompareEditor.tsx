import { useEffect, useRef, type RefObject } from 'react'
import { Annotation, Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { validateText } from '../../../../shared/text'
import { wordDifference } from '../tools/diff'

const externalChange = Annotation.define<boolean>()
const differencesChanged = StateEffect.define<void>()
const alignmentChanged = StateEffect.define<DecorationSet>()
const alignment = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none
    for (const effect of transaction.effects) if (effect.is(alignmentChanged)) value = effect.value
    return value
  },
  provide: field => EditorView.decorations.from(field)
})

class AlignmentGap extends WidgetType {
  constructor(readonly rows: number, readonly selected: boolean, readonly lineHeight: number) { super() }
  eq(other: AlignmentGap) { return this.rows === other.rows && this.selected === other.selected && this.lineHeight === other.lineHeight }
  get estimatedHeight() { return this.rows * this.lineHeight }
  toDOM() {
    const element = document.createElement('div')
    element.className = `compare-alignment-gap${this.selected ? ' compare-selected-difference' : ''}`
    element.style.height = `${this.estimatedHeight}px`
    element.dataset.rows = String(this.rows)
    element.setAttribute('aria-hidden', 'true')
    return element
  }
}

interface Props {
  text: string
  otherText: string
  side: 'left' | 'right'
  label: string
  newline: '\n' | '\r\n'
  bom: boolean
  readOnly: boolean
  differences: { start: number; end: number; otherStart: number; otherEnd: number }[]
  selectedDifference: number
  editorRef: RefObject<EditorView | null>
  onChange: (text: string) => void
  onHistory: (redo: boolean) => void
  onError: (message: string) => void
  onScroll: (view: EditorView) => void
}

export default function CompareEditor(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const editable = useRef(new Compartment())
  const otherLines = useRef<string[]>([])
  useEffect(() => { otherLines.current = props.otherText.split('\n') }, [props.otherText])
  useEffect(() => {
    function decorate(view: EditorView) {
      const lines = new Set<number>()
      for (const visible of view.visibleRanges) {
        for (let line = view.state.doc.lineAt(visible.from); line.from <= visible.to;) {
          lines.add(line.from)
          if (line.number === view.state.doc.lines) break
          line = view.state.doc.line(line.number + 1)
        }
      }
      let change = 0
      const ranges = latest.current.differences
      return Decoration.set([...lines].sort((a, b) => a - b).flatMap(from => {
        const number = view.state.doc.lineAt(from).number - 1
        while (change < ranges.length && Math.max(ranges[change].end - 1, ranges[change].start) < number) change++
        const range = ranges[change]
        if (!range || number < range.start || number >= range.end) return []
        const selected = change === latest.current.selectedDifference ? ' compare-selected-difference' : ''
        const decorations = [Decoration.line({ class: `compare-changed-line${selected}` }).range(from)]
        const otherNumber = range.otherStart + number - range.start
        if (otherNumber >= range.otherEnd) return decorations
        const line = view.state.doc.lineAt(from)
        const other = otherLines.current[otherNumber] ?? ''
        const words = latest.current.side === 'left' ? wordDifference(line.text, other) : wordDifference(other, line.text)
        if (words) {
          let offset = from
          for (const part of words[latest.current.side]) {
            if (part.changed && part.text.length) decorations.push(Decoration.mark({ class: 'compare-changed-word' }).range(offset, offset + part.text.length))
            offset += part.text.length
          }
        } else if (line.length) {
          let start = 0, end = line.length, otherEnd = other.length
          while (start < end && start < otherEnd && line.text[start] === other[start]) start++
          while (end > start && otherEnd > start && line.text[end - 1] === other[otherEnd - 1]) { end--; otherEnd-- }
          if (end > start) decorations.push(Decoration.mark({ class: 'compare-changed-word' }).range(from + start, from + end))
        }
        return decorations
      }), true)
    }
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: latest.current.text,
        extensions: [
          lineNumbers(), highlightActiveLine(), drawSelection(), alignment,
          EditorView.domEventHandlers({ scroll: (_event, view) => { latest.current.onScroll(view) } }),
          ViewPlugin.fromClass(class {
            decorations
            constructor(view: EditorView) { this.decorations = decorate(view) }
            update(update: ViewUpdate) {
              if (update.docChanged || update.viewportChanged || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(differencesChanged)))) this.decorations = decorate(update.view)
            }
          }, { decorations: plugin => plugin.decorations }),
          EditorView.contentAttributes.of({ 'aria-label': latest.current.label, spellcheck: 'false' }),
          editable.current.of(EditorState.readOnly.of(latest.current.readOnly)),
          keymap.of([
            { key: 'Mod-z', run: () => { latest.current.onHistory(false); return true } },
            { key: 'Mod-Shift-z', run: () => { latest.current.onHistory(true); return true } },
            { key: 'Mod-y', run: () => { latest.current.onHistory(true); return true } },
            ...defaultKeymap
          ]),
          EditorState.transactionFilter.of(transaction => {
            if (!transaction.docChanged || transaction.annotation(externalChange)) return transaction
            try {
              validateText(transaction.newDoc.toString(), latest.current.newline, latest.current.bom)
              return transaction
            } catch (error) {
              latest.current.onError(String(error))
              return []
            }
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalChange))) {
              latest.current.onChange(update.state.doc.toString())
            }
          })
        ]
      })
    })
    props.editorRef.current = view
    return () => { props.editorRef.current = null; view.destroy() }
  }, [])
  useEffect(() => {
    const view = props.editorRef.current
    if (view && view.state.doc.toString() !== props.text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.text }, annotations: externalChange.of(true) })
    }
  }, [props.text])
  useEffect(() => {
    props.editorRef.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(props.readOnly)) })
  }, [props.readOnly])
  useEffect(() => {
    const view = props.editorRef.current
    if (!view) return
    const gaps = props.differences.flatMap((range, index) => {
      const rows = range.otherEnd - range.otherStart - (range.end - range.start)
      if (rows <= 0) return []
      const atEnd = range.end >= view.state.doc.lines
      const position = atEnd ? view.state.doc.length : view.state.doc.line(range.end + 1).from
      return [Decoration.widget({
        widget: new AlignmentGap(rows, index === props.selectedDifference, view.defaultLineHeight),
        block: true,
        side: atEnd ? 1 : -1
      }).range(position)]
    })
    view.dispatch({ effects: [alignmentChanged.of(Decoration.set(gaps, true)), differencesChanged.of()] })
  }, [props.differences, props.otherText, props.selectedDifference])
  return <div className="compare-code-editor" ref={container} />
}
