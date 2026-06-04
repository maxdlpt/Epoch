import Database from 'better-sqlite3'
import type { DBRecord } from '../../shared/types'

interface RawPoint {
  date: string
  value: number
}

/** Tables required for a file to be recognised as a TSV database. */
const REQUIRED_TABLES = ['series', 'series_points'] as const

/**
 * Typed error raised when an external database file cannot be used as a TSV
 * source. Carries a machine-readable `code` and the list of tables that were
 * missing, so the UI can render a helpful message.
 */
export class TsvSchemaError extends Error {
  readonly code: 'INVALID_SCHEMA'
  readonly missingTables: string[]

  constructor(missingTables: string[]) {
    super(
      `External database has an invalid schema — missing tables: ${missingTables.join(', ')}`,
    )
    this.name = 'TsvSchemaError'
    this.code = 'INVALID_SCHEMA'
    this.missingTables = missingTables
  }
}

function findMissingTables(db: Database.Database): string[] {
  const rows = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('series', 'series_points')",
    )
    .all()
  const present = new Set(rows.map((r) => r.name))
  return REQUIRED_TABLES.filter((t) => !present.has(t))
}

/**
 * Run the v2 decimal-form migration on an external DB if needed.
 * Opens a writable connection, migrates, and closes — before the readonly reader opens.
 */
function migrateExternalIfNeeded(filePath: string): void {
  let db: Database.Database | null = null
  try {
    db = new Database(filePath, { fileMustExist: true })
    const version = db.pragma('user_version', { simple: true }) as number
    if (version < 2) {
      db.exec('UPDATE series_points SET value = value / 100.0')
      db.exec(`DELETE FROM settings WHERE key = 'graph_session'`)
      db.pragma('user_version = 2')
    }
  } catch {
    /* If writable open fails (e.g. network share is readonly), skip — values read as-is */
  } finally {
    db?.close()
  }
}

export class ExternalDBReader {
  private db: Database.Database

  constructor(filePath: string) {
    // Migrate before opening readonly
    migrateExternalIfNeeded(filePath)
    this.db = new Database(filePath, { readonly: true, fileMustExist: true })
    this.db.pragma('foreign_keys = ON')
    const missing = findMissingTables(this.db)
    if (missing.length > 0) {
      this.db.close()
      throw new TsvSchemaError(missing)
    }
  }

  listSeries(): DBRecord[] {
    return this.db
      .prepare<[], DBRecord>(
        `
      SELECT s.id, s.name, s.code, s.description,
        MIN(p.date) as startDate, MAX(p.date) as endDate,
        COUNT(p.date) as pointCount
      FROM series s
      LEFT JOIN series_points p ON p.series_id = s.id
      GROUP BY s.id
    `,
      )
      .all()
  }

  getSeries(
    id: string,
  ): { id: string; name: string; code: string; description: string; points: RawPoint[] } | null {
    const meta = this.db.prepare('SELECT * FROM series WHERE id = ?').get(id) as
      | { id: string; name: string; code: string; description: string }
      | undefined
    if (!meta) return null
    const points = this.db
      .prepare<[string], RawPoint>(
        'SELECT date, value FROM series_points WHERE series_id = ? ORDER BY date',
      )
      .all(id)
    return { ...meta, points }
  }

  close(): void {
    this.db.close()
  }

  /** @internal Test hook: whether this connection has FK enforcement on. */
  isForeignKeysEnabled(): boolean {
    return this.db.pragma('foreign_keys', { simple: true }) === 1
  }
}

/**
 * Probe a path to see whether it is a usable TSV database.
 * Returns true only if the file opens read-only AND passes schema validation.
 */
export function checkPathReachable(filePath: string): boolean {
  try {
    const reader = new ExternalDBReader(filePath)
    reader.close()
    return true
  } catch {
    return false
  }
}
