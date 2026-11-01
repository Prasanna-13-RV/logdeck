export interface Difference { aStart: number; aEnd: number; bStart: number; bEnd: number }
export interface DiffOptions { ignoreCase: boolean; ignoreWhitespace: boolean }

export function lineDifferences(left: string, right: string, options: DiffOptions, onCoarse?: () => void): Difference[] {
  const a = left.split('\n')
  const b = right.split('\n')
  const normalize = (text: string) => {
    if (options.ignoreWhitespace) text = text.replace(/\s+/g, ' ').trim()
    return options.ignoreCase ? text.toLowerCase() : text
  }
  const aa = a.map(normalize), bb = b.map(normalize)
  const result: Difference[] = []
  let remainingCells = 200_000
  const deadline = Date.now() + 3000
  function append(change: Difference) {
    const previous = result[result.length - 1]
    if (previous && previous.aEnd === change.aStart && previous.bEnd === change.bStart) {
      previous.aEnd = change.aEnd
      previous.bEnd = change.bEnd
    } else result.push(change)
  }
  function compare(aStart: number, aEnd: number, bStart: number, bEnd: number) {
    let prefix = 0, suffix = 0
    while (aStart + prefix < aEnd && bStart + prefix < bEnd && aa[aStart + prefix] === bb[bStart + prefix]) prefix++
    aStart += prefix; bStart += prefix
    while (suffix < aEnd - aStart && suffix < bEnd - bStart && aa[aEnd - suffix - 1] === bb[bEnd - suffix - 1]) suffix++
    aEnd -= suffix; bEnd -= suffix
    const n = aEnd - aStart, m = bEnd - bStart
    if (!n && !m) return
    if (!n || !m) { append({ aStart, aEnd, bStart, bEnd }); return }
    const coarse = () => {
      const positions = new Map<string, number[]>()
      const leftPositions = new Map<string, number[]>()
      const counts = new Map<string, number>()
      for (let i = aStart; i < aEnd; i++) {
        counts.set(aa[i], (counts.get(aa[i]) ?? 0) + 1)
        const list = leftPositions.get(aa[i])
        if (list) list.push(i)
        else leftPositions.set(aa[i], [i])
      }
      for (let j = bStart; j < bEnd; j++) {
        const list = positions.get(bb[j])
        if (list) list.push(j)
        else positions.set(bb[j], [j])
      }
      // Rare matching lines anchor a monotonic alignment, even across large insertions.
      const candidates: { a: number; b: number; previous: number }[] = []
      const tails: number[] = []
      for (let i = aStart; i < aEnd; i++) {
        const matches = positions.get(aa[i])
        if (!matches || matches.length * counts.get(aa[i])! > 64) continue
        for (let j = matches.length - 1; j >= 0; j--) {
          const b = matches[j]
          let low = 0, high = tails.length
          while (low < high) {
            const middle = (low + high) >>> 1
            if (candidates[tails[middle]].b < b) low = middle + 1
            else high = middle
          }
          candidates.push({ a: i, b, previous: low ? tails[low - 1] : -1 })
          tails[low] = candidates.length - 1
        }
      }
      const anchors: { a: number; b: number }[] = []
      for (let index = tails[tails.length - 1] ?? -1; index >= 0; index = candidates[index].previous) anchors.push(candidates[index])
      anchors.reverse()
      if (anchors.length) {
        let ai = aStart, bi = bStart
        for (const anchor of anchors) {
          compare(ai, anchor.a, bi, anchor.b)
          ai = anchor.a + 1; bi = anchor.b + 1
        }
        compare(ai, aEnd, bi, bEnd)
        return
      }
      // Highly repetitive regions still retain matching lines without quadratic work.
      onCoarse?.()
      let ai = aStart, bi = bStart
      function next(matches: number[] | undefined, start: number) {
        if (!matches) return Infinity
        let low = 0, high = matches.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (matches[middle] < start) low = middle + 1
          else high = middle
        }
        return matches[low] ?? Infinity
      }
      while (ai < aEnd && bi < bEnd) {
        if (aa[ai] === bb[bi]) { ai++; bi++; continue }
        if (ai + 1 < aEnd && bi + 1 < bEnd && aa[ai + 1] === bb[bi + 1]) {
          append({ aStart: ai, aEnd: ai + 1, bStart: bi, bEnd: bi + 1 })
          ai++; bi++; continue
        }
        const nextB = next(positions.get(aa[ai]), bi)
        const nextA = next(leftPositions.get(bb[bi]), ai)
        if (nextB === Infinity && nextA === Infinity) {
          append({ aStart: ai, aEnd: ai + 1, bStart: bi, bEnd: bi + 1 })
          ai++; bi++
        } else if (nextB - bi <= nextA - ai) {
          append({ aStart: ai, aEnd: ai, bStart: bi, bEnd: nextB })
          bi = nextB
        } else {
          append({ aStart: ai, aEnd: nextA, bStart: bi, bEnd: bi })
          ai = nextA
        }
      }
      if (ai < aEnd || bi < bEnd) append({ aStart: ai, aEnd, bStart: bi, bEnd })
    }
    let frontier = new Map<number, number>([[1, 0]])
    const trace: Map<number, number>[] = []
    let steps = 0
    for (let d = 0; d <= n + m; d++) {
      remainingCells -= frontier.size
      if (remainingCells < 0 || Date.now() > deadline) return coarse()
      trace.push(new Map(frontier))
      for (let k = -d; k <= d; k += 2) {
        const down = frontier.get(k + 1) ?? -Infinity
        const across = frontier.get(k - 1) ?? -Infinity
        let x = k === -d || (k !== d && across < down) ? down : across + 1
        let y = x - k
        while (x < n && y < m && aa[aStart + x] === bb[bStart + y]) {
          x++; y++
          if (++steps % 10000 === 0 && Date.now() > deadline) return coarse()
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
          let ai = aStart, bi = bStart
          let pending: Difference | undefined
          for (const edit of edits) {
            if (edit === 'equal') {
              if (pending) { append(pending); pending = undefined }
              ai++; bi++
            } else {
              pending ??= { aStart: ai, aEnd: ai, bStart: bi, bEnd: bi }
              if (edit === 'delete') pending.aEnd = ++ai
              else pending.bEnd = ++bi
            }
          }
          if (pending) append(pending)
          return
        }
      }
    }
    throw new Error('Diff could not complete.')
  }
  compare(0, aa.length, 0, bb.length)
  return result
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
