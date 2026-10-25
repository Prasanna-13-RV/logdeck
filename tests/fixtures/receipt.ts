// Synthetic receipt preserves the reported control-byte case, not payment identifiers.
export const receiptHex = Buffer.from('ALIPAY+ PAIEMENT\n\nDATE PAIEMENT : 2026-09-24 12:50:46\n\nMONTANT : 1.12 EUR\n\n##QRCode##\u0080\u0013TEST-REFERENCE\n', 'latin1').toString('hex').toUpperCase()
