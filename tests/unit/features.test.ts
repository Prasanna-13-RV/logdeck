import { describe, expect, it, vi } from 'vitest'
import { companyFeaturesEnabled, officialWebsiteUrl } from '../../shared/features'
import { lineDifferences } from '../../src/renderer/src/tools/diff'

describe('optional company features', () => {
  it('defaults off and requires explicit true even when credentials exist', () => {
    for (const value of [undefined, '', 'false']) expect(companyFeaturesEnabled(value)).toBe(false)
    expect(companyFeaturesEnabled('true')).toBe(true)
    expect(() => companyFeaturesEnabled('yes')).toThrow('true or false')
    expect(officialWebsiteUrl).toBe('https://logdeck.netlify.app')
  })
})

describe('large text comparisons', () => {
  it('isolates sparse changes and a 2339-line insertion in unequal, repetitive logs', () => {
    const left = Array.from({ length: 7759 }, (_, i) => i % 40 === 0 ? `SECTION_${i}` : `SETTING_${i % 40}=1`)
    const right = [...left]
    right[0] = 'SECTION_CHANGED'
    right[14] = 'SETTING_14=3'
    right[7000] = 'SETTING_CHANGED=2'
    right.splice(3000, 0, ...Array.from({ length: 2339 }, (_, i) => `ADDED_${i}`))
    const changes = lineDifferences(left.join('\n'), right.join('\n'), { ignoreCase: true, ignoreWhitespace: true })
    expect(changes).toEqual([
      { aStart: 0, aEnd: 1, bStart: 0, bEnd: 1 },
      { aStart: 14, aEnd: 15, bStart: 14, bEnd: 15 },
      { aStart: 3000, aEnd: 3000, bStart: 3000, bEnd: 5339 },
      { aStart: 7000, aEnd: 7001, bStart: 9339, bEnd: 9340 }
    ])
    const transformed = [...left]
    for (const change of [...changes].reverse()) transformed.splice(change.aStart, change.aEnd - change.aStart, ...right.slice(change.bStart, change.bEnd))
    expect(transformed).toEqual(right)
  })
  it('retains identical repeated lines when there are no rare anchors', () => {
    const left = Array.from({ length: 8000 }, (_, i) => `setting_${i % 20}`)
    const right = [...left]
    right[0] = 'changed'
    right.splice(4000, 0, ...Array(2000).fill('extra'))
    const changes = lineDifferences(left.join('\n'), right.join('\n'), { ignoreCase: false, ignoreWhitespace: false })
    expect(changes.reduce((sum, change) => sum + change.aEnd - change.aStart, 0)).toBe(1)
    const transformed = [...left]
    for (const change of [...changes].reverse()) transformed.splice(change.aStart, change.aEnd - change.aStart, ...right.slice(change.bStart, change.bEnd))
    expect(transformed).toEqual(right)
  })
  for (const count of [7000, 8000]) {
    it(`compares ${count} changed lines completely without failing`, () => {
      const left = Array.from({ length: count }, (_, i) => `left ${i}`)
      const right = Array.from({ length: count }, (_, i) => `right ${i}`)
      const coarse = vi.fn()
      const changes = lineDifferences(left.join('\n'), right.join('\n'), { ignoreCase: false, ignoreWhitespace: false }, coarse)
      expect(changes).toEqual([{ aStart: 0, aEnd: count, bStart: 0, bEnd: count }])
      expect(coarse).toHaveBeenCalledOnce()
      const transformed = [...left]
      for (const change of [...changes].reverse()) transformed.splice(change.aStart, change.aEnd - change.aStart, ...right.slice(change.bStart, change.bEnd))
      expect(transformed).toEqual(right)
    })
  }
  it('keeps matching regions and exact transforms when many scattered changes exceed refinement limits', () => {
    const left = Array.from({ length: 8000 }, (_, i) => `row ${i}`)
    const right = left.map((line, i) => i % 2 ? line : `changed ${i}`)
    const changes = lineDifferences(left.join('\n'), right.join('\n'), { ignoreCase: false, ignoreWhitespace: false })
    const transformed = [...left]
    for (const change of [...changes].reverse()) transformed.splice(change.aStart, change.aEnd - change.aStart, ...right.slice(change.bStart, change.bEnd))
    expect(transformed).toEqual(right)
    expect(changes).toHaveLength(4000)
  })
})
