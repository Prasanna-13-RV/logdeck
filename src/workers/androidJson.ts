import { Tokenizer, TokenParser, TokenType } from '@streamparser/json'
import type { LogLevel } from '../../shared/contracts'
import type { LineOffset } from './logCore'

export const maxJsonRecordBytes = 1_000_000

export class AndroidJsonScanner {
  private tokenizer = new Tokenizer({ stringBufferSize: 16_384 })
  private grammar = new TokenParser({ paths: ['$.__logdeck_validation_only'], keepStack: false })
  private depth = 0
  private arrayDepth = -1
  private rootKey = ''
  private recordStart = -1
  private recordLine = 1
  private found = false
  private bytePosition = 0
  private bomOffset = 0
  private sourceLine = 1
  private chunk: Buffer = Buffer.alloc(0)
  private newlineCursor = 0
  private rows: LineOffset[] = []
  private inString = false
  private escaped = false
  private stringBytes = 0
  private guardDepth = 0

  constructor() {
    this.grammar.onValue = () => { /* Only validate grammar; retain no records. */ }
    this.tokenizer.onToken = token => {
      const offset = token.offset + this.bomOffset
      this.grammar.write(token)
      if (token.token === TokenType.STRING && this.depth === 1) this.rootKey = String(token.value)
      if (this.recordStart >= 0 && offset - this.recordStart > maxJsonRecordBytes) {
        throw new Error('A JSON log record exceeds the current 1 MB per-record limit.')
      }
      if (token.token === TokenType.LEFT_BRACKET) {
        if (this.depth === this.arrayDepth) throw new Error('Each logcatMessages entry must be a JSON object.')
        if (this.depth === 1 && this.rootKey === 'logcatMessages') {
          if (this.found) throw new Error('Duplicate logcatMessages arrays are not supported.')
          this.arrayDepth = 2
          this.found = true
        }
        this.depth++
      } else if (token.token === TokenType.LEFT_BRACE) {
        if (this.depth === this.arrayDepth) {
          this.recordStart = offset
          this.advanceLines(offset - this.bytePosition)
          this.recordLine = this.sourceLine
        }
        this.depth++
      } else if (token.token === TokenType.RIGHT_BRACE || token.token === TokenType.RIGHT_BRACKET) {
        if (token.token === TokenType.RIGHT_BRACE && this.depth === this.arrayDepth + 1 && this.recordStart >= 0) {
          if (offset - this.recordStart + 1 > maxJsonRecordBytes) {
            throw new Error('A JSON log record exceeds the current 1 MB per-record limit.')
          }
          this.rows.push({
            offset: this.recordStart, length: offset - this.recordStart + 1, sourceLine: this.recordLine
          })
          this.recordStart = -1
        }
        if (token.token === TokenType.RIGHT_BRACKET && this.depth === this.arrayDepth) this.arrayDepth = -1
        this.depth--
      } else if (this.depth === this.arrayDepth && token.token !== TokenType.COMMA) {
        throw new Error('Each logcatMessages entry must be a JSON object.')
      }
    }
  }

  private advanceLines(until: number) {
    for (;;) {
      const next = this.chunk.indexOf(10, this.newlineCursor)
      if (next === -1 || next >= until) break
      this.sourceLine++
      this.newlineCursor = next + 1
    }
  }

  push(chunk: Buffer): LineOffset[] {
    if (this.bytePosition === 0 && chunk[0] === 0xef) this.bomOffset = 3
    this.rows = []
    this.chunk = chunk
    this.newlineCursor = 0
    for (const byte of chunk) {
      if (this.inString) {
        if (++this.stringBytes > maxJsonRecordBytes) throw new Error('A JSON string exceeds the current 1 MB limit.')
        if (this.escaped) this.escaped = false
        else if (byte === 92) this.escaped = true
        else if (byte === 34) this.inString = false
      } else if (byte === 34) {
        this.inString = true
        this.stringBytes = 0
      } else if (byte === 123 || byte === 91) {
        if (++this.guardDepth > 64) throw new Error('JSON nesting exceeds the supported depth of 64.')
      } else if (byte === 125 || byte === 93) this.guardDepth--
    }
    this.tokenizer.write(chunk)
    this.advanceLines(chunk.length)
    this.bytePosition += chunk.length
    return this.rows
  }

  finish(): LineOffset[] {
    this.rows = []
    if (!this.tokenizer.isEnded) this.tokenizer.end()
    if (!this.grammar.isEnded) this.grammar.end()
    if (!this.found) throw new Error('JSON input must be an Android Studio export containing a logcatMessages array.')
    return this.rows
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function parseAndroidRecord(raw: string) {
  const data = record(JSON.parse(raw))
  const header = record(data.header)
  const timestamp = record(header.timestamp)
  const levelNames: Record<string, LogLevel> = {
    VERBOSE: 'V', DEBUG: 'D', INFO: 'I', WARN: 'W', WARNING: 'W', ERROR: 'E', ASSERT: 'A', FATAL: 'F',
    V: 'V', D: 'D', I: 'I', W: 'W', E: 'E', A: 'A', F: 'F'
  }
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  const id = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : ''
  let time = ''
  if (typeof timestamp.seconds === 'number' && Number.isSafeInteger(timestamp.seconds) &&
      typeof timestamp.nanos === 'number' && Number.isInteger(timestamp.nanos) &&
      timestamp.nanos >= 0 && timestamp.nanos < 1_000_000_000) {
    const date = new Date(timestamp.seconds * 1000)
    if (Number.isFinite(date.getTime())) time = `${date.toISOString().slice(0, 19).replace('T', ' ')}.${String(timestamp.nanos).padStart(9, '0')}Z`
  }
  return {
    raw, time, pid: id(header.pid), tid: id(header.tid),
    level: levelNames[text(header.logLevel)] ?? '',
    tag: text(header.tag), message: typeof data.message === 'string' ? data.message : '[Missing string message; inspect raw JSON]',
    applicationId: text(header.applicationId), processName: text(header.processName)
  }
}
