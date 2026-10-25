import { dialog, type BrowserWindow } from 'electron'
import { open, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { compareLimits, type TextDocument } from '../../shared/contracts'
import { encodeText } from '../../shared/text'
import { object, sessionId } from './validation'

interface DocumentEntry { owner: number; path: string; hash: string }
const documents = new Map<string, DocumentEntry>()
const busy = new Set<number>()
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

async function read(path: string) {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > compareLimits.bytes) throw new Error('Choose a regular UTF-8 text file up to 10 MB.')
    const buffer = Buffer.alloc(metadata.size + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (!part.bytesRead) break
      bytesRead += part.bytesRead
    }
    const after = await handle.stat()
    if (bytesRead !== metadata.size || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) throw new Error('File changed while reading. Try again.')
    return buffer.subarray(0, bytesRead)
  } finally { await handle.close() }
}

export class TextFiles {
  async pick(window: BrowserWindow): Promise<TextDocument | null> {
    if ([...documents.values()].filter(entry => entry.owner === window.webContents.id).length >= 40) throw new Error('Too many Compare documents. Close a Compare tab.')
    const picked = await dialog.showOpenDialog(window, { title: 'Open UTF-8 text for Compare', properties: ['openFile'] })
    if (picked.canceled) return null
    const path = await realpath(picked.filePaths[0])
    const bytes = await read(path)
    let raw: string
    try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { throw new Error('Compare supports valid UTF-8 only. Convert the encoding explicitly before opening.') }
    const bom = raw.startsWith('\uFEFF')
    if (bom) raw = raw.slice(1)
    const crlf = raw.includes('\r\n')
    if (crlf && /(?<!\r)\n/.test(raw)) throw new Error('Mixed line endings require explicit conversion before opening in Compare.')
    const newline = crlf ? '\r\n' : '\n'
    encodeText(raw, newline, bom)
    const id = randomUUID()
    documents.set(id, { owner: window.webContents.id, path, hash: digest(bytes) })
    return { id, name: basename(path), text: raw.replace(/\r\n/g, '\n'), newline, bom }
  }

  async save(window: BrowserWindow, input: unknown, protectedPaths: string[]): Promise<TextDocument | null> {
    const owner = window.webContents.id
    if (busy.has(owner)) throw new Error('A Compare save is already in progress.')
    const data = object(input)
    if (typeof data.text !== 'string' || data.text.length > compareLimits.bytes || typeof data.saveAs !== 'boolean' ||
      (data.newline !== '\n' && data.newline !== '\r\n') || typeof data.bom !== 'boolean') throw new Error('Invalid Compare save request.')
    const text = data.text
    const newline = data.newline
    const bom = data.bom
    const output = encodeText(text, newline, bom)
    const id = data.id === undefined ? randomUUID() : sessionId(data.id)
    const entry = documents.get(id)
    if (data.id !== undefined && (!entry || entry.owner !== owner)) throw new Error('This document does not belong to this window.')
    if (!entry && [...documents.values()].filter(value => value.owner === owner).length >= 40) throw new Error('Too many Compare documents.')
    busy.add(owner)
    let temporary: string | undefined
    try {
      let path = entry?.path
      let saveAs = data.saveAs || !entry
      let authorizedHash: string | null = null
      if (entry && !saveAs) {
        let changed = false
        try { authorizedHash = digest(await read(entry.path)); changed = authorizedHash !== entry.hash }
        catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') changed = true
          else throw error
        }
        if (changed) {
          const decision = await dialog.showMessageBox(window, { type: 'warning', message: 'The source changed outside LogDeck.', detail: 'Overwrite only if you intend to replace the external changes.', buttons: ['Cancel', 'Save As', 'Overwrite'], defaultId: 0, cancelId: 0 })
          if (decision.response === 0) return null
          saveAs = decision.response === 1
        }
      }
      if (saveAs) {
        const picked = await dialog.showSaveDialog(window, { title: 'Save Compare text', defaultPath: entry?.path ?? 'comparison.txt', properties: ['showOverwriteConfirmation'] })
        if (picked.canceled || !picked.filePath) return null
        path = picked.filePath
      }
      if (!path) throw new Error('No destination selected.')
      const parent = await realpath(dirname(path))
      path = join(parent, basename(path))
      const existingPath = await realpath(path).catch(error => {
        if (error.code === 'ENOENT') return path!
        throw error
      })
      if (protectedPaths.some(source => source.toLowerCase() === existingPath.toLowerCase())) throw new Error('This file is open in a read-only log viewer. Save to a different file.')
      let before: string | null = null
      try { before = digest(await read(path)) }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      if (!saveAs && before !== authorizedHash) throw new Error('Destination changed after the conflict check. Your buffer is retained; retry or Save As.')
      temporary = join(parent, `.logdeck-${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx')
      try { await handle.writeFile(output, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      let latest: string | null = null
      try { latest = digest(await read(path)) }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      if (latest !== before) throw new Error('Destination changed during saving. Your buffer is retained; retry or Save As.')
      if (window.isDestroyed()) throw new Error('Compare window closed before saving. Destination was not replaced.')
      await rename(temporary, path)
      temporary = undefined
      documents.set(id, { owner, path, hash: digest(Buffer.from(output)) })
      return { id, name: basename(path), text, newline, bom }
    } finally {
      busy.delete(owner)
      if (temporary) await rm(temporary, { force: true })
    }
  }

  release(owner: number, id: string) {
    const entry = documents.get(id)
    if (!entry || entry.owner !== owner) throw new Error('This document does not belong to this window.')
    documents.delete(id)
  }
  close(owner: number) { for (const [id, entry] of documents) if (entry.owner === owner) documents.delete(id) }
}
