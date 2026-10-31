import { useState } from 'react'
import { asciiToHex, hexToAscii, normalizeHex, escapedBytePreview, type ByteEncoding } from '../tools/conversion'
import { definitions, definitionFor, defaultTagValue, validateTagValue, limitHex, setBit, replaceByte, decodingNotice, cvmMethods, cvmConditions, cvmResults, describeCvm, parseTlv, type Scheme, type TlvNode } from '../tools/emv'
import type { EmvSeed } from '../../../../shared/emvTracker'

function message(error: unknown) { return error instanceof Error ? error.message : String(error) }
function CopyValue({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState('')
  return <><button className="secondary-button" disabled={!value} onClick={() => void window.logdeck.writeClipboard(value).then(result => setStatus(result.ok ? 'Copied' : `Copy failed: ${result.error}`)).catch(error => setStatus(`Copy failed: ${message(error)}`))}>{label}</button><span role="status">{status}</span></>
}

export function ConversionTool() {
  const [ascii, setAscii] = useState('')
  const [hex, setHex] = useState('')
  const [error, setError] = useState('')
  const [encoding, setEncoding] = useState<ByteEncoding>('ascii')
  return <main className="tool-page">
    <header className="tool-heading"><div className="eyebrow">LOCAL UTILITIES</div><h1>Hex / ASCII calculator</h1><p>Explicit byte conversion. Nothing is uploaded or written into a source log.</p></header>
    {error && <div className="viewer-notice" role="alert">{error}</div>}
    <label className="tool-input-row">Text encoding<select aria-label="Conversion encoding" value={encoding} onChange={event => { setEncoding(event.target.value === 'latin1' ? 'latin1' : 'ascii'); setError('') }}><option value="ascii">Strict ASCII (00-7F)</option><option value="latin1">Latin-1 byte mode (00-FF, lossless)</option></select></label>
    <div className="tool-columns">
      <section className="tool-card"><h2>{encoding === 'ascii' ? 'ASCII text' : 'Latin-1 byte text'}</h2><textarea aria-label="ASCII input" maxLength={32768} value={ascii} spellCheck={false} onChange={event => setAscii(event.target.value)} />
        <button className="primary-button" onClick={() => { try { setHex(asciiToHex(ascii, encoding)); setError('') } catch (error) { setError(message(error)) } }}>{encoding === 'ascii' ? 'ASCII' : 'Latin-1'} to hex →</button><CopyValue value={ascii} label={encoding === 'ascii' ? 'Copy ASCII' : 'Copy byte text'} />
      </section>
      <section className="tool-card"><h2>Hex bytes</h2><textarea aria-label="Hex input" maxLength={100000} value={hex} spellCheck={false} onChange={event => setHex(event.target.value)} />
        <button className="primary-button" onClick={() => { try { setAscii(hexToAscii(hex, encoding)); setError('') } catch (error) { setError(message(error)) } }}>← Hex to {encoding === 'ascii' ? 'ASCII' : 'Latin-1'}</button><CopyValue value={hex} label="Copy hex" />
      </section>
    </div>
    <p className="muted">Strict ASCII is 00–7F. Latin-1 maps each byte 00–FF to the same Unicode code point, preserving receipt/control bytes without guessing UTF-8 or Windows-1252. Byte 80 is a control, not a euro sign. Hex requires complete pairs; spaces/newlines are allowed. Maximum 32,768 bytes. The preview escapes controls; copying text copies actual characters.</p>
    <section className="tool-card"><h2>Escaped byte text preview</h2><pre aria-label="Escaped ASCII preview">{escapedBytePreview(ascii)}</pre></section>
  </main>
}

function TlvRows({ nodes, depth = 0, select }: { nodes: TlvNode[]; depth?: number; select: (node: TlvNode) => void }) {
  return <>{nodes.map(node => <tbody key={node.offset}>
    <tr><td style={{ paddingLeft: 12 + depth * 18 }}>{node.tag}</td><td>{node.offset}</td><td>{node.length}</td><td className="hex-value">{node.children.length ? `${node.children.length} nested TLVs` : node.value}</td>
      <td>{!node.children.length && definitions.some(item => item.tag === node.tag) ? <button className="text-button" onClick={() => select(node)}>Edit {node.tag} at {node.offset}</button> : 'Raw / container'}</td></tr>
    {node.children.length > 0 && <tr><td colSpan={5}><table className="data-table nested-table"><TlvRows nodes={node.children} depth={depth + 1} select={select} /></table></td></tr>}
  </tbody>)}</>
}

export function EmvTool({ seed }: { seed?: EmvSeed }) {
  const [scheme, setScheme] = useState<Scheme>('visa')
  const [tag, setTag] = useState(seed?.tag ?? '95')
  const [input, setInput] = useState(seed?.value ?? defaultTagValue('95'))
  const [loadedTag, setLoadedTag] = useState('95')
  const [original, setOriginal] = useState('8000000000')
  const [modified, setModified] = useState('8000000000')
  const [hexDraft, setHexDraft] = useState('8000000000')
  const [error, setError] = useState('')
  const [tlvInput, setTlvInput] = useState('')
  const [tlvOriginal, setTlvOriginal] = useState('')
  const [nodes, setNodes] = useState<TlvNode[]>([])
  const [selectedNode, setSelectedNode] = useState<TlvNode | null>(null)
  const [edits, setEdits] = useState<Record<number, string>>({})
  const definition = definitionFor(loadedTag)
  const notice = decodingNotice(definition, scheme)

  function change(value: string) {
    try {
      const hex = validateTagValue(loadedTag, value)
      if (hex.length !== original.length) throw new Error('Edits must preserve the original byte length. Decode a new baseline to use a different length.')
      setModified(hex); setHexDraft(hex); setError('')
      if (selectedNode) setEdits(previous => ({ ...previous, [selectedNode.valueOffset]: hex }))
    } catch (error) { setError(message(error)) }
  }
  function loadTag(nextTag: string, value: string, node: TlvNode | null = null) {
    try {
      const hex = validateTagValue(nextTag, value)
      setLoadedTag(nextTag); setOriginal(hex); setModified(node ? edits[node.valueOffset] ?? hex : hex)
      setHexDraft(node ? edits[node.valueOffset] ?? hex : hex); setSelectedNode(node); setError('')
    } catch (error) { setError(message(error)) }
  }
  let tlvModified = tlvOriginal
  for (const [offset, hex] of Object.entries(edits)) {
    const start = Number(offset) * 2
    tlvModified = tlvModified.slice(0, start) + hex + tlvModified.slice(start + hex.length)
  }
  const cvmOriginal = loadedTag === '9F34' ? describeCvm(original) : null
  const cvmModified = loadedTag === '9F34' ? describeCvm(modified) : null
  const bit = (hex: string, byte: number, bit: number) => (parseInt(hex.slice(byte * 2, byte * 2 + 2), 16) >> (bit - 1)) & 1
  return <main className="tool-page">
    <header className="tool-heading"><div className="eyebrow">LOCAL EMV WORKSPACE</div><h1>Decode. Change a bit. See the result.</h1><p>Original data stays unchanged. Edited values are an analysis sandbox, not a new card/terminal configuration.</p></header>
    {seed && <p className="viewer-notice">Tag {seed.tag} and its original value were prefilled from the log. Select the applicable scheme/profile and press Decode to establish this value as the editing baseline. The log was not changed.</p>}
    <div className="tool-card">
      <form className="tool-input-row" onSubmit={event => { event.preventDefault(); loadTag(tag, input) }}>
        <label>Scheme / profile<select aria-label="EMV scheme" value={scheme} onChange={event => setScheme(event.target.value as Scheme)}><option value="visa">Visa (qVSDC qualifiers)</option><option value="mastercard">Mastercard (common EMV fields)</option></select></label>
        <label>Tag<select aria-label="EMV tag" value={tag} onChange={event => {
          const nextTag = event.target.value
          setTag(nextTag); setInput(defaultTagValue(nextTag)); setError('')
        }}>{definitions.map(item => <option key={item.tag} value={item.tag}>{item.tag} · {item.name}</option>)}</select></label>
        <label className="grow">Value to decode<input aria-label="EMV value" value={input} maxLength={1000} onChange={event => setInput(limitHex(event.target.value, definitionFor(tag).length))} spellCheck={false} /></label>
        <button className="primary-button">Decode value</button>
      </form>
      <p className="muted">The initial TVR value is a synthetic example. Paste your value and Decode to establish a new immutable baseline. Scheme selection never auto-detects a kernel or invents missing definitions.</p>
    </div>
    {error && <div className="viewer-notice" role="alert">{error}</div>}
    <h2>{loadedTag} · {definition.name}</h2>
    {notice && <div className="viewer-notice" role="status">{notice}</div>}
    <div className="tool-columns">
      <section className="tool-card"><h3>Original value</h3><output className="hex-output" aria-label="Original tag value">{original}</output><CopyValue value={original} label="Copy original value" /></section>
      <section className={`tool-card ${modified !== original ? 'changed-card' : ''}`}><h3>Modified value {modified !== original && <span className="change-label">CHANGED</span>}</h3><output className="hex-output" aria-label="Modified tag value">{modified}</output><CopyValue value={modified} label="Copy modified value" /><button className="text-button" onClick={() => change(original)}>Reset changes</button></section>
    </div>
    <form className="tool-input-row tool-card" onSubmit={event => { event.preventDefault(); change(hexDraft) }}>
      <label className="grow">Edit raw hex (preserves byte length)<input aria-label="Modified hex input" value={hexDraft} maxLength={1000} onChange={event => setHexDraft(limitHex(event.target.value, original.length / 2))} /></label>
      <button className="secondary-button">Apply hex edit</button>
      <span className="muted">RFU and unverified fields have no semantic bit toggles. Raw edits are not compliance validation.</span>
    </form>
    {cvmOriginal && cvmModified && <section className="tool-card"><h3>CVM Results: coded fields, not independent flags</h3>
      <table className="data-table"><thead><tr><th>Field</th><th>Original</th><th>Modified</th></tr></thead><tbody>
        {([
          ['CVM method (6-bit value)', 0, cvmMethods, cvmOriginal.method],
          ['Condition code', 1, cvmConditions, cvmOriginal.condition],
          ['Result', 2, cvmResults, cvmOriginal.result]
        ] as const).map(([name, byte, values, description]) => {
          const raw = parseInt(modified.slice(byte * 2, byte * 2 + 2), 16)
          const value = byte === 0 ? raw & 63 : raw
          return <tr key={name}><td>{name}</td><td>{description}</td><td><select aria-label={name} value={value} onChange={event => change(replaceByte(modified, byte, byte === 0 ? (raw & 192) | Number(event.target.value) : Number(event.target.value)))}>
            {values[value] === undefined && <option value={value}>Reserved / scheme-specific ({value})</option>}
            {Object.entries(values).map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}
          </select></td></tr>
        })}
        <tr><td>Continue if unsuccessful (b7)</td><td>{String(cvmOriginal.continueOnFailure)}</td><td><input type="checkbox" aria-label="Continue if CVM fails" checked={cvmModified.continueOnFailure} onChange={event => change(setBit(modified, 0, 7, event.target.checked))} /></td></tr>
      </tbody></table><p className="muted">CVM code bit 8 is reserved. Unknown method/condition/result codes remain explicitly unknown.</p>
    </section>}
    {!notice && <div className="emv-byte-grid">{definition.bytes?.map((meanings, byte) => <section className="tool-card" key={byte}>
      <h3>Byte {byte + 1} <span className="muted">{original.slice(byte * 2, byte * 2 + 2)} → {modified.slice(byte * 2, byte * 2 + 2)}</span></h3>
      <table className="data-table bit-table"><thead><tr>{[8, 7, 6, 5, 4, 3, 2, 1].map(bit => <th key={bit}>b{bit}</th>)}<th>Meaning when 1</th><th>Original</th><th>Modified</th></tr></thead>
        <tbody>{meanings.map((meaning, index) => {
          const position = 8 - index
          const before = bit(original, byte, position)
          const after = bit(modified, byte, position)
          const editable = !meaning.startsWith('RFU') && !meaning.includes('raw only')
          return <tr className={`${after ? 'bit-set' : ''} ${before !== after ? 'changed-row' : ''}`.trim()} key={index}>
            {[8, 7, 6, 5, 4, 3, 2, 1].map(column => <td key={column}>{column === position ? <button className="bit-toggle" aria-label={`Byte ${byte + 1} bit ${position}: ${meaning}`} aria-pressed={Boolean(after)} disabled={!editable} onClick={() => change(setBit(modified, byte, position, !after))}>{after}</button> : ''}</td>)}
            <td>{meaning}</td><td>{before}</td><td>{after}{before !== after ? ' (changed)' : ''}</td>
          </tr>
        })}</tbody>
      </table>
    </section>)}</div>}
    {notice && <section className="tool-card"><table className="data-table"><thead><tr><th>Byte</th><th>Original hex / binary</th><th>Modified hex / binary</th></tr></thead><tbody>
      {original.match(/../g)!.map((value, i) => <tr key={i}><td>{i + 1}</td><td>{value} / {parseInt(value, 16).toString(2).padStart(8, '0')}</td><td>{modified.slice(i * 2, i * 2 + 2)} / {parseInt(modified.slice(i * 2, i * 2 + 2), 16).toString(2).padStart(8, '0')}</td></tr>)}
    </tbody></table></section>}
    <section className="tool-card"><h2>BER-TLV parser</h2><p className="muted">Paste a complete TLV sequence, without APDU headers/status words. Nested templates are parsed locally. Choose a supported leaf to edit its fixed-length value; the modified sequence updates without changing tags or lengths.</p>
      <textarea aria-label="TLV input" maxLength={200000} value={tlvInput} onChange={event => setTlvInput(event.target.value)} spellCheck={false} />
      <button className="primary-button" onClick={() => {
        try {
          const hex = normalizeHex(tlvInput)
          const parsed = parseTlv(hex)
          setNodes(parsed); setTlvOriginal(hex); setEdits({}); setSelectedNode(null); setError('')
        } catch (error) { setError(message(error)) }
      }}>Parse TLV</button>
      {nodes.length > 0 && <>
        <div className="tool-table-scroll"><table className="data-table"><thead><tr><th>Tag</th><th>Byte offset</th><th>Length</th><th>Value</th><th>Action</th></tr></thead>
          <TlvRows nodes={nodes} select={node => { setTag(node.tag); setInput(node.value); loadTag(node.tag, node.value, node) }} />
        </table></div>
        <div className="tool-columns"><div><h3>Original TLV</h3><pre aria-label="Original TLV">{tlvOriginal}</pre><CopyValue value={tlvOriginal} label="Copy original TLV" /></div>
          <div><h3>Modified TLV</h3><pre aria-label="Modified TLV">{tlvModified}</pre><CopyValue value={tlvModified} label="Copy modified TLV" /></div></div>
      </>}
      <p className="muted">Limits: 65,536 bytes, 2,000 TLV nodes, 16 nested levels. Unknown tags remain raw. 9F6E semantic decoding and kernel-specific AIP byte 2 require a verified versioned definition. This is not a certification tool.</p>
    </section>
  </main>
}
