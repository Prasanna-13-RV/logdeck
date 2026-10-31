import { describe, expect, it } from 'vitest'
import { validateText, encodeText } from '../../shared/text'
import { defaultColumns, validColumns, validPresets, validDisplay } from '../../src/renderer/src/preferences'
import { validateExport, validateSearch } from '../../src/main/validation'
import { RegexJob } from '../../src/workers/regex'
import { lineDifferences, wordDifference } from '../../src/renderer/src/tools/diff'
import { literalHighlightSpans, queryHighlights } from '../../src/workers/search'

describe('offline release boundaries', () => {
  it('keeps visible highlights aligned when Unicode case folding expands a character', () => {
    const text = '\u0130PAYMENT timeout'
    expect(literalHighlightSpans(text, ['timeout'], false)).toEqual([{ start: text.indexOf('timeout'), end: text.length }])
    expect(literalHighlightSpans(text, ['\u0130'], false)).toEqual([{ start: 0, end: 1 }])
    expect(literalHighlightSpans(text, ['PAYMENT'], true)).toEqual([{ start: 1, end: 8 }])
    expect(literalHighlightSpans('a'.repeat(1000), ['a'], true)).toHaveLength(400)
  })
  it('maps line changes to exact original ranges and bounded word-level differences', () => {
    expect(lineDifferences('a\nb\nc', 'a\nchanged\nc', { ignoreCase: false, ignoreWhitespace: false })).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }])
    expect(lineDifferences('a\nb', 'a\nnew\nb', { ignoreCase: false, ignoreWhitespace: false })).toEqual([{ aStart: 1, aEnd: 1, bStart: 1, bEnd: 2 }])
    expect(lineDifferences(' A   B', 'a b ', { ignoreCase: true, ignoreWhitespace: true })).toEqual([])
    const words = wordDifference('the old value', 'the new value')!
    expect(words.left.filter(value => value.changed).map(value => value.text).join('')).toBe('old')
    expect(words.right.filter(value => value.changed).map(value => value.text).join('')).toBe('new')
    expect(wordDifference('x'.repeat(4001), '')).toBeNull()
  })
  it('round-trips varied line changes without losing equal blocks or duplicates', () => {
    let seed = 7
    const random = () => { seed = (seed * 16807) % 2147483647; return seed }
    for (let run = 0; run < 250; run++) {
      const left = Array.from({ length: random() % 20 + 1 }, () => String(random() % 5))
      const right = Array.from({ length: random() % 20 + 1 }, () => String(random() % 5))
      const changes = lineDifferences(left.join('\n'), right.join('\n'), { ignoreCase: false, ignoreWhitespace: false })
      const transformed = [...left]
      for (const change of [...changes].reverse()) transformed.splice(change.aStart, change.aEnd - change.aStart, ...right.slice(change.bStart, change.bEnd))
      expect(transformed).toEqual(right)
    }
    const large = Array.from({ length: 100_000 }, (_, index) => `same ${index}`).join('\n')
    expect(lineDifferences(large, large.replace('same 50000\n', 'changed 50000\n'), { ignoreCase: false, ignoreWhitespace: false })).toEqual([{ aStart: 50000, aEnd: 50001, bStart: 50000, bEnd: 50001 }])
  })
  it('preserves CRLF/BOM while enforcing encoded limits and rejecting unsupported text', () => {
    expect(encodeText('one\ntwo', '\r\n', true)).toBe('\uFEFFone\r\ntwo')
    expect(() => validateText('x\n'.repeat(100_000))).toThrow('100,000')
    expect(() => validateText('é'.repeat(5_000_001))).toThrow('10 MB')
    expect(() => validateText('a\rb')).toThrow('Standalone CR')
    expect(() => validateText('\0')).toThrow('Binary')
  })
  it('validates complete column layouts and bounded presets/settings', () => {
    expect(validColumns(defaultColumns)).toBe(true)
    expect(validColumns(defaultColumns.map(item => ({ ...item, visible: false })))).toBe(false)
    expect(validColumns(defaultColumns.map(item => ({ ...item, visible: item.id !== 'message' })))).toBe(true)
    expect(validColumns([...defaultColumns.slice(1), defaultColumns[1]])).toBe(false)
    expect(validDisplay({ fontSize: 13, defaultWrap: true })).toBe(true)
    expect(validDisplay({ fontSize: 50, defaultWrap: false })).toBe(false)
    expect(validPresets([{ id: 'one', name: 'Errors', query: 'level:E', filters: {}, caseSensitive: false, mode: 'expression' }])).toBe(true)
    expect(validPresets([{ id: 'one', name: 'Bad', query: '', filters: { levels: ['X'] }, caseSensitive: false, mode: 'regex' }])).toBe(false)
  })
  it('validates explicit regex mode, include filter and selection boundaries', () => {
    expect(validateSearch({ id: 'one', query: 'error.*', caseSensitive: false, mode: 'regex', filters: { include: 'terminal' } }).mode).toBe('regex')
    expect(() => validateSearch({ id: 'one', query: '', caseSensitive: false, mode: 'code', filters: {} })).toThrow('mode')
    expect(() => validateExport({ id: 'one', start: 9, end: 2 })).toThrow('range')
    expect(() => validateExport({ id: 'one', start: 2 })).toThrow('range')
    expect(validateExport({ id: 'one', start: 2, end: 9, searchVersion: 1 }).end).toBe(9)
    expect(queryHighlights('(tag:Payment OR "old value") AND NOT (message:ignored OR level:D)')).toEqual([{ field: 'tag', value: 'Payment' }, { field: 'raw', value: 'old value' }])
    expect(queryHighlights('NOT NOT message:included')).toEqual([{ field: 'message', value: 'included' }])
  })
  it('runs regex away from the file worker and terminates catastrophic backtracking', async () => {
    const safe = new RegexJob('^error\\s+\\d+$', false)
    try { expect(await safe.test(['ERROR 123', 'normal'])).toEqual([true, false]) }
    finally { safe.stop() }
    expect(() => new RegexJob('[', false)).toThrow('Invalid regular expression')
    const unsafe = new RegexJob('(a+)+$', true)
    try { await expect(unsafe.test([`${'a'.repeat(100_000)}!`])).rejects.toThrow('timed out') }
    finally { unsafe.stop() }
    const retry = new RegexJob('ready', true)
    try { expect(await retry.test(['ready'])).toEqual([true]) }
    finally { retry.stop() }
  })
})
