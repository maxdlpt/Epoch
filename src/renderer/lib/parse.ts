import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { DataSeries } from '../../shared/types'
import { detectFrequency, snapToFrequency } from './freq'

function makeId(): string {
  return crypto.randomUUID()
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

const SLASH_RE = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year < 100 ? 2000 + year : year, month - 1, day))
}

function spanMs(dates: Date[]): number {
  let min = Infinity
  let max = -Infinity
  for (const d of dates) {
    const t = d.getTime()
    if (isNaN(t)) continue
    if (t < min) min = t
    if (t > max) max = t
  }
  return min === Infinity ? 0 : max - min
}

/**
 * Median consecutive gap in days for an array of Date objects (NaN values ignored).
 * Mirrors the logic in freq.ts but operates on Date[] rather than pre-sorted ms[].
 */
function medianGapDays(dates: Date[]): number {
  const ms = dates.map((d) => d.getTime()).filter((t) => !isNaN(t)).sort((a, b) => a - b)
  if (ms.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < ms.length; i++) {
    const g = (ms[i] - ms[i - 1]) / 86_400_000
    if (g > 0) gaps.push(g)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * Parse an array of date strings from a single CSV column, detecting DD/MM vs
 * MM/DD ambiguity at the column level instead of row-by-row.
 *
 * Detection order:
 *   1. Any first component > 12  → unambiguously DD/MM/YYYY.
 *   2. Any second component > 12 → unambiguously MM/DD/YYYY.
 *   3. Fully ambiguous (all components ≤ 12, e.g. first-of-month monthly data):
 *      compare the MEDIAN CONSECUTIVE GAP of each interpretation and choose the
 *      larger one.  The correct reading gives consistent ~30-day gaps; the wrong
 *      reading of "01/MM/YYYY" EU data maps dates to January 1–12 of each year,
 *      producing a bimodal distribution (1-day intra-month + 354-day year jumps)
 *      whose median collapses to 1 — reliably distinguishing it from the correct
 *      interpretation regardless of how many years the series spans.
 */
function parseDateColumn(values: string[]): Date[] {
  const trimmed = values.map((v) => v.trim())
  const matches = trimmed.map((v) => v.match(SLASH_RE))
  const allSlash = matches.every(Boolean)

  if (!allSlash) {
    // Non-slash column (ISO, English long-form, etc.) — trust native parsing
    return trimmed.map((v) => new Date(v))
  }

  const parseDMY = (m: RegExpMatchArray): Date =>
    utcDate(parseInt(m[3]), parseInt(m[2]), parseInt(m[1]))
  const parseMDY = (m: RegExpMatchArray): Date =>
    utcDate(parseInt(m[3]), parseInt(m[1]), parseInt(m[2]))

  // Unambiguous: at least one value has day component > 12
  if (matches.some((m) => m && parseInt(m[1]) > 12)) {
    return matches.map((m) => (m ? parseDMY(m) : new Date(NaN)))
  }

  // Unambiguous: second component > 12 → must be a day → MM/DD/YYYY
  if (matches.some((m) => m && parseInt(m[2]) > 12)) {
    return matches.map((m) => (m ? parseMDY(m) : new Date(NaN)))
  }

  // Fully ambiguous: both A and B components are ≤ 12 throughout the column.
  // Span comparison fails here: "01/MM/YYYY" monthly data read as MM/DD maps to
  // January 1–12 of each year, so both interpretations span roughly the same
  // total period and the ratio never reaches 5×.
  //
  // Median consecutive gap is the reliable discriminator:
  //   Correct interpretation  → consistent ~30-day (monthly) or ~1-day (daily) gaps
  //   Wrong interpretation    → bimodal: 1-day intra-January + ~354-day year jumps
  //                             whose median collapses to 1 day regardless of N.
  const dmyDates = matches.map((m) => (m ? parseDMY(m) : new Date(NaN)))
  const mdyDates = matches.map((m) => (m ? parseMDY(m) : new Date(NaN)))

  const dmyGap = medianGapDays(dmyDates)
  const mdyGap = medianGapDays(mdyDates)

  // Choose the interpretation whose median gap is larger — it represents the
  // actual calendar spacing rather than the artificial 1-day cluster.
  if (dmyGap !== mdyGap) return dmyGap > mdyGap ? dmyDates : mdyDates
  // Tiebreaker (e.g. sparse ambiguous data): keep whichever spans more time.
  return spanMs(dmyDates) >= spanMs(mdyDates) ? dmyDates : mdyDates
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
  // Filter out blank-named columns — Excel sheets often carry trailing empty
  // columns within their used-range that produce phantom series with no data.
  // Apply the same _\d+ normalisation used for `name` so that PapaParse's
  // auto-renamed duplicates of blank headers (e.g. "_1", "_2") are also caught.
  const valueHeaders = headers.slice(1).filter(h => h.replace(/_\d+$/, '').trim() !== '')

  // Parse the entire date column at once so DD/MM vs MM/DD detection works
  // across the full column rather than ambiguously row-by-row.
  const parsedDates = parseDateColumn(rows.map((r) => r[dateCol] ?? ''))

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
      .map((row, rowIdx) => ({
        date: parsedDates[rowIdx],
        value: parseFloat(row[col]),
      }))
      .filter((p) => !isNaN(p.date.getTime()) && !isNaN(p.value))
    const freq = detectFrequency(points)
    // Snap dates to canonical period-end (e.g. Apr 29 → Apr 30 for monthly)
    if (freq !== 'daily') {
      for (const p of points) p.date = snapToFrequency(p.date, freq)
    }
    return {
      id: makeId(),
      // Keep the user's original label for display, even if it's a duplicate.
      name: col.replace(/_\d+$/, ''),
      code: codes[i],
      description: '',
      data_freq: freq,
      source: 'memory' as const,
      points,
      // Snapshot copy: 'Reset to Raw' must restore these exactly even after
      // an in-place mutation of `points`.
      originalPoints: points.map((p) => ({ ...p })),
    }
  })
}

export function parseExcelBuffer(buffer: ArrayBuffer): DataSeries[] {
  // cellDates: true promotes numeric cells whose format code looks like a date
  // (e.g. "Nov-97") to type 'd' with a real JS Date value instead of a serial
  // number.  sheet_to_csv ignores dateNF for those cells and outputs the raw
  // formatted string ("Nov-97"), which new Date() then misparses.  We avoid
  // sheet_to_csv entirely and build the CSV ourselves:
  //   • Date column (c === first col, t === 'd'): emit ISO "YYYY-MM-DD"
  //   • All other cells: emit the formatted display string (cell.w) so that
  //     percentage values ("1.39%") keep their display scale through parseFloat.
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws['!ref']) return []

  const range = XLSX.utils.decode_range(ws['!ref'])
  const csvRows: string[] = []

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cols: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (!cell || cell.v == null) {
        cols.push('')
        continue
      }
      if (c === range.s.c && cell.t === 'd') {
        // First column, date cell → ISO YYYY-MM-DD (always unambiguous).
        // XLSX cellDates creates Date objects in LOCAL time, so we must use
        // getFullYear/getMonth/getDate (not toISOString which shifts to UTC
        // and can move BST midnight dates back one day into the wrong month).
        const d = cell.v as Date
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        cols.push(`${yyyy}-${mm}-${dd}`)
      } else {
        // Everything else: use the pre-formatted display string if available,
        // fall back to the raw value as a string.
        cols.push(cell.w ?? String(cell.v))
      }
    }
    csvRows.push(cols.join(','))
  }

  return parseCSVText(csvRows.join('\n'))
}
