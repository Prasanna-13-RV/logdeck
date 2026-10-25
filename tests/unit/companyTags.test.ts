import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newerPack, parseTagPack, type CompanyTagPack } from '../../shared/companyTags'
import { FirebaseTags, firebaseConfig } from '../../shared/firebaseTags'
import { CompanyTags } from '../../src/main/companyTags'
import { trackEmv } from '../../shared/emvTracker'
import { emvDefinition } from '../../shared/emvDictionary'

const pack: CompanyTagPack = { schemaVersion: 1, companyId: 'test-company', version: 1, name: 'Synthetic tags', tags: [
  { tag: 'DF8101', name: 'Company status', description: 'Synthetic definition', bytes: 2 },
  { tag: '9F33', name: 'Company capabilities', description: 'Company-specific context', bytes: 1 }
] }
const config = { apiKey: 'synthetic-public-api-key', projectId: 'demo-logdeck' }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }) }
function cloud(options: { pack?: CompanyTagPack; role?: string; version?: number; status?: number; expires?: string } = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes('signInWithPassword')) return json({ idToken: 'synthetic-id', refreshToken: 'synthetic-refresh', localId: 'test-user', expiresIn: options.expires ?? '3600' })
    if (url.includes('securetoken')) return json({ id_token: 'refreshed-id', refresh_token: 'refreshed-refresh', user_id: 'test-user', expires_in: '3600' })
    if (options.status) return json({ error: 'Not exposed' }, options.status)
    if (url.includes('/members/')) return json({ fields: { active: { booleanValue: true }, role: { stringValue: options.role ?? 'admin' } } })
    if (url.includes('/catalog/')) return json({ fields: { version: { integerValue: String(options.version ?? options.pack?.version ?? 1) } }, updateTime: '2026-01-01T00:00:00Z' })
    if (url.includes('/packs/')) return json({ fields: { json: { stringValue: JSON.stringify(options.pack ?? pack) } } })
    if (url.endsWith(':commit')) return json({ writeResults: [] })
    throw new Error(`Unexpected synthetic request: ${url}`)
  })
}

afterEach(() => vi.restoreAllMocks())
describe('validated company definitions', () => {
  it('normalizes IDs, strips unknown fields, preserves optional lengths and rejects malformed packs', () => {
    const parsed = parseTagPack(JSON.stringify({ ...pack, extra: 'ignored', tags: [{ ...pack.tags[0], tag: 'df8101', arbitrary: 'ignored' }] }))
    expect(parsed.tags[0]).toEqual(pack.tags[0])
    expect(parsed).not.toHaveProperty('extra')
    for (const value of [
      { ...pack, schemaVersion: 2 }, { ...pack, companyId: '../private' }, { ...pack, version: 0 },
      { ...pack, tags: [] }, { ...pack, tags: [...pack.tags, pack.tags[0]] },
      { ...pack, tags: [{ ...pack.tags[0], bytes: -1 }] },
      { ...pack, tags: [{ ...pack.tags[0], name: 'bad\nname' }] },
      { ...pack, tags: [{ ...pack.tags[0], sensitive: 'yes' }] },
      { ...pack, tags: Array(1001).fill(pack.tags[0]) }
    ]) expect(() => parseTagPack(JSON.stringify(value))).toThrow()
    expect(() => parseTagPack(' '.repeat(512001))).toThrow('512 KB')
  })
  it('requires immutable equal versions and blocks downgrade while allowing a deliberate company switch', () => {
    expect(newerPack(null, pack)).toBe(true)
    expect(newerPack(pack, structuredClone(pack))).toBe(false)
    expect(newerPack(pack, { ...pack, version: 2 })).toBe(true)
    expect(() => newerPack({ ...pack, version: 2 }, pack)).toThrow('Downgrades')
    expect(() => newerPack(pack, { ...pack, name: 'Modified same version' })).toThrow('immutable')
    expect(newerPack(pack, { ...pack, companyId: 'second-company' })).toBe(true)
  })
  it('recognizes company-only pairs without replacing global validation or meaning', () => {
    expect(trackEmv('DF8101: AABB').occurrences).toHaveLength(0)
    const result = trackEmv('DF8101: AABB; 9F33: E0F8C8', false, pack.tags)
    expect(result.occurrences.map(item => item.tag)).toEqual(['DF8101', '9F33'])
    expect(result.occurrences[1].status).toBe('valid')
    expect(emvDefinition('9F33')?.bytes).toBe(3)
    expect(emvDefinition('9F33')?.name).not.toBe('Company capabilities')
  })
})

describe('bounded Firebase REST contract (mocked network, not rule evidence)', () => {
  it('remains unconfigured without a project and never exposes token state', async () => {
    expect(firebaseConfig('', '')).toBeNull()
    expect(() => firebaseConfig(config.apiKey, '')).toThrow('configuration')
    const request = cloud()
    const client = new FirebaseTags(config, request)
    await expect(client.download(pack.companyId)).rejects.toThrow('Sign in')
    expect(request).not.toHaveBeenCalled()
    await client.signIn('test@example.invalid', 'synthetic-password')
    expect(client.account).toEqual({ email: 'test@example.invalid', uid: 'test-user' })
    expect(await client.download(pack.companyId)).toEqual(pack)
    client.signOut()
    expect(client.account).toBeNull()
    await expect(client.download(pack.companyId)).rejects.toThrow('Sign in')
  })
  it('refreshes expired credentials, rechecks membership, rejects mismatched catalog and denied access', async () => {
    const request = cloud({ expires: '1' })
    const client = new FirebaseTags(config, request)
    await client.signIn('test@example.invalid', 'synthetic-password')
    await client.download(pack.companyId)
    expect(request.mock.calls.some(([url]) => String(url).includes('securetoken'))).toBe(true)
    const mismatched = new FirebaseTags(config, cloud({ version: 2 }))
    await mismatched.signIn('test@example.invalid', 'synthetic-password')
    await expect(mismatched.download(pack.companyId)).rejects.toThrow('identity/version')
    const denied = new FirebaseTags(config, cloud({ status: 403 }))
    await denied.signIn('test@example.invalid', 'synthetic-password')
    await expect(denied.download(pack.companyId)).rejects.toThrow('Access denied')
    const invalidRole = new FirebaseTags(config, cloud({ role: 'owner' }))
    await invalidRole.signIn('test@example.invalid', 'synthetic-password')
    await expect(invalidRole.download(pack.companyId)).rejects.toThrow('membership')
  })
  it('requires admin and a higher version, publishing pack and catalog with atomic preconditions', async () => {
    const request = cloud()
    const client = new FirebaseTags(config, request)
    await client.signIn('test@example.invalid', 'synthetic-password')
    await expect(client.publish(JSON.stringify(pack))).rejects.toThrow('higher than 1')
    await client.publish(JSON.stringify({ ...pack, version: 2 }))
    const commit = request.mock.calls.find(([url]) => String(url).endsWith(':commit'))!
    const body = JSON.parse(String(commit[1]?.body))
    expect(body.writes).toHaveLength(2)
    expect(body.writes[0].currentDocument).toEqual({ exists: false })
    expect(body.writes[1].currentDocument).toEqual({ updateTime: '2026-01-01T00:00:00Z' })
    const member = new FirebaseTags(config, cloud({ role: 'member' }))
    await member.signIn('test@example.invalid', 'synthetic-password')
    await expect(member.publish(JSON.stringify({ ...pack, version: 2 }))).rejects.toThrow('administrator')
  })
  it('rejects oversized and malformed responses without echoing server secrets', async () => {
    const oversized = new FirebaseTags(config, vi.fn(async () => new Response('x'.repeat(800001))))
    await expect(oversized.signIn('test@example.invalid', 'synthetic-password')).rejects.toThrow('supported size')
    const malformed = new FirebaseTags(config, vi.fn(async () => json({})))
    await expect(malformed.signIn('test@example.invalid', 'synthetic-password')).rejects.toThrow('authentication response')
    const failure = new FirebaseTags(config, vi.fn(async () => json({ secret: 'never-display' }, 400)))
    await expect(failure.signIn('test@example.invalid', 'synthetic-password')).rejects.not.toThrow('never-display')
  })
})

describe('manual cache installation', () => {
  it('restores the prior worker state and cleans only its temporary file if persistence fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logdeck-company-rollback-'))
    const path = join(directory, 'company-emv-tags.json')
    try {
      await mkdir(path)
      const service = new CompanyTags(path, config, cloud())
      await service.signIn(1, { email: 'test@example.invalid', password: 'synthetic-password' })
      const apply = vi.fn(async (_pack: CompanyTagPack | null) => {})
      await expect(service.download(1, pack.companyId, apply)).rejects.toThrow()
      expect(apply.mock.calls).toEqual([[pack], [null]])
      expect(service.status(1).installed).toBeNull()
      expect(await readdir(directory)).toEqual(['company-emv-tags.json'])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('persists only validated downloads, retains offline state after logout/restart, and rolls back failed apply', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logdeck-company-'))
    const path = join(directory, 'company-emv-tags.json')
    try {
      const request = cloud()
      const service = new CompanyTags(path, config, request)
      await service.load()
      expect(request).not.toHaveBeenCalled()
      expect(service.status(1).installed).toBeNull()
      await service.signIn(1, { email: 'test@example.invalid', password: 'synthetic-password' })
      const apply = vi.fn(async () => {})
      await service.download(1, pack.companyId, apply)
      expect(apply).toHaveBeenCalledWith(pack)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(pack)
      await service.download(1, pack.companyId, apply)
      expect(apply).toHaveBeenCalledTimes(1)
      await service.signOut(1)
      expect(service.status(1).installed).toEqual(pack)
      expect(service.status(1).account).toBeNull()
      const offline = new CompanyTags(path, null)
      await offline.load()
      expect(offline.status(9).installed).toEqual(pack)
      await expect(offline.download(9, pack.companyId, apply)).rejects.toThrow('not configured')
      const upgrade = new CompanyTags(path, config, cloud({ pack: { ...pack, version: 2 } }))
      await upgrade.load()
      await upgrade.signIn(2, { email: 'test@example.invalid', password: 'synthetic-password' })
      await expect(upgrade.download(2, pack.companyId, async () => { throw new Error('Synthetic apply failure') })).rejects.toThrow('apply failure')
      expect(upgrade.status(2).installed?.version).toBe(1)
      expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1)
      await writeFile(path, 'invalid JSON')
      const corrupted = new CompanyTags(path, null)
      await corrupted.load()
      expect(corrupted.status(9).installed).toBeNull()
      expect(corrupted.status(9).notice).toContain('could not be loaded')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
