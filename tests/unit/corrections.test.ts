import { describe, expect, it } from 'vitest'
import { compileQuery, queryHighlights } from '../../src/workers/search'
import { parseLogLine } from '../../src/workers/logCore'
import { trackEmv } from '../../shared/emvTracker'
import { emvDefinition } from '../../shared/emvDictionary'
import { asciiToHex, hexToAscii, escapedBytePreview } from '../../src/renderer/src/tools/conversion'
import { receiptHex } from '../fixtures/receipt'
import { selectionCount, selectedPositions, togglePosition, containsPosition, type PositionRange } from '../../shared/selection'
import { validateExport, validateClipboard } from '../../src/main/validation'

describe('requested viewer corrections', () => {
  it('supports Android-style -field exclusion with literal dots, case, grouping and NOT', () => {
    const allow = parseLogLine('10-24 12:00:00.000 1 2 I Core.Api: ok')
    const deny = parseLogLine('10-24 12:00:00.000 1 2 D Core.Dal: data')
    const nonCore = parseLogLine('10-24 12:00:00.000 1 2 W Other: ok')
    const predicate = compileQuery('Core. -tag:Core.Dal', false)
    expect([allow, deny, nonCore].map(predicate)).toEqual([true, false, false])
    expect(compileQuery('-tag:core.dal', false)(deny)).toBe(false)
    expect(compileQuery('-tag:core.dal', true)(deny)).toBe(true)
    expect(compileQuery('NOT -tag:Core.Dal', false)(deny)).toBe(true)
    expect(compileQuery('Core. -tag:"Core.Dal"', false)(deny)).toBe(false)
    expect(compileQuery('(tag:Core.Api OR tag:Other) -level:D', false)(allow)).toBe(true)
    expect(queryHighlights('Core. -tag:Core.Dal')).toEqual([{ field: 'raw', value: 'Core.' }])
    expect(() => compileQuery('-unsupported:test', false)).toThrow('Unknown')
  })

  it('recognizes T/L/V dumps and #[T] containers without dictionary dependence', () => {
    const input = '#[T]: 70      L:   41\n#[T]: 61      L:   39\n  T:  4F      L:    7    V: A0000000031010\n  T:  50      L:   11    V: 5649534120435245444954\n  T:  87      L:    1    V: 01\n  T:  9F12    L:   11    V: 5649534120435245444954\nT: 9f33 L: 3 V: E0F8C8\nT: 9f13 L: 2 V: 0001\nT: DF01 L: 1 V: AB'
    const result = trackEmv(input)
    expect(result.occurrences.map(hit => hit.tag)).toEqual(['70', '61', '4F', '50', '87', '9F12', '9F33', '9F13', 'DF01'])
    expect(result.occurrences.map(hit => hit.status)).toEqual(['unavailable', 'unavailable', ...Array<string>(7).fill('valid')])
    for (const hit of result.occurrences) expect(input.slice(hit.start, hit.end).replace(/\s/g, '').toUpperCase()).toBe(hit.tag)
    expect(emvDefinition('9f13')?.bytes).toBe(2)
    expect(trackEmv('T: 9F33 L: 2 V: E0F8C8').occurrences[0].status).toBe('invalid')
    expect(trackEmv('T: DF01 L: 1 V: ZZ').occurrences[0].status).toBe('invalid')
    expect(trackEmv('T: 9F33 L: 3 V: E0F8C8', true).occurrences[0].status).toBe('unverified')
    expect(trackEmv('counter T: 123 L: 5 value 9F33').occurrences).toEqual([])
  })

  it('converts receipt-style bytes losslessly in Latin-1 and escapes byte 80', () => {
    expect(() => hexToAscii(receiptHex)).toThrow('above 7F')
    const receipt = hexToAscii(receiptHex, 'latin1')
    expect(receipt).toContain('ALIPAY+ PAIEMENT\n\nDATE PAIEMENT : 2026-09-24 12:50:46')
    expect(receipt).toContain('MONTANT : 1.12 EUR')
    expect(receipt).toContain('##QRCode##\u0080\u0013')
    expect(escapedBytePreview(receipt)).toContain('##QRCode##\\u0080\\u0013')
    expect(asciiToHex(receipt, 'latin1').replace(/ /g, '')).toBe(receiptHex)
    const allBytes = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0')).join('').toUpperCase()
    expect(asciiToHex(hexToAscii(allBytes, 'latin1'), 'latin1').replace(/ /g, '')).toBe(allBytes)
    expect(() => asciiToHex('世界', 'latin1')).toThrow('cannot be represented')
    expect(() => hexToAscii('801', 'latin1')).toThrow('pairs')
  })

  it('toggles disjoint and contiguous ranges without enumerating a large selection', () => {
    let ranges: PositionRange[] = [{ start: 1, end: 10_000_000 }]
    ranges = togglePosition(ranges, 5)
    expect(ranges).toEqual([{ start: 1, end: 4 }, { start: 6, end: 10_000_000 }])
    expect(containsPosition(ranges, 5)).toBe(false)
    expect(selectionCount(ranges)).toBe(9_999_999)
    ranges = togglePosition(ranges, 5)
    expect(ranges).toEqual([{ start: 1, end: 10_000_000 }])
    expect([...selectedPositions([{ start: 1, end: 1 }, { start: 3, end: 4 }])]).toEqual([1, 3, 4])
  })

  it('validates bounded ordered disjoint IPC ranges and forbids ambiguous requests', () => {
    expect(validateExport({ id: 'a', ranges: [{ start: 1, end: 2 }, { start: 5, end: 5 }] }).ranges).toHaveLength(2)
    for (const extra of [
      { ranges: [] }, { ranges: [{ start: 2, end: 1 }] }, { ranges: [{ start: 2, end: 3 }, { start: 3, end: 5 }] },
      { start: 1, end: 2, ranges: [{ start: 5, end: 5 }] }, { ranges: Array(501).fill({ start: 1, end: 1 }) },
      { ranges: [{ start: 0, end: 1 }] }, { ranges: [{ start: 1, end: 10_000_001 }] }
    ]) expect(() => validateExport({ id: 'a', ...extra })).toThrow()
  })

  it('bounds write-only clipboard IPC by UTF-8 bytes, including exact thresholds', () => {
    expect(validateClipboard('A'.repeat(512_000))).toHaveLength(512_000)
    expect(() => validateClipboard('A'.repeat(512_001))).toThrow('512 KB')
    expect(() => validateClipboard('é'.repeat(256_001))).toThrow('512 KB')
    expect(() => validateClipboard({ text: 'invalid' })).toThrow('Clipboard text')
  })
})
