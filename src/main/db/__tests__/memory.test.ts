import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../schema'
import { MemoryDB } from '../memory'

let db: Database.Database
let memDB: MemoryDB

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  memDB = new MemoryDB(db)
})

afterEach(() => {
  db.close()
})

describe('MemoryDB', () => {
  it('saves and lists a series', () => {
    memDB.saveSeries({
      id: 's1', name: 'US CPI', code: 'USCPI', description: 'CPI all items',
      points: [{ date: '2020-01-01', value: 257.97 }]
    })
    const list = memDB.listSeries()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('US CPI')
  })

  it('fetches a series by id with all points', () => {
    memDB.saveSeries({
      id: 's2', name: 'GDP', code: 'GDP', description: '',
      points: [
        { date: '2020-01-01', value: 21000 },
        { date: '2020-04-01', value: 19000 }
      ]
    })
    const s = memDB.getSeries('s2')
    expect(s?.points).toHaveLength(2)
    expect(s?.points[0].value).toBe(21000)
  })

  it('deletes a series', () => {
    memDB.saveSeries({ id: 's3', name: 'X', code: 'X', description: '', points: [] })
    memDB.deleteSeries('s3')
    expect(memDB.listSeries()).toHaveLength(0)
  })

  it('cascades point deletion when a series is deleted', () => {
    memDB.saveSeries({
      id: 's4', name: 'Y', code: 'Y', description: '',
      points: [{ date: '2020-01-01', value: 1 }, { date: '2020-02-01', value: 2 }]
    })
    memDB.deleteSeries('s4')
    const orphans = db.prepare("SELECT COUNT(*) as n FROM series_points WHERE series_id = 's4'").get() as { n: number }
    expect(orphans.n).toBe(0)
  })
})
