import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { parseCSVText, parseClipboardHtml, parseExcelBuffer } from '../../lib/parse'
import { ipc } from '../../lib/ipc'
import type { DataSeries } from '../../../shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

type Grid = string[][]

interface Props {
  series: DataSeries[]
  initialGrid?: string[][]
  onDone: (series: DataSeries[]) => void
  onCancel: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert parsed DataSeries[] into an editable grid (dates × series). */
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_LOOKUP: Record<string, number> = {}
SHORT_MONTHS.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i })

function fmtDateDisplay(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = SHORT_MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day} ${mon} ${year}`
}

/**
 * Normalise any parseable date string to the "dd mmm yyyy" display format.
 * Returns the original string if it can't be parsed as a date.
 */
function normalizeDateDisplay(s: string): string {
  const t = s.trim()
  if (!t) return s
  const d = new Date(t)
  if (!isNaN(d.getTime())) return fmtDateDisplay(d)
  return s
}

/** Parse "dd mmm yyyy" back to a sortable YYYY-MM-DD key. */
function displayDateToKey(s: string): string {
  const parts = s.trim().split(/\s+/)
  if (parts.length !== 3) return s
  const day = parts[0].padStart(2, '0')
  const mi = MONTH_LOOKUP[parts[1].toLowerCase()]
  if (mi === undefined) return s
  const month = String(mi + 1).padStart(2, '0')
  return `${parts[2]}-${month}-${day}`
}

/**
 * Format a value cell for display: "2.12345%" → " 2.12 %"
 * Negatives use accounting-style parentheses: "-1.50%" → "(1.50)%"
 * Positive values are padded so the decimal point aligns with negatives.
 *
 * Also handles bare numeric strings from the IPC clipboard (e.g. scientific
 * notation like "-1.0500000000000001E-2"): values with |n| ≤ 1 are treated
 * as decimal fractions and multiplied by 100 before display.
 */
function displayPct(raw: string): string {
  const withPct = raw.endsWith('%')
  const numStr  = withPct ? raw.slice(0, -1) : raw.trim()
  if (numStr !== '') {
    const n = parseFloat(numStr)
    if (!isNaN(n)) {
      // Already-percentage values (with '%') are used as-is.
      // Bare decimal fractions (|n| ≤ 1, no '%') are scaled ×100.
      const pct = withPct || Math.abs(n) > 1 ? n : n * 100
      if (pct < 0) return `(${Math.abs(pct).toFixed(2)})%`
      return `\u2007${pct.toFixed(2)}\u2007%`
    }
  }
  return raw
}

function seriesToGrid(series: DataSeries[]): Grid {
  // Union all dates, sorted ascending
  const dateSet = new Map<string, Date>()
  for (const s of series) {
    for (const p of s.points) {
      const key = p.date.toISOString().slice(0, 10)
      if (!dateSet.has(key)) dateSet.set(key, p.date)
    }
  }
  const sortedDates = [...dateSet.entries()].sort(
    (a, b) => a[1].getTime() - b[1].getTime(),
  )

  // Build lookup: seriesId → { dateKey → value }
  const lookups = series.map((s) => {
    const map = new Map<string, number>()
    for (const p of s.points) map.set(p.date.toISOString().slice(0, 10), p.value)
    return map
  })

  // Header row
  const header = ['date', ...series.map((s) => s.name)]

  // Data rows — display-formatted dates and percentage values
  const rows = sortedDates.map(([dateKey, dateObj]) => [
    fmtDateDisplay(dateObj),
    ...lookups.map((lk) => {
      const v = lk.get(dateKey)
      return v != null ? `${v}%` : ''
    }),
  ])

  return [header, ...rows]
}

/** Pad every row to `cols` width. */
function padGrid(grid: Grid, cols: number): Grid {
  return grid.map((row) => {
    if (row.length >= cols) return row
    return [...row, ...Array(cols - row.length).fill('')]
  })
}

function gridToCSV(grid: Grid): string {
  return grid
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
            return `"${cell.replace(/"/g, '""')}"`
          return cell
        })
        .join(','),
    )
    .join('\n')
}

/**
 * Run a raw pasted grid through the same parseCSVText pipeline used by
 * PasteTable / FileDropZone — handles date disambiguation, value conversion
 * (cleanNumericRich, ×100 for bare decimals), and data-type detection.
 * Returns null if parsing finds no valid series.
 */
function parsePastedGrid(raw: Grid): DataSeries[] | null {
  const csv = gridToCSV(raw)
  const series = parseCSVText(csv)
  if (series.length > 0 && series[0].points.length > 0) return series
  return null
}

/** Strip all trailing empty columns from a grid. */
function stripTrailingEmpty(grid: Grid): Grid {
  if (grid.length === 0) return grid
  // Find the last column that has any non-empty content
  let lastDataCol = 0
  for (let ci = grid[0].length - 1; ci >= 1; ci--) {
    if (grid.some((row) => (row[ci] ?? '').trim() !== '')) {
      lastDataCol = ci
      break
    }
  }
  return grid.map((r) => r.slice(0, lastDataCol + 1))
}

/**
 * Merge new columns (from seriesToGrid output) into the existing grid,
 * aligned by date.  Tries exact YYYY-MM-DD match first, then YYYY-MM.
 * Unmatched dates are appended and the grid is re-sorted.
 * Returns the grid with exactly 1 trailing empty column.
 */
function mergeDateAligned(
  grid: Grid,
  newGrid: Grid, // seriesToGrid output: [header, ...dataRows], col 0 = date
): Grid {
  // Strip trailing empty columns so insertAt is always right after real data
  const clean = stripTrailingEmpty(grid)
  const insertAt = clean[0].length // append at the end of data columns

  const newHeaders = newGrid[0].slice(1) // skip "date"
  const colCount = newHeaders.length
  const emptyVals: string[] = Array(colCount).fill('')

  // Index existing grid dates using sortable YYYY-MM-DD keys
  const exactIndex = new Map<string, number>()
  const monthIndex = new Map<string, number>()
  for (let r = 1; r < clean.length; r++) {
    const dk = displayDateToKey(clean[r][0])
    if (!exactIndex.has(dk)) exactIndex.set(dk, r)
    const mk = dk.slice(0, 7)
    if (!monthIndex.has(mk)) monthIndex.set(mk, r)
  }

  // Map each new row to a grid row
  const gridRowToValues = new Map<number, string[]>()
  const unmappedNewRows: number[] = []

  for (let nr = 1; nr < newGrid.length; nr++) {
    const dk = displayDateToKey(newGrid[nr][0])
    const vals = newGrid[nr].slice(1)

    let gridRow = exactIndex.get(dk)
    if (gridRow === undefined) gridRow = monthIndex.get(dk.slice(0, 7))

    if (gridRow !== undefined && !gridRowToValues.has(gridRow)) {
      gridRowToValues.set(gridRow, vals)
    } else {
      unmappedNewRows.push(nr)
    }
  }

  // Build result — append new columns at the end of each row
  const next = clean.map((r) => [...r])
  next[0].push(...newHeaders)
  for (let r = 1; r < next.length; r++) {
    next[r].push(...(gridRowToValues.get(r) ?? emptyVals))
  }

  // Append unmapped rows (dates not in existing grid)
  if (unmappedNewRows.length > 0) {
    for (const nr of unmappedNewRows) {
      const row: string[] = Array(insertAt).fill('')
      row[0] = newGrid[nr][0]
      row.push(...newGrid[nr].slice(1))
      while (row.length < next[0].length) row.push('')
      next.push(row)
    }
    const header = next.shift()!
    next.sort((a, b) => displayDateToKey(a[0]).localeCompare(displayDateToKey(b[0])))
    next.unshift(header)
  }

  // Add exactly 1 trailing empty column
  const maxCols = Math.max(...next.map((r) => r.length))
  return padGrid(next, maxCols + 1)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UploadTablePage({ series, initialGrid, onDone, onCancel }: Props) {
  // Build grid from initialGrid (dateless path) or series + 1 empty column for pasting
  const [grid, setGrid] = useState<Grid>(() => {
    if (initialGrid && initialGrid.length > 0) {
      const stripped = stripTrailingEmpty(initialGrid)
      return padGrid(stripped, stripped[0].length + 1)
    }
    const base = seriesToGrid(series)
    return padGrid(base, base[0].length + 1)
  })

  const tableRef = useRef<HTMLTableElement>(null)
  const addMoreRef = useRef<HTMLInputElement>(null)
  const [focusedCell, setFocusedCell]       = useState<string | null>(null)
  const [dateError, setDateError]           = useState<string | null>(null)
  const [hoveredHeaderCol, setHoveredHeaderCol] = useState<number | null>(null)

  // Auto-clear date error once all date cells are filled
  useEffect(() => {
    if (dateError && grid.slice(1).every((row) => (row[0] ?? '').trim() !== '')) {
      setDateError(null)
    }
  }, [grid, dateError])

  const updateCell = useCallback((ri: number, ci: number, value: string) => {
    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      next[ri][ci] = value
      return next
    })
  }, [])

  // Feature 3: remove a series column by index
  const removeColumn = useCallback((ci: number) => {
    setHoveredHeaderCol(null)
    setGrid((prev) => {
      const next = prev.map((row) => [...row.slice(0, ci), ...row.slice(ci + 1)])
      const maxCols = Math.max(...next.map((r) => r.length))
      // Re-ensure exactly 1 trailing empty column
      const hasEmptyTrailing = next[0].some(
        (_, i) => i > 0 && next.every((r) => (r[i] ?? '').trim() === ''),
      )
      return hasEmptyTrailing ? next : padGrid(next, maxCols + 1)
    })
  }, [])

  // Paste handler — three branches, tried in order:
  //
  //   1. parsePastedGrid succeeds (data has a date column + values) → column-merge.
  //      Handles ALL multi-series-with-dates pastes regardless of which cell is focused.
  //   2. No dates detected + focused on trailing empty-col header → content-based append.
  //      Detects whether row 0 is a title row and positions values accordingly.
  //   3. No dates + any other cell → distribute downward from focused cell.
  //      Used for pasting titles, dates, or value ranges at a specific row.
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const targetCol = parseInt((e.currentTarget as HTMLInputElement).getAttribute('data-col') ?? '-1')
      const targetRow = parseInt((e.currentTarget as HTMLInputElement).getAttribute('data-row') ?? '-1')

      if (targetCol < 0 || targetRow < 0) return
      // "Date" header is read-only
      if (targetRow === 0 && targetCol === 0) return

      e.preventDefault()
      e.stopPropagation()

      // ── Gather clipboard data ─────────────────────────────────────────────────
      // Capture synchronous data BEFORE any await (browser may discard the
      // clipboard event after the first suspension point).
      let htmlGrid: Grid | null = null
      const html = e.clipboardData.getData('text/html')
      if (html) {
        const parsed = parseClipboardHtml(html)
        if (parsed && parsed.length > 0) htmlGrid = parsed
      }
      const textFallback = e.clipboardData.getData('text/plain')
      let textGrid: Grid | null = null
      if (textFallback.trim()) {
        textGrid = textFallback.trim().split(/\r?\n/).map((row) => row.split('\t'))
      }

      // Prefer IPC clipboard: reads binary Excel format for ISO dates and full
      // numeric precision, avoiding display-formatted strings like "Jan-24".
      let ipcGrid: Grid | null = null
      try { ipcGrid = await ipc.clipboard.readSpreadsheet() } catch { /* IPC unavailable */ }

      const candidates = [ipcGrid, htmlGrid, textGrid].filter(
        (g): g is Grid => g != null && g.length > 0,
      )
      if (candidates.length === 0) return
      const pastedGrid = candidates.reduce((best, g) => g.length > best.length ? g : best)

      // ── Branch 1: structured data with dates → column-merge ──────────────────
      // Always try first, regardless of which cell is focused, so multi-series
      // pastes work whether the user clicked on the empty column header or not.
      const parsedSeries = parsePastedGrid(pastedGrid)
      if (parsedSeries && parsedSeries.length > 0) {
        const newGrid = seriesToGrid(parsedSeries)
        setGrid((prev) => mergeDateAligned(prev, newGrid))
        return
      }

      // ── Branch 2: no dates, focused on trailing empty col header → append ────
      const isTrailingEmptyHeader =
        targetRow === 0 &&
        targetCol > 0 &&
        grid.every((row) => (row[targetCol] ?? '').trim() === '')

      if (isTrailingEmptyHeader) {
        const firstRowHasTitle = pastedGrid[0].some((cell) => {
          const t = cell.trim()
          return t !== '' && isNaN(parseFloat(t))
        })

        const headerCells = firstRowHasTitle ? pastedGrid[0] : pastedGrid[0].map(() => '')
        const valueRows   = firstRowHasTitle ? pastedGrid.slice(1) : pastedGrid
        const pastedCols  = Math.max(...pastedGrid.map((r) => r.length), 1)

        setGrid((prev) => {
          const clean    = stripTrailingEmpty(prev)
          const next     = clean.map((r) => [...r])
          const insertAt = next[0].length

          const paddedHeader = [...headerCells]
          while (paddedHeader.length < pastedCols) paddedHeader.push('')
          next[0].push(...paddedHeader)

          const totalDataRows = Math.max(next.length - 1, valueRows.length)
          for (let i = 0; i < totalDataRows; i++) {
            const ri  = i + 1
            const src = valueRows[i] ?? []
            const vals = [...src]
            while (vals.length < pastedCols) vals.push('')
            if (ri < next.length) {
              next[ri].push(...vals)
            } else {
              const newRow = Array(insertAt).fill('')
              newRow.push(...vals)
              next.push(newRow)
            }
          }

          const maxCols = Math.max(...next.map((r) => r.length))
          return padGrid(next, maxCols + 1)
        })
        return
      }

      // ── Branch 3: distribute downward from focused cell ──────────────────────
      setGrid((prev) => {
        const next = prev.map((r) => [...r])
        for (let ri = 0; ri < pastedGrid.length; ri++) {
          const gridRow = targetRow + ri
          if (gridRow >= next.length) break
          for (let ci2 = 0; ci2 < pastedGrid[ri].length; ci2++) {
            const gridCol = targetCol + ci2
            if (gridCol >= next[0].length) break
            const val = pastedGrid[ri][ci2]
            // Normalise date column to consistent "dd mmm yyyy" display format
            next[gridRow][gridCol] = gridRow > 0 && gridCol === 0
              ? normalizeDateDisplay(val)
              : val
          }
        }
        return next
      })
    },
    [grid],
  )

  // "Add more" file handler — date-aligned merge
  const handleAddMoreFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (addMoreRef.current) addMoreRef.current.value = ''
      try {
        const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
        let newSeries: DataSeries[]
        if (ext === '.csv' || ext === '.tsv' || file.type === 'text/csv') {
          newSeries = parseCSVText(await file.text())
        } else {
          newSeries = parseExcelBuffer(await file.arrayBuffer())
        }
        if (newSeries.length === 0) return

        const newGrid = seriesToGrid(newSeries)
        setGrid((prev) => mergeDateAligned(prev, newGrid))
      } catch {
        /* ignore */
      }
    },
    [],
  )

  // "Done" — re-parse the grid into series
  const handleDone = useCallback(() => {
    // Feature 1: require all date cells to be filled
    const emptyDates = grid.slice(1).some((row) => (row[0] ?? '').trim() === '')
    if (emptyDates) {
      setDateError('Paste dates into the date column before continuing.')
      return
    }

    // Strip trailing empty columns before parsing
    const trimmed = grid.map((row) => {
      let end = row.length
      while (end > 1 && row[end - 1].trim() === '') end--
      return row.slice(0, end)
    })
    const csv = gridToCSV(trimmed)
    const parsed = parseCSVText(csv)
    if (parsed.length > 0) {
      setDateError(null)
      onDone(parsed)
    } else {
      setDateError('Could not parse the dates. Check that the date column contains valid date values.')
    }
  }, [grid, onDone])

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
      let nextRow = ri
      let nextCol = ci
      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          nextCol = ci - 1
          if (nextCol < 0) {
            nextCol = grid[0].length - 1
            nextRow = ri - 1
          }
        } else {
          nextCol = ci + 1
          if (nextCol >= grid[0].length) {
            nextCol = 0
            nextRow = ri + 1
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        nextRow = e.shiftKey ? ri - 1 : ri + 1
      } else {
        return
      }
      if (nextRow < 0 || nextRow >= grid.length) return
      const cell = tableRef.current?.querySelector<HTMLInputElement>(
        `tr:nth-child(${nextRow + 1}) td:nth-child(${nextCol + 1}) input`,
      )
      cell?.focus()
      cell?.select()
    },
    [grid],
  )

  // Determine which columns are "empty" (no header and no data)
  const isEmptyCol = (ci: number) => {
    if (ci === 0) return false
    return grid.every((row) => (row[ci] ?? '').trim() === '')
  }

  const dataColCount = grid[0].slice(1).filter((_, i) => !isEmptyCol(i + 1)).length

  // Compute uniform series column width: fit the widest displayed value OR header.
  // All non-empty series columns share the same width.
  const seriesColWidth = useMemo(() => {
    const CHAR_PX = 7.2 // monospace char width at text-sm (tabular-nums)
    const PAD = 24       // px horizontal padding
    let widestChars = 0

    for (let ci = 1; ci < grid[0].length; ci++) {
      if (grid.every((row) => (row[ci] ?? '').trim() === '')) continue
      // Check header length
      widestChars = Math.max(widestChars, (grid[0][ci] ?? '').length)
      // Check all displayed values (formatted with displayPct)
      for (let ri = 1; ri < grid.length; ri++) {
        const displayed = displayPct(grid[ri][ci] ?? '')
        widestChars = Math.max(widestChars, displayed.length)
      }
    }

    return Math.max(80, widestChars * CHAR_PX + PAD)
  }, [grid])

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {grid.length - 1} rows · {dataColCount} series
          </span>
          <button
            type="button"
            onClick={() => addMoreRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add file
          </button>
          <input
            ref={addMoreRef}
            type="file"
            accept=".csv,.xlsx,.xls,.tsv"
            className="hidden"
            onChange={handleAddMoreFile}
          />
        </div>
        <div className="flex items-center gap-2">
          {dateError && (
            <span className="text-xs text-amber-500">{dateError}</span>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
      </div>

      {/* Scrollable table */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto rounded-lg border-2 border-border w-fit max-w-full">
        <table
          ref={tableRef}
          className="text-sm border-collapse"
        >
          <colgroup>
            <col style={{ width: 120, minWidth: 120 }} />
            {grid[0].slice(1).map((_, i) => {
              const ci = i + 1
              const empty = grid.every((row) => (row[ci] ?? '').trim() === '')
              const w = empty ? 120 : seriesColWidth
              return <col key={i} style={{ width: w, minWidth: w }} />
            })}
          </colgroup>
          <tbody>
            {grid.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-muted sticky top-0 z-10 shadow-[0_1px_0_0_var(--border)]' : ''}>
                {row.map((cell, ci) => {
                  const empty = isEmptyCol(ci)
                  const isHeader = ri === 0
                  const isDateCol = ci === 0
                  const isFocused = focusedCell === `${ri}:${ci}`

                  // Display value logic
                  let displayVal = cell
                  if (isHeader && isDateCol) {
                    displayVal = 'Date'
                  } else if (isHeader) {
                    displayVal = cell
                  } else if (isFocused) {
                    displayVal = cell
                  } else if (!isDateCol) {
                    displayVal = displayPct(cell)
                  }

                  // Feature 3: show X button on hoverable header columns
                  const canDelete = isHeader && !isDateCol && !empty
                  const showDeleteBtn = canDelete && hoveredHeaderCol === ci

                  return (
                    <td
                      key={ci}
                      onMouseEnter={canDelete ? () => setHoveredHeaderCol(ci) : undefined}
                      onMouseLeave={canDelete ? () => setHoveredHeaderCol(null) : undefined}
                      className={[
                        'border border-border p-0 relative',
                        isHeader ? 'bg-muted' : '',
                        isDateCol && !isHeader ? 'bg-muted/30' : '',
                        empty && !isHeader ? 'bg-primary/[0.02] border-dashed' : '',
                      ].join(' ')}
                    >
                      <input
                        data-col={ci}
                        data-row={ri}
                        value={displayVal}
                        onChange={(e) => {
                          // Don't allow editing the forced "Date" header
                          if (isHeader && isDateCol) return
                          updateCell(ri, ci, e.target.value)
                        }}
                        onPaste={handlePaste}
                        onFocus={() => setFocusedCell(`${ri}:${ci}`)}
                        onBlur={() => setFocusedCell(null)}
                        onKeyDown={(e) => handleCellKeyDown(e, ri, ci)}
                        readOnly={isHeader && isDateCol}
                        placeholder={
                          empty && isHeader
                            ? 'Paste here…'
                            : undefined
                        }
                        className={[
                          'w-full py-1 text-center',
                          showDeleteBtn ? 'pl-2 pr-5' : 'px-2',
                          isHeader ? 'bg-muted' : 'bg-transparent',
                          'focus:outline-none focus:bg-primary/5',
                          isHeader
                            ? [
                                'font-semibold',
                                !isDateCol && !empty ? 'truncate text-left' : '',
                              ].join(' ')
                            : isDateCol
                              ? 'font-mono tabular-nums text-muted-foreground'
                              : 'font-mono tabular-nums',
                          empty ? 'placeholder:text-muted-foreground/40 placeholder:italic' : '',
                        ].join(' ')}
                        title={isHeader && !isDateCol ? cell : undefined}
                      />
                      {showDeleteBtn && (
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeColumn(ci) }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-4 w-4 rounded-full bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-colors"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground shrink-0">
        Paste additional series into the empty column on the right. Dates are matched automatically. Tab/Enter to navigate cells.
      </p>
    </div>
  )
}
