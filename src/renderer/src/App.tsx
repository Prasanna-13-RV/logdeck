import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Calculator, Columns2, FolderOpen, Monitor, Moon, Plus, Settings2, ShieldCheck, Sun, UserRound, X, AppWindow, CreditCard } from 'lucide-react'
import type { Result, SessionInfo, Theme } from '../../../shared/contracts'
import { useWorkspace } from './state'
import { Home } from './components/Home'
import { SplitWorkspace } from './components/SplitWorkspace'
import { LocalSettings } from './components/LocalSettings'
import { Modal } from './components/Modal'
import { ConversionTool, EmvTool } from './components/Tools'
import type { EmvSeed } from '../../../shared/emvTracker'

const Compare = lazy(() => import('./components/Compare'))
type Dialog = 'login' | 'settings' | null
type Tab = { id: string; kind: 'home' | 'calculator' | 'emv' | 'compare'; seed?: EmvSeed } | { id: string; kind: 'log'; session: SessionInfo; second?: SessionInfo }
const themeOptions: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor }
]
const title = (tab: Tab) => tab.kind === 'log' ? tab.session.name : tab.kind === 'home' ? 'New tab' : tab.kind === 'calculator' ? 'Hex / ASCII' : tab.kind === 'compare' ? 'Text Compare' : 'EMV workspace'

export function App() {
  const { theme, setTheme } = useWorkspace()
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'home', kind: 'home' }])
  const [active, setActive] = useState('home')
  const tabsRef = useRef(tabs)
  const activeRef = useRef(active)
  tabsRef.current = tabs
  activeRef.current = active
  const knownSessions = useRef(new Set<string>())
  const closedSessions = useRef(new Set<string>())
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [appearanceReady, setAppearanceReady] = useState(false)
  const openingHome = useRef<string | null>(null)
  const compareState = useRef(new Map<string, { dirty: boolean; busy: boolean }>())
  const splitting = useRef(false)
  const compareStatus = useCallback((id: string, dirty: boolean, busy: boolean) => { compareState.current.set(id, { dirty, busy }) }, [])

  const receive = useCallback((info: SessionInfo) => {
    if (closedSessions.current.has(info.id)) return
    const first = !knownSessions.current.has(info.id)
    knownSessions.current.add(info.id)
    const home = openingHome.current ?? activeRef.current
    setTabs(previous => {
      const parent = previous.find(tab => tab.kind === 'log' && tab.second?.id === info.id)
      if (parent?.kind === 'log') return previous.map(tab => tab.id === parent.id ? { ...parent, second: info } : tab)
      const existing = previous.find(tab => tab.id === info.id)
      if (existing?.kind === 'log') return previous.map(tab => tab.id === info.id ? { ...existing, session: info } : tab)
      const next: Tab = { id: info.id, kind: 'log', session: info }
      if (previous.some(tab => tab.id === home && tab.kind === 'home')) return previous.map(tab => tab.id === home ? next : tab)
      return [...previous, next]
    })
    if (first) setActive(info.id)
  }, [])

  const removeTab = useCallback((id: string) => {
    const previous = tabsRef.current
    const parent = previous.find(tab => tab.kind === 'log' && tab.second?.id === id)
    if (parent?.kind === 'log') { setTabs(previous.map(tab => tab.id === parent.id ? { ...parent, second: undefined } : tab)); return }
    const index = previous.findIndex(tab => tab.id === id)
    if (index === -1) return
    let remaining = previous.filter(tab => tab.id !== id)
    if (!remaining.length) remaining = [{ id: crypto.randomUUID(), kind: 'home' }]
    setTabs(remaining)
    if (activeRef.current === id) setActive(remaining[Math.min(index, remaining.length - 1)].id)
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('logdeck-theme')
      if (saved === 'dark' || saved === 'light' || saved === 'system') setTheme(saved)
    } catch { setError('Appearance preferences could not be loaded. This session still works.') }
    setAppearanceReady(true)
    const unsubscribe = window.logdeck.onProgress(receive)
    const closed = window.logdeck.onClosed(id => {
      closedSessions.current.add(id)
      knownSessions.current.delete(id)
      removeTab(id)
    })
    void window.logdeck.getSessions().then(async result => {
      if (!result.ok) { setError(result.error); return }
      result.value.forEach(receive)
      const current = await window.logdeck.getSession()
      if (!current.ok) setError(current.error)
      else if (current.value) setActive(current.value.id)
    }).catch(error => setError(String(error)))
    return () => { unsubscribe(); closed() }
  }, [receive, removeTab, setTheme])

  const current = tabs.find(tab => tab.id === active)
  useEffect(() => {
    document.title = `${current ? title(current) : 'New tab'} - LogDeck`
    if (current?.kind === 'log') {
      void window.logdeck.activateSession(current.id).then(result => { if (!result.ok) setError(result.error) }).catch(error => setError(String(error)))
    }
  }, [active, current?.kind === 'log' ? current.session.name : current?.kind])

  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? system.matches ? 'dark' : 'light' : theme }
    apply()
    system.addEventListener('change', apply)
    if (appearanceReady) {
      try { localStorage.setItem('logdeck-theme', theme) }
      catch { setError('Appearance could not be saved. Your change applies for this session only.') }
    }
    return () => system.removeEventListener('change', apply)
  }, [theme, appearanceReady])

  const newTab = useCallback((kind: 'home' | 'calculator' | 'emv' | 'compare' = 'home', seed?: EmvSeed) => {
    if (kind === 'compare' && tabsRef.current.filter(tab => tab.kind === 'compare').length >= 2) { setError('Two Compare workspaces are already open. Close one before opening another.'); return }
    if (tabsRef.current.length >= 20) { setError('Close a tab or use a new window (20 tabs per window).'); return }
    const tab: Tab = { id: crypto.randomUUID(), kind, seed }
    setTabs(previous => [...previous, tab])
    setActive(tab.id)
  }, [])
  const closeTab = useCallback(async (id: string) => {
    const tab = tabsRef.current.find(tab => tab.id === id)
    if (tab?.kind === 'compare') {
      const state = compareState.current.get(id)
      if (state?.busy) { setError('Wait for the Compare file operation before closing this tab.'); return }
      if (state?.dirty) {
        const decision = await window.logdeck.confirmDiscard()
        if (!decision.ok) { setError(decision.error); return }
        if (!decision.value) return
      }
      compareState.current.delete(id)
    }
    if (tab?.kind === 'log') {
      if (tab.second) {
        const closed = await window.logdeck.closeFile(tab.second.id)
        if (!closed.ok) { setError(closed.error); return }
      }
      const result = await window.logdeck.closeFile(id)
      if (!result.ok) { setError(result.error); return }
    }
    removeTab(id)
  }, [removeTab])
  async function splitTab(id: string) {
    if (splitting.current) return
    const tab = tabsRef.current.find(tab => tab.id === id)
    if (tab?.kind !== 'log' || tab.second) return
    splitting.current = true
    try {
      const result = await window.logdeck.duplicateSession(id)
      if (!result.ok) { setError(result.error); return }
      knownSessions.current.add(result.value.id)
      if (!tabsRef.current.some(value => value.id === id)) {
        const closed = await window.logdeck.closeFile(result.value.id)
        if (!closed.ok) setError(closed.error)
        return
      }
      setTabs(previous => previous.map(value => value.id === id && value.kind === 'log' ? { ...value, second: result.value } : value))
    } catch (error) { setError(String(error)) }
    finally { splitting.current = false }
  }
  const open = useCallback(async (action: () => Promise<Result<SessionInfo | null>>) => {
    if (busy) return
    if (tabsRef.current.length >= 20 && !tabsRef.current.some(tab => tab.id === activeRef.current && tab.kind === 'home')) {
      setError('Close a tab or open a new window before opening another file.')
      return
    }
    setBusy(true)
    setError(null)
    openingHome.current = activeRef.current
    try {
      const result = await action()
      if (!result.ok) setError(result.error)
      else if (result.value) {
        // Worker progress can arrive before the open reply; retain newer counts.
        const latest = tabsRef.current.find(tab => tab.id === result.value?.id)
        receive(latest?.kind === 'log' && latest.session.lines >= result.value.lines ? latest.session : result.value)
        setActive(result.value.id)
      }
    } catch (error) { setError(`Could not open the file: ${String(error)}`) }
    finally { setBusy(false); openingHome.current = null }
  }, [busy, receive])
  const pick = useCallback(() => void open(() => window.logdeck.openFile()), [open])
  const newWindow = () => void window.logdeck.newWindow().then(result => { if (!result.ok) setError(result.error) }).catch(error => setError(String(error)))
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key === 'o') { event.preventDefault(); pick() }
      if (key === 't') { event.preventDefault(); newTab() }
      if (key === 'w') { event.preventDefault(); void closeTab(activeRef.current).catch(error => setError(String(error))) }
      if (key === 'tab') {
        event.preventDefault()
        const list = tabsRef.current
        const index = list.findIndex(tab => tab.id === activeRef.current)
        setActive(list[(index + (event.shiftKey ? -1 : 1) + list.length) % list.length].id)
      }
    }
    const preventDrop = (event: DragEvent) => event.preventDefault()
    window.addEventListener('keydown', keyboard)
    window.addEventListener('dragover', preventDrop)
    window.addEventListener('drop', preventDrop)
    return () => {
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('dragover', preventDrop)
      window.removeEventListener('drop', preventDrop)
    }
  }, [pick, newTab, closeTab])
  const showHome = (features = false) => {
    const home = tabsRef.current.find(tab => tab.kind === 'home')
    if (home) setActive(home.id)
    else newTab()
    if (features) requestAnimationFrame(() => requestAnimationFrame(() => {
      const visible = document.querySelector('.tab-panel:not([hidden]) #features')
      visible?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }))
  }
  return (
    <div className="app-shell">
      <header className="navbar">
        <button className="brand" aria-label="LogDeck home" onClick={() => showHome()}><span className="brand-mark"><Activity size={23} /></span><span>LogDeck<span className="brand-period">.</span></span></button>
        <nav aria-label="Main navigation">
          <button className="nav-link" onClick={() => showHome(true)}>Features</button>
          <button className="nav-link" onClick={() => newTab('emv')}><CreditCard size={15} /> EMV</button>
          <button className="nav-link" onClick={() => newTab('calculator')}><Calculator size={15} /> Hex / ASCII</button>
          <button className="nav-link" onClick={() => newTab('compare')}><Columns2 size={15} /> Compare</button>
        </nav>
        <div className="navbar-actions">
          <button className="nav-open" onClick={pick} disabled={busy}><FolderOpen size={16} /> Open file</button>
          <button className="icon-button" aria-label="New window" title="New window (Ctrl+N)" onClick={newWindow}><AppWindow size={18} /></button>
          <button className="icon-button" aria-label="Appearance and settings" onClick={() => setDialog('settings')}><Settings2 size={18} /></button>
          <button className="icon-button" aria-label={`Theme: ${theme}. Switch theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}>{theme === 'system' ? <Monitor size={18} /> : theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}</button>
          <button className="login-button" onClick={() => setDialog('login')}><UserRound size={15} />Login<span className="small-badge">COMING LATER</span></button>
        </div>
      </header>
      <div className="browser-tabs" role="tablist" aria-label="Workspace tabs">
        {tabs.map(tab => <div className={`browser-tab ${tab.id === active ? 'active' : ''}`} key={tab.id}>
          <button role="tab" aria-selected={tab.id === active} aria-controls={`panel-${tab.id}`} id={`tab-${tab.id}`} title={title(tab)} onClick={() => setActive(tab.id)}>{title(tab)}{tab.kind === 'log' && tab.session.synthetic && <span className="synthetic-label">SYNTHETIC</span>}</button>
          <button className="icon-button" aria-label={tab.kind === 'log' ? 'Close file' : `Close ${title(tab)}`} title={`Close ${title(tab)} (Ctrl+W)`} onClick={() => void closeTab(tab.id).catch(error => setError(String(error)))}><X size={13} /></button>
        </div>)}
        <button className="icon-button" aria-label="New tab" title="New tab (Ctrl+T)" onClick={() => newTab()}><Plus size={17} /></button>
      </div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={16} /></button></div>}
      {tabs.map(tab => <section className="tab-panel" role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={tab.id !== active} key={tab.id}>
        {tab.kind === 'log' ? <SplitWorkspace session={tab.session} second={tab.second} active={tab.id === active} onError={setError} onEmv={seed => newTab('emv', seed)} onSplit={() => void splitTab(tab.id)} onCloseSplit={() => {
          if (tab.second) void window.logdeck.closeFile(tab.second.id).then(result => { if (!result.ok) setError(result.error) }).catch(error => setError(String(error)))
        }} /> : tab.kind === 'compare' ? <Suspense fallback={<div role="status">Loading local Compare editor...</div>}><Compare tabId={tab.id} active={tab.id === active} onStatus={compareStatus} onError={setError} /></Suspense> :
          tab.kind === 'calculator' ? <ConversionTool /> : tab.kind === 'emv' ? <EmvTool seed={tab.seed} /> :
          <Home busy={busy} onOpen={pick} onDemo={() => void open(() => window.logdeck.openDemo())} onDrop={files => {
            if (files.length !== 1) { setError('Drop exactly one .log or .logcat file at a time.'); return }
            try {
              const path = window.logdeck.pathForFile(files[0])
              if (!path) { setError('This drop does not refer to a local file. Use Browse files instead.'); return }
              void open(() => window.logdeck.openDroppedFile(path))
            } catch (error) { setError(`Could not read the dropped file: ${String(error)}`) }
          }} />}
      </section>)}
      {dialog && <Modal title={dialog === 'login' ? 'Your workspace needs no account' : 'Make yourself at home'} onClose={() => setDialog(null)}>
        {dialog === 'settings' ? <>
          <p className="muted">Choose your appearance. Your preference stays on this machine.</p>
          <div className="theme-options">{themeOptions.map(option => <button className={`theme-option ${theme === option.value ? 'chosen' : ''}`} aria-pressed={theme === option.value} key={option.value} onClick={() => setTheme(option.value)}><option.icon size={23} />{option.label}</button>)}</div>
          <div className="settings-note"><ShieldCheck size={18} /><span>Log files stay local. No telemetry, login, or network connection is required.</span></div>
          <LocalSettings onError={setError} />
          <h3>Keyboard shortcuts</h3><div className="shortcut-list"><span>Open file<kbd>Ctrl O</kbd></span><span>New tab / close tab<kbd>Ctrl T / W</kbd></span><span>Next / previous tab<kbd>Ctrl (Shift) Tab</kbd></span><span>New independent window<kbd>Ctrl N</kbd></span><span>Find<kbd>Ctrl F</kbd></span><span>Go to source line / record<kbd>Ctrl G</kbd></span><span>Copy selected records<kbd>Ctrl Shift C</kbd></span><span>Extend record selection<kbd>Shift click / Enter</kbd></span><span>Resize focused column separator<kbd>Left / Right</kbd></span><span>Next / previous matching record<kbd>(Shift) F3</kbd></span><span>Compare undo / redo<kbd>Ctrl Z / Y</kbd></span><span>Close dialog<kbd>Esc</kbd></span></div>
        </> : <>
          <p>Firebase authentication will be introduced in a later release for account-connected features.</p><p className="muted">You can open and inspect saved logs without signing in. This preview does not collect credentials or pretend to authenticate.</p>
        </>}
      </Modal>}
    </div>
  )
}
