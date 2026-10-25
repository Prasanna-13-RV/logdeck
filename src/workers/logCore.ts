import type { LogLevel } from '../../shared/contracts'

export interface LineOffset { offset: number; length: number; sourceLine?: number }

export class LineScanner {
  private position = 0
  private lineStart = 0

  push(chunk: Buffer): LineOffset[] {
    const lines: LineOffset[] = []
    let start = 0
    for (;;) {
      const newline = chunk.indexOf(10, start)
      if (newline === -1) break
      const end = this.position + newline
      lines.push({ offset: this.lineStart, length: end - this.lineStart })
      this.lineStart = end + 1
      start = newline + 1
    }
    this.position += chunk.length
    return lines
  }

  finish(): LineOffset[] {
    if (this.position === this.lineStart) return []
    const line = { offset: this.lineStart, length: this.position - this.lineStart }
    this.lineStart = this.position
    return [line]
  }
}

const threadtime = /^((?:\d{4}-)?\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.+?)\s*:\s?(.*)$/

export function parseLogLine(raw: string) {
  const match = threadtime.exec(raw)
  if (!match) return { raw, time: '', pid: '', tid: '', level: '' as LogLevel, tag: '', message: raw }
  return {
    raw, time: match[1], pid: match[2], tid: match[3],
    level: match[4] as LogLevel, tag: match[5], message: match[6]
  }
}

export function validateUtf8Prefix(bytes: Buffer): void {
  if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255)) {
    throw new Error('This increment supports UTF-8 logs only. Convert this UTF-16 file before opening.')
  }
  if (bytes.includes(0)) throw new Error('This file appears to be binary or a non-UTF-8 encoding.')
}
