import { useState } from 'react'
import { firebaseConfig, FirebaseTags } from '../../shared/firebaseTags'
import { companyId, parseTagPack, tagPackLimits, type CompanyTagPack } from '../../shared/companyTags'
import { emvDefinition } from '../../shared/emvDictionary'

function configuration() {
  try { return { config: firebaseConfig(import.meta.env.VITE_FIREBASE_API_KEY, import.meta.env.VITE_FIREBASE_PROJECT_ID), error: '' } }
  catch (error) { return { config: null, error: error instanceof Error ? error.message : String(error) } }
}

export function Admin() {
  const [setup] = useState(configuration)
  const [client] = useState(() => setup.config ? new FirebaseTags(setup.config) : null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany] = useState('')
  const [account, setAccount] = useState<string | null>(null)
  const [pack, setPack] = useState<CompanyTagPack | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); setPassword('') }
  }
  return <section className="site-section admin-page" aria-label="Company administration">
    <div className="eyebrow">PRIVATE COMPANY WORKSPACE</div><h1>Publish knowledge.<br /><span>Not your logs.</span></h1>
    <p>Only an active company administrator can publish. This uploads tag definitions, never log files or transaction values.</p>
    {(!setup.config || setup.error) && <p className="site-notice" role="status">{setup.error || 'Firebase is not configured. Sign-in and publication are disabled until the project is set up.'}</p>}
    {error && <p className="site-error" role="alert">{error}</p>}
    {notice && <p className="site-notice" role="status">{notice}</p>}
    {!account ? <form className="tool-card admin-form" onSubmit={event => { event.preventDefault(); void run(async () => {
      companyId(company.trim())
      await client!.signIn(email.trim(), password)
      try {
        const access = await client!.membership(company.trim())
        if (access.role !== 'admin') throw new Error('This account is a member, not a company administrator.')
        setAccount(email.trim())
      } catch (error) { client!.signOut(); throw error }
    }) }}>
      <h2>Administrator sign-in</h2>
      <label>Company ID<input required maxLength={64} value={company} disabled={!client || busy} onChange={event => setCompany(event.target.value)} /></label>
      <label>Email<input type="email" autoComplete="username" required maxLength={254} value={email} disabled={!client || busy} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required maxLength={4096} value={password} disabled={!client || busy} onChange={event => setPassword(event.target.value)} /></label>
      <button className="primary-button" disabled={!client || busy}>Sign in as company admin</button>
      <p className="muted">Accounts and membership are provisioned by your administrator. There is no public self-enrolment or role selection.</p>
    </form> : <section className="tool-card admin-form">
      <header className="site-actions"><strong>{account} / {company} / admin</strong><button disabled={busy} className="text-button" onClick={() => { client!.signOut(); setAccount(null); setPack(null); setNotice('Signed out.'); setError('') }}>Sign out</button></header>
      <h2>Upload a tag-pack JSON file</h2>
      <p>Schema 1 / 1-1,000 hexadecimal tags / maximum 512 KB / positive integer version. Each publication must be higher than the current version.</p>
      <input aria-label="Company tag JSON" type="file" accept=".json,application/json" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]
        setPack(null); setError(''); setNotice('')
        if (!file) return
        void run(async () => {
          if (file.size > tagPackLimits.bytes) throw new Error('Tag pack exceeds 512 KB.')
          const candidate = parseTagPack(await file.text())
          if (candidate.companyId !== company.trim()) throw new Error('Pack companyId must match the authorized company.')
          setPack(candidate); setNotice('Validated locally. Nothing has been published yet.')
        })
      }} />
      {pack && <>
        <h3>{pack.name} / v{pack.version}</h3>
        <p>{pack.tags.length} company tags / {pack.tags.filter(tag => emvDefinition(tag.tag)).length} also have global definitions. Both sources are retained.</p>
        <div className="admin-preview"><table><thead><tr><th>Tag</th><th>Name</th><th>Bytes</th></tr></thead><tbody>{pack.tags.map(tag => <tr key={tag.tag}><td>{tag.tag}</td><td>{tag.name}</td><td>{tag.bytes ?? 'Variable'}</td></tr>)}</tbody></table></div>
        <button className="primary-button" disabled={busy} onClick={() => void run(async () => {
          const published = await client!.publish(JSON.stringify(pack))
          setNotice(`Published ${published.name} v${published.version}. Authorized users can download it from LogDeck Settings.`)
          setPack(null)
        })}>Publish version {pack.version}</button>
      </>}
    </section>}
    <section className="tool-card"><h2>Versioned, deliberate distribution.</h2><p>Publication creates an immutable pack and advances the company catalog atomically. The desktop downloads only when a user clicks Download EMV tags in Settings. Installed packs remain available after sign-out; access revocation prevents future cloud downloads, not copies already downloaded.</p><a href="/company-tags.example.json" download>Download synthetic JSON template</a></section>
  </section>
}
