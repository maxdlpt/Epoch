import { describe, it, expect } from 'vitest'
import type { DataPoint, DataSeries, ExternalDB } from '../types'

describe('shared types', () => {
  it('DataPoint has date and value', () => {
    const p: DataPoint = { date: new Date('2020-01-01'), value: 100 }
    expect(p.date).toBeInstanceOf(Date)
    expect(typeof p.value).toBe('number')
  })

  it('DataSeries has id, name, points', () => {
    const s: DataSeries = {
      id: 'abc',
      name: 'US CPI',
      code: 'USCPI',
      description: 'Consumer Price Index',
      points: [{ date: new Date('2020-01-01'), value: 257.97 }],
      source: 'memory'
    }
    expect(s.id).toBe('abc')
    expect(s.points).toHaveLength(1)
  })

  it('ExternalDB has id, name, path', () => {
    const db: ExternalDB = { id: 'db1', name: 'Macro Data', path: '/tmp/macro.db', reachable: true }
    expect(db.name).toBe('Macro Data')
  })
})
