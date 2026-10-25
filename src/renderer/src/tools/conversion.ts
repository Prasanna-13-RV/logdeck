import { normalizeHex } from '../../../../shared/hex'
export { normalizeHex } from '../../../../shared/hex'

export type ByteEncoding = 'ascii' | 'latin1'

export function asciiToHex(input: string, encoding: ByteEncoding = 'ascii'): string {
  if (input.length > 32_768) throw new Error('ASCII input is limited to 32,768 characters.')
  return Array.from(input, char => {
    const code = char.charCodeAt(0)
    if (code > (encoding === 'ascii' ? 127 : 255)) throw new Error(encoding === 'ascii' ?
      'Strict ASCII accepts only U+0000 through U+007F; select Latin-1 for byte-preserving 00-FF conversion.' :
      'Latin-1 byte mode accepts only U+0000 through U+00FF; this character cannot be represented by one byte.')
    return code.toString(16).padStart(2, '0').toUpperCase()
  }).join(' ')
}

export function hexToAscii(input: string, encoding: ByteEncoding = 'ascii'): string {
  const hex = normalizeHex(input, 32_768)
  return hex.match(/../g)!.map(byte => {
    const code = parseInt(byte, 16)
    if (encoding === 'ascii' && code > 127) throw new Error('The input contains bytes above 7F, which are not ASCII. Select Latin-1 byte mode to preserve every byte.')
    return String.fromCharCode(code)
  }).join('')
}

export function escapedBytePreview(text: string): string {
  return JSON.stringify(text).replace(/[\u007f-\u009f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
