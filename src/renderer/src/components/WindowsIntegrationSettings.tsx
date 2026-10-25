import { useEffect, useState } from 'react'
import type { WindowsIntegrationInfo } from '../../../../shared/windowsIntegration'

export function WindowsIntegrationSettings({ onError }: { onError: (message: string) => void }) {
  const [info, setInfo] = useState<WindowsIntegrationInfo | null>(null)
  const [busy, setBusy] = useState(false)
  async function update(action?: 'register' | 'remove') {
    setBusy(true)
    try {
      const result = await (action ? window.logdeck.changeWindowsIntegration(action) : window.logdeck.windowsIntegrationInfo())
      if (!result.ok) onError(result.error)
      else setInfo(result.value)
    } catch (error) { onError(String(error)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void update() }, [])
  return <section aria-label="Windows Open with">
    <h3>Open with LogDeck</h3>
    <p className="muted">Download the portable EXE to a permanent folder and run it. No installer or administrator rights are needed. Enable this optional integration to add LogDeck to Windows Open with for .log and .logcat files; your default apps are unchanged.</p>
    <p role="status">{!info ? 'Reading Windows integration...' : !info.available ? 'Available in the packaged Windows app.' : info.registeredPath ? `Registered EXE: ${info.registeredPath}` : 'Not registered for this Windows account.'}</p>
    {info?.available && <p className="muted">Current EXE: {info.executablePath}. If you move or download a new version, enable again from that EXE. To make LogDeck the default, select it in Windows Settings &gt; Apps &gt; Default apps.</p>}
    <button className="secondary-button" disabled={busy || !info?.available} onClick={() => void update('register')}>Enable Open with LogDeck</button>
    <button className="text-button" disabled={busy || !info?.registeredPath} onClick={() => void update('remove')}>Remove Open with registration</button>
  </section>
}
