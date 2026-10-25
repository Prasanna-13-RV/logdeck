import { useEffect, useState } from 'react'
import type { CacheInfo } from '../../../../shared/contracts'
import { defaultColumns, usePreference, validColumns, validDisplay, type ColumnId } from '../preferences'
import { CompanyTagSettings } from './CompanyTagSettings'
import { WindowsIntegrationSettings } from './WindowsIntegrationSettings'

export function LocalSettings({ onError }: { onError: (message: string) => void }) {
  const [settings, save] = usePreference('logdeck-display', { fontSize: 11, defaultWrap: false }, validDisplay, onError)
  const [columns, saveColumns] = usePreference('logdeck-columns', defaultColumns, validColumns, onError)
  const [cache, setCache] = useState<CacheInfo | null>(null)
  const [busy, setBusy] = useState(false)
  async function refresh(clear = false) {
    setBusy(true)
    try {
      const result = await (clear ? window.logdeck.clearCache() : window.logdeck.cacheInfo())
      if (!result.ok) onError(result.error)
      else setCache(result.value)
    } catch (error) { onError(String(error)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void refresh() }, [])
  function moveColumn(id: ColumnId, direction: number) {
    const index = columns.findIndex(column => column.id === id)
    const other = index + direction
    if (other < 0 || other >= columns.length) return
    const next = [...columns]
    ;[next[index], next[other]] = [next[other], next[index]]
    saveColumns(next)
  }
  return <section className="local-settings">
    <CompanyTagSettings />
    <WindowsIntegrationSettings onError={onError} />
    <h3>Viewer display</h3>
    <label>Log font size <input type="range" min={10} max={18} aria-label="Log font size" value={settings.fontSize} onChange={event => save({ ...settings, fontSize: Number(event.target.value) })} /> {settings.fontSize}px</label>
    <label><input type="checkbox" checked={settings.defaultWrap} onChange={event => save({ ...settings, defaultWrap: event.target.checked })} />Use wrapping by default</label>
    <h3>Log columns</h3>
    <div className="column-editor" aria-label="Column layout">
      {columns.map((column, index) => <div className="column-control" key={column.id}>
        <label><input type="checkbox" aria-label={`Show ${column.id} column`} disabled={column.id === 'message'} checked={column.visible} onChange={event => saveColumns(columns.map(value => value.id === column.id ? { ...value, visible: event.target.checked } : value))} />{column.id}</label>
        <input aria-label={`${column.id} column width`} type="number" min={40} max={4000} value={column.width} onChange={event => {
          const width = Number(event.target.value)
          if (Number.isInteger(width) && width >= 40 && width <= 4000) saveColumns(columns.map(value => value.id === column.id ? { ...value, width } : value))
        }} />
        <button className="text-button" aria-label={`Move ${column.id} left`} disabled={!index} onClick={() => moveColumn(column.id, -1)}>Left</button>
        <button className="text-button" aria-label={`Move ${column.id} right`} disabled={index === columns.length - 1} onClick={() => moveColumn(column.id, 1)}>Right</button>
      </div>)}
      <button className="secondary-button" onClick={() => saveColumns(defaultColumns)}>Restore default columns</button>
    </div>
    <h3>Rebuildable index cache</h3>
    <p className="muted">{cache ? `${cache.files} indexes · ${(cache.bytes / 1_000_000).toFixed(1)} MB · ${cache.active} active sources` : 'Reading local cache inventory...'}</p>
    <p className="muted">Clear removes only recognized inactive index files. Active sources, logs, saved filters and appearance are preserved.</p>
    <button className="secondary-button" disabled={busy} onClick={() => void refresh(true)}>Clear inactive indexes</button>
    <button className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh cache inventory</button>
  </section>
}
