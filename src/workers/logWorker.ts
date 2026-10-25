import { parentPort, workerData } from 'node:worker_threads'
import { open, stat, mkdir, rm, readdir, rename, realpath } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { limits, type FindRequest, type FindMatch, type LogRow, type SessionInfo, type SearchRequest, type SearchInfo, type ExportRequest, type ExportInfo, type CacheInfo } from '../../shared/contracts'
import { compileQuery, literalHighlightSpans, matchesFilters } from './search'
import { RegexJob } from './regex'
import { LineScanner, parseLogLine, validateUtf8Prefix } from './logCore'
import { AndroidJsonScanner, parseAndroidRecord } from './androidJson'
import { trackEmv } from '../../shared/emvTracker'
import { selectedPositions, selectionCount } from '../../shared/selection'
import { parseTagPack, type CompanyTagPack } from '../../shared/companyTags'

interface Resource {
  key: string
  path: string
  file: FileHandle
  db: Database.Database
  size: number
  mtime: number
  ctime: number
  lines: number
  indexedBytes: number
  status: SessionInfo['status']
  cacheHit: boolean
  warning?: string
  error?: string
  stop: boolean
  lastProgress: number
  format: 'text' | 'android-json'
  sourceHash?: string
  task?: Promise<void>
}
interface Session {
  info: Pick<SessionInfo, 'id' | 'name' | 'synthetic'>
  resource: Resource
  cancelled: boolean
  search?: { info: SearchInfo; table: string; stop: boolean; task?: Promise<void>; regex?: RegexJob }
  find?: { info: SearchInfo; table: string; stop: boolean; task?: Promise<void>; searchVersion?: number }
  export?: { info: ExportInfo; stop: boolean; task?: Promise<void> }
}
interface Command {
  requestId: number
  type: 'open' | 'range' | 'segment' | 'cancel' | 'close' | 'search' | 'search-status' | 'search-cancel' | 'find' | 'find-status' | 'find-cancel' | 'find-match' | 'locate' | 'duplicate' | 'export' | 'export-status' | 'export-cancel' | 'cache-info' | 'cache-clear' | 'copy' | 'company-tags'
  id: string
  path?: string
  name?: string
  synthetic?: boolean
  start?: number
  count?: number
  line?: number
  offset?: number
  emv?: boolean
  search?: SearchRequest
  find?: FindRequest
  version?: number
  ordinal?: number
  searchVersion?: number
  newId?: string
  export?: ExportRequest
  destination?: string
  companyPack?: CompanyTagPack | null
}

const port = parentPort!
const sessions = new Map<string, Session>()
const resources = new Map<string, Resource>()
const cachePath = (workerData as { cachePath: string }).cachePath
let searchVersion = 0
let companyPack: CompanyTagPack | null = null

function info(session: Session): SessionInfo {
  const resource = session.resource
  return {
    ...session.info,
    size: resource.size, lines: resource.lines, indexedBytes: resource.indexedBytes,
    status: session.cancelled ? 'cancelled' : resource.status,
    cacheHit: resource.cacheHit, warning: resource.warning, error: resource.error, format: resource.format
  }
}

function publish(resource: Resource) {
  for (const session of sessions.values()) {
    if (session.resource === resource) port.postMessage({ event: 'progress', info: info(session) })
  }
}

function publishProgress(resource: Resource) {
  const now = Date.now()
  if (resource.lastProgress && now - resource.lastProgress < 100) return
  resource.lastProgress = now
  publish(resource)
}

function saveComplete(resource: Resource) {
  if (!resource.sourceHash) throw new Error('Cannot complete an index without its source hash.')
  resource.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'complete', JSON.stringify({ lines: resource.lines, warning: resource.warning, hash: resource.sourceHash, ctime: resource.ctime })
  )
}

async function hashSource(resource: Resource): Promise<string> {
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(256 * 1024)
  let offset = 0
  while (offset < resource.size) {
    const { bytesRead } = await resource.file.read(buffer, 0, Math.min(buffer.length, resource.size - offset), offset)
    if (!bytesRead) throw new Error('The source became unreadable during verification. Reopen the file.')
    hash.update(buffer.subarray(0, bytesRead))
    offset += bytesRead
  }
  return hash.digest('hex')
}

async function checkSource(resource: Resource) {
  const current = await stat(resource.path)
  const handle = await resource.file.stat()
  const changes = [
    current.size !== resource.size && 'size',
    current.mtimeMs !== resource.mtime && 'modification time',
    current.ino !== handle.ino && 'file identity',
    handle.size !== resource.size && 'open file size',
    handle.mtimeMs !== resource.mtime && 'open file modification time'
  ].filter(Boolean)
  if (changes.length) {
    throw new Error(`The source file changed (${changes.join(', ')}). Close this view and reopen the file to rebuild its index.`)
  }
  if (current.ctimeMs !== resource.ctime) {
    if (!resource.sourceHash || await hashSource(resource) !== resource.sourceHash) {
      throw new Error('The source file changed (content hash). Close this view and reopen the file.')
    }
    resource.ctime = current.ctimeMs
    if (resource.status === 'ready') saveComplete(resource)
  }
}

async function index(resource: Resource) {
  const scanner = resource.format === 'android-json' ? new AndroidJsonScanner() : new LineScanner()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const hash = createHash('sha256')
  let validUtf8 = true
  const insert = resource.db.prepare('INSERT INTO lines (line, offset, length, sourceLine) VALUES (?, ?, ?, ?)')
  const batch = resource.db.transaction((rows: { offset: number; length: number; sourceLine?: number }[]) => {
    for (const row of rows) {
      if (resource.lines >= limits.lines) throw new Error('This file exceeds the 10 million line viewer limit.')
      insert.run(++resource.lines, row.offset, row.length, row.sourceLine ?? null)
    }
  })
  try {
    const buffer = Buffer.alloc(256 * 1024)
    while (!resource.stop && resource.indexedBytes < resource.size) {
      const { bytesRead } = await resource.file.read(buffer, 0, buffer.length, resource.indexedBytes)
      if (!bytesRead) throw new Error('The file became unreadable while indexing. Reopen it to retry.')
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      if (validUtf8) {
        try { decoder.decode(chunk, { stream: true }) }
        catch { validUtf8 = false; resource.warning = 'Invalid UTF-8: replacement characters may be displayed. Original bytes are unchanged.' }
      }
      batch(scanner.push(chunk))
      resource.indexedBytes += bytesRead
      publishProgress(resource)
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    if (resource.stop) { if (resource.status !== 'error') resource.status = 'cancelled'; return }
    if (validUtf8) {
      try { decoder.decode() }
      catch { resource.warning = 'Incomplete UTF-8 sequence: replacement characters may be displayed.' }
    }
    batch(scanner.finish())
    resource.sourceHash = hash.digest('hex')
    await checkSource(resource)
    saveComplete(resource)
    resource.db.pragma('wal_checkpoint(TRUNCATE)')
    resource.status = 'ready'
  } catch (error) {
    resource.status = 'error'
    resource.error = error instanceof Error ? error.message : 'Indexing failed.'
  } finally { publish(resource) }
}

async function openResource(path: string): Promise<Resource> {
  const metadata = await stat(path)
  if (!metadata.isFile()) throw new Error('Select a regular log file, not a directory.')
  if (metadata.size > limits.bytes) throw new Error('The viewer currently accepts files up to 500 MB.')
  const file = await open(path, 'r')
  let db: Database.Database | undefined
  try {
    const prefix = Buffer.alloc(Math.min(metadata.size, 8192))
    await file.read(prefix, 0, prefix.length, 0)
    validateUtf8Prefix(prefix)
    const format = prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith('{') ? 'android-json' : 'text'
    const tail = Buffer.alloc(Math.min(metadata.size, 8192))
    await file.read(tail, 0, tail.length, Math.max(0, metadata.size - tail.length))
    const key = createHash('sha256').update(JSON.stringify([
      path, metadata.size, metadata.mtimeMs, metadata.ino, 'offset-index-v3', format
    ])).update(prefix).update(tail).digest('hex')
    const existing = resources.get(key)
    if (existing) {
      await file.close()
      if (existing.status === 'cancelled') {
        existing.db.exec('DELETE FROM lines; DELETE FROM meta')
        existing.lines = 0
        existing.indexedBytes = 0
        existing.stop = false
        existing.status = 'indexing'
        existing.task = undefined
      }
      return existing
    }
    await mkdir(cachePath, { recursive: true })
    const dbPath = join(cachePath, `${key}.db`)
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('cache_size = -4096')
    db.pragma('temp_store = FILE')
    db.exec('CREATE TABLE IF NOT EXISTS lines (line INTEGER PRIMARY KEY, offset INTEGER NOT NULL, length INTEGER NOT NULL, sourceLine INTEGER); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const row = db.prepare("SELECT value FROM meta WHERE key = 'complete'").get() as { value: string } | undefined
    const cached = row ? JSON.parse(row.value) as { lines: number; warning?: string; hash: string; ctime: number } : undefined
    if (cached && (!Number.isSafeInteger(cached.lines) || cached.lines < 0 || cached.lines > limits.lines ||
      typeof cached.hash !== 'string' || !/^[a-f0-9]{64}$/.test(cached.hash) || !Number.isFinite(cached.ctime))) {
      throw new Error('The cached index is corrupt. Clear its cache through the file system before reopening.')
    }
    if (!cached) db.exec('DELETE FROM lines; DELETE FROM meta')
    const resource: Resource = {
      key, path, file, db, size: metadata.size, mtime: metadata.mtimeMs, ctime: metadata.ctimeMs,
      lines: cached?.lines ?? 0, indexedBytes: cached ? metadata.size : 0,
      status: cached ? 'ready' : 'indexing', cacheHit: Boolean(cached),
      warning: cached?.warning, stop: false, lastProgress: 0, format,
      sourceHash: cached?.hash
    }
    if (cached && cached.ctime !== metadata.ctimeMs) {
      if (await hashSource(resource) === cached.hash) saveComplete(resource)
      else {
        resource.db.exec('DELETE FROM lines; DELETE FROM meta')
        resource.lines = 0
        resource.indexedBytes = 0
        resource.status = 'indexing'
        resource.cacheHit = false
        resource.sourceHash = undefined
      }
    }
    if (resource.cacheHit) await checkSource(resource)
    resources.set(key, resource)
    return resource
  } catch (error) {
    db?.close()
    await file.close()
    throw error
  }
}

async function readRow(resource: Resource, line: number, offset = 0, maxBytes: number = limits.segmentBytes, emv = false): Promise<LogRow> {
  const record = resource.db.prepare('SELECT offset, length, sourceLine FROM lines WHERE line = ?').get(line) as
    { offset: number; length: number; sourceLine: number | null } | undefined
  if (!record) throw new Error('This line has not been indexed yet.')
  if (offset > record.length) throw new Error('The requested message segment does not exist.')
  let structured: ReturnType<typeof parseAndroidRecord> | undefined
  if (resource.format === 'android-json') {
    const recordBytes = Buffer.alloc(record.length)
    const result = await resource.file.read(recordBytes, 0, record.length, record.offset)
    if (result.bytesRead !== record.length) throw new Error('The JSON source changed during reading.')
    structured = parseAndroidRecord(recordBytes.toString('utf8'))
  }
  const length = Math.min(maxBytes, record.length - offset)
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await resource.file.read(buffer, 0, length, record.offset + offset)
  if (bytesRead !== length) throw new Error('The source file changed during reading. Reopen the file.')
  let end = bytesRead
  if (offset + end < record.length) {
    let lead = end - 1
    while (lead >= 0 && (buffer[lead] & 0xc0) === 0x80) lead--
    if (lead >= 0) {
      const first = buffer[lead]
      const expected = first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 1
      if (lead + expected > end) end = lead
    }
  }
  const more = offset + end < record.length
  let raw = buffer.subarray(0, end).toString('utf8')
  if (line === 1 && offset === 0) raw = raw.replace(/^\uFEFF/, '')
  if (!more) raw = raw.replace(/\r$/, '')
  const row: LogRow = {
    ...(structured ? {
      ...structured, raw, tag: structured.tag.slice(0, maxBytes),
      message: structured.message.slice(0, maxBytes),
      applicationId: structured.applicationId.slice(0, maxBytes),
      processName: structured.processName.slice(0, maxBytes)
    } : parseLogLine(raw)),
    line, sourceLine: record.sourceLine ?? line, byteLength: record.length,
    truncated: more || offset > 0, segmentOffset: offset, nextOffset: offset + end
  }
  if (emv) row.emv = trackEmv(offset ? raw : row.message, structured && !offset ? structured.message.length > maxBytes : more, companyPack?.tags)
  return row
}

async function stopSearch(session: Session) {
  if (!session.search) return
  session.search.stop = true
  session.search.regex?.stop()
  await session.search.task
}

async function stopFind(session: Session) {
  if (!session.find) return
  session.find.stop = true
  await session.find.task
}

async function findFile(session: Session, request: FindRequest) {
  const job = session.find!
  const resource = session.resource
  const insert = resource.db.prepare(`INSERT INTO ${job.table} (ordinal, position, column, start, end, line) VALUES (?, ?, ?, ?, ?, ?)`)
  const source = request.searchVersion === undefined ? undefined : resource.db.prepare(`SELECT line FROM ${session.search!.table} WHERE position = ?`)
  const started = Date.now()
  try {
    await checkSource(resource)
    for (let position = 1; position <= job.info.total && !job.stop; position++) {
      const line = source ? (source.get(position) as { line: number }).line : position
      const record = resource.db.prepare('SELECT length FROM lines WHERE line = ?').get(line) as { length: number }
      if (record.length > 1_000_000) throw new Error(`Find stopped: record ${line} exceeds the 1 MB search-record limit. No complete result is claimed.`)
      const row = await readRow(resource, line, 0, 1_000_000)
      resource.db.transaction(() => {
        for (const column of request.columns) {
          for (const span of literalHighlightSpans(String(row[column]), [request.query], request.caseSensitive, Infinity)) {
            insert.run(++job.info.matches, position, column, span.start, span.end, line)
          }
        }
      })()
      job.info.scanned = position
      if (Date.now() - started > 120_000) throw new Error('Find exceeded two minutes. Filter the logs and retry.')
      if (position % 200 === 0) await new Promise<void>(resolve => setImmediate(resolve))
    }
    await checkSource(resource)
    job.info.status = job.stop ? 'cancelled' : 'ready'
  } catch (error) {
    job.info.status = job.stop ? 'cancelled' : 'error'
    if (!job.stop) job.info.error = error instanceof Error ? error.message : 'Find failed.'
  }
}

async function searchFile(session: Session, request: SearchRequest, match: ReturnType<typeof compileQuery>) {
  const search = session.search!
  const resource = session.resource
  const insert = resource.db.prepare(`INSERT INTO ${search.table} (position, line) VALUES (?, ?)`)
  const batch = resource.db.transaction((lines: number[]) => {
    for (const line of lines) insert.run(++search.info.matches, line)
  })
  const started = Date.now()
  try {
    await checkSource(resource)
    for (let start = 1; start <= search.info.total && !search.stop; start += 200) {
      const found: number[] = []
      let pending: { line: number; raw: string }[] = []
      let pendingBytes = 0
      const flush = async () => {
        if (!pending.length || search.stop) return
        const matches = await search.regex!.test(pending.map(row => row.raw))
        pending.forEach((row, index) => { if (matches[index]) found.push(row.line) })
        pending = []
        pendingBytes = 0
      }
      for (let line = start; line < start + 200 && line <= search.info.total && !search.stop; line++) {
        const record = resource.db.prepare('SELECT length FROM lines WHERE line = ?').get(line) as { length: number }
        if (record.length > 1_000_000) throw new Error(`Search stopped: record ${line} exceeds the 1 MB search-record limit. No complete result is claimed.`)
        const row = await readRow(resource, line, 0, 1_000_000)
        if (matchesFilters(row, request.filters, request.caseSensitive)) {
          if (search.regex) {
            if (pendingBytes + record.length > 256_000) await flush()
            pending.push({ line, raw: row.raw })
            pendingBytes += record.length
          } else if (match(row)) found.push(line)
        }
        search.info.scanned = line
      }
      await flush()
      batch(found)
      if (Date.now() - started > 120_000) throw new Error('Search exceeded two minutes. Narrow the input or cancel and retry.')
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    await checkSource(resource)
    search.info.status = search.stop ? 'cancelled' : 'ready'
  } catch (error) {
    search.info.status = search.stop ? 'cancelled' : 'error'
    if (!search.stop) search.info.error = error instanceof Error ? error.message : 'Search failed.'
  } finally { search.regex?.stop() }
}

async function cacheInventory(clear = false): Promise<CacheInfo> {
  await mkdir(cachePath, { recursive: true })
  const active = new Set([...resources.keys()])
  const entries = await readdir(cachePath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.db(?:-wal|-shm)?$/.test(entry.name)) continue
    if (clear && !active.has(entry.name.slice(0, 64))) await rm(join(cachePath, entry.name))
  }
  let bytes = 0
  let files = 0
  for (const entry of await readdir(cachePath, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.db(?:-wal|-shm)?$/.test(entry.name)) continue
    bytes += (await stat(join(cachePath, entry.name))).size
    if (entry.name.endsWith('.db')) files++
  }
  return { files, bytes, active: active.size }
}

async function exportFile(session: Session, request: ExportRequest, destination: string) {
  const job = session.export!
  const resource = session.resource
  const temporary = `${destination}.logdeck-${session.info.id}.tmp`
  let created = false
  try {
    await checkSource(resource)
    const normalizedDestination = await realpath(destination).catch(error => {
      if (error.code === 'ENOENT') return destination
      throw error
    })
    if ([...resources.values()].some(value => value.path.toLowerCase() === normalizedDestination.toLowerCase())) throw new Error('Cannot export over an open source log.')
    const before = await stat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    const file = await open(temporary, 'wx')
    created = true
    try {
      const buffer = Buffer.alloc(64 * 1024)
      for (const position of selectedPositions(request.ranges ?? [{ start: request.start ?? 1, end: request.end ?? job.info.total }])) {
        if (job.stop) break
        const found = request.searchVersion === undefined ? { line: position } :
          resource.db.prepare(`SELECT line FROM ${session.search!.table} WHERE position = ?`).get(position) as { line: number } | undefined
        if (!found) throw new Error('Result mapping changed during export.')
        const record = resource.db.prepare('SELECT offset, length FROM lines WHERE line = ?').get(found.line) as { offset: number; length: number }
        let offset = 0
        while (offset < record.length && !job.stop) {
          const { bytesRead } = await resource.file.read(buffer, 0, Math.min(buffer.length, record.length - offset), record.offset + offset)
          if (!bytesRead) throw new Error('Source became unreadable during export.')
          await file.writeFile(buffer.subarray(0, bytesRead))
          offset += bytesRead
        }
        if (job.stop) break
        await file.writeFile('\n')
        job.info.written++
        if (position % 100 === 0) await new Promise<void>(resolve => setImmediate(resolve))
      }
      if (!job.stop) await file.sync()
    } finally { await file.close() }
    if (job.stop) { job.info.status = 'cancelled'; return }
    await checkSource(resource)
    const after = await stat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (before?.mtimeMs !== after?.mtimeMs || before?.size !== after?.size || before?.ino !== after?.ino) throw new Error('Destination changed during export; retry with another destination.')
    await rename(temporary, destination)
    created = false
    job.info.status = 'ready'
  } catch (error) {
    job.info.status = job.stop ? 'cancelled' : 'error'
    if (!job.stop) job.info.error = error instanceof Error ? error.message : 'Export failed.'
  } finally { if (created) await rm(temporary, { force: true }) }
}

async function closeSession(id: string) {
  const session = sessions.get(id)
  if (!session) return
  if (session.export) { session.export.stop = true; await session.export.task }
  await stopSearch(session)
  await stopFind(session)
  if (session.search) session.resource.db.exec(`DROP TABLE IF EXISTS ${session.search.table}`)
  if (session.find) session.resource.db.exec(`DROP TABLE IF EXISTS ${session.find.table}`)
  sessions.delete(id)
  const resource = session.resource
  const remaining = [...sessions.values()].filter(s => s.resource === resource)
  if (remaining.length) {
    if (remaining.every(s => s.cancelled)) { resource.stop = true; await resource.task }
    return
  }
  resource.stop = true
  await resource.task
  resource.db.close()
  await resource.file.close()
  resources.delete(resource.key)
  if (resource.status !== 'ready') {
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(join(cachePath, `${resource.key}.db${suffix}`), { force: true })
    }
  }
}

async function handle(command: Command): Promise<unknown> {
  if (command.type === 'company-tags') {
    companyPack = command.companyPack ? parseTagPack(JSON.stringify(command.companyPack)) : null
    return
  }
  if (command.type === 'cache-info' || command.type === 'cache-clear') return cacheInventory(command.type === 'cache-clear')
  if (command.type === 'open') {
    const resource = await openResource(command.path!)
    const session: Session = {
      info: { id: command.id, name: command.name!, synthetic: Boolean(command.synthetic) },
      resource, cancelled: false
    }
    sessions.set(command.id, session)
    const initial = info(session)
    if (!resource.task && resource.status === 'indexing') resource.task = index(resource)
    return initial
  }
  const session = sessions.get(command.id)
  if (!session) throw new Error('This file session has closed.')
  const resource = session.resource
  if (command.type === 'close') return closeSession(command.id)
  if (command.type === 'duplicate') {
    if (resource.status !== 'ready') throw new Error('Wait for indexing to finish before splitting.')
    const duplicate: Session = { info: { ...session.info, id: command.newId! }, resource, cancelled: false }
    sessions.set(command.newId!, duplicate)
    return info(duplicate)
  }
  if (command.type === 'export-status') {
    if (!session.export) throw new Error('No export is active.')
    return session.export.info
  }
  if (command.type === 'export-cancel') {
    if (session.export) { session.export.stop = true; await session.export.task }
    return
  }
  if (command.type === 'export') {
    if (resource.status !== 'ready') throw new Error('Wait for indexing before exporting.')
    if (session.export?.info.status === 'running') throw new Error('An export is already running in this view.')
    const request = command.export!
    if (request.searchVersion !== undefined && (session.search?.info.version !== request.searchVersion || session.search.info.status !== 'ready')) throw new Error('Complete the search before exporting its results.')
    const total = request.searchVersion === undefined ? resource.lines : session.search!.info.matches
    const ranges = request.ranges ?? [{ start: request.start ?? 1, end: request.end ?? total }]
    if (ranges.some(range => range.start > total || range.end > total)) throw new Error('Selection is outside available records.')
    session.export = { stop: false, info: { status: 'running', written: 0, total: selectionCount(ranges) } }
    const job = session.export
    job.task = exportFile(session, request, command.destination!).catch(error => {
      job.info.status = 'error'
      job.info.error = `Export cleanup failed: ${String(error)}`
    })
    return session.export.info
  }
  if (command.type === 'search') {
    if (session.export?.info.status === 'running') throw new Error('Finish or cancel the export before changing the search.')
    if (resource.status !== 'ready') throw new Error('Wait for indexing to finish before searching.')
    if ([...sessions.values()].filter(value => value !== session && value.search?.info.status === 'running').length >= 2) throw new Error('Two searches are already running. Cancel or finish one before starting another.')
    const request = command.search!
    const match = request.mode === 'regex' ? () => true : compileQuery(request.query, request.caseSensitive)
    const regex = request.mode === 'regex' ? new RegexJob(request.query, request.caseSensitive) : undefined
    await stopFind(session)
    await stopSearch(session)
    if (session.search) resource.db.exec(`DROP TABLE IF EXISTS ${session.search.table}`)
    const version = ++searchVersion
    const table = `matches_${version}`
    resource.db.exec(`CREATE TEMP TABLE ${table} (position INTEGER PRIMARY KEY, line INTEGER UNIQUE NOT NULL)`)
    session.search = { table, stop: false, regex, info: { version, status: 'running', matches: 0, scanned: 0, total: resource.lines } }
    session.search.task = searchFile(session, request, match)
    return session.search.info
  }
  if (command.type === 'search-status') {
    if (!session.search) throw new Error('No search is active in this tab.')
    return session.search.info
  }
  if (command.type === 'search-cancel') {
    if (session.export?.info.status === 'running') throw new Error('Finish or cancel the export before changing the search.')
    await stopFind(session)
    await stopSearch(session); return
  }
  if (command.type === 'find') {
    if (resource.status !== 'ready') throw new Error('Wait for indexing to finish before finding text.')
    const request = command.find!
    if (request.searchVersion !== undefined && (session.search?.info.version !== request.searchVersion || session.search.info.status !== 'ready')) throw new Error('Complete the filters before finding text in their results.')
    if ([...sessions.values()].filter(value => value !== session && value.find?.info.status === 'running').length >= 2) throw new Error('Two finds are already running. Close a find popup before starting another.')
    await stopFind(session)
    if (session.find) resource.db.exec(`DROP TABLE IF EXISTS ${session.find.table}`)
    const version = ++searchVersion
    const table = `find_${version}`
    resource.db.exec(`CREATE TEMP TABLE ${table} (ordinal INTEGER PRIMARY KEY, position INTEGER, column TEXT, start INTEGER, end INTEGER, line INTEGER)`)
    session.find = { table, stop: false, searchVersion: request.searchVersion,
      info: { version, status: 'running', matches: 0, scanned: 0, total: request.searchVersion === undefined ? resource.lines : session.search!.info.matches } }
    session.find.task = findFile(session, request)
    return session.find.info
  }
  if (command.type === 'find-status') {
    if (!session.find) throw new Error('No find is active in this tab.')
    return session.find.info
  }
  if (command.type === 'find-cancel') {
    await stopFind(session)
    if (session.find) resource.db.exec(`DROP TABLE IF EXISTS ${session.find.table}`)
    session.find = undefined
    return
  }
  if (command.type === 'cancel') {
    session.cancelled = true
    if (![...sessions.values()].some(s => s.resource === resource && !s.cancelled)) {
      resource.stop = true
      await resource.task
    }
    publish(resource)
    return
  }
  if (resource.status === 'error') throw new Error(resource.error)
  try { await checkSource(resource) }
  catch (error) {
    resource.status = 'error'
    resource.stop = true
    resource.error = error instanceof Error ? error.message : 'The file changed.'
    publish(resource)
    throw error
  }
  if (command.type === 'find-match') {
    const job = session.find
    if (!job || job.stop || command.version !== job.info.version ||
      (job.searchVersion !== undefined && job.searchVersion !== session.search?.info.version)) throw new Error('Find results are outdated. Find the text again.')
    const match = resource.db.prepare(`SELECT position, column, start, end, line FROM ${job.table} WHERE ordinal = ?`).get(command.ordinal) as Omit<FindMatch, 'row'> & { line: number } | undefined
    if (!match) throw new Error('Find occurrence is outside the available results.')
    return { position: match.position, column: match.column, start: match.start, end: match.end, row: await readRow(resource, match.line, 0, 1_000_000, command.emv) } satisfies FindMatch
  }
  if (command.type === 'locate') {
    if (!session.search || command.searchVersion !== session.search.info.version) throw new Error('Search results are outdated. Apply the search again.')
    const found = resource.db.prepare(`SELECT position FROM ${session.search.table} WHERE line = ?`).get(command.line) as { position: number } | undefined
    return found?.position ?? null
  }
  if (command.type === 'segment') return readRow(resource, command.line!, command.offset!, limits.segmentBytes, command.emv)
  if (command.type === 'copy') {
    const request = command.export!
    if (request.searchVersion !== undefined && (request.searchVersion !== session.search?.info.version || session.search.info.status !== 'ready')) throw new Error('Complete the current search before copying results.')
    const chunks: string[] = []
    let bytes = 0
    for (const position of selectedPositions(request.ranges ?? [{ start: request.start!, end: request.end! }])) {
      const source = request.searchVersion === undefined ? { line: position } :
        resource.db.prepare(`SELECT line FROM ${session.search!.table} WHERE position = ?`).get(position) as { line: number } | undefined
      if (!source) throw new Error('Selection is outside the available results.')
      const record = resource.db.prepare('SELECT length FROM lines WHERE line = ?').get(source.line) as { length: number } | undefined
      if (!record || record.length + bytes > 512_000) throw new Error('Copy exceeds 512 KB. Export the selection instead.')
      const row = await readRow(resource, source.line, 0, 512_000)
      bytes += Buffer.byteLength(row.raw, 'utf8') + (chunks.length ? 1 : 0)
      if (bytes > 512_000) throw new Error('Copy exceeds 512 KB of decoded text. Export the selection instead.')
      chunks.push(row.raw)
    }
    return chunks.join('\n')
  }
  if (command.searchVersion !== undefined && command.searchVersion !== session.search?.info.version) {
    throw new Error('Search results are outdated. Apply the search again.')
  }
  const rows: LogRow[] = []
  let payload = 0
  for (let line = command.start!; line < command.start! + command.count! && line <= resource.lines; line++) {
    let sourceLine = line
    if (command.searchVersion !== undefined) {
      const found = resource.db.prepare(`SELECT line FROM ${session.search!.table} WHERE position = ?`).get(line) as { line: number } | undefined
      if (!found) break
      sourceLine = found.line
    }
    const row = await readRow(resource, sourceLine, 0, limits.segmentBytes, command.emv)
    const bytes = Buffer.byteLength(JSON.stringify(row))
    if (payload + bytes > limits.responseBytes) break
    rows.push(row)
    payload += bytes
  }
  return rows
}

let queue = Promise.resolve()
port.on('message', (command: Command) => {
  queue = queue.then(async () => {
    try {
      port.postMessage({ requestId: command.requestId, ok: true, value: await handle(command) })
    } catch (error) {
      port.postMessage({ requestId: command.requestId, ok: false,
        error: error instanceof Error ? error.message : 'File operation failed.' })
    }
  })
})
