export function normalizeHex(input: string, maxBytes = 65_536): string {
  const hex = input.replace(/\s/g, '').toUpperCase()
  if (!hex || !/^[0-9A-F]+$/.test(hex) || hex.length % 2) throw new Error('Enter complete hexadecimal byte pairs (whitespace is allowed).')
  if (hex.length > maxBytes * 2) throw new Error(`Input exceeds ${maxBytes.toLocaleString()} bytes.`)
  return hex
}
