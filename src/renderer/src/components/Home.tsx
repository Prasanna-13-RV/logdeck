import { ArrowDownToLine, ArrowRight, Columns2, FileText, FolderOpen, HardDrive, Layers3, Search, ShieldCheck, Sparkles, Upload } from 'lucide-react'
import brandPortrait from '../../../../images/brand-portrait.png'
import brandMark from '../../../../images/brand-mark.png'

export const features = [
  { icon: FileText, name: 'A clearer view of every line', text: 'A virtualized table with whole-table scrolling, optional wrapping, independent tabs, and severity colors.', status: 'Available', className: 'available' },
  { icon: Search, name: 'Find the signal', text: 'Expressions or isolated regex, saved investigations, independent splits, column controls, and full-record export.', status: 'Available', className: 'available' },
  { icon: Layers3, name: 'Understand EMV locally', text: 'Local TLV parsing and original-versus-edited tag values. Scheme-aware decoding with unverified layouts explicitly identified.', status: 'Available', className: 'available' },
  { icon: Columns2, name: 'Compare with confidence', text: 'Independent editable panes, line/word differences, undo/redo and safe saves. UTF-8 text up to 10 MB / 100,000 lines per side.', status: 'Available', className: 'available' }
]

export function Home({ busy, onOpen, onDemo, onDrop }: {
  busy: boolean; onOpen: () => void; onDemo: () => void; onDrop: (files: File[]) => void
}) {
  return (
    <main className="home">
      <section className="hero">
        <img className="page-brand-logo" src={brandMark} alt="LogDeck" width={160} height={160} />
        <div className="eyebrow"><span className="status-dot" /> YOUR LOGS. YOUR MACHINE.</div>
        <h1>Less noise.<br /><span>More understanding.</span></h1>
        <p className="hero-copy">A focused workspace for your logs. Open a file, follow the story,<br className="wide-break" /> and get back to building.</p>
        <div className="drop-zone" aria-label="Drop a log file"
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; event.currentTarget.classList.add('drag-active') }}
          onDragLeave={event => event.currentTarget.classList.remove('drag-active')}
          onDrop={event => {
            event.preventDefault()
            event.currentTarget.classList.remove('drag-active')
            onDrop(Array.from(event.dataTransfer.files))
          }}>
          <div className="upload-icon"><Upload size={27} strokeWidth={1.5} /></div>
          <h2>{busy ? 'Opening your workspace...' : 'Drop your log file here'}</h2>
          <p>Local files. No upload. No account required.</p>
          <button className="primary-button" onClick={onOpen} disabled={busy}><FolderOpen size={16} /> Browse files <ArrowRight size={16} /></button>
          <div className="file-types"><span>.log</span><span>.logcat</span><span className="muted">UTF-8 &middot; saved files</span></div>
        </div>
        <button className="text-button demo-link" onClick={onDemo} disabled={busy}>
          <Sparkles size={15} /> Just looking around? Open a synthetic demo <ArrowRight size={14} />
        </button>
        <div className="trust-row"><span><ShieldCheck size={15} /> Private by design</span><span><HardDrive size={15} /> Works offline</span><span><ArrowDownToLine size={15} /> Read-only source logs</span></div>
      </section>
      <section className="features-section" id="features" aria-labelledby="features-title">
        <div className="section-heading"><div><div className="eyebrow">BUILT FOR THE INVESTIGATION</div><h2 id="features-title">A little less friction. A lot more focus.</h2></div><span className="version-badge">WORKSPACE PREVIEW &middot; 0.1</span></div>
        <div className="feature-grid">{features.map(feature => (
          <article className="feature-card" key={feature.name}>
            <feature.icon size={22} className="feature-icon" />
            <span className={`feature-status ${feature.className}`}>{feature.status}</span>
            <h3>{feature.name}</h3><p>{feature.text}</p>
          </article>
        ))}</div>
      </section>
      <footer className="home-footer"><span className="footer-brand"><img src={brandPortrait} alt="" />LogDeck <span className="muted"> / A local-first developer workspace</span></span><span className="muted">Optional company tags in Settings / Live ADB: later release</span></footer>
    </main>
  )
}
