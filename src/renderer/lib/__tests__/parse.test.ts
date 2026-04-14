import { describe, it, expect } from 'vitest'
import { parseCSVText } from '../parse'

describe('parseCSVText', () => {
  it('parses simple date,value CSV', () => {
    const csv = `date,price\n2020-01-01,100\n2020-02-01,110`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(1)
    expect(series[0].name).toBe('price')
    expect(series[0].points).toHaveLength(2)
    expect(series[0].points[0].value).toBe(100)
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
