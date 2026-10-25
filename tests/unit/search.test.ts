import { describe, expect, it } from 'vitest'
import { compileQuery, literalHighlightSpans, matchesFilters } from '../../src/workers/search'
import { parseLogLine } from '../../src/workers/logCore'
import { validateSearch, validateRange, validateLocate, validateFind, validateFindMatch } from '../../src/main/validation'

const row = { ...parseLogLine('10-24 12:01:02.123  1423  1560 W Payment: response delayed'), line: 1 }
describe('expression search', () => {
  it('counts all literal occurrences independently of the drawing cap and preserves Unicode offsets', () => {
    expect(literalHighlightSpans('a'.repeat(405), ['a'], false)).toHaveLength(400)
    expect(literalHighlightSpans('a'.repeat(405), ['a'], false, Infinity)).toHaveLength(405)
    expect(literalHighlightSpans('İ needle\nNEEDLE', ['needle'], false, Infinity)).toEqual([{ start: 2, end: 8 }, { start: 9, end: 15 }])
    expect(literalHighlightSpans('needle NEEDLE', ['needle'], true, Infinity)).toEqual([{ start: 0, end: 6 }])
  })
  it('validates independent find IPC and occurrence navigation', () => {
    const request = { id: 'tab', query: 'needle', caseSensitive: false, columns: ['message'], searchVersion: 1 }
    expect(validateFind(request)).toEqual(request)
    for (const extra of [{ query: '' }, { query: 'x'.repeat(2001) }, { caseSensitive: 1 }, { columns: ['raw'] }, { columns: [] }, { searchVersion: 0 }]) {
      expect(() => validateFind({ ...request, ...extra })).toThrow()
    }
    expect(validateFindMatch({ id: 'tab', version: 1, ordinal: 401 }).ordinal).toBe(401)
    for (const extra of [{ version: 0 }, { ordinal: 0 }, { ordinal: 1.2 }, { emv: 'yes' }]) {
      expect(() => validateFindMatch({ id: 'tab', version: 1, ordinal: 1, ...extra })).toThrow()
    }
  })
  it('honors precedence, grouping, implicit AND and field phrases', () => {
    expect(compileQuery('(tag:Payment OR tag:Network) AND NOT level:D', false)(row)).toBe(true)
    expect(compileQuery('pid:1423 "response delayed"', false)(row)).toBe(true)
    expect(compileQuery('level:E OR level:W AND tag:Other', false)(row)).toBe(false)
    expect(compileQuery('message:"response delayed"', false)(row)).toBe(true)
    expect(compileQuery('pid:142', false)(row)).toBe(false)
  })
  it('respects case and treats quoted operators literally', () => {
    expect(compileQuery('payment', false)(row)).toBe(true)
    expect(compileQuery('payment', true)(row)).toBe(false)
    expect(compileQuery('"OR"', false)(row)).toBe(false)
    expect(compileQuery('', false)(row)).toBe(true)
  })
  it('rejects unknown fields, incomplete and excessive expressions', () => {
    for (const query of ['foo:x', '()', 'tag:', 'NOT', 'x AND', '"bad', '(x', 'OR x', 'x)']) {
      expect(() => compileQuery(query, false)).toThrow()
    }
    expect(() => compileQuery('('.repeat(100) + 'x' + ')'.repeat(100), false)).toThrow()
  })
  it('combines exact identifiers, levels, contains/exclude and time bounds', () => {
    expect(matchesFilters(row, { levels: ['W', 'E'], pid: '1423', tag: 'pay' }, false)).toBe(true)
    expect(matchesFilters(row, { levels: ['D'] }, false)).toBe(false)
    expect(matchesFilters(row, { tid: '156' }, false)).toBe(false)
    expect(matchesFilters(row, { exclude: 'delayed' }, false)).toBe(false)
    expect(matchesFilters(row, { from: '10-24 13:00:00.000' }, false)).toBe(false)
  })
  it('validates search contracts and rejects invalid identifiers/time ordering', () => {
    expect(validateSearch({ id: 'tab', query: '', caseSensitive: false, filters: {} }).query).toBe('')
    for (const filters of [{ pid: 'a' }, { tid: '-1' }, { from: 'z', to: 'a' }, { levels: ['X'] }, { tag: 123 }]) {
      expect(() => validateSearch({ id: 'tab', query: '', caseSensitive: false, filters })).toThrow()
    }
    expect(() => validateRange({ id: 'tab', start: 1, count: 1, searchVersion: -1 })).toThrow()
    expect(() => validateLocate({ id: 'tab', line: 0, searchVersion: 1 })).toThrow()
  })
})
