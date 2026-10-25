import type { EmvTracking } from './emvTracker'
import type { PositionRange } from './selection'

export type Theme = 'dark' | 'light' | 'system'
export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'A' | ''

export interface LogRow {
  line: number
  time: string
  pid: string
  tid: string
  level: LogLevel
  tag: string
  message: string
  raw: string
  byteLength: number
  truncated: boolean
  segmentOffset: number
  nextOffset: number
  sourceLine?: number
  applicationId?: string
  processName?: string
  emv?: EmvTracking
}

export interface SessionInfo {
  id: string
  name: string
  size: number
  lines: number
  indexedBytes: number
  status: 'indexing' | 'ready' | 'cancelled' | 'error'
  cacheHit: boolean
  synthetic: boolean
  format?: 'text' | 'android-json'
  warning?: string
  error?: string
}

export interface SearchFilters {
  levels?: LogLevel[]
  tag?: string
  pid?: string
  tid?: string
  application?: string
  exclude?: string
  include?: string
  from?: string
  to?: string
}
export interface SearchRequest { id: string; query: string; caseSensitive: boolean; filters: SearchFilters; mode?: 'expression' | 'regex' }
export interface ExportRequest { id: string; searchVersion?: number; start?: number; end?: number; ranges?: PositionRange[] }
export interface ExportInfo {
  status: 'running' | 'ready' | 'cancelled' | 'error'
  written: number
  total: number
  error?: string
}
export interface CacheInfo { files: number; bytes: number; active: number }
export interface TextDocument { id: string; name: string; text: string; newline: '\n' | '\r\n'; bom: boolean }
export interface SearchInfo {
  version: number
  status: 'running' | 'ready' | 'cancelled' | 'error'
  matches: number
  scanned: number
  total: number
  error?: string
}
export interface RangeRequest { id: string; start: number; count: number; searchVersion?: number; emv?: boolean }
export interface SegmentRequest { id: string; line: number; offset: number; emv?: boolean }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface DesktopApi {
  openFile: () => Promise<Result<SessionInfo | null>>
  openDroppedFile: (path: string) => Promise<Result<SessionInfo>>
  pathForFile: (file: File) => string
  openDemo: () => Promise<Result<SessionInfo>>
  getSession: () => Promise<Result<SessionInfo | null>>
  getSessions: () => Promise<Result<SessionInfo[]>>
  activateSession: (id: string) => Promise<Result<void>>
  readRange: (request: RangeRequest) => Promise<Result<LogRow[]>>
  readSegment: (request: SegmentRequest) => Promise<Result<LogRow>>
  cancel: (id: string) => Promise<Result<void>>
  closeFile: (id: string) => Promise<Result<void>>
  newWindow: () => Promise<Result<void>>
  startSearch: (request: SearchRequest) => Promise<Result<SearchInfo>>
  searchStatus: (id: string) => Promise<Result<SearchInfo>>
  cancelSearch: (id: string) => Promise<Result<void>>
  locate: (request: { id: string; line: number; searchVersion: number }) => Promise<Result<number | null>>
  duplicateSession: (id: string) => Promise<Result<SessionInfo>>
  exportRecords: (request: ExportRequest) => Promise<Result<ExportInfo | null>>
  copyRecords: (request: ExportRequest) => Promise<Result<string>>
  writeClipboard: (text: string) => Promise<Result<void>>
  exportStatus: (id: string) => Promise<Result<ExportInfo>>
  cancelExport: (id: string) => Promise<Result<void>>
  cacheInfo: () => Promise<Result<CacheInfo>>
  clearCache: () => Promise<Result<CacheInfo>>
  openText: () => Promise<Result<TextDocument | null>>
  saveText: (request: { id?: string; text: string; saveAs: boolean; newline: '\n' | '\r\n'; bom: boolean }) => Promise<Result<TextDocument | null>>
  releaseText: (id: string) => Promise<Result<void>>
  confirmDiscard: () => Promise<Result<boolean>>
  onProgress: (listener: (info: SessionInfo) => void) => () => void
  onClosed: (listener: (id: string) => void) => () => void
}

export const limits = {
  bytes: 500_000_000,
  lines: 10_000_000,
  rangeRows: 500,
  responseBytes: 900_000,
  clipboardBytes: 512_000,
  segmentBytes: 16_384,
  pageLines: 50_000,
  rowHeight: 28
} as const

export const compareLimits = { bytes: 10_000_000, lines: 100_000 } as const
