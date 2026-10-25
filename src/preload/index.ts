import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi, SessionInfo } from '../../shared/contracts'

const api: DesktopApi = {
  openFile: () => ipcRenderer.invoke('files:pick'),
  openDroppedFile: path => ipcRenderer.invoke('files:drop', path),
  pathForFile: file => webUtils.getPathForFile(file),
  openDemo: () => ipcRenderer.invoke('files:demo'),
  getSession: () => ipcRenderer.invoke('files:current'),
  getSessions: () => ipcRenderer.invoke('files:list'),
  activateSession: id => ipcRenderer.invoke('files:activate', id),
  readRange: request => ipcRenderer.invoke('files:range', request),
  readSegment: request => ipcRenderer.invoke('files:segment', request),
  cancel: id => ipcRenderer.invoke('files:cancel', id),
  closeFile: id => ipcRenderer.invoke('files:close', id),
  newWindow: () => ipcRenderer.invoke('windows:new'),
  startSearch: request => ipcRenderer.invoke('files:search', request),
  searchStatus: id => ipcRenderer.invoke('files:search-status', id),
  cancelSearch: id => ipcRenderer.invoke('files:search-cancel', id),
  locate: request => ipcRenderer.invoke('files:locate', request),
  duplicateSession: id => ipcRenderer.invoke('files:duplicate', id),
  exportRecords: request => ipcRenderer.invoke('files:export', request),
  copyRecords: request => ipcRenderer.invoke('files:copy', request),
  writeClipboard: text => ipcRenderer.invoke('clipboard:write', text),
  exportStatus: id => ipcRenderer.invoke('files:export-status', id),
  cancelExport: id => ipcRenderer.invoke('files:export-cancel', id),
  cacheInfo: () => ipcRenderer.invoke('cache:info'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openText: () => ipcRenderer.invoke('text:open'),
  saveText: request => ipcRenderer.invoke('text:save', request),
  releaseText: id => ipcRenderer.invoke('text:release', id),
  confirmDiscard: () => ipcRenderer.invoke('text:discard'),
  onClosed: listener => {
    const receive = (_event: Electron.IpcRendererEvent, id: string) => listener(id)
    ipcRenderer.on('files:closed', receive)
    return () => ipcRenderer.removeListener('files:closed', receive)
  },
  onProgress: listener => {
    const receive = (_event: Electron.IpcRendererEvent, info: SessionInfo) => listener(info)
    ipcRenderer.on('files:progress', receive)
    return () => ipcRenderer.removeListener('files:progress', receive)
  }
}

contextBridge.exposeInMainWorld('logdeck', api)
