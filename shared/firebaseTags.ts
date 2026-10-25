import { companyId, parseTagPack, type CompanyTagPack } from './companyTags'

export interface FirebaseTagConfig { apiKey: string; projectId: string }
export interface FirebaseLogin { idToken: string; refreshToken: string; email: string; uid: string; expiresAt: number }
export interface Membership { role: 'admin' | 'member'; active: true }
interface FirestoreValue { stringValue?: string; integerValue?: string; booleanValue?: boolean }
interface FirestoreDocument { name: string; fields?: Record<string, FirestoreValue>; updateTime: string }

export function firebaseConfig(apiKey: unknown, projectId: unknown): FirebaseTagConfig | null {
  if (!apiKey && !projectId) return null
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(apiKey) ||
      typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Invalid Firebase configuration. Set both API key and project ID.')
  return { apiKey, projectId }
}

export class FirebaseTags {
  private login: FirebaseLogin | null = null
  constructor(private config: FirebaseTagConfig, private request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  get account() { return this.login ? { email: this.login.email, uid: this.login.uid } : null }
  signOut() { this.login = null }

  private async json(url: string, init: RequestInit, missing = false): Promise<unknown> {
    const response = await this.request(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: 'error' })
    if (missing && response.status === 404) return null
    if (!response.ok) {
      // Do not echo server bodies, credentials, tokens or company documents into UI/logs.
      if (response.status === 401 || response.status === 403) throw new Error('Access denied. Sign in again and verify your active company membership/role.')
      if (response.status === 409 || response.status === 412) throw new Error('Publication conflict. Reload the current version and publish a new higher version.')
      throw new Error(`Firebase request failed (${response.status}). Check credentials, configuration and connectivity.`)
    }
    const raw = await this.readBounded(response, 800_000)
    return JSON.parse(raw)
  }

  private async readBounded(response: Response, limit: number) {
    if (!response.body) throw new Error('Firebase returned an empty response.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    let output = ''
    try {
      for (;;) {
        const result = await reader.read()
        if (result.done) break
        bytes += result.value.length
        if (bytes > limit) { await reader.cancel(); throw new Error('Firebase response exceeds the supported size.') }
        output += decoder.decode(result.value, { stream: true })
      }
      return output + decoder.decode()
    } finally { reader.releaseLock() }
  }

  private authResult(value: unknown, email: string, refreshing: boolean): FirebaseLogin {
    const data = value as Record<string, unknown> | null
    const idToken = data?.[refreshing ? 'id_token' : 'idToken']
    const refreshToken = data?.[refreshing ? 'refresh_token' : 'refreshToken']
    const uid = data?.[refreshing ? 'user_id' : 'localId']
    const expires = Number(data?.[refreshing ? 'expires_in' : 'expiresIn'])
    if (typeof idToken !== 'string' || !idToken || typeof refreshToken !== 'string' || !refreshToken ||
        typeof uid !== 'string' || !uid || !Number.isFinite(expires) || expires < 1) throw new Error('Invalid authentication response.')
    return { idToken, refreshToken, uid, email, expiresAt: Date.now() + expires * 1000 }
  }

  async signIn(email: string, password: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 4096) throw new Error('Enter a valid email address and password.')
    const result = await this.json(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.config.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
    })
    this.login = this.authResult(result, email, false)
    return this.account!
  }

  private async token() {
    if (!this.login) throw new Error('Sign in before accessing company tags.')
    if (Date.now() >= this.login.expiresAt - 60_000) {
      const login = this.login
      try {
        const result = await this.json(`https://securetoken.googleapis.com/v1/token?key=${this.config.apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: login.refreshToken })
        })
        this.login = this.authResult(result, login.email, true)
      } catch (error) { this.login = null; throw error }
    }
    return this.login.idToken
  }

  private get root() { return `projects/${this.config.projectId}/databases/(default)/documents` }
  private async document(path: string, optional = false): Promise<FirestoreDocument | null> {
    return await this.json(`https://firestore.googleapis.com/v1/${this.root}/${path}`, {
      headers: { Authorization: `Bearer ${await this.token()}` }
    }, optional) as FirestoreDocument | null
  }

  async membership(company: string): Promise<Membership> {
    companyId(company)
    if (!this.login) throw new Error('Sign in before accessing company tags.')
    const doc = await this.document(`companies/${company}/members/${encodeURIComponent(this.login.uid)}`)
    const fields = doc?.fields
    if (fields?.active?.booleanValue !== true || !['member', 'admin'].includes(fields?.role?.stringValue ?? '')) throw new Error('No active company membership. Ask your administrator to grant access.')
    return { active: true, role: fields!.role.stringValue as Membership['role'] }
  }

  private async current(company: string) {
    const doc = await this.document(`companies/${company}/catalog/current`, true)
    if (!doc) return null
    const version = Number(doc.fields?.version?.integerValue)
    if (!Number.isSafeInteger(version) || version < 1 || !doc.updateTime) throw new Error('Invalid company catalog metadata.')
    return { version, updateTime: doc.updateTime }
  }

  async download(company: string): Promise<CompanyTagPack> {
    await this.membership(company)
    const current = await this.current(company)
    if (!current) throw new Error('No tag pack has been published for this company.')
    const doc = await this.document(`companies/${company}/packs/${current.version}`)
    const json = doc?.fields?.json?.stringValue
    if (typeof json !== 'string') throw new Error('Published tag pack is missing.')
    const pack = parseTagPack(json)
    if (pack.companyId !== company || pack.version !== current.version) throw new Error('Published tag-pack identity/version does not match the catalog.')
    return pack
  }

  async publish(raw: string): Promise<CompanyTagPack> {
    const pack = parseTagPack(raw)
    const membership = await this.membership(pack.companyId)
    if (membership.role !== 'admin') throw new Error('Only an active company administrator may publish tag packs.')
    const current = await this.current(pack.companyId)
    if (current && pack.version <= current.version) throw new Error(`Publish a version higher than ${current.version}. Existing versions are immutable.`)
    const prefix = `${this.root}/companies/${pack.companyId}`
    await this.json(`https://firestore.googleapis.com/v1/${this.root}:commit`, {
      method: 'POST', headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: [
        { update: { name: `${prefix}/packs/${pack.version}`, fields: {
          json: { stringValue: JSON.stringify(pack) }, companyId: { stringValue: pack.companyId }, version: { integerValue: String(pack.version) }
        } }, currentDocument: { exists: false } },
        { update: { name: `${prefix}/catalog/current`, fields: { version: { integerValue: String(pack.version) } } },
          currentDocument: current ? { updateTime: current.updateTime } : { exists: false } }
      ] })
    })
    return pack
  }
}
