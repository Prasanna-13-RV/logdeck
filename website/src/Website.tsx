import { useEffect, useState, type MouseEvent } from 'react'
import { Activity, ArrowDownToLine, ArrowRight, HardDrive, Moon, ShieldCheck, Sun } from 'lucide-react'
import { features } from '../../src/renderer/src/components/Home'
import { Admin } from './admin'
import { parseReleaseManifest, type ReleaseManifest } from '../../shared/releases'

function downloadUrl() {
  const configured = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL
  if (!configured) return null
  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch { return null }
}

export function Website() {
  const [path, setPath] = useState(location.pathname)
  const [dark, setDark] = useState(() => {
    try { const saved = localStorage.getItem('logdeck-site-theme'); return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches }
    catch { return matchMedia('(prefers-color-scheme: dark)').matches }
  })
  const [notice, setNotice] = useState('')
  const [websiteRelease, setWebsiteRelease] = useState<ReleaseManifest | null>(null)
  const [releaseError, setReleaseError] = useState('')
  useEffect(() => {
    const update = () => setPath(location.pathname)
    addEventListener('popstate', update)
    return () => removeEventListener('popstate', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('logdeck-site-theme', dark ? 'dark' : 'light') }
    catch { setNotice('Appearance storage is unavailable. Your theme will last only for this page.') }
  }, [dark])
  useEffect(() => {
    document.title = `LogDeck - ${path === '/' ? 'Less noise. More understanding.' : path === '/features' ? 'Features' : path === '/download' ? 'Download' : path === '/admin' ? 'Company administration' : 'Page not found'}`
    window.scrollTo(0, 0)
  }, [path])
  useEffect(() => {
    if (path !== '/download') return
    const controller = new AbortController()
    void fetch('/updates/windows.json', { signal: controller.signal, redirect: 'error' }).then(async response => {
      if (!response.ok) throw new Error(`Release details unavailable (${response.status}).`)
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > 32_768) throw new Error('Release manifest exceeds 32 KB.')
      const manifest = parseReleaseManifest(await response.text())
      setWebsiteRelease(manifest); setReleaseError('')
    }).catch(error => {
      if (controller.signal.aborted) return
      setWebsiteRelease(null); setReleaseError(error instanceof Error ? error.message : String(error))
    })
    return () => controller.abort()
  }, [path])
  function link(event: MouseEvent<HTMLAnchorElement>, target: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault(); history.pushState({}, '', target); setPath(target)
  }
  const nav = (target: string, label: string) => <a href={target} onClick={event => link(event, target)} aria-current={path === target ? 'page' : undefined}>{label}</a>
  const url = websiteRelease?.downloadUrl ?? downloadUrl()
  return <div className="website">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="navbar">
      <a className="brand" href="/" onClick={event => link(event, '/')} aria-label="LogDeck home"><span className="brand-mark"><Activity size={25} /></span>LogDeck<span className="brand-period">.</span></a>
      <nav aria-label="Main navigation">{nav('/', 'Home')}{nav('/features', 'Features')}{nav('/download', 'Download app')}</nav>
      <div className="navbar-actions"><button className="icon-button" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button></div>
    </header>
    {notice && <p role="status" className="site-notice">{notice}</p>}
    <main id="main" className="site-main">
      {path === '/' ? <>
        <section className="hero site-hero">
          <div className="eyebrow"><span className="status-dot" />YOUR LOGS. YOUR MACHINE.</div>
          <h1>Less noise.<br /><span>More understanding.</span></h1>
          <p className="hero-copy">Your focused desktop workspace for logcat, saved logs,<br className="wide-break" /> EMV investigation and confident comparison.</p>
          <div className="site-actions"><a className="primary-button" href="/download" onClick={event => link(event, '/download')}><ArrowDownToLine size={17} />Get LogDeck <ArrowRight size={16} /></a><a className="secondary-button" href="/features" onClick={event => link(event, '/features')}>Explore features</a></div>
          <div className="trust-row"><span><ShieldCheck size={16} />Logs stay local</span><span><HardDrive size={16} />Offline-first viewing</span></div>
          <div className="site-preview" aria-label="Synthetic log preview">
            <header><span className="status-dot" />investigation.log <span className="small-badge">SYNTHETIC PREVIEW</span></header>
            <div className="preview-row preview-head"><span>LEVEL</span><span>TAG</span><span>MESSAGE</span></div>
            <div className="preview-row"><span>I</span><span>LogDeck</span><span>A clearer view of every line.</span></div>
            <div className="preview-row"><span>W</span><span>Payment</span><span>Tag 95: 8000000000 / inspect offline</span></div>
            <div className="preview-row"><span>D</span><span>Worker</span><span>Bounded records. Read-only source.</span></div>
            <footer>Illustration only. This website does not upload or view your logs.</footer>
          </div>
        </section>
        <FeatureCards />
        <section className="site-section site-callout"><div className="eyebrow">BUILT AROUND YOUR WORKFLOW</div><h2>Keep the context. Lose the noise.</h2><p>Filter in the sidebar, search displayed text, compare changes, and inspect global and company EMV references without rewriting your logs.</p>{nav('/download', 'Find your desktop download')}</section>
      </> : path === '/features' ? <>
        <section className="hero"><div className="eyebrow">FOCUSED TOOLS, ONE WORKSPACE</div><h1>Follow the story.<br /><span>Not the noise.</span></h1><p className="hero-copy">Real desktop features. Clear limits. No cloud upload required to inspect logs.</p></section>
        <FeatureCards />
        <section className="site-section detail-grid">
          <article className="tool-card"><h2>Filter. Search. Select.</h2><p>AND / OR / NOT expressions, <code>Core. -tag:Core.Dal</code>, isolated regex filtering and saved investigations. Top search highlights without hiding rows. Ctrl-click, complete-record copy and ordered export keep the context.</p></article>
          <article className="tool-card"><h2>Both kinds of EMV knowledge.</h2><p>60 bundled common global definitions work offline. Authorized company users manually download a versioned company pack from Settings. Both definitions appear when IDs overlap; proprietary meanings never replace the global reference.</p></article>
          <article className="tool-card"><h2>Tools for the details.</h2><p>TVR and supported bit editors show original and modified values. Responsive byte tables, bounded BER-TLV parsing and strict ASCII / lossless Latin-1 conversion help inspect receipt bytes.</p></article>
          <article className="tool-card"><h2>Local-first, honestly scoped.</h2><p>Worker-backed indexing and virtualized tables keep data bounded. Compare supports 10 MB / 100,000 lines per side. Full viewer 500 MB / 10-million-entry performance is not yet certified. No live ADB or exhaustive scheme database is claimed.</p></article>
        </section>
      </> : path === '/download' ? <section className="hero download-page">
        <div className="eyebrow">YOUR DESKTOP WORKSPACE</div><h1>Bring the focus<br /><span>to your machine.</span></h1>
        <p className="hero-copy">LogDeck preview / Windows 10 and 11</p>
        <article className="tool-card download-card"><ArrowDownToLine size={32} /><h2>LogDeck for Windows</h2>
          <p>A local-first Electron desktop app. Open saved UTF-8 .log and Android Studio .logcat exports without signing in.</p>
          {websiteRelease ? <div className="release-notes"><div className="eyebrow">LATEST RELEASE · {websiteRelease.latestVersion}</div><p>{websiteRelease.releaseNotes}</p><small>Published {new Date(websiteRelease.publishedAt).toLocaleDateString()}</small></div> :
            <p role="status">{releaseError || 'Loading release information...'}</p>}
          {url ? <a className="primary-button" href={url} rel="noopener noreferrer">Download Windows app</a> : <><button className="primary-button" disabled>Download not published yet</button><p role="status">A verified Windows release has not been linked. No portable EXE is available from this page yet.</p></>}
          {websiteRelease?.sha256 && <div className="release-notes"><p>SHA-256: <code className="release-checksum">{websiteRelease.sha256}</code></p><a href={websiteRelease.checksumUrl} rel="noopener noreferrer">Download checksum file</a></div>}
          {import.meta.env.VITE_WINDOWS_DOWNLOAD_URL && !url && <p role="alert">The configured download link is invalid. An HTTPS release URL is required.</p>}
          <p className="muted">Company tags require optional Firebase sign-in and active company membership. Logs remain on your machine.</p>
        </article>
        <p className="muted">Windows x64 portable EXE: save it in a permanent folder and run it, with no installation wizard. Optional Settings &gt; Open with LogDeck registration does not change default apps. After updating or moving the EXE, enable it again. Preferences and rebuildable caches use your Windows account folders, not the EXE folder. Unsigned builds can display a Windows SmartScreen warning; verify the publisher and checksum before running. macOS and Linux builds are not offered.</p>
      </section> : path === '/admin' ? <Admin /> : <section className="hero"><h1>Page not found.</h1>{nav('/', 'Back to LogDeck')}</section>}
    </main>
    <footer className="home-footer site-footer"><span>LogDeck / Your logs. Your machine.</span><div>{nav('/admin', 'Company admin')}<span> No log uploads. No analytics.</span></div></footer>
  </div>
}

function FeatureCards() {
  return <section className="features-section" aria-labelledby="features-title">
    <div className="section-heading"><div><div className="eyebrow">BUILT FOR THE INVESTIGATION</div><h2 id="features-title">A little less friction. A lot more focus.</h2></div><span className="version-badge">DESKTOP PREVIEW</span></div>
    <div className="feature-grid">{features.map(feature => <article className="feature-card" key={feature.name}><feature.icon size={23} className="feature-icon" /><span className="feature-status available">Desktop feature</span><h3>{feature.name}</h3><p>{feature.text}</p></article>)}</div>
  </section>
}
