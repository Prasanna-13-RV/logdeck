import { normalizeHex } from './conversion'

export type Scheme = 'visa' | 'mastercard'
export interface TagDefinition { tag: string; name: string; length?: number; visaOnly?: boolean; bytes?: string[][] }
const rfu = 'RFU - preserve'
export const definitions: TagDefinition[] = [
  { tag: '95', name: 'TVR - Terminal Verification Results', length: 5, bytes: [
    ['Offline data authentication was not performed', 'SDA failed', 'ICC data missing', 'Card appears on terminal exception file', 'DDA failed', 'CDA failed', 'SDA selected', rfu],
    ['Card and terminal application versions differ', 'Application expired', 'Application not yet effective', 'Requested service not allowed', 'New card', rfu, rfu, rfu],
    ['Cardholder verification unsuccessful', 'Unrecognized CVM', 'PIN try limit exceeded', 'PIN required but PIN pad unavailable', 'PIN required but not entered', 'Online PIN entered', rfu, rfu],
    ['Transaction exceeds floor limit', 'Lower consecutive offline limit exceeded', 'Upper consecutive offline limit exceeded', 'Randomly selected for online processing', 'Merchant forced online', rfu, rfu, rfu],
    ['Default TDOL used', 'Issuer authentication failed', 'Issuer script failed before final GENERATE AC', 'Issuer script failed after final GENERATE AC', rfu, rfu, rfu, rfu]
  ] },
  { tag: '82', name: 'AIP - Application Interchange Profile', length: 2, bytes: [
    [rfu, 'SDA supported', 'DDA supported', 'Cardholder verification supported', 'Terminal risk management required', 'Issuer authentication supported', rfu, 'CDA supported'],
    Array(8).fill('Kernel/version-specific - raw only')
  ] },
  { tag: '9F33', name: 'Terminal Capabilities', length: 3, bytes: [
    ['Manual key entry supported', 'Magnetic stripe supported', 'Contact chip supported', rfu, rfu, rfu, rfu, rfu],
    ['Plaintext PIN verified by card', 'Enciphered online PIN', 'Signature', 'Enciphered offline PIN', 'No CVM required', rfu, rfu, rfu],
    ['SDA supported', 'DDA supported', 'Card capture supported', rfu, 'CDA supported', rfu, rfu, rfu]
  ] },
  { tag: '9F34', name: 'CVM Results', length: 3 },
  { tag: '9F6C', name: 'CTQ - Card Transaction Qualifiers (Visa)', length: 2, visaOnly: true, bytes: [
    ['Online PIN required', 'Signature required', 'Go online if offline authentication fails', 'Switch interface if offline authentication fails', 'Go online if application expired', 'Switch interface for cash', 'Switch interface for cashback', rfu],
    ['Consumer device CVM performed', 'Issuer update processing supported', rfu, rfu, rfu, rfu, rfu, rfu]
  ] },
  { tag: '9F66', name: 'TTQ - Terminal Transaction Qualifiers (Visa)', length: 4, visaOnly: true, bytes: [
    ['MSD supported (legacy)', rfu, 'qVSDC supported', 'Contact chip supported', 'Offline-only reader', 'Online PIN supported', 'Signature supported', 'ODA for online authorization supported'],
    ['Online cryptogram required', 'CVM required', 'Contact-chip offline PIN supported', rfu, rfu, rfu, rfu, rfu],
    ['Issuer update processing supported', 'Consumer-device CVM supported', rfu, rfu, rfu, rfu, rfu, rfu],
    [rfu, rfu, rfu, rfu, rfu, rfu, rfu, rfu]
  ] },
  { tag: '9F6E', name: 'Scheme-specific data (9F6E)' }
]

export function definitionFor(tag: string): TagDefinition {
  const definition = definitions.find(item => item.tag === tag)
  if (!definition) throw new Error('This tag does not have a bundled decoder.')
  return definition
}

export function defaultTagValue(tag: string): string {
  const definition = definitionFor(tag)
  if (definition.tag === '95') return '8000000000'
  return '00'.repeat(definition.length ?? 1)
}

export function limitHex(value: string, bytes?: number): string {
  const hex = value.replace(/[^0-9a-f]/gi, '').toUpperCase()
  return bytes ? hex.slice(0, bytes * 2) : hex
}

export function validateTagValue(tag: string, value: string): string {
  const hex = normalizeHex(value, 256)
  const definition = definitionFor(tag)
  if (definition.length && hex.length !== definition.length * 2) throw new Error(`${tag} requires exactly ${definition.length} bytes.`)
  return hex
}

export function decodingNotice(definition: TagDefinition, scheme: Scheme): string | null {
  if (definition.tag === '9F6E') return '9F6E is scheme/kernel/version-specific. No verified Visa or Mastercard layout is bundled; raw hex comparison is available, but semantic decoding is intentionally disabled.'
  if (definition.visaOnly && scheme !== 'visa') return 'This is a Visa qualifier layout. It is not interpreted as a Mastercard field. Select Visa only for data from that scheme.'
  return null
}

export function setBit(hex: string, byte: number, bit: number, enabled: boolean): string {
  const normalized = normalizeHex(hex, 256)
  if (!Number.isInteger(byte) || byte < 0 || byte * 2 >= normalized.length || !Number.isInteger(bit) || bit < 1 || bit > 8) throw new Error('Invalid byte/bit position.')
  const value = parseInt(normalized.slice(byte * 2, byte * 2 + 2), 16)
  const changed = enabled ? value | (1 << (bit - 1)) : value & ~(1 << (bit - 1))
  return replaceByte(normalized, byte, changed)
}

export function replaceByte(hex: string, byte: number, value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 255 || !Number.isInteger(byte) || byte < 0 || byte * 2 >= hex.length) throw new Error('Invalid byte value.')
  return hex.slice(0, byte * 2) + value.toString(16).padStart(2, '0').toUpperCase() + hex.slice(byte * 2 + 2)
}

export const cvmMethods: Record<number, string> = {
  0: 'Fail CVM processing', 1: 'Plaintext PIN verified by card', 2: 'Enciphered online PIN',
  3: 'Plaintext PIN and signature', 4: 'Enciphered PIN verified by card',
  5: 'Enciphered offline PIN and signature', 30: 'Signature', 31: 'No CVM required', 63: 'No CVM performed'
}
export const cvmConditions: Record<number, string> = {
  0: 'Always', 1: 'Unattended cash', 2: 'Not unattended cash, manual cash or cashback',
  3: 'If terminal supports CVM', 4: 'Manual cash', 5: 'Purchase with cashback',
  6: 'Application currency and amount below X', 7: 'Application currency and amount above X',
  8: 'Application currency and amount below Y', 9: 'Application currency and amount above Y'
}
export const cvmResults: Record<number, string> = { 0: 'Unknown', 1: 'Failed', 2: 'Successful' }
export function describeCvm(hex: string) {
  const value = validateTagValue('9F34', hex)
  const first = parseInt(value.slice(0, 2), 16)
  return {
    method: cvmMethods[first & 63] ?? 'Reserved or scheme-specific CVM code',
    continueOnFailure: Boolean(first & 64),
    condition: cvmConditions[parseInt(value.slice(2, 4), 16)] ?? 'Reserved or scheme-specific condition',
    result: cvmResults[parseInt(value.slice(4, 6), 16)] ?? 'Reserved result'
  }
}

export { parseTlv, type TlvNode } from '../../../../shared/emvTlv'
