import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (host !== '127.0.0.1:8088') throw new Error('Rules tests require the dedicated local Firestore emulator at 127.0.0.1:8088. Use npm run test:rules.')
const root = 'projects/demo-logdeck/databases/(default)/documents'
const base = `http://${host}/v1/${root}`
const documents = new Set<string>()
let company: string
function token(uid: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: uid, user_id: uid, aud: 'demo-logdeck', iss: 'https://securetoken.google.com/demo-logdeck',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
    firebase: { sign_in_provider: 'custom', identities: {} }
  })}.`
}
function headers(uid?: string) { return { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid === 'owner' ? 'owner' : token(uid)}` } : {}) } }
async function seed(path: string, fields: unknown) {
  documents.add(path)
  const response = await fetch(`${base}/${path}`, { method: 'PATCH', headers: headers('owner'), body: JSON.stringify({ fields }) })
  expect(response.status, await response.text()).toBe(200)
}
async function get(path: string, uid?: string) { return fetch(`${base}/${path}`, { headers: headers(uid) }) }
function writes(version: number) {
  const packPath = `companies/${company}/packs/${version}`
  const catalogPath = `companies/${company}/catalog/current`
  documents.add(packPath); documents.add(catalogPath)
  return [
    { update: { name: `${root}/${packPath}`, fields: {
      companyId: { stringValue: company }, version: { integerValue: String(version) }, json: { stringValue: '{"synthetic":true}' }
    } }, currentDocument: { exists: false } },
    { update: { name: `${root}/${catalogPath}`, fields: { version: { integerValue: String(version) } } } }
  ]
}
async function commit(uid: string, batch: unknown[]) {
  return fetch(`${base}:commit`, { method: 'POST', headers: headers(uid), body: JSON.stringify({ writes: batch }) })
}
beforeEach(async () => {
  company = `rules-${randomUUID()}`
  for (const [uid, role, active] of [['admin', 'admin', true], ['member', 'member', true], ['inactive', 'admin', false]] as const) {
    await seed(`companies/${company}/members/${uid}`, { role: { stringValue: role }, active: { booleanValue: active } })
  }
})
afterEach(async () => {
  for (const path of documents) {
    const response = await fetch(`${base}/${path}`, { method: 'DELETE', headers: headers('owner') })
    expect([200, 404]).toContain(response.status)
  }
  documents.clear()
})
describe('deployed rules evaluated by local Firestore emulator', () => {
  it('isolates company reads and denies self-granted membership, enumeration, and member publication', async () => {
    expect((await commit('admin', writes(1))).status).toBe(200)
    const path = `companies/${company}/packs/1`
    expect((await get(path, 'member')).status).toBe(200)
    for (const uid of [undefined, 'outsider', 'inactive']) expect((await get(path, uid)).status).toBe(403)
    expect((await get(`companies/${company}/packs`, 'member')).status).toBe(403)
    expect((await get(`companies/${company}/members/member`, 'member')).status).toBe(200)
    expect((await get(`companies/${company}/members/admin`, 'member')).status).toBe(403)
    const selfGrant = await fetch(`${base}/companies/${company}/members/outsider`, {
      method: 'PATCH', headers: headers('outsider'), body: JSON.stringify({ fields: { role: { stringValue: 'admin' }, active: { booleanValue: true } } })
    })
    expect(selfGrant.status).toBe(403)
    expect((await commit('member', writes(2))).status).toBe(403)
    expect((await commit('inactive', writes(2))).status).toBe(403)
    expect((await get(`companies/${company}/catalog/current`, 'member')).status).toBe(200)
  })
  it('requires atomic matching publication, immutable versions, and strictly increasing catalog values', async () => {
    const first = writes(1)
    expect((await commit('admin', [first[0]])).status).toBe(403)
    expect((await commit('admin', [first[1]])).status).toBe(403)
    expect((await commit('admin', first)).status).toBe(200)
    const next = writes(2)
    expect((await commit('admin', next)).status).toBe(200)
    const read = await get(`companies/${company}/catalog/current`, 'member')
    expect((await read.json()).fields.version.integerValue).toBe('2')
    expect((await commit('admin', writes(1))).status).not.toBe(200)
    const modified = { update: first[0].update }
    expect((await commit('admin', [modified])).status).toBe(403)
    const deleted = await fetch(`${base}/companies/${company}/packs/2`, { method: 'DELETE', headers: headers('admin') })
    expect(deleted.status).toBe(403)
    const mismatch = writes(3)
    mismatch[0].update.fields.companyId = { stringValue: 'another-company' }
    expect((await commit('admin', mismatch)).status).toBe(403)
  })
  it('rejects stale catalog preconditions atomically without leaving an orphan pack', async () => {
    expect((await commit('admin', writes(1))).status).toBe(200)
    const catalog = await (await get(`companies/${company}/catalog/current`, 'admin')).json()
    const second = writes(2)
    const third = writes(3)
    const withPrecondition = (batch: ReturnType<typeof writes>) => [
      batch[0], { ...batch[1], currentDocument: { updateTime: catalog.updateTime } }
    ]
    expect((await commit('admin', withPrecondition(second))).status).toBe(200)
    expect((await commit('admin', withPrecondition(third))).status).not.toBe(200)
    expect((await get(`companies/${company}/packs/3`, 'member')).status).toBe(404)
    expect((await (await get(`companies/${company}/catalog/current`, 'member')).json()).fields.version.integerValue).toBe('2')
  })
})
