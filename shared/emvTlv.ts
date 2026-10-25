import { normalizeHex } from './hex'

export interface TlvNode { tag: string; length: number; offset: number; valueOffset: number; value: string; children: TlvNode[] }

export function parseTlv(input: string): TlvNode[] {
  const hex = normalizeHex(input)
  const bytes = hex.match(/../g)!.map(value => parseInt(value, 16))
  let nodes = 0
  function parse(start: number, end: number, depth: number): TlvNode[] {
    if (depth > 16) throw new Error('TLV nesting exceeds 16 levels.')
    const result: TlvNode[] = []
    let offset = start
    while (offset < end) {
      if (++nodes > 2000) throw new Error('TLV input exceeds 2,000 nodes.')
      const original = offset
      const first = bytes[offset++]
      if (first === 0 || first === 255) throw new Error(`Padding or invalid tag at byte ${original}; remove non-TLV data explicitly.`)
      if ((first & 31) === 31) {
        let count = 1
        do {
          if (offset >= end || count++ >= 4) throw new Error('Invalid or truncated extended tag.')
          if (offset === original + 1 && (bytes[offset] & 127) === 0) throw new Error('Invalid extended tag encoding.')
        } while (bytes[offset++] & 128)
      }
      const tag = hex.slice(original * 2, offset * 2)
      if (offset >= end) throw new Error(`Missing length for tag ${tag}.`)
      let length = bytes[offset++]
      if (length & 128) {
        const count = length & 127
        if (count === 0 || count > 3 || offset + count > end) throw new Error(`Unsupported or truncated length for ${tag}.`)
        length = 0
        for (let i = 0; i < count; i++) length = length * 256 + bytes[offset++]
      }
      if (offset + length > end) throw new Error(`Value of tag ${tag} extends beyond its containing TLV.`)
      const value = hex.slice(offset * 2, (offset + length) * 2)
      result.push({ tag, offset: original, valueOffset: offset, length, value,
        children: first & 32 ? parse(offset, offset + length, depth + 1) : [] })
      offset += length
    }
    return result
  }
  return parse(0, bytes.length, 0)
}
