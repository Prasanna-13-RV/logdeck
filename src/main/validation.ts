import { limits, type RangeRequest, type SegmentRequest, type SearchRequest, type SearchFilters, type LogLevel, type ExportRequest } from '../../shared/contracts'
import type { PositionRange } from '../../shared/selection'

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid request.')
  return value as Record<string, unknown>
}

export function sessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) throw new Error('Invalid file session.')
  return value
}

export function validateClipboard(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > limits.clipboardBytes) throw new Error('Clipboard text must be at most 512 KB. Export larger selections.')
  return value
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Requested range is outside the supported limits.')
  return value
}

export function validateRange(value: unknown): RangeRequest {
  const data = object(value)
  return {
    id: sessionId(data.id), start: integer(data.start, 1, limits.lines), count: integer(data.count, 1, limits.rangeRows),
    searchVersion: data.searchVersion === undefined ? undefined : integer(data.searchVersion, 1, Number.MAX_SAFE_INTEGER),
    emv: optionalBoolean(data.emv)
  }
}

export function validateSegment(value: unknown): SegmentRequest {
  const data = object(value)
  return { id: sessionId(data.id), line: integer(data.line, 1, limits.lines), offset: integer(data.offset, 0, limits.bytes), emv: optionalBoolean(data.emv) }
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('Invalid EMV tracking option.')
  return value
}

export function validateSearch(value: unknown): SearchRequest {
  const data = object(value)
  if (typeof data.query !== 'string' || data.query.length > 2000 || typeof data.caseSensitive !== 'boolean') throw new Error('Invalid search query (maximum 2,000 characters).')
  const input = object(data.filters)
  const filters: SearchFilters = {}
  for (const field of ['tag', 'pid', 'tid', 'application', 'include', 'exclude', 'from', 'to'] as const) {
    const value = input[field]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string' || value.length > 256) throw new Error(`Invalid ${field} filter.`)
    filters[field] = value
  }
  for (const field of ['pid', 'tid'] as const) {
    if (filters[field] && !/^\d+$/.test(filters[field])) throw new Error(`${field.toUpperCase()} must contain digits only.`)
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('The start time must not follow the end time.')
  if (input.levels !== undefined) {
    if (!Array.isArray(input.levels) || input.levels.length > 7 ||
      input.levels.some(level => !['V', 'D', 'I', 'W', 'E', 'F', 'A'].includes(level))) throw new Error('Invalid level filter.')
    filters.levels = input.levels as LogLevel[]
  }
  if (data.mode !== undefined && data.mode !== 'expression' && data.mode !== 'regex') throw new Error('Invalid search mode.')
  return { id: sessionId(data.id), query: data.query, caseSensitive: data.caseSensitive, filters, mode: data.mode as SearchRequest['mode'] }
}

export function validateExport(value: unknown): ExportRequest {
  const data = object(value)
  const start = data.start === undefined ? undefined : integer(data.start, 1, limits.lines)
  const end = data.end === undefined ? undefined : integer(data.end, 1, limits.lines)
  if ((start === undefined) !== (end === undefined) || (start !== undefined && end! < start)) throw new Error('Invalid selected record range.')
  let ranges: PositionRange[] | undefined
  if (data.ranges !== undefined) {
    if (start !== undefined || !Array.isArray(data.ranges) || !data.ranges.length || data.ranges.length > 500) throw new Error('Select 1-500 ordered ranges without combining range formats.')
    let previousEnd = 0
    ranges = data.ranges.map(value => {
      const range = object(value)
      const start = integer(range.start, 1, limits.lines)
      const end = integer(range.end, start, limits.lines)
      if (start <= previousEnd) throw new Error('Selected ranges must be ordered and nonoverlapping.')
      previousEnd = end
      return { start, end }
    })
  }
  return { id: sessionId(data.id), start, end, ranges, searchVersion: data.searchVersion === undefined ? undefined : integer(data.searchVersion, 1, Number.MAX_SAFE_INTEGER) }
}

export function validateLocate(value: unknown) {
  const data = object(value)
  return { id: sessionId(data.id), line: integer(data.line, 1, limits.lines), searchVersion: integer(data.searchVersion, 1, Number.MAX_SAFE_INTEGER) }
}
