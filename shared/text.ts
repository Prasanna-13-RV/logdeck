import { compareLimits } from './contracts'

export function validateText(text: string, newline: '\n' | '\r\n' = '\n', bom = false): void {
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) throw new Error('Unpaired Unicode surrogate cannot be saved without data loss.')
  if (text.includes('\0')) throw new Error('Binary/NUL text is not supported in Compare.')
  if (/\r(?!\n)/.test(text)) throw new Error('Standalone CR line endings are unsupported. Convert the file explicitly first.')
  const lines = text.split('\n').length
  if (lines > compareLimits.lines) throw new Error('Compare accepts at most 100,000 lines per side.')
  const normalized = text.replace(/\r\n/g, '\n')
  const encoded = normalized.replace(/\n/g, newline)
  if (new TextEncoder().encode(encoded).length + (bom ? 3 : 0) > compareLimits.bytes) throw new Error('Compare accepts at most 10 MB of encoded text per side.')
}

export function encodeText(text: string, newline: '\n' | '\r\n', bom: boolean) {
  validateText(text, newline, bom)
  return `${bom ? '\uFEFF' : ''}${text.replace(/\r\n/g, '\n').replace(/\n/g, newline)}`
}
