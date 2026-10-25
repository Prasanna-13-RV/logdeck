export interface Difference { aStart: number; aEnd: number; bStart: number; bEnd: number }
export interface DiffOptions { ignoreCase: boolean; ignoreWhitespace: boolean }

export function lineDifferences(left: string, right: string, options: DiffOptions): Difference[] {
  const a = left.split('\n')
  const b = right.split('\n')
  const normalize = (text: string) => {
    if (options.ignoreWhitespace) text = text.replace(/\s+/g, ' ').trim()
    return options.ignoreCase ? text.toLowerCase() : text
  }
  const aa = a.map(normalize), bb = b.map(normalize)
  let prefix = 0, suffix = 0
  while (prefix < aa.length && prefix < bb.length && aa[prefix] === bb[prefix]) prefix++
  while (suffix < aa.length - prefix && suffix < bb.length - prefix && aa[aa.length - suffix - 1] === bb[bb.length - suffix - 1]) suffix++
  const n = aa.length - prefix - suffix, m = bb.length - prefix - suffix
  if (!n && !m) return []
  if (!n || !m) return [{ aStart: prefix, aEnd: prefix + n, bStart: prefix, bEnd: prefix + m }]
  let frontier = new Map<number, number>([[1, 0]])
  const trace: Map<number, number>[] = []
  let cells = 0, steps = 0
  const deadline = Date.now() + 4000
  for (let d = 0; d <= n + m; d++) {
    cells += frontier.size
    if (cells > 1_000_000 || Date.now() > deadline) throw new Error('Diff complexity limit reached. Narrow the documents or simplify the changed region.')
    trace.push(new Map(frontier))
    for (let k = -d; k <= d; k += 2) {
      const down = frontier.get(k + 1) ?? -Infinity
      const across = frontier.get(k - 1) ?? -Infinity
      let x = k === -d || (k !== d && across < down) ? down : across + 1
      let y = x - k
      while (x < n && y < m && aa[prefix + x] === bb[prefix + y]) {
        x++; y++
        if (++steps % 10000 === 0 && Date.now() > deadline) throw new Error('Diff timed out. Narrow the documents.')
      }
      frontier.set(k, x)
      if (x >= n && y >= m) {
        const edits: ('equal' | 'delete' | 'insert')[] = []
        let xx = n, yy = m
        for (let dd = d; dd >= 0; dd--) {
          const old = trace[dd]
          const kk = xx - yy
          const previousK = kk === -dd || (kk !== dd && (old.get(kk - 1) ?? -Infinity) < (old.get(kk + 1) ?? -Infinity)) ? kk + 1 : kk - 1
          const previousX = old.get(previousK) ?? 0
          const previousY = previousX - previousK
          while (xx > previousX && yy > previousY) { edits.push('equal'); xx--; yy-- }
          if (dd > 0) {
            if (xx === previousX) { edits.push('insert'); yy-- }
            else { edits.push('delete'); xx-- }
          }
        }
        edits.reverse()
        const result: Difference[] = []
        let ai = prefix, bi = prefix
        let pending: Difference | undefined
        for (const edit of edits) {
          if (edit === 'equal') {
            if (pending) { result.push(pending); pending = undefined }
            ai++; bi++
          } else {
            pending ??= { aStart: ai, aEnd: ai, bStart: bi, bEnd: bi }
            if (edit === 'delete') pending.aEnd = ++ai
            else pending.bEnd = ++bi
          }
        }
        if (pending) result.push(pending)
        if (result.length > 10000) throw new Error('More than 10,000 changed blocks. Narrow the comparison.')
        return result
      }
    }
  }
  throw new Error('Diff could not complete.')
}

export function wordDifference(left: string, right: string) {
  if (left.length + right.length > 4000) return null
  const a = left.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []
  const b = right.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []
  if (a.length > 200 || b.length > 200) return null
  const matrix = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) matrix[i][j] = a[i] === b[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1])
  const first: { text: string; changed: boolean }[] = [], second: typeof first = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      first.push({ text: a[i++], changed: false }); second.push({ text: b[j++], changed: false })
    } else if (i < a.length && (j === b.length || matrix[i + 1][j] >= matrix[i][j + 1])) first.push({ text: a[i++], changed: true })
    else second.push({ text: b[j++], changed: true })
  }
  return { left: first, right: second }
}
