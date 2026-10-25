import { useState } from 'react'
import type { SessionInfo } from '../../../../shared/contracts'
import { LogViewer } from './LogViewer'
import type { EmvSeed } from '../../../../shared/emvTracker'

export function SplitWorkspace({ session, second, active, onError, onSplit, onCloseSplit, onEmv }: {
  session: SessionInfo; second?: SessionInfo; active: boolean
  onError: (message: string) => void; onSplit: () => void; onCloseSplit: () => void
  onEmv: (seed: EmvSeed) => void
}) {
  const [focused, setFocused] = useState(0)
  const [sideBySide, setSideBySide] = useState(false)
  const [opening, setOpening] = useState(false)
  async function openAnother() {
    if (opening) return
    setOpening(true)
    try {
      const result = await window.logdeck.openSplitFile(session.id)
      if (!result.ok) onError(result.error)
    } catch (error) { onError(String(error)) }
    finally { setOpening(false) }
  }
  return <div className={`split-workspace ${second ? `is-split ${sideBySide ? 'side-by-side' : ''}` : ''}`}>
    <div className="split-pane" onFocusCapture={() => setFocused(0)} onPointerDownCapture={() => setFocused(0)}>
      {second && <div className="split-heading">Primary view · independent scroll and filters
        <button className="text-button" aria-label={sideBySide ? 'Stack split views' : 'Split side by side'} onClick={() => setSideBySide(!sideBySide)}>{sideBySide ? 'Stack views' : 'Side by side'}</button>
      </div>}
      {!second && <div className="split-file-actions"><button className="text-button" disabled={opening} onClick={() => void openAnother()}>Open another log in split</button></div>}
      <LogViewer session={session} active={active} keyboardActive={focused === 0} onError={onError} onSplit={second ? undefined : onSplit} onEmv={onEmv} />
    </div>
    {second && <div className="split-pane" onFocusCapture={() => setFocused(1)} onPointerDownCapture={() => setFocused(1)}>
      <div className="split-heading"><span title={second.name}>Secondary · {second.name}</span><button className="text-button" disabled={opening} onClick={() => void openAnother()}>Open another log</button><button className="text-button" disabled={opening} onClick={onCloseSplit}>Close split</button></div>
      <LogViewer key={second.id} session={second} active={active} keyboardActive={focused === 1} onError={onError} onEmv={onEmv} />
    </div>}
  </div>
}
