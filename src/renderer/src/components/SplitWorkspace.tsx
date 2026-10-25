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
  return <div className={`split-workspace ${second ? 'is-split' : ''}`}>
    <div className="split-pane" onFocusCapture={() => setFocused(0)} onPointerDownCapture={() => setFocused(0)}>
      {second && <div className="split-heading">Primary view · independent scroll and filters</div>}
      <LogViewer session={session} active={active} keyboardActive={focused === 0} onError={onError} onSplit={second ? undefined : onSplit} onEmv={onEmv} />
    </div>
    {second && <div className="split-pane" onFocusCapture={() => setFocused(1)} onPointerDownCapture={() => setFocused(1)}>
      <div className="split-heading">Secondary view <button className="text-button" onClick={onCloseSplit}>Close split</button></div>
      <LogViewer session={second} active={active} keyboardActive={focused === 1} onError={onError} onEmv={onEmv} />
    </div>}
  </div>
}
