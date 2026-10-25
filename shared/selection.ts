export interface PositionRange { start: number; end: number }

export function selectionCount(ranges: readonly PositionRange[]) {
  return ranges.reduce((count, range) => count + range.end - range.start + 1, 0)
}

export function containsPosition(ranges: readonly PositionRange[], position: number) {
  return ranges.some(range => position >= range.start && position <= range.end)
}

export function togglePosition(ranges: readonly PositionRange[], position: number): PositionRange[] {
  const next: PositionRange[] = []
  let removed = false
  for (const range of ranges) {
    if (position < range.start || position > range.end) next.push({ ...range })
    else {
      removed = true
      if (range.start < position) next.push({ start: range.start, end: position - 1 })
      if (range.end > position) next.push({ start: position + 1, end: range.end })
    }
  }
  if (!removed) next.push({ start: position, end: position })
  next.sort((a, b) => a.start - b.start)
  const merged: PositionRange[] = []
  for (const range of next) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end)
    else merged.push(range)
  }
  return merged
}

export function* selectedPositions(ranges: readonly PositionRange[]) {
  for (const range of ranges) for (let position = range.start; position <= range.end; position++) yield position
}
