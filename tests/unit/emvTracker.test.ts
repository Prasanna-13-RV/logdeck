import { describe, expect, it } from 'vitest'
import { trackEmv } from '../../shared/emvTracker'
import { emvDictionary, emvDictionaryVersion } from '../../shared/emvDictionary'
import { validateRange, validateSegment } from '../../src/main/validation'

describe('bounded offline EMV tracker', () => {
  it('recognizes explicit labels, spaced/lowercase tags, lengths and duplicates', () => {
    const text = 'Tag 95: 8000000000; tag: 9f 02[6]: 00 00 00 00 01 00; tag[31]:9f01\n9F02[6]:000000000200\nTag 95: 0000000000'
    const result = trackEmv(text)
    expect(result.occurrences.map(hit => hit.tag)).toEqual(['95', '9F02', '9F01', '9F02', '95'])
    expect(result.occurrences.map(hit => hit.status)).toEqual(['valid', 'valid', 'unavailable', 'valid', 'valid'])
    expect(result.occurrences[1].value).toBe('000000000100')
    for (const hit of result.occurrences) expect(text.slice(hit.start, hit.end).replace(/\s/g, '').toUpperCase()).toBe(hit.tag)
  })

  it('does not highlight numbers, timestamps, PIDs, hex substrings or arbitrary unlabelled bytes', () => {
    expect(trackEmv('10:00:00.095 95 82 I Payment: amount 95; counter=82; serial=A9F0200; hex 9F02 06 000000000100; 95: normal text').occurrences).toEqual([])
  })

  it('distinguishes missing, malformed, wrong lengths, unknown and oversized values', () => {
    const hits = trackEmv(`Tag 95\nTag 95: GG\nTag 95: 00\nTag 9F02[5]:000000000100\nTag DF01: AB\nTag 9F10: ${'AB'.repeat(257)}`).occurrences
    expect(hits.map(hit => hit.status)).toEqual(['unavailable', 'invalid', 'invalid', 'invalid', 'valid', 'unverified'])
    expect(hits[5].value).toBeUndefined()
  })

  it('parses only complete labelled TLV, including nested/duplicate objects with source offsets', () => {
    const text = 'payload EMV TLV: 77 10 95 05 80 00 00 00 00 9F 02 06 00 00 00 00 01 00'
    const result = trackEmv(text)
    expect(result.notices).toEqual([])
    expect(result.occurrences.map(hit => hit.tag)).toEqual(['77', '95', '9F02'])
    for (const hit of result.occurrences) expect(text.slice(hit.start, hit.end).replace(/\s/g, '')).toBe(hit.tag)
    expect(trackEmv('TLV: 950500').notices.join()).toContain('TLV not parsed')
    expect(trackEmv('TLV: 950500').occurrences).toEqual([])
    expect(trackEmv('TLV: 9505GG').notices.join()).toContain('TLV not parsed')
    expect(trackEmv('9F0206000000000100').occurrences).toEqual([])
  })

  it('bounds work and never validates a possibly clipped value', () => {
    const result = trackEmv('Tag 95: 8000000000\n'.repeat(100))
    expect(result.occurrences).toHaveLength(64)
    expect(result.notices.join()).toContain('first 64')
    expect(trackEmv('Tag 95: 8000000000', true).occurrences[0].status).toBe('unverified')
    expect(trackEmv('TLV: 95058000000000', true).occurrences).toEqual([])
    expect(trackEmv('x'.repeat(16_384) + '\nTag 95').occurrences).toEqual([])
  })

  it('has unique versioned reference entries and validates the IPC switch', () => {
    expect(emvDictionary).toHaveLength(60)
    expect(new Set(emvDictionary.map(tag => tag.tag)).size).toBe(emvDictionary.length)
    expect(emvDictionaryVersion).toBeTruthy()
    expect(validateRange({ id: 'x', start: 1, count: 5, emv: false }).emv).toBe(false)
    expect(validateSegment({ id: 'x', line: 1, offset: 0, emv: true }).emv).toBe(true)
    expect(() => validateRange({ id: 'x', start: 1, count: 5, emv: 'true' })).toThrow('EMV')
  })
})
