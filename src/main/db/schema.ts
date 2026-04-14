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
}
