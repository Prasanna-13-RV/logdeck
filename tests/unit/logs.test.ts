import { describe, expect, it } from 'vitest'
import { LineScanner, parseLogLine, validateUtf8Prefix } from '../../src/workers/logCore'
import { validateRange } from '../../src/main/validation'

describe('byte line scanner', () => {
  it('preserves byte offsets across UTF-8, CRLF and chunk boundaries', () => {
    const bytes = Buffer.from('\uFEFFhello\r\n世界\nlast')
    const scanner = new LineScanner()
    const rows = []
    for (let i = 0; i < bytes.length; i += 2) rows.push(...scanner.push(bytes.subarray(i, i + 2)))
    rows.push(...scanner.finish())
    expect(rows.map(r => bytes.subarray(r.offset, r.offset + r.length).toString())).toEqual([
      '\uFEFFhello\r', '世界', 'last'
    ])
  })
  it('does not invent a final empty line', () => {
    const scanner = new LineScanner()
    expect([...scanner.push(Buffer.from('a\n\n')), ...scanner.finish()]).toEqual([
      { offset: 0, length: 1 }, { offset: 2, length: 0 }
    ])
    expect(new LineScanner().finish()).toEqual([])
  })
  it('tracks a huge line without retaining its contents', () => {
    const scanner = new LineScanner()
    for (let i = 0; i < 20; i++) expect(scanner.push(Buffer.alloc(100_000, 65))).toEqual([])
    expect(scanner.finish()).toEqual([{ offset: 0, length: 2_000_000 }])
  })
})

describe('log parser', () => {
  it('parses threadtime without inventing dates or losing raw content', () => {
    const raw = '10-24 12:01:02.123  1423  1560 E Payment : terminal offline'
    expect(parseLogLine(raw)).toEqual({
      raw, time: '10-24 12:01:02.123', pid: '1423', tid: '1560',
      level: 'E', tag: 'Payment', message: 'terminal offline'
    })
  })
  it('keeps malformed/plain/HTML text as raw messages', () => {
    const raw = '<script>not executable</script>'
    expect(parseLogLine(raw).message).toBe(raw)
    expect(parseLogLine(raw).level).toBe('')
  })
  it('rejects UTF-16 and binary prefixes explicitly', () => {
    expect(() => validateUtf8Prefix(Buffer.from([255, 254, 65, 0]))).toThrow('UTF-8')
    expect(() => validateUtf8Prefix(Buffer.from([65, 0, 66]))).toThrow('binary')
  })
})

describe('IPC range limits', () => {
  it('accepts bounded requests', () => {
    expect(validateRange({ id: 'session', start: 1, count: 120 })).toEqual({
      id: 'session', start: 1, count: 120
    })
  })
  it.each([null, {}, { id: 's', start: 0, count: 1 }, { id: 's', start: 1, count: 501 },
    { id: 's', start: 1.1, count: 1 }])('rejects malformed/unbounded ranges %j', value => {
    expect(() => validateRange(value)).toThrow()
  })
})
