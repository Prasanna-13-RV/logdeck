// @ts-check
import { useState } from 'react'
import { X } from 'lucide-react'

/** @param {{ result: import('../../../../shared/releases').UpdateCheckResult | null }} props */
export function UpdateNotice({ result }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !result?.updateAvailable) return null

  return <aside className="startup-update" role="status" aria-label="Startup update notice">
    <div>
      <strong>LogDeck {result.latestVersion} is available</strong>
      <p>Installed: {result.currentVersion} · Latest: {result.latestVersion}</p>
      {result.releaseNotes && <p className="update-notice-notes">{result.releaseNotes}</p>}
    </div>
    <button className="icon-button" aria-label="Dismiss update notice" onClick={() => setDismissed(true)}><X size={16} /></button>
  </aside>
}
