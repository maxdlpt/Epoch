import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      code        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS series_points (
      series_id   TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      value       REAL NOT NULL,
      PRIMARY KEY (series_id, date)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Idempotent column additions — swallow "duplicate column name" errors on re-run.
  const addColumn = (sql: string) => {
    try {
      db.exec(sql)
    } catch {
      /* column already exists */
    }
  }
  addColumn(`ALTER TABLE series ADD COLUMN data_type     TEXT NOT NULL DEFAULT 'growth'`)
  addColumn(`ALTER TABLE series ADD COLUMN starting_value REAL`)

  // ── v2 migration: percentage-form → decimal-form values ────────────────────
  // Old format stored 5.2 for +5.2%; new format stores 0.052.
  const version = db.pragma('user_version', { simple: true }) as number
  if (version < 2) {
    db.exec('UPDATE series_points SET value = value / 100.0')
    // Clear stale session that still carries percentage-form values
    db.exec(`DELETE FROM settings WHERE key = 'graph_session'`)
    db.pragma('user_version = 2')
  }
}
