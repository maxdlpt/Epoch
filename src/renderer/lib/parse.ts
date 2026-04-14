import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { DataSeries } from '../../shared/types'

function makeId(): string {
  return crypto.randomUUID()
}

// NOTE: within-file column-name collisions are disambiguated here at parse time
// using a `_2`, `_3`, ... suffix on `code` (display `name` keeps the original
// label so the UI still shows e.g. "Price"). Papa-parse renames duplicate
// header keys to "Price_1" itself; we strip that and apply our own 1-based-
// after-first scheme to match Excel/VSCode conventions.
//
// TODO(save flow): cross-upload collisions remain. Two SEPARATE uploads each
// with a column "Price" both produce code 'PRICE' and will collide on the
// schema's UNIQUE constraint. The save layer (Task 12 SaveMenu) needs to detect
// existing codes and prompt the user to rename, overwrite, or auto-suffix.
export function parseCSVText(csvText: string): DataSeries[] {
  // Normalize tabs to commas so pasted TSV data (e.g. from Excel) parses correctly.
  const normalized = csvText.replace(/\t/g, ',')
  const result = Papa.parse<Record<string, string>>(normalized, { header: true, skipEmptyLines: true })
  const rows = result.data
  if (rows.length === 0) return []

  const headers = Object.keys(rows[0])
  const dateCol = headers[0]
  const valueHeaders = headers.slice(1)

  // Disambiguate codes within this file using `_2`, `_3`, ... suffixes, based
  // on the user's original column label (after stripping Papa's auto-rename).
  const codeCounts = new Map<string, number>()
  const codes = valueHeaders.map((col) => {
    const original = col.replace(/_\d+$/, '')
    const baseCode = original.toUpperCase().replace(/\s+/g, '_')
    const seen = codeCounts.get(baseCode) ?? 0
    codeCounts.set(baseCode, seen + 1)
    return seen === 0 ? baseCode : `${baseCode}_${seen + 1}`
  })

  return valueHeaders.map((col, i) => {
    const points = rows
      .map(row => ({
        date: new Date(row[dateCol]),
        value: parseFloat(row[col]),
      }))
      .filter(p => !isNaN(p.date.getTime()) && !isNaN(p.value))
    return {
      id: makeId(),
      // Keep the user's original label for display, even if it's a duplicate.
      name: col.replace(/_\d+$/, ''),
      code: codes[i],
      description: '',
      source: 'memory' as const,
      points,
      // Snapshot copy: 'Reset to Raw' must restore these exactly even after
      // an in-place mutation of `points`.
      originalPoints: points.map(p => ({ ...p })),
    }
  })
}

export function parseExcelBuffer(buffer: ArrayBuffer): DataSeries[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const csv = XLSX.utils.sheet_to_csv(ws)
  return parseCSVText(csv)
}
