import type { EmvDefinition } from './emvDictionary'

export interface CompanyTagPack {
  schemaVersion: 1
  companyId: string
  version: number
  name: string
  tags: EmvDefinition[]
}

export const tagPackLimits = { bytes: 512_000, tags: 1000 } as const

export function companyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new Error('Company ID must use 1-64 lowercase letters, digits, underscores or hyphens.')
  return value
}

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label} (1-${max} characters, no controls).`)
  return value.trim()
}

export function parseTagPack(raw: string): CompanyTagPack {
  if (new TextEncoder().encode(raw).length > tagPackLimits.bytes) throw new Error('Tag pack exceeds 512 KB.')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tag pack must be a JSON object.')
  const data = value as Record<string, unknown>
  if (data.schemaVersion !== 1) throw new Error('Unsupported tag-pack schemaVersion. Expected 1.')
  if (!Number.isSafeInteger(data.version) || Number(data.version) < 1) throw new Error('Version must be a positive safe integer.')
  if (!Array.isArray(data.tags) || !data.tags.length || data.tags.length > tagPackLimits.tags) throw new Error('Tag pack must contain 1-1,000 tags.')
  const seen = new Set<string>()
  const tags = data.tags.map((input: unknown): EmvDefinition => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Each tag must be an object.')
    const tag = input as Record<string, unknown>
    const id = text(tag.tag, 6, 'tag ID').toUpperCase()
    if (!/^(?:[0-9A-F]{2}){1,3}$/.test(id)) throw new Error(`Invalid hexadecimal tag ID: ${id}.`)
    if (seen.has(id)) throw new Error(`Duplicate company tag: ${id}.`)
    seen.add(id)
    if (tag.bytes !== undefined && (!Number.isSafeInteger(tag.bytes) || Number(tag.bytes) < 0 || Number(tag.bytes) > 65_536)) throw new Error(`Invalid byte length for ${id}.`)
    if (tag.sensitive !== undefined && typeof tag.sensitive !== 'boolean') throw new Error(`Invalid sensitivity flag for ${id}.`)
    return {
      tag: id, name: text(tag.name, 120, 'tag name'), description: text(tag.description, 1000, 'tag description'),
      ...(tag.bytes === undefined ? {} : { bytes: Number(tag.bytes) }),
      ...(tag.sensitive === undefined ? {} : { sensitive: tag.sensitive })
    }
  })
  return { schemaVersion: 1, companyId: companyId(data.companyId), version: Number(data.version), name: text(data.name, 120, 'pack name'), tags }
}

export function newerPack(current: CompanyTagPack | null, candidate: CompanyTagPack): boolean {
  if (current && current.companyId === candidate.companyId) {
    if (candidate.version < current.version) throw new Error('Server version is older than the installed company pack. Downgrades are blocked.')
    if (candidate.version === current.version) {
      if (JSON.stringify(candidate) !== JSON.stringify(current)) throw new Error('This version differs from the installed immutable pack. Publish a higher version.')
      return false
    }
  }
  return true
}
