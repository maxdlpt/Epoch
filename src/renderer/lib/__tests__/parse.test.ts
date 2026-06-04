import { describe, it, expect } from 'vitest'
import { parseCSVText, detectDataType, toGrowthRates } from '../parse'

describe('parseCSVText', () => {
  it('parses percent-signed growth data into decimal form', () => {
    // Cells with % are divided by 100: "2.5%" → 0.025
    const csv = `date,return\n2020-01-01,2.5%\n2020-02-01,3.1%`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(1)
    expect(series[0].name).toBe('return')
    expect(series[0].points).toHaveLength(2)
    expect(series[0].points[0].value).toBeCloseTo(0.025)
  })

  it('keeps bare decimals as-is (already in decimal form)', () => {
    // Cells without % are already decimal fractions: 0.025 stays 0.025
    const csv = `date,return\n2020-01-01,0.025\n2020-02-01,0.031`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(1)
    expect(series[0].points[0].value).toBeCloseTo(0.025)
    expect(series[0].points[1].value).toBeCloseTo(0.031)
  })

  it('converts level data (large positive magnitudes) to growth rates', () => {
    // Values of 100/110 — bare numbers, kept as-is → detected as level → growth rates in decimal form
    const csv = `date,price\n2020-01-01,100\n2020-02-01,110`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(1)
    expect(series[0].dataType).toBe('level')
    expect(series[0].startingValue).toBe(100)
    expect(series[0].points[0].value).toBe(0)           // sentinel
    expect(series[0].points[1].value).toBeCloseTo(0.10)  // +10% in decimal
  })

  it('parses multi-series CSV', () => {
    const csv = `date,cpi,gdp\n2020-01-01,257,21000\n2020-02-01,258,21100`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(2)
    expect(series.map(s => s.name)).toContain('cpi')
    expect(series.map(s => s.name)).toContain('gdp')
  })

  it('disambiguates duplicate column codes with numeric suffix', () => {
    // Two columns named "Price" both yield code 'PRICE' — would collide on
    // the schema's UNIQUE constraint unless suffixed at parse time.
    const csv = `date,Price,Price\n2020-01-01,100,200\n2020-02-01,110,210`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(2)
    const codes = series.map(s => s.code)
    expect(codes).toEqual(['PRICE', 'PRICE_2'])
    // Original display names remain unchanged so the UI still shows "Price".
    expect(series.map(s => s.name)).toEqual(['Price', 'Price'])
  })

  it('handles multi-way collisions with sequential suffixes', () => {
    const csv = `date,a,a,a,a\n2020-01-01,1,2,3,4`
    const series = parseCSVText(csv)
    expect(series.map(s => s.code)).toEqual(['A', 'A_2', 'A_3', 'A_4'])
  })

  it('normalizes tabs to commas (TSV paste from Excel)', () => {
    const tsv = `date\tprice\n2020-01-01\t100\n2020-02-01\t110`
    const series = parseCSVText(tsv)
    expect(series).toHaveLength(1)
    expect(series[0].name).toBe('price')
    expect(series[0].points).toHaveLength(2)
  })
})

// Helper: build DataPoint array with a fixed date (value is what we're testing)
function pts(values: number[]) {
  const d = new Date('2020-01-01')
  return values.map(value => ({ date: d, value }))
}

describe('detectDataType', () => {
  it('returns growth for empty array', () => {
    expect(detectDataType([])).toBe('growth')
  })

  it('returns growth when negFrac > 0.15', () => {
    // 4 negative out of 20 = 0.2 → growth (decimal-form returns)
    const values = [...Array(16).fill(0.05), ...Array(4).fill(-0.01)]
    expect(detectDataType(pts(values))).toBe('growth')
  })

  it('returns level when nearly all positive and medianAbs > 20', () => {
    // 0 negative, median = 100 → level (price data)
    expect(detectDataType(pts([80, 90, 100, 110, 120]))).toBe('level')
  })

  it('returns growth when medianAbs ≤ 20 even with no negatives', () => {
    // medianAbs = 0.05 (small decimal returns) → growth
    expect(detectDataType(pts([0.03, 0.04, 0.05, 0.06, 0.07]))).toBe('growth')
  })

  it('returns growth at the exact medianAbs = 20 boundary (not strictly greater)', () => {
    // Exactly 20 does NOT satisfy > 20 → growth
    expect(detectDataType(pts([20, 20, 20]))).toBe('growth')
  })

  it('returns growth when negFrac is between 0.05 and 0.15 regardless of magnitude', () => {
    // 1 negative out of 10 = 0.10, not > 0.15 but not < 0.05 → growth fallback
    const values = [...Array(9).fill(100), -1]
    expect(detectDataType(pts(values))).toBe('growth')
  })
})

describe('toGrowthRates', () => {
  it('first growth point is 0 sentinel with original date', () => {
    const d0 = new Date('2020-01-01')
    const d1 = new Date('2020-02-01')
    const input = [{ date: d0, value: 100 }, { date: d1, value: 110 }]
    const { growthPoints } = toGrowthRates(input)
    expect(growthPoints[0].value).toBe(0)
    expect(growthPoints[0].date).toBe(d0)
  })

  it('captures startingValue from first input point', () => {
    const input = pts([250, 260, 270])
    const { startingValue } = toGrowthRates(input)
    expect(startingValue).toBe(250)
  })

  it('computes growth rates in decimal form', () => {
    // 100 → 110 → 121: each step is +10% = 0.10 in decimal
    const d = [new Date('2020-01-01'), new Date('2020-02-01'), new Date('2020-03-01')]
    const input = [{ date: d[0], value: 100 }, { date: d[1], value: 110 }, { date: d[2], value: 121 }]
    const { growthPoints } = toGrowthRates(input)
    expect(growthPoints).toHaveLength(3)
    expect(growthPoints[1].value).toBeCloseTo(0.10, 10)
    expect(growthPoints[2].value).toBeCloseTo(0.10, 10)
  })

  it('handles negative prior value with Math.abs denominator', () => {
    // -100 → -80: change = +20 over |−100| = 0.20 in decimal
    const d = [new Date('2020-01-01'), new Date('2020-02-01')]
    const input = [{ date: d[0], value: -100 }, { date: d[1], value: -80 }]
    const { growthPoints } = toGrowthRates(input)
    expect(growthPoints[1].value).toBeCloseTo(0.20, 10)
  })

  it('output has same length as input', () => {
    const input = pts([10, 20, 30, 40, 50])
    const { growthPoints } = toGrowthRates(input)
    expect(growthPoints).toHaveLength(input.length)
  })
})
