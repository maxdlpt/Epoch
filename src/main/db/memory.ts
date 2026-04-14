import type Database from 'better-sqlite3'
import type { DBRecord } from '../../shared/types'

interface RawPoint { date: string; value: number }
interface SavePayload {
  id: string
  name: string
  code: string
  description: string
  points: RawPoint[]
}

export class MemoryDB {
  constructor(private db: Database.Database) {}

  listSeries(): DBRecord[] {
    return this.db.prepare<[], DBRecord>(`
      SELECT s.id, s.name, s.code, s.description,
        MIN(p.date) as startDate, MAX(p.date) as endDate,
        COUNT(p.date) as pointCount
      FROM series s
      LEFT JOIN series_points p ON p.series_id = s.id
      GROUP BY s.id
    `).all()
  }

  getSeries(id: string): { id: string; name: string; code: string; description: string; points: RawPoint[] } | null {
    const meta = this.db.prepare('SELECT * FROM series WHERE id = ?').get(id) as
      | { id: string; name: string; code: string; description: string }
      | undefined
    if (!meta) return null
    const points = this.db.prepare<[string], RawPoint>(
      'SELECT date, value FROM series_points WHERE series_id = ? ORDER BY date'
    ).all(id)
    return { ...meta, points }
  }

  saveSeries(payload: SavePayload): void {
    const insertSeries = this.db.prepare(
      'INSERT OR REPLACE INTO series (id, name, code, description) VALUES (?, ?, ?, ?)'
    )
    const insertPoint = this.db.prepare(
      'INSERT OR REPLACE INTO series_points (series_id, date, value) VALUES (?, ?, ?)'
    )
    const deletePoints = this.db.prepare('DELETE FROM series_points WHERE series_id = ?')

    this.db.transaction(() => {
      insertSeries.run(payload.id, payload.name, payload.code, payload.description)
      deletePoints.run(payload.id)
      for (const p of payload.points) {
        insertPoint.run(payload.id, p.date, p.value)
      }
    })()
  }

  deleteSeries(id: string): void {
    this.db.prepare('DELETE FROM series WHERE id = ?').run(id)
  }
}
