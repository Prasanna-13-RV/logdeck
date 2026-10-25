import { emvDefinition, emvDictionary, emvDictionaryVersion, emvDictionarySource } from '../../../../shared/emvDictionary'
import type { EmvOccurrence, EmvSeed } from '../../../../shared/emvTracker'
import { definitions } from '../tools/emv'

export interface EmvSelection {
  occurrence: EmvOccurrence
  line: number
  sourceLine?: number
  segmentOffset: number
}

export function EmvInspector({ selection, onClose, onEdit }: {
  selection: EmvSelection; onClose: () => void; onEdit: (seed: EmvSeed) => void
}) {
  const { occurrence, line, sourceLine, segmentOffset } = selection
  const definition = emvDefinition(occurrence.tag)
  const editable = occurrence.status === 'valid' && occurrence.value && definitions.some(item => item.tag === occurrence.tag)
  return <aside className="emv-inspector" aria-label="EMV tag definition">
    <header><span className="eyebrow">OFFLINE EMV TRACKER</span><button className="text-button" aria-label="Close EMV definition" onClick={onClose}>Close</button></header>
    <h2>{occurrence.tag} · {definition?.name ?? 'Unknown tag'}</h2>
    <p>{definition?.description ?? 'No definition is bundled for this explicitly labelled tag. No meaning or bit layout has been inferred.'}</p>
    {definition?.sensitive && <p className="viewer-notice">Sensitive payment/personal data. Keep this log local and redact it before sharing.</p>}
    <dl>
      <dt>Source location</dt><dd>Record {line} · physical line {sourceLine ?? line} · segment byte offset {segmentOffset} · text character {occurrence.start + 1}</dd>
      <dt>Recognition</dt><dd>{occurrence.context}</dd>
      <dt>Expected length</dt><dd>{definition?.bytes === undefined ? 'Variable / profile-dependent; no fixed-length check' : `${definition.bytes} bytes`}</dd>
      <dt>Value status</dt><dd>{occurrence.status}: {occurrence.detail}</dd>
      <dt>Extracted original hex</dt><dd className="hex-value">{occurrence.value ?? 'Unavailable or not retained; see value status.'}</dd>
    </dl>
    {editable ? <button className="secondary-button" onClick={() => onEdit({ tag: occurrence.tag, value: occurrence.value! })}>Open value in EMV editor</button> :
      <p className="muted">Definition/reference only. No supported editable decoder is available for this value.</p>}
    <p className="muted">Scheme/kernel layouts differ. The editor requires an explicit profile; this tracker does not identify the scheme.</p>
    <footer>Dictionary {emvDictionaryVersion} · {emvDictionary.length} common tags. Independent summaries based on public EMV tag references ({emvDictionarySource}). Not an exhaustive or EMVCo-certified database. Definitions are bundled: no runtime network lookup.</footer>
  </aside>
}
