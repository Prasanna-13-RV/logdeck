import { emvDefinition, type EmvDefinition } from './emvDictionary'
import { parseTlv, type TlvNode } from './emvTlv'

export interface EmvOccurrence {
  tag: string
  start: number
  end: number
  value?: string
  status: 'valid' | 'invalid' | 'unavailable' | 'unverified'
  detail: string
  context: 'tag label' | 'tag/value' | 'TLV'
}
export interface EmvTracking { occurrences: EmvOccurrence[]; notices: string[] }
export interface EmvSeed { tag: string; value: string }
export const emvTrackingLimits = { characters: 16_384, occurrences: 64, valueBytes: 256 } as const

function validation(tag: string, value: string | undefined, declared?: number): Pick<EmvOccurrence, 'value' | 'status' | 'detail'> {
  if (value === undefined || !value.trim()) return { status: 'unavailable', detail: 'No value was supplied beside this tag.' }
  const hex = value.replace(/[ \t]/g, '').toUpperCase()
  if (!/^(?:[0-9A-F]{2})+$/.test(hex)) return { status: 'invalid', detail: 'Value is not a complete hexadecimal byte sequence.' }
  if (hex.length > emvTrackingLimits.valueBytes * 2) return { status: 'unverified', detail: 'Value exceeds the 256-byte inspection limit; not retained or decoded.' }
  const bytes = hex.length / 2
  const expected = emvDefinition(tag)?.bytes
  if ((declared !== undefined && declared !== bytes) || (expected !== undefined && expected !== bytes)) {
    return { value: hex, status: 'invalid', detail: `Found ${bytes} bytes; ${declared === undefined ? '' : `log declares ${declared}; `}${expected === undefined ? 'declared length does not match.' : `dictionary expects ${expected}.`}` }
  }
  return { value: hex, status: 'valid', detail: 'Hexadecimal bytes and available length checks passed. Content semantics are not certified.' }
}

export function trackEmv(input: string, incomplete = false, companyTags: readonly EmvDefinition[] = []): EmvTracking {
  const result: EmvTracking = { occurrences: [], notices: [] }
  const text = input.slice(0, emvTrackingLimits.characters)
  if (input.length > text.length || incomplete) result.notices.push('Partial displayed segment: values at its boundary are not validated; other segments are not scanned.')
  const add = (occurrence: EmvOccurrence) => {
    if (result.occurrences.length < emvTrackingLimits.occurrences) result.occurrences.push(occurrence)
    else if (!result.notices.includes('Only the first 64 tag occurrences in this segment are highlighted.')) result.notices.push('Only the first 64 tag occurrences in this segment are highlighted.')
  }
  for (const line of text.matchAll(/[^\r\n]+/g)) {
    const content = line[0]
    const base = line.index!
    const boundary = (incomplete || input.length > text.length) && base + content.length === text.length
    const tlv = /\b(?:EMV[ \t]+)?TLV[ \t]*[:=][ \t]*(.*)$/.exec(content)
    if (tlv) {
      if (boundary) { result.notices.push('TLV at a partial segment boundary was not parsed.'); continue }
      const raw = tlv[1]
      const payloadStart = base + tlv.index + tlv[0].length - raw.length
      try {
        const nodes = parseTlv(raw)
        const offsets: number[] = []
        for (let i = 0; i < raw.length; i++) if (/[0-9a-fA-F]/.test(raw[i])) offsets.push(payloadStart + i)
        const visit = (values: TlvNode[]) => {
          for (const node of values) {
            const start = offsets[node.offset * 2]
            const end = offsets[node.offset * 2 + node.tag.length - 1] + 1
            add({ tag: node.tag, start, end, context: 'TLV', ...validation(node.tag, node.value, node.length) })
            visit(node.children)
          }
        }
        visit(nodes)
      } catch (error) {
        result.notices.push(`TLV not parsed: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    const dump = /(?:#\[[ \t]*T[ \t]*\]|(?<!\w)T)[ \t]*:[ \t]*([0-9a-f]{2}(?:[ \t]*[0-9a-f]{2}){0,2})[ \t]+L[ \t]*:[ \t]*(\d+)(?:[ \t]+V[ \t]*:[ \t]*(.*))?[ \t]*$/i.exec(content)
    if (dump) {
      const tag = dump[1].replace(/[ \t]/g, '').toUpperCase()
      const tagOffset = dump[0].indexOf(':') + 1
      const start = base + dump.index + tagOffset + dump[0].slice(tagOffset).search(/\S/)
      const verified = boundary && dump[3] !== undefined
        ? { status: 'unverified' as const, detail: 'Value may continue beyond this displayed segment; not retained or decoded.' }
        : validation(tag, dump[3], Number(dump[2]))
      add({ tag, start, end: start + dump[1].length, context: 'tag/value', ...verified })
      continue
    }
    const candidates = /(?<![a-zA-Z0-9])(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{2}(?:[ \t]+[0-9a-fA-F]{2}){1,2}|[0-9a-fA-F]{2})(?![a-zA-Z0-9])/g
    for (const candidate of content.matchAll(candidates)) {
      const start = candidate.index!
      const tag = candidate[0].replace(/[ \t]/g, '').toUpperCase()
      const before = content.slice(Math.max(0, start - 160), start)
      const labelled = /\b(?:tag(?:\[\d+\])?[ \t]*[:=]?[ \t]*|EMV[ \t]+)$/i.test(before)
      const after = content.slice(start + candidate[0].length)
      const separator = /^(?:[ \t]*\[(\d+)\])?[ \t]*(?:(?:value[ \t]*)?[:=])[ \t]*/i.exec(after)
      const contextual = /\b(?:emv|tlv|tag)\b/i.test(before)
      if (!labelled && !(separator && (tag.length > 2 || contextual) && (emvDefinition(tag) || companyTags.some(value => value.tag === tag)))) continue
      const rawValue = separator ? after.slice(separator[0].length).split(/[;,]|\s+(?:tag|length|len|value)\s*[:=]/i)[0].trim() : undefined
      const declared = separator?.[1] === undefined ? undefined : Number(separator[1])
      const verified = boundary && rawValue !== undefined
        ? { status: 'unverified' as const, detail: 'Value may continue beyond this displayed segment; not retained or decoded.' }
        : validation(tag, rawValue, declared)
      add({ tag, start: base + start, end: base + start + candidate[0].length, context: labelled ? 'tag label' : 'tag/value', ...verified })
    }
  }
  result.occurrences.sort((a, b) => a.start - b.start)
  return result
}
