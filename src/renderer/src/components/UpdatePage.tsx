import { useEffect, useState } from 'react'
import { ArrowDownToLine, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import type { UpdateCheckResult, UpdatePageInfo } from '../../../../shared/releases'

export function UpdatePage({ startupResult }: { startupResult?: UpdateCheckResult | null }) {
  const [info, setInfo] = useState<UpdatePageInfo | null>(null)
  const [result, setResult] = useState<UpdateCheckResult | null>(startupResult ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (startupResult) setResult(previous => previous ?? startupResult) }, [startupResult])
  useEffect(() => {
    let active = true
    void window.logdeck.updatePageInfo().then(response => {
      if (!active) return
      if (!response.ok) setError(response.error)
      else setInfo(response.value)
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { active = false }
  }, [])

  async function check() {
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await window.logdeck.checkForUpdates()
      if (!response.ok) throw new Error(response.error)
      setResult(response.value)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }

  async function openDownload() {
    setError('')
    try {
      const response = await window.logdeck.openDownloadPage()
      if (!response.ok) throw new Error(response.error)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }

  return <main className="update-page">
    <section className="update-hero">
      <span className="update-icon"><RefreshCw size={25} /></span>
      <div className="eyebrow">LOGDECK RELEASES</div>
      <h1>Updates, on your terms.</h1>
      <p>LogDeck checks the public release version once at startup. You can check again here. Nothing is downloaded or installed automatically.</p>
    </section>
    <section className="update-card" aria-label="LogDeck version information">
      <div className="update-version-grid">
        <div><span className="update-label">INSTALLED VERSION</span><strong aria-label="Installed version">{info?.currentVersion ?? 'Loading...'}</strong></div>
        <div><span className="update-label">LATEST WEBSITE RELEASE</span><strong aria-label="Latest website release">{result?.latestVersion ?? 'Not checked'}</strong></div>
      </div>
      {!info?.configured && info && <p className="update-notice" role="status">Release checking is not configured. Local viewing remains available. Ask your LogDeck administrator to configure the official release website.</p>}
      {result && <div className={`update-result ${result.updateAvailable ? 'update-available' : 'update-current'}`} role="status">
        {result.updateAvailable ? <><ArrowDownToLine size={20} /><div><strong>LogDeck {result.latestVersion} is available</strong><p>Your installed version is {result.currentVersion}. Review the release notes below, then visit the official download page to update manually.</p></div></> :
          <><CheckCircle2 size={20} /><div><strong>{result.latestVersion === result.currentVersion ? 'You are up to date' : 'Installed version is newer'}</strong><p>{result.latestVersion === result.currentVersion ? `You have the latest listed version, ${result.currentVersion}.` : `Website lists ${result.latestVersion}; your installed version ${result.currentVersion} is newer.`}</p></div></>}
      </div>}
      {error && <p className="update-error" role="alert">{error}</p>}
      <div className="update-actions">
        <button className="primary-button" disabled={!info?.configured || busy} onClick={() => void check()}><RefreshCw size={15} className={busy ? 'update-spinning' : ''} />{busy ? 'Checking...' : 'Check for updates'}</button>
        <button className="secondary-button" disabled={!info?.configured} onClick={() => void openDownload()}><ExternalLink size={15} />Official download page</button>
      </div>
      {result && <section className="release-notes" aria-label="Release notes">
        <div className="eyebrow">RELEASE NOTES · {result.latestVersion}</div>
        <p>{result.releaseNotes}</p>
        <small>Published {new Date(result.publishedAt).toLocaleDateString()} · Checked {new Date(result.checkedAt).toLocaleString()}</small>
      </section>}
      <p className="update-privacy"><ShieldCheck size={15} /> The startup check and this button request only the small public release manifest. Logs, company tags, and account information are not sent.</p>
      <p className="muted update-limit">Updates are manual: download the new portable EXE from the official website, verify its checksum and publisher, close this app, then run the new EXE. Re-enable Open with LogDeck from Settings if its path changed. This page does not replace files or verify executable signatures.</p>
    </section>
  </main>
}
