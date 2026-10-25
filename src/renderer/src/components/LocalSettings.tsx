import { useEffect, useState } from 'react'
import type { CacheInfo } from '../../../../shared/contracts'
import { usePreference, validDisplay } from '../preferences'

export function LocalSettings({ onError }: { onError: (message: string) => void }) {
  const [settings, save] = usePreference('logdeck-display', { fontSize: 11, defaultWrap: false }, validDisplay, onError)
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
  return <section className="local-settings">
    <h3>Viewer display</h3>
    <label>Log font size <input type="range" min={10} max={18} aria-label="Log font size" value={settings.fontSize} onChange={event => save({ ...settings, fontSize: Number(event.target.value) })} /> {settings.fontSize}px</label>
    <label><input type="checkbox" checked={settings.defaultWrap} onChange={event => save({ ...settings, defaultWrap: event.target.checked })} />Use wrapping by default</label>
    <h3>Rebuildable index cache</h3>
    <p className="muted">{cache ? `${cache.files} indexes · ${(cache.bytes / 1_000_000).toFixed(1)} MB · ${cache.active} active sources` : 'Reading local cache inventory...'}</p>
    <p className="muted">Clear removes only recognized inactive index files. Active sources, logs, saved filters and appearance are preserved.</p>
    <button className="secondary-button" disabled={busy} onClick={() => void refresh(true)}>Clear inactive indexes</button>
    <button className="text-button" disabled={busy} onClick={() => void refresh()}>Refresh cache inventory</button>
  </section>
}
