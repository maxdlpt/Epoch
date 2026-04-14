import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { DataSeries } from '../../shared/types'

function makeId(): string {
  return crypto.randomUUID()
}

// TODO: dedupe in save flow — two uploads with a column named "Price" both yield
// code 'PRICE' and collide on the schema's UNIQUE constraint. Handle when Task 12
// SaveMenu is implemented.
export function parseCSVText(csvText: string): DataSeries[] {
  // Normalize tabs to commas so pasted TSV data (e.g. from Excel) parses correctly.
  const normalized = csvText.replace(/\t/g, ',')
  const result = Papa.parse<Record<string, string>>(normalized, { header: true, skipEmptyLines: true })
  const rows = result.data
  if (rows.length === 0) return []

  const headers = Object.keys(rows[0])
  const dateCol = headers[0]
  const valueHeaders = headers.slice(1)

  return valueHeaders.map(col => ({
    id: makeId(),
    name: col,
    code: col.toUpperCase().replace(/\s+/g, '_'),
    description: '',
    source: 'memory' as const,
    points: rows
      .map(row => ({
        date: new Date(row[dateCol]),
        value: parseFloat(row[col]),
      }))
      .filter(p => !isNaN(p.date.getTime()) && !isNaN(p.value)),
  }))
}

export function parseExcelBuffer(buffer: ArrayBuffer): DataSeries[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const csv = XLSX.utils.sheet_to_csv(ws)
  return parseCSVText(csv)
}
