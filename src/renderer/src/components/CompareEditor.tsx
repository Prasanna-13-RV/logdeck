import { useEffect, useRef, type RefObject } from 'react'
import { Annotation, Compartment, EditorState, StateEffect } from '@codemirror/state'
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { validateText } from '../../../../shared/text'

const externalChange = Annotation.define<boolean>()
const differencesChanged = StateEffect.define<void>()

interface Props {
  text: string
  label: string
  newline: '\n' | '\r\n'
  bom: boolean
  readOnly: boolean
  differences: { start: number; end: number }[]
  editorRef: RefObject<EditorView | null>
  onChange: (text: string) => void
  onHistory: (redo: boolean) => void
  onError: (message: string) => void
}

export default function CompareEditor(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const editable = useRef(new Compartment())
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
        return range && number >= range.start && number <= Math.max(range.start, range.end - 1) ?
          [Decoration.line({ class: 'compare-changed-line' }).range(from)] : []
      }))
    }
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: latest.current.text,
        extensions: [
          lineNumbers(), highlightActiveLine(),
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
  useEffect(() => { props.editorRef.current?.dispatch({ effects: differencesChanged.of() }) }, [props.differences])
  return <div className="compare-code-editor" ref={container} />
}
