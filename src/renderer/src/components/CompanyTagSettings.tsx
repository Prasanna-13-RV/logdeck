import { useEffect, useState } from 'react'
import type { CompanyTagStatus, Result } from '../../../../shared/contracts'

export function CompanyTagSettings() {
  const [status, setStatus] = useState<CompanyTagStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<Result<CompanyTagStatus>>) {
    setBusy(true); setError('')
    try {
      const result = await action()
      if (!result.ok) throw new Error(result.error)
      setStatus(result.value)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); setPassword('') }
  }
  useEffect(() => {
    void run(() => window.logdeck.companyTagStatus())
    return window.logdeck.onCompanyTagsChanged(() => { void run(() => window.logdeck.companyTagStatus()) })
  }, [])
  return <section className="company-settings" aria-label="Company EMV tags">
    <h3>Company EMV tags</h3>
    <p>Global tags stay bundled. Company definitions are shown alongside them, never replacing global meanings or bit decoders.</p>
    {error && <p role="alert">{error}</p>}
    {!status ? <p role="status">Loading tag settings...</p> : <>
      {!status.configured && <p className="viewer-notice">Firebase is not configured. Cloud sign-in and downloads are unavailable until the Firebase project is set up.</p>}
      <p role="status">{status.notice}</p>
      {status.installed && <p>Installed: <strong>{status.installed.name}</strong> · {status.installed.companyId} · version {status.installed.version} · {status.installed.tags.length} company tags</p>}
      {status.account ? <p>Signed in as {status.account.email} <button className="text-button" disabled={busy} onClick={() => void run(() => window.logdeck.companySignOut())}>Sign out</button></p> :
        <form onSubmit={event => { event.preventDefault(); void run(() => window.logdeck.companySignIn(email.trim(), password)) }}>
          <label>Email<input aria-label="Company account email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} disabled={busy || !status.configured} required maxLength={254} /></label>
          <label>Password<input aria-label="Company account password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy || !status.configured} required maxLength={4096} /></label>
          <button className="secondary-button" disabled={busy || !status.configured}>Sign in for company tags</button>
        </form>}
      <label>Company ID<input aria-label="Company ID" value={company} maxLength={64} placeholder="Company ID from your administrator" onChange={event => setCompany(event.target.value)} disabled={busy || !status.configured} /></label>
      <button className="primary-button" disabled={busy || !status.configured || !status.account || !company} onClick={() => void run(() => window.logdeck.downloadCompanyTags(company.trim()))}>{busy ? 'Working...' : 'Download EMV tags'}</button>
      <p className="muted">Manual only: checks your company membership and published version. A newer valid pack is installed locally for offline use; older versions are rejected. One company pack is active on this device at a time. Downloading another company replaces only the company pack, never global tags. Sign-out does not delete downloaded definitions. No logs are uploaded. Sign-in is kept only until this window closes.</p>
    </>}
  </section>
}
