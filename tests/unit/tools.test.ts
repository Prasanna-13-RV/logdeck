import { describe, expect, it } from 'vitest'
import { asciiToHex, hexToAscii, normalizeHex } from '../../src/renderer/src/tools/conversion'
import { definitions, definitionFor, validateTagValue, setBit, parseTlv, describeCvm, decodingNotice } from '../../src/renderer/src/tools/emv'

describe('local conversion and EMV', () => {
  it('round-trips strict ASCII including control bytes', () => {
    expect(asciiToHex('ABC\r\n')).toBe('41 42 43 0D 0A')
    expect(hexToAscii('00 41 7f')).toBe('\0A\x7f')
    expect(hexToAscii(asciiToHex('hello'))).toBe('hello')
    for (const value of ['A', 'GG', '41-42']) expect(() => normalizeHex(value)).toThrow()
    expect(() => asciiToHex('世界')).toThrow('ASCII')
    expect(() => hexToAscii('80')).toThrow('ASCII')
  })
  it('changes TVR b8 without changing other bytes or original input', () => {
    const original = '8000000000'
    expect(setBit(original, 0, 8, false)).toBe('0000000000')
    expect(original).toBe('8000000000')
    expect(setBit('0000000000', 4, 5, true)).toBe('0000000010')
    for (const definition of definitions.filter(item => item.length)) {
      expect(() => validateTagValue(definition.tag, '00'.repeat(definition.length! + 1))).toThrow()
    }
  })
  it('round-trips every editable byte/bit position', () => {
    for (const definition of definitions.filter(item => item.length)) {
      const hex = '00'.repeat(definition.length!)
      for (let byte = 0; byte < definition.length!; byte++) {
        for (let bit = 1; bit <= 8; bit++) expect(setBit(setBit(hex, byte, bit, true), byte, bit, false)).toBe(hex)
      }
    }
  })
  it('anchors key published bit masks and keeps unknown AIP byte 2 unlabelled', () => {
    expect(definitionFor('95').bytes![0][0]).toBe('Offline data authentication was not performed')
    expect(definitionFor('82').bytes![0][1]).toBe('SDA supported')
    expect(definitionFor('9F33').bytes![2][4]).toBe('CDA supported')
    expect(definitionFor('9F66').bytes![0][2]).toBe('qVSDC supported')
    expect(definitionFor('9F6C').bytes![1][0]).toBe('Consumer device CVM performed')
    expect(definitionFor('82').bytes![1].every(value => value.includes('raw only'))).toBe(true)
    expect(setBit('0000', 0, 7, true)).toBe('4000')
    expect(setBit('000000', 2, 4, true)).toBe('000008')
  })
  it('decodes CVM as combined codes rather than independent flag meanings', () => {
    expect(describeCvm('1F0002')).toEqual({ method: 'No CVM required', continueOnFailure: false, condition: 'Always', result: 'Successful' })
    expect(describeCvm('420301').continueOnFailure).toBe(true)
  })
  it('gates Visa qualifiers and unknown 9F6E rather than guessing Mastercard semantics', () => {
    expect(decodingNotice(definitions.find(item => item.tag === '9F66')!, 'mastercard')).toContain('not interpreted')
    expect(decodingNotice(definitions.find(item => item.tag === '9F6E')!, 'visa')).toContain('disabled')
    expect(decodingNotice(definitions[0], 'mastercard')).toBeNull()
  })
  it('parses nested TLV with exact value offsets and duplicate tags', () => {
    const parsed = parseTlv('770D950580000000009F34031F0002')
    expect(parsed[0].children.map(node => node.tag)).toEqual(['95', '9F34'])
    expect(parsed[0].children[0].valueOffset).toBe(4)
    expect(parseTlv('950100950101').length).toBe(2)
    expect(parseTlv('5A81020102')[0].value).toBe('0102')
    for (const value of ['9505FF', '7780', '9F', '9F000100', '7703950500']) expect(() => parseTlv(value)).toThrow()
  })
})
