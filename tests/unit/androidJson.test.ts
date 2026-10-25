import { describe, expect, it } from 'vitest'
import { AndroidJsonScanner, maxJsonRecordBytes, parseAndroidRecord } from '../../src/workers/androidJson'
import { parseLogLine } from '../../src/workers/logCore'

const entry = {
  header: {
    logLevel: 'DEBUG', pid: 123, tid: 456, applicationId: 'example.synthetic',
    processName: 'example.synthetic:worker', tag: 'Synthetic',
    timestamp: { seconds: 0, nanos: 775000000 }
  },
  message: 'Unicode 世界, escaped "quotes", braces { inside }, and\nanother line'
}

describe('Android Studio JSON adapter', () => {
  it('indexes record byte ranges rather than pretty-printed JSON source lines', () => {
    const raw = Buffer.from('\uFEFF' + JSON.stringify({ metadata: { model: 'synthetic' }, logcatMessages: [entry, entry] }, null, 2))
    const scanner = new AndroidJsonScanner()
    const rows = []
    for (let i = 0; i < raw.length; i += 7) rows.push(...scanner.push(raw.subarray(i, i + 7)))
    rows.push(...scanner.finish())
    expect(rows).toHaveLength(2)
    expect(JSON.parse(raw.subarray(rows[0].offset, rows[0].offset + rows[0].length).toString())).toEqual(entry)
    expect(rows[0].sourceLine).toBe(6)
    expect(rows[1].sourceLine).toBeGreaterThan(rows[0].sourceLine!)
  })
  it('maps named levels, IDs, application, message and nanosecond UTC time', () => {
    expect(parseAndroidRecord(JSON.stringify(entry))).toMatchObject({
      pid: '123', tid: '456', level: 'D', tag: 'Synthetic', message: entry.message,
      time: '1970-01-01 00:00:00.775000000Z', applicationId: 'example.synthetic',
      processName: 'example.synthetic:worker'
    })
  })
  it('leaves missing metadata blank rather than inventing values', () => {
    expect(parseAndroidRecord('{"message":"plain"}')).toMatchObject({
      pid: '', tid: '', time: '', level: '', tag: '', message: 'plain'
    })
  })
  it.each(['{"logcatMessages":[', '{"other":[]}', '{"logcatMessages":[null]}',
    '{"logcatMessages":[[]]}', '{"logcatMessages":[{},,{}]}'])('rejects malformed or unsupported JSON %s', raw => {
    const scanner = new AndroidJsonScanner()
    expect(() => { scanner.push(Buffer.from(raw)); scanner.finish() }).toThrow()
  })
  it('rejects oversized strings explicitly without whole-document buffering', () => {
    const scanner = new AndroidJsonScanner()
    expect(() => scanner.push(Buffer.from(`{"logcatMessages":[{"message":"${'a'.repeat(maxJsonRecordBytes + 1)}"}]}`))).toThrow('1 MB')
  })
})

describe('plain Android threadtime layout', () => {
  it('extracts variable whitespace and a colon within message content', () => {
    expect(parseLogLine('11-17 08:43:29.322   820  1006 E storaged: synthetic: preserved')).toMatchObject({
      time: '11-17 08:43:29.322', pid: '820', tid: '1006', level: 'E',
      tag: 'storaged', message: 'synthetic: preserved'
    })
    expect(parseLogLine('11-17 08:43:29.439  1199  1199 I chatty  : example')).toMatchObject({
      tag: 'chatty', message: 'example'
    })
  })
  it('preserves buffer markers and stack traces as raw lines', () => {
    expect(parseLogLine('--------- beginning of system')).toMatchObject({
      time: '', level: '', tag: '', message: '--------- beginning of system'
    })
    expect(parseLogLine('    at example.Synthetic.run(Synthetic.java:1)').pid).toBe('')
  })
})
