import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { DataSeries, DataPoint, DataType } from '../../shared/types'
import { detectFrequency, snapToFrequency } from './freq'

function makeId(): string {
  return crypto.randomUUID()
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

const SLASH_RE = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/
const QUARTER_RE = /^Q([1-4])\s*[\/\-]?\s*(\d{4})$/i
const YEAR_QUARTER_RE = /^(\d{4})\s*[\/\-]?\s*Q([1-4])$/i
const MONTH_YEAR_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*[,\-]?\s*(\d{2,4})$/i
const DAY_MONTH_YEAR_RE = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})$/i
const YYYY_MM_RE = /^(\d{4})[\/\-](\d{1,2})$/

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Parse a single date string, supporting multiple formats:
 * - ISO dates (2023-01-15)
 * - Quarter labels: "Q1 2023", "2023-Q1" → last day of that quarter
 * - Monthly labels: "Jan 2023", "January 2023", "2023-01" → last day of that month
 * - Fallback: native Date parser
 */
function parseFlexibleDate(raw: string): Date {
  const s = raw.trim()

  // Quarter: Q1 2023, Q2/2023, etc.
  let qm = s.match(QUARTER_RE)
  if (qm) {
    const q = parseInt(qm[1])
    const y = parseInt(qm[2])
    return new Date(Date.UTC(y, q * 3, 0)) // last day of quarter
  }
  qm = s.match(YEAR_QUARTER_RE)
  if (qm) {
    const y = parseInt(qm[1])
    const q = parseInt(qm[2])
    return new Date(Date.UTC(y, q * 3, 0))
  }

  // Month-year: "Jan 2023", "January 2023", "Mar-60", "Sep-99"
  const mm = s.match(MONTH_YEAR_RE)
  if (mm) {
    const month = MONTH_MAP[mm[1].slice(0, 3).toLowerCase()]
    let year = parseInt(mm[2])
    if (year < 100) year += year < 50 ? 2000 : 1900 // 60 → 1960, 23 → 2023
    return new Date(Date.UTC(year, month, 0)) // last day of that month
  }

  // Day-month-year: "01 Jan 2023", "15 Mar 2023"
  const dmy = s.match(DAY_MONTH_YEAR_RE)
  if (dmy) {
    const day = parseInt(dmy[1])
    const month = MONTH_MAP[dmy[2].slice(0, 3).toLowerCase()]
    const year = parseInt(dmy[3])
    return new Date(Date.UTC(year, month - 1, day))
  }

  // YYYY-MM: "2023-01"
  const ym = s.match(YYYY_MM_RE)
  if (ym) {
    const year = parseInt(ym[1])
    const month = parseInt(ym[2])
    return new Date(Date.UTC(year, month, 0)) // last day of that month
  }

  return new Date(s)
}

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

export type DateFormat = 'DMY' | 'MDY' | 'ISO'

interface ParsedDateResult {
  dates: Date[]
  format: DateFormat
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
export function parseDateColumn(values: string[], forceFormat?: DateFormat): ParsedDateResult {
  const trimmed = values.map((v) => v.trim())
  const matches = trimmed.map((v) => v.match(SLASH_RE))
  const allSlash = matches.every(Boolean)

  if (!allSlash) {
    // Non-slash column (ISO, English long-form, etc.) — trust native parsing
    return { dates: trimmed.map((v) => parseFlexibleDate(v)), format: 'ISO' }
  }

  const parseDMY = (m: RegExpMatchArray): Date =>
    utcDate(parseInt(m[3]), parseInt(m[2]), parseInt(m[1]))
  const parseMDY = (m: RegExpMatchArray): Date =>
    utcDate(parseInt(m[3]), parseInt(m[1]), parseInt(m[2]))

  // Allow user override
  if (forceFormat === 'DMY') return { dates: matches.map((m) => (m ? parseDMY(m) : new Date(NaN))), format: 'DMY' }
  if (forceFormat === 'MDY') return { dates: matches.map((m) => (m ? parseMDY(m) : new Date(NaN))), format: 'MDY' }

  // Unambiguous: at least one value has day component > 12
  if (matches.some((m) => m && parseInt(m[1]) > 12)) {
    return { dates: matches.map((m) => (m ? parseDMY(m) : new Date(NaN))), format: 'DMY' }
  }

  // Unambiguous: second component > 12 → must be a day → MM/DD/YYYY
  if (matches.some((m) => m && parseInt(m[2]) > 12)) {
    return { dates: matches.map((m) => (m ? parseMDY(m) : new Date(NaN))), format: 'MDY' }
  }

  // Fully ambiguous: both A and B components are ≤ 12 throughout the column.
  const dmyDates = matches.map((m) => (m ? parseDMY(m) : new Date(NaN)))
  const mdyDates = matches.map((m) => (m ? parseMDY(m) : new Date(NaN)))

  const dmyGap = medianGapDays(dmyDates)
  const mdyGap = medianGapDays(mdyDates)

  // Choose the interpretation whose median gap is larger — it represents the
  // actual calendar spacing rather than the artificial 1-day cluster.
  if (dmyGap !== mdyGap) return dmyGap > mdyGap ? { dates: dmyDates, format: 'DMY' } : { dates: mdyDates, format: 'MDY' }
  // Tiebreaker (e.g. sparse ambiguous data): keep whichever spans more time.
  return spanMs(dmyDates) >= spanMs(mdyDates) ? { dates: dmyDates, format: 'DMY' } : { dates: mdyDates, format: 'MDY' }
}

// ─── Data type detection & conversion ────────────────────────────────────────

/**
 * Heuristic that classifies uploaded values as Level (prices/indices) or Growth (returns).
 *
 * negFrac > 0.15               → 'growth'  (returns frequently change sign)
 * negFrac < 0.05 AND medAbs > 20 → 'level'  (nearly all positive, price magnitude)
 * otherwise                    → 'growth'  (safe default)
 */
export function detectDataType(points: DataPoint[]): DataType {
  const N = points.length
  if (N === 0) return 'growth'
  const negFrac = points.filter(p => p.value < 0).length / N
  if (negFrac > 0.15) return 'growth'
  const absVals = points.map(p => Math.abs(p.value)).sort((a, b) => a - b)
  const medianAbs = absVals[Math.floor((N - 1) / 2)]
  if (negFrac < 0.05 && medianAbs > 20) return 'level'
  return 'growth'
}

/**
 * Converts N level data points into N growth rate points.
 *
 * growthPoints[0]  = { date: d₀, value: 0 }                (sentinel — no prior period)
 * growthPoints[i]  = { date: dᵢ, value: (valᵢ − valᵢ₋₁) / |valᵢ₋₁| }   (decimal form)
 * startingValue    = points[0].value                         (original first price)
 */
export function toGrowthRates(points: DataPoint[]): { growthPoints: DataPoint[]; startingValue: number } {
  const startingValue = points[0].value
  const growthPoints: DataPoint[] = [
    { date: points[0].date, value: 0 },
    ...points.slice(1).map((p, i) => ({
      date: p.date,
      value: (p.value - points[i].value) / Math.abs(points[i].value),
    })),
  ]
  return { growthPoints, startingValue }
}

// ─── Numeric cleaning ─────────────────────────────────────────────────────────

interface CleanResult { value: number; hasPct: boolean }

/**
 * Parse a single cell value, handling:
 *   - Parenthesised negatives: "(1.5)" → -1.5
 *   - Percent signs: "1.134%" → { value: 1.134, hasPct: true }
 *   - Currency symbols: "$1,234.56" → 1234.56
 *   - Thousand separators: "1,234" → 1234
 *
 * The `hasPct` flag is used at the column level to decide whether values that
 * lack a `%` are decimal fractions that need ×100 conversion.
 */
export function cleanNumericRich(raw: string): CleanResult {
  let s = raw.trim()
  // Accounting-style negatives: (value) → -value
  const isParens = s.startsWith('(') && s.endsWith(')')
  if (isParens) s = s.slice(1, -1).trim()
  // Detect and strip percent sign
  const hasPct = s.endsWith('%')
  if (hasPct) s = s.slice(0, -1)
  // Strip currency symbols and whitespace
  s = s.replace(/[£$€¥₹\s]/g, '')
  // Strip thousand separators (commas followed by 3 digits)
  s = s.replace(/,(\d{3})/g, '$1')
  let value = parseFloat(s)
  if (isParens && !isNaN(value)) value = -value
  return { value, hasPct }
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

  // Use meta.fields (the actual header row) instead of Object.keys(rows[0]),
  // because PapaParse omits keys from rows where the field has no value —
  // jagged CSVs (short early rows) would silently drop trailing columns.
  const headers = result.meta.fields ?? Object.keys(rows[0])
  const dateCol = headers[0]
  // Filter out blank-named columns — Excel sheets often carry trailing empty
  // columns within their used-range that produce phantom series with no data.
  // Apply the same _\d+ normalisation used for `name` so that PapaParse's
  // auto-renamed duplicates of blank headers (e.g. "_1", "_2") are also caught.
  const valueHeaders = headers.slice(1).filter(h => h.replace(/_\d+$/, '').trim() !== '')

  // Parse the entire date column at once so DD/MM vs MM/DD detection works
  // across the full column rather than ambiguously row-by-row.
  const { dates: parsedDates, format: detectedDateFormat } = parseDateColumn(rows.map((r) => r[dateCol] ?? ''))

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

  const totalRows = rows.length

  return valueHeaders.map((col, i) => {
    // First pass: parse each cell with rich metadata (value + hasPct flag)
    const richCells = rows.map((row, rowIdx) => ({
      date: parsedDates[rowIdx],
      ...cleanNumericRich(row[col] ?? ''),
    }))

    // All values stored in decimal form (0.052 = +5.2%).
    // If the cell had "%", divide the numeric part by 100 (e.g. "5.2%" → 0.052).
    // Bare decimals are already in the right form (e.g. "0.052" stays 0.052).
    const rawPoints = richCells
      .map((c) => ({
        date: c.date,
        value: c.hasPct ? c.value / 100 : c.value,
      }))
      .filter((p) => !isNaN(p.date.getTime()) && !isNaN(p.value))

    const droppedRows = totalRows - rawPoints.length
    const freq = detectFrequency(rawPoints)
    // Snap dates to canonical period-end (e.g. Apr 29 → Apr 30 for monthly)
    if (freq !== 'daily') {
      for (const p of rawPoints) p.date = snapToFrequency(p.date, freq)
    }

    const detectedType = detectDataType(rawPoints)
    let points = rawPoints
    let startingValue: number | undefined

    if (detectedType === 'level' && rawPoints.length > 0) {
      const converted = toGrowthRates(rawPoints)
      points = converted.growthPoints
      startingValue = converted.startingValue
    }

    return {
      id: makeId(),
      // Keep the user's original label for display, even if it's a duplicate.
      name: col.replace(/_\d+$/, ''),
      code: codes[i],
      description: '',
      data_freq: freq,
      source: 'memory' as const,
      dataType: detectedType,
      startingValue,
      droppedRows,
      dateFormat: detectedDateFormat,
      points,
      // Snapshot copy: 'Reset to Raw' must restore these exactly even after
      // an in-place mutation of `points`.
      originalPoints: points.map((p) => ({ ...p })),
    }
  })
}

function parseExcelSheet(ws: XLSX.WorkSheet): string {
  if (!ws['!ref']) return ''
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
        const d = cell.v as Date
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        cols.push(`${yyyy}-${mm}-${dd}`)
      } else if (c === range.s.c && cell.t === 'n' && !cell.w) {
        // First column, numeric with no format string — likely an Excel date serial number
        const d = excelSerialToDate(cell.v as number)
        if (d) {
          const yyyy = d.getUTCFullYear()
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
          const dd = String(d.getUTCDate()).padStart(2, '0')
          cols.push(`${yyyy}-${mm}-${dd}`)
        } else {
          cols.push(String(cell.v))
        }
      } else {
        cols.push(cell.w ?? String(cell.v))
      }
    }
    csvRows.push(cols.join(','))
  }
  return csvRows.join('\n')
}

/**
 * Convert an Excel date serial number to a UTC Date.
 * Excel epoch: 1900-01-01 = serial 1 (with the Lotus 1-2-3 leap year bug at serial 60).
 * Returns null for values that don't look like dates (< 1 or > 2958465 which is 9999-12-31).
 */
function excelSerialToDate(serial: number): Date | null {
  if (serial < 1 || serial > 2958465) return null
  // Adjust for Lotus 1-2-3 bug (Excel thinks 1900 is a leap year)
  const adjusted = serial > 60 ? serial - 1 : serial
  const ms = (adjusted - 1) * 86400000
  const epoch = Date.UTC(1900, 0, 1)
  return new Date(epoch + ms)
}

export function parseExcelBuffer(buffer: ArrayBuffer): DataSeries[] {
  // cellDates: true promotes numeric cells whose format code looks like a date
  // (e.g. "Nov-97") to type 'd' with a real JS Date value instead of a serial
  // number.  We avoid sheet_to_csv entirely and build the CSV ourselves.
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

  // Try all sheets, return the first one that produces valid series
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const csvText = parseExcelSheet(ws)
    if (!csvText) continue
    const series = parseCSVText(csvText)
    if (series.length > 0 && series[0].points.length > 0) return series
  }

  return []
}

/**
 * Parse Excel's HTML clipboard format via SheetJS.
 *
 * When copying cells, Excel embeds `x:num` attributes on `<td>` elements
 * containing the raw cell value (e.g. `<td x:num="0.01134098">1%</td>`).
 * SheetJS parses these into `cell.v` (raw value) vs `cell.w` (display string).
 *
 * Returns a tab-separated string grid (header + data rows) using raw values
 * for numeric cells, or null if the HTML doesn't contain a parseable table.
 */
/**
 * Convert an Excel serial date number to YYYY-MM-DD.
 * Excel epoch: serial 1 = Jan 1, 1900.
 * Accounts for the Lotus 1-2-3 bug (serial 60 = fake Feb 29, 1900).
 */
function excelSerialToISO(serial: number): string {
  // For serial > 60, subtract 1 to skip the phantom Feb 29, 1900
  const dayOffset = serial > 60 ? serial - 2 : serial - 1
  const d = new Date(Date.UTC(1900, 0, 1 + dayOffset))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseClipboardHtml(html: string): string[][] | null {
  // Primary: DOMParser — reads Excel's x:num attributes for full-precision values.
  // XLSX.read() crashes on some clipboard HTML formats, so DOMParser is more robust.
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (table) {
      const trs = table.querySelectorAll('tr')
      if (trs.length > 0) {
        const rows: string[][] = []
        for (const tr of trs) {
          const cells: string[] = []
          const tds = tr.querySelectorAll('td, th')
          for (let c = 0; c < tds.length; c++) {
            const td = tds[c]
            const xNum = td.getAttribute('x:num')
            if (c === 0) {
              // First column (dates): convert Excel serial → YYYY-MM-DD
              if (xNum != null && !isNaN(Number(xNum))) {
                cells.push(excelSerialToISO(Number(xNum)))
              } else {
                cells.push(td.textContent?.trim() ?? '')
              }
            } else {
              // Value columns: prefer x:num for full precision, fall back to text
              cells.push(xNum ?? td.textContent?.trim() ?? '')
            }
          }
          if (cells.length > 0) rows.push(cells)
        }
        if (rows.length > 0) return rows
      }
    }
  } catch { /* DOMParser failed — try XLSX fallback */ }

  // Fallback: XLSX parser (works for some HTML formats that DOMParser can't handle)
  try {
    const wb = XLSX.read(html, { type: 'string', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws?.['!ref']) return null

    const range = XLSX.utils.decode_range(ws['!ref'])
    const rows: string[][] = []

    for (let r = range.s.r; r <= range.e.r; r++) {
      const cols: string[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (!cell || cell.v == null) { cols.push(''); continue }

        if (c === range.s.c) {
          if (cell.t === 'd') {
            const d = cell.v as Date
            cols.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
          } else {
            cols.push(cell.w ?? String(cell.v))
          }
        } else {
          cols.push(String(cell.v))
        }
      }
      rows.push(cols)
    }

    if (rows.length === 0) return null
    return rows
  } catch { return null }
}
