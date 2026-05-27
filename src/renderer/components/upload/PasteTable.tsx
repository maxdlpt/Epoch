import { useState, useEffect, useCallback, useRef } from 'react'
import { parseCSVText } from '../../lib/parse'
import { ipc } from '../../lib/ipc'
import type { DataSeries } from '../../../shared/types'

interface Props {
  onSeries: (series: DataSeries[]) => void
  onRawGrid?: (grid: string[][]) => void
}

type Grid = string[][]

function gridToCSV(grid: Grid): string {
  return grid.map((row) => row.map((cell) => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`
    }
    return cell
  }).join(',')).join('\n')
}

/** Forward parsed series immediately — no intermediate grid UI. */
function forwardGrid(grid: Grid, onSeries: (s: DataSeries[]) => void): boolean {
  const csv = gridToCSV(grid)
  const series = parseCSVText(csv)
  if (series.length > 0 && series[0].points.length > 0) {
    onSeries(series)
    return true
  }
  return false
}

/** True if any cell in the grid contains a numeric value (possible dateless series). */
function hasNumericData(grid: Grid): boolean {
  return grid.some((row) =>
    row.some((cell) => {
      const t = cell.trim().replace(/%$/, '')
      return t !== '' && !isNaN(parseFloat(t))
    }),
  )
}

/**
 * Build an initial table grid from pasted data that has no date column.
 * Row 0: ['Date', ...headers or empty strings]
 * Rows 1+: ['', ...values]
 */
function buildDatelessGrid(pastedGrid: Grid): Grid | null {
  if (pastedGrid.length === 0 || !hasNumericData(pastedGrid)) return null

  const numCols = Math.max(...pastedGrid.map((r) => r.length))

  // First row is a header if ALL its non-empty cells are non-numeric
  const firstRowIsHeader = pastedGrid[0].every((cell) => {
    const t = cell.trim()
    return t === '' || isNaN(parseFloat(t))
  })

  const headerCells = firstRowIsHeader ? pastedGrid[0] : Array(numCols).fill('')
  const dataRows    = firstRowIsHeader ? pastedGrid.slice(1) : pastedGrid

  if (dataRows.length === 0) return null

  const header: string[] = ['Date', ...headerCells]
  const rows: Grid = [header]

  for (const row of dataRows) {
    const padded = [...row]
    while (padded.length < numCols) padded.push('')
    rows.push(['', ...padded])
  }

  return rows
}

/**
 * Read spreadsheet data from the OS clipboard via the main process.
 * Retries up to 3 times with increasing delays (the clipboard may be
 * locked by the browser during paste event processing).
 */
async function readClipboardWithRetry(): Promise<Grid | null> {
  const delays = [0, 100, 300]
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    try {
      const grid = await ipc.clipboard.readSpreadsheet()
      if (grid && grid.length > 0) return grid
    } catch { /* IPC error — retry */ }
  }
  return null
}

export function PasteTable({ onSeries, onRawGrid }: Props) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  useEffect(() => {
    zoneRef.current?.focus()
  }, [])

  const tryProcess = useCallback((grid: Grid): boolean => {
    if (forwardGrid(grid, onSeries)) return true
    const raw = buildDatelessGrid(grid)
    if (raw && onRawGrid) {
      onRawGrid(raw)
      return true
    }
    return false
  }, [onSeries, onRawGrid])

  // Both Ctrl+V and button use the same IPC path — the main process reads
  // unsanitized HTML from the OS clipboard (preserving Excel's x:num attributes
  // for full precision), which the web clipboard API strips out.
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    e.preventDefault()
    setParseError(null)

    const grid = await readClipboardWithRetry()

    if (!grid) {
      setParseError('Could not read clipboard. Try the "Paste from clipboard" button below.')
      return
    }

    if (!tryProcess(grid)) {
      setParseError('No valid series found. Ensure data contains numbers, or include a date column as the first column.')
    }
  }, [tryProcess])

  const handleClipboardButton = useCallback(async () => {
    setParseError(null)
    try {
      const grid = await ipc.clipboard.readSpreadsheet()

      if (grid && grid.length > 0) {
        if (tryProcess(grid)) return
        setParseError('No valid series found. Ensure data contains numbers, or include a date column as the first column.')
        return
      }

      setParseError('Clipboard is empty. Copy data first, then click this button.')
    } catch {
      setParseError('Clipboard access denied. Use Ctrl+V to paste instead.')
    }
  }, [tryProcess])

  return (
    <div
      ref={zoneRef}
      tabIndex={0}
      onPaste={handlePaste}
      className={[
        'flex flex-col items-center justify-center min-h-48 rounded-lg gap-3',
        'border-2 border-dashed border-border',
        'text-muted-foreground text-sm cursor-text',
        'focus:outline-none focus:border-primary transition-colors',
      ].join(' ')}
    >
      <p className="font-medium">Paste your data here (Ctrl+V)</p>
      <p className="text-xs text-center">
        First row = headers · First column = dates (optional — you can add dates on the next screen)
      </p>
      <button
        type="button"
        onClick={handleClipboardButton}
        className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
      >
        Paste from clipboard
      </button>
      {parseError && (
        <p className="text-xs text-amber-500">{parseError}</p>
      )}
    </div>
  )
}
