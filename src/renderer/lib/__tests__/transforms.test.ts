import { describe, it, expect } from 'vitest'
import { toCumReturn, toNormalized, toPctChange, reconstructLevels, toLevelIndex } from '../transforms'
import type { DataPoint } from '../../../shared/types'

const pts: DataPoint[] = [
  { date: new Date('2020-01-01'), value: 100 },
  { date: new Date('2020-02-01'), value: 110 },
  { date: new Date('2020-03-01'), value: 99 },
]

describe('transforms', () => {
  it('toCumReturn: first point is 0, second is 0.10 (10% in decimal)', () => {
    const out = toCumReturn(pts)
    expect(out[0].value).toBeCloseTo(0)
    expect(out[1].value).toBeCloseTo(0.10)
  })

  it('toNormalized: first point is 100', () => {
    const out = toNormalized(pts)
    expect(out[0].value).toBe(100)
    expect(out[1].value).toBeCloseTo(110)
  })

  it('toPctChange: second point shows period change in decimal form', () => {
    const out = toPctChange(pts)
    expect(out[1].value).toBeCloseTo(0.10)
  })
})

// Growth-rate points that toGrowthRates would produce for [100, 110, 121]:
// [0, +0.10, +0.10]  (decimal form: 0.10 = +10%)
const growthPts: DataPoint[] = [
  { date: new Date('2020-01-01'), value: 0 },
  { date: new Date('2020-02-01'), value: 0.10 },
  { date: new Date('2020-03-01'), value: 0.10 },
]

describe('reconstructLevels', () => {
  it('returns empty for empty input', () => {
    expect(reconstructLevels([], 100)).toEqual([])
  })

  it('first point equals startingValue regardless of sentinel', () => {
    const out = reconstructLevels(growthPts, 100)
    expect(out[0].value).toBeCloseTo(100)
  })

  it('compounds growth rates correctly: 100 → 110 → 121', () => {
    const out = reconstructLevels(growthPts, 100)
    expect(out[1].value).toBeCloseTo(110)
    expect(out[2].value).toBeCloseTo(121)
  })

  it('preserves original dates on output points', () => {
    const out = reconstructLevels(growthPts, 100)
    expect(out.map(p => p.date)).toEqual(growthPts.map(p => p.date))
  })

  it('output length equals input length', () => {
    const out = reconstructLevels(growthPts, 100)
    expect(out).toHaveLength(growthPts.length)
  })
})

const levelPts: DataPoint[] = [
  { date: new Date('2020-01-01'), value: 100 },
  { date: new Date('2020-02-01'), value: 110 },
  { date: new Date('2020-03-01'), value: 121 },
]

describe('toLevelIndex', () => {
  it('returns empty for empty input', () => {
    expect(toLevelIndex([], null)).toEqual([])
  })

  it('normalises to 100 at first point when baseDate is null', () => {
    const out = toLevelIndex(levelPts, null)
    expect(out[0].value).toBeCloseTo(100)
    expect(out[1].value).toBeCloseTo(110)
  })

  it('normalises to 100 at the snapped base date', () => {
    const base = new Date('2020-02-01') // value = 110 at this point
    const out = toLevelIndex(levelPts, base)
    expect(out[1].value).toBeCloseTo(100)           // 110/110 * 100
    expect(out[0].value).toBeCloseTo(90.909, 2)     // 100/110 * 100
    expect(out[2].value).toBeCloseTo(110, 2)        // 121/110 * 100
  })

  it('snaps base date to nearest point when not an exact match', () => {
    // Jan 15 is between Jan 1 and Feb 1 — closer to Jan 1
    const base = new Date('2020-01-15')
    const out = toLevelIndex(levelPts, base)
    expect(out[0].value).toBeCloseTo(100) // snapped to Jan 1
  })

  it('preserves original dates', () => {
    const out = toLevelIndex(levelPts)
    expect(out.map(p => p.date)).toEqual(levelPts.map(p => p.date))
  })
})
