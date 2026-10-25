import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { FileWorker } from './workerClient'
import { sessionId, validateRange, validateSegment, validateSearch, validateLocate, validateExport, validateClipboard } from './validation'
import { TextFiles } from './textFiles'
import type { LogRow, Result, SessionInfo, SearchInfo, ExportInfo, CacheInfo } from '../../shared/contracts'

const windows = new Map<number, BrowserWindow>()
const sessions = new Map<string, { owner: number; info: SessionInfo; path: string }>()
const textFiles = new TextFiles()
const exportDialogs = new Set<number>()
const busy = new Set<number>()
const rangeJobs = new Map<number, number>()
const activeSessions = new Map<number, string>()
let files: FileWorker

if (process.env.LOGDECK_TEST_USER_DATA) app.setPath('userData', process.env.LOGDECK_TEST_USER_DATA)
app.setName('LogDeck')

function ownedWindow(event: IpcMainInvokeEvent) {
  const window = windows.get(event.sender.id)
  if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized window.')
  const expected = process.env.ELECTRON_RENDERER_URL
  const url = event.senderFrame.url
  if (expected ? new URL(url).origin !== new URL(expected).origin : !url.startsWith('file:')) {
    throw new Error('Unauthorized page.')
  }
  return window
}

function ownedSession(event: IpcMainInvokeEvent, id: string) {
  const session = sessions.get(id)
  if (!session || session.owner !== event.sender.id) throw new Error('This file does not belong to this window.')
  return session
}

function ipc<T>(channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<T>) {
  ipcMain.handle(channel, async (event, payload): Promise<Result<T>> => {
    try { ownedWindow(event); return { ok: true, value: await handler(event, payload) } }
    catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The operation failed.' }
    }
  })
}

async function closeSession(id: string) {
  const entry = sessions.get(id)
  if (!entry) return
  await files.request('close', id)
  sessions.delete(id)
  if (activeSessions.get(entry.owner) === id) activeSessions.delete(entry.owner)
  const window = windows.get(entry.owner)
  if (window && !window.isDestroyed()) window.webContents.send('files:closed', id)
}

async function openForWindow(window: BrowserWindow, input: string, synthetic = false) {
  const owner = window.webContents.id
  if (busy.has(owner)) throw new Error('A file is already opening in this window.')
  if ([...sessions.values()].filter(entry => entry.owner === owner).length >= 12) {
    throw new Error('This window supports up to 12 open files. Close a tab or open a new window.')
  }
  if (typeof input !== 'string' || input.length > 32767 || !isAbsolute(input)) throw new Error('Invalid file path.')
  if (!['.log', '.logcat'].includes(extname(input).toLowerCase())) throw new Error('Choose a .log or .logcat file.')
  busy.add(owner)
  const id = randomUUID()
  try {
    const path = await realpath(input)
    // Register before opening so early worker progress is attributed to its owner.
    const pending: SessionInfo = {
      id, name: basename(path), size: 0, lines: 0, indexedBytes: 0,
      status: 'indexing', synthetic, cacheHit: false
    }
    sessions.set(id, { owner, info: pending, path })
    const info = await files.request<SessionInfo>('open', id, { path, name: basename(path), synthetic })
    if (window.isDestroyed()) {
      await closeSession(id)
      throw new Error('The receiving window closed.')
    }
    const entry = sessions.get(id)!
    if (entry.info.size === 0 && entry.info.lines === 0) entry.info = info
    activeSessions.set(owner, id)
    window.webContents.send('files:progress', entry.info)
    return entry.info
  } catch (error) {
    if (sessions.has(id)) {
      try { await files.request('close', id) }
      catch (cleanupError) { console.error('Failed to clean up opening session:', cleanupError) }
      sessions.delete(id)
    }
    throw error
  } finally { busy.delete(owner) }
}

async function demoPath() {
  const directory = join(app.getPath('userData'), 'examples')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'synthetic-demo.logcat')
  const entries = [
    ['I', 'LogDeck', 'Synthetic demonstration log. No device or payment data.'],
    ['D', 'ActivityManager', 'Preparing viewer session and local workspace'],
    ['I', 'Network', 'Connection established to example.invalid (synthetic)'],
    ['W', 'Payment', 'Simulated response delayed; retry scheduled'],
    ['E', 'Network', 'Synthetic timeout while reading demonstration response'],
    ['I', 'Renderer', 'Viewport ready. Original log files stay read-only.'],
    ['V', 'Worker', 'Indexing next batch of synthetic records'],
    ['D', 'Payment', 'Example tag-shaped text 9F02[6]:00 00 00 00 00 12 (not decoded)']
  ]
  const text = Array.from({ length: 2400 }, (_, i) => {
    const [level, tag, message] = entries[i % entries.length]
    return `10-24 12:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.123  1423  1560 ${level} ${tag}: ${message} [${i + 1}]`
  }).join('\n')
  try { await writeFile(path, `${text}\n`, { flag: 'wx' }) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
  return path
}

async function createWindow(initialPath?: string) {
  const window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 940, minHeight: 640,
    title: 'LogDeck', backgroundColor: '#101319', show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false
    }
  })
  const owner = window.webContents.id
  windows.set(owner, window)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.on('closed', () => {
    textFiles.close(owner)
    windows.delete(owner)
    activeSessions.delete(owner)
    for (const [id, entry] of sessions) {
      if (entry.owner === owner) void closeSession(id).catch(error => console.error('File cleanup failed:', error))
    }
  })
  window.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(window, {
      type: 'warning', message: 'Discard unsaved Compare changes?',
      buttons: ['Keep editing', 'Discard'], defaultId: 0, cancelId: 0
    })
    if (response === 1) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'n' && input.type === 'keyDown') {
      event.preventDefault()
      void createWindow().catch(error => dialog.showErrorBox('Could not create window', String(error)))
    }
  })
  let openingError: string | undefined
  if (initialPath) {
    try {
      await openForWindow(window, initialPath)
    } catch (error) {
      openingError = String(error)
    }
  }
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
  if (openingError) await dialog.showMessageBox(window, { type: 'error', message: openingError })
  return window
}

function registerIpc() {
  ipc('files:pick', async event => {
    const window = ownedWindow(event)
    const result = await dialog.showOpenDialog(window, {
      title: 'Open a log file', properties: ['openFile'],
      filters: [{ name: 'Log files', extensions: ['log', 'logcat'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return openForWindow(window, result.filePaths[0])
  })
  ipc('files:drop', async (event, path) => {
    if (typeof path !== 'string') throw new Error('Invalid dropped file.')
    return openForWindow(ownedWindow(event), path)
  })
  ipc('files:demo', async event => openForWindow(ownedWindow(event), await demoPath(), true))
  ipc('files:current', async event => {
    const id = activeSessions.get(event.sender.id)
    return id ? sessions.get(id)?.info ?? null : null
  })
  ipc('files:list', async event => [...sessions.values()].filter(s => s.owner === event.sender.id).map(s => s.info))
  ipc('files:activate', async (event, value) => {
    const id = sessionId(value)
    ownedSession(event, id)
    activeSessions.set(event.sender.id, id)
  })
  ipc('files:range', async (event, value) => {
    const request = validateRange(value)
    ownedSession(event, request.id)
    const owner = event.sender.id
    if ((rangeJobs.get(owner) ?? 0) >= 2) throw new Error('Too many simultaneous range requests.')
    rangeJobs.set(owner, (rangeJobs.get(owner) ?? 0) + 1)
    try { return await files.request<LogRow[]>('range', request.id, { ...request }) }
    finally { rangeJobs.set(owner, (rangeJobs.get(owner) ?? 1) - 1) }
  })
  ipc('files:segment', async (event, value) => {
    const request = validateSegment(value)
    ownedSession(event, request.id)
    return files.request<LogRow>('segment', request.id, { ...request })
  })
  ipc('files:cancel', async (event, value) => {
    const id = sessionId(value)
    ownedSession(event, id)
    await files.request('cancel', id)
  })
  ipc('files:close', async (event, value) => {
    const id = sessionId(value)
    ownedSession(event, id)
    await closeSession(id)
  })
  ipc('files:search', async (event, value) => {
    const request = validateSearch(value)
    ownedSession(event, request.id)
    return files.request<SearchInfo>('search', request.id, { search: request })
  })
  ipc('files:search-status', async (event, value) => {
    const id = sessionId(value)
    ownedSession(event, id)
    return files.request<SearchInfo>('search-status', id)
  })
  ipc('files:search-cancel', async (event, value) => {
    const id = sessionId(value)
    ownedSession(event, id)
    await files.request('search-cancel', id)
  })
  ipc('files:locate', async (event, value) => {
    const request = validateLocate(value)
    ownedSession(event, request.id)
    return files.request<number | null>('locate', request.id, request)
  })
  ipc('files:duplicate', async (event, value) => {
    const id = sessionId(value)
    const source = ownedSession(event, id)
    if ([...sessions.values()].filter(entry => entry.owner === event.sender.id).length >= 12) throw new Error('Close a file or split before creating another view (12 per window).')
    const newId = randomUUID()
    const info = await files.request<SessionInfo>('duplicate', id, { newId })
    sessions.set(newId, { owner: event.sender.id, path: source.path, info })
    return info
  })
  ipc('files:export', async (event, value) => {
    const request = validateExport(value)
    const source = ownedSession(event, request.id)
    const owner = event.sender.id
    if (exportDialogs.has(owner)) throw new Error('An export destination dialog is already open.')
    exportDialogs.add(owner)
    try {
      const picked = await dialog.showSaveDialog(ownedWindow(event), {
        title: 'Export records in source order', defaultPath: `${source.info.name}.export.txt`,
        properties: ['showOverwriteConfirmation']
      })
      if (picked.canceled || !picked.filePath) return null
      const destination = await realpath(picked.filePath).catch(error => { if (error.code === 'ENOENT') return picked.filePath!; throw error })
      if ([...sessions.values()].some(entry => entry.path.toLowerCase() === destination.toLowerCase())) throw new Error('Export cannot replace an open source log.')
      return files.request<ExportInfo>('export', request.id, { export: request, destination })
    } finally { exportDialogs.delete(owner) }
  })
  ipc('files:copy', async (event, value) => {
    const request = validateExport(value)
    ownedSession(event, request.id)
    const count = request.ranges ? request.ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0) :
      request.start === undefined || request.end === undefined ? 0 : request.end - request.start + 1
    if (count < 1 || count > 500) throw new Error('Copy supports 1-500 selected records. Export larger selections.')
    return files.request<string>('copy', request.id, { export: request })
  })
  ipc('clipboard:write', async (_event, value) => {
    await clipboard.writeText(validateClipboard(value))
  })
  ipc('files:export-status', async (event, value) => {
    const id = sessionId(value)
    ownedSession(event, id)
    return files.request<ExportInfo>('export-status', id)
  })
  ipc('files:export-cancel', async (event, value) => {
    const id = sessionId(value)
    ownedSession(event, id)
    await files.request('export-cancel', id)
  })
  ipc('cache:info', async () => files.request<CacheInfo>('cache-info', 'cache'))
  ipc('cache:clear', async () => files.request<CacheInfo>('cache-clear', 'cache'))
  ipc('text:open', async event => textFiles.pick(ownedWindow(event)))
  ipc('text:save', async (event, value) => textFiles.save(ownedWindow(event), value, [...sessions.values()].map(entry => entry.path)))
  ipc('text:release', async (event, value) => textFiles.release(event.sender.id, sessionId(value)))
  ipc('text:discard', async event => (await dialog.showMessageBox(ownedWindow(event), {
    type: 'warning', message: 'Discard unsaved Compare changes?', buttons: ['Keep editing', 'Discard'], defaultId: 0, cancelId: 0
  })).response === 1)
  ipc('windows:new', async () => { await createWindow() })
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    const path = argv.find(value => ['.log', '.logcat'].includes(extname(value).toLowerCase()))
    void createWindow(path).catch(error => dialog.showErrorBox('Could not open LogDeck', String(error)))
  })
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    const cacheRoot = process.env.LOGDECK_TEST_USER_DATA ??
      join(process.env.LOCALAPPDATA || app.getPath('userData'), 'LogDeck')
    files = new FileWorker(join(cacheRoot, 'indexes'), info => {
      const entry = sessions.get(info.id)
      if (!entry) return
      entry.info = info
      const window = windows.get(entry.owner)
      if (window && !window.isDestroyed()) window.webContents.send('files:progress', info)
    }, error => {
      console.error('File worker stopped:', error.message)
      for (const entry of sessions.values()) {
        entry.info = { ...entry.info, status: 'error', error: error.message }
        const window = windows.get(entry.owner)
        if (window && !window.isDestroyed()) window.webContents.send('files:progress', entry.info)
      }
    })
    registerIpc()
    const path = process.argv.find(value => ['.log', '.logcat'].includes(extname(value).toLowerCase()))
    await createWindow(path ? resolve(path) : undefined)
  }).catch(error => { dialog.showErrorBox('LogDeck could not start', String(error)); app.quit() })
}
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => { if (files) void files.stop() })
