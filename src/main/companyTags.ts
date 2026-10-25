import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { companyId, newerPack, parseTagPack, tagPackLimits, type CompanyTagPack } from '../../shared/companyTags'
import { FirebaseTags, type FirebaseTagConfig } from '../../shared/firebaseTags'
import type { CompanyTagStatus } from '../../shared/contracts'

export class CompanyTags {
  private clients = new Map<number, FirebaseTags>()
  private busy = new Set<number>()
  private installing = false
  private installed: CompanyTagPack | null = null
  private notice = 'No company pack installed. Global definitions are always available.'
  constructor(private path: string, private config: FirebaseTagConfig | null, private request: typeof fetch = fetch) {}

  async load() {
    try {
      const info = await stat(this.path)
      if (info.size > tagPackLimits.bytes) throw new Error('Cached tag pack exceeds 512 KB.')
      this.installed = parseTagPack(await readFile(this.path, 'utf8'))
      this.notice = 'Downloaded company pack loaded locally. No network check was made.'
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      this.notice = `Local company pack could not be loaded: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  status(owner: number): CompanyTagStatus {
    return { configured: this.config !== null, account: this.clients.get(owner)?.account ?? null, installed: this.installed, notice: this.notice }
  }
  close(owner: number) { this.clients.get(owner)?.signOut(); this.clients.delete(owner) }
  private client(owner: number) {
    if (!this.config) throw new Error('Firebase is not configured. Follow the Firebase setup guide before enabling cloud features.')
    let client = this.clients.get(owner)
    if (!client) { client = new FirebaseTags(this.config, this.request); this.clients.set(owner, client) }
    return client
  }
  private async exclusive<T>(owner: number, action: () => Promise<T>) {
    if (this.busy.has(owner)) throw new Error('A company-tag operation is already in progress.')
    this.busy.add(owner)
    try { return await action() }
    finally { this.busy.delete(owner) }
  }
  async signIn(owner: number, value: unknown) {
    return this.exclusive(owner, async () => {
      if (!value || typeof value !== 'object') throw new Error('Invalid sign-in request.')
      const input = value as Record<string, unknown>
      if (typeof input.email !== 'string' || typeof input.password !== 'string') throw new Error('Enter an email address and password.')
      await this.client(owner).signIn(input.email, input.password)
      return this.status(owner)
    })
  }
  async signOut(owner: number) {
    return this.exclusive(owner, async () => { this.close(owner); return this.status(owner) })
  }
  async download(owner: number, company: unknown, apply: (pack: CompanyTagPack | null) => Promise<void>) {
    return this.exclusive(owner, async () => {
      if (this.installing) throw new Error('Another window is installing company tags. Try again after it finishes.')
      this.installing = true
      let temporary: string | undefined
      try {
        const pack = await this.client(owner).download(companyId(company))
        if (!newerPack(this.installed, pack)) return { ...this.status(owner), notice: `Company pack v${pack.version} is already up to date.` }
        await mkdir(dirname(this.path), { recursive: true })
        temporary = `${this.path}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(pack), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        await apply(pack)
        try { await rename(temporary, this.path) }
        catch (error) { await apply(this.installed); throw error }
        temporary = undefined
        this.installed = pack
        this.notice = `Installed ${pack.name} v${pack.version}. Global and company definitions are both available offline.`
        return this.status(owner)
      } finally {
        this.installing = false
        if (temporary) {
          try { await unlink(temporary) }
          catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
        }
      }
    })
  }
}
