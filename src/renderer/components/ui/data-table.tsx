"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Save, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ipc } from '../../lib/ipc'
import type { DBRecord, DataSeries } from '../../../shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${y} ${MONTHS[parseInt(m, 10) - 1]} ${d}`
}

function parseValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

// ─── EditableHeader ───────────────────────────────────────────────────────────

interface EditableHeaderProps {
  name: string
  dirty: boolean
  onCommit: (newName: string) => void
  onFocus?: () => void  // clears data-cell selection when header enters edit mode
}

function EditableHeader({ name, dirty, onCommit, onFocus }: EditableHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState(name)
  const wrapperRef            = useRef<HTMLDivElement>(null)
  const inputRef              = useRef<HTMLInputElement>(null)

  function startEdit() {
    setValue(name)
    setEditing(true)
    onFocus?.()
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function confirm() {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name) onCommit(trimmed)
    setEditing(false)
  }

  function cancel() {
    setValue(name)
    setEditing(false)
  }

  useEffect(() => {
    if (!editing) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) cancel()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editing, value, name])

  if (editing) {
    return (
      <div ref={wrapperRef} className="flex items-center gap-1 px-2 py-1.5 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  { e.preventDefault(); confirm() }
            if (e.key === 'Escape') { e.preventDefault(); cancel()  }
          }}
          className={cn(
            'flex-1 min-w-0 px-1.5 py-0.5 text-sm font-medium text-center rounded',
            'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400',
            'outline-none ring-1 ring-blue-400/50',
          )}
        />
        <button
          type="button"
          onClick={confirm}
          className="shrink-0 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
          aria-label="Confirm name"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          className="shrink-0 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          aria-label="Cancel edit"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className={cn(
        'w-full px-3 py-2.5 text-sm font-medium text-center whitespace-nowrap',
        'hover:text-foreground transition-colors',
        dirty ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground',
      )}
    >
      {name}
    </button>
  )
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

type CellCoord = { rowIdx: number; colIdx: number }

interface CellProps {
  displayValue: string
  dirty: boolean
  selected: boolean
  inRange: boolean
  editing: boolean
  editValue: string
  inputRef: React.RefObject<HTMLInputElement>
  rowIdx: number
  colIdx: number
  onPointerDown: (e: React.PointerEvent) => void
  onDoubleClick: () => void
  onEditChange: (v: string) => void
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

function Cell({
  displayValue, dirty, selected, inRange, editing, editValue,
  inputRef, rowIdx, colIdx, onPointerDown, onDoubleClick, onEditChange, onInputKeyDown,
}: CellProps) {
  return (
    <td
      data-row={rowIdx}
      data-col={colIdx}
      className={cn(
        'border-r border-border last:border-r-0 p-0 relative',
        inRange && !selected && 'bg-blue-100 dark:bg-blue-900/50',
        selected && 'bg-blue-50 dark:bg-blue-950/40',
        selected && '[box-shadow:inset_0_0_0_2px_#3b82f6] dark:[box-shadow:inset_0_0_0_2px_#60a5fa] z-[5]',
      )}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          className={cn(
            'w-full h-full px-3 py-2.5 text-sm tabular-nums text-center',
            'bg-blue-50 dark:bg-blue-950/40 outline-none',
            'text-blue-700 dark:text-blue-300',
          )}
        />
      ) : (
        <div
          className={cn(
            'px-3 py-2.5 text-sm tabular-nums text-center select-none',
            dirty ? 'text-blue-600 dark:text-blue-400' : 'text-foreground',
            !displayValue && 'text-muted-foreground/30',
          )}
        >
          {displayValue || '—'}
        </div>
      )}
    </td>
  )
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export interface DataTableProps {
  records: DBRecord[]
  dbPath: string | null
  dbId: string | null
  filter: string | 'all'
}

type Edits = Record<string, Record<string, string>> // seriesId → isoDate → raw input

export function DataTable({ records, dbPath, dbId, filter }: DataTableProps) {
  const [allSeries, setAllSeries]   = useState<DataSeries[]>([])
  const [loading, setLoading]       = useState(false)
  const [edits, setEdits]           = useState<Edits>({})
  const [nameEdits, setNameEdits]   = useState<Record<string, string>>({})
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)

  // Excel-like navigation state — single atomic state prevents sel/anchor desync
  const [range, setRange]       = useState<{ anchor: CellCoord; cursor: CellCoord } | null>(null)
  const [editMode, setEditMode] = useState(false)

  // Derived — read-only views into range used throughout
  const sel    = range?.cursor ?? null
  const anchor = range?.anchor ?? null
  const [editValue, setEditValue] = useState('')
  const [preEditValue, setPreEditValue] = useState('') // saved for Escape

  const [tableScale, setTableScale] = useState(1.0)
  const TABLE_SCALE_MIN  = 0.75
  const TABLE_SCALE_MAX  = 1.3
  const TABLE_SCALE_STEP = 0.05

  const wrapRef      = useRef<HTMLDivElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)   // inner overflow container
  const inputRef     = useRef<HTMLInputElement>(null)

  // Which series to show based on filter
  const visibleRecords = useMemo(
    () => filter === 'all' ? records : records.filter((r) => r.id === filter),
    [records, filter],
  )

  // Fetch full series (with points) whenever visible set changes
  useEffect(() => {
    if (visibleRecords.length === 0) { setAllSeries([]); return }
    let cancelled = false
    setLoading(true)
    setEdits({})
    setNameEdits({})
    setSaveError(null)
    setRange(null)
    setEditMode(false)

    Promise.all(
      visibleRecords.map((r) =>
        dbPath
          ? ipc.external.getSeries(dbPath, r.id, dbId ?? r.id)
          : ipc.memory.getSeries(r.id),
      ),
    )
      .then((results) => {
        if (!cancelled) setAllSeries(results.filter((s): s is DataSeries => s !== null))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [visibleRecords, dbPath, dbId])

  // Pivot: sorted union of all dates × all series
  const { dates, pivot } = useMemo(() => {
    const dateSet = new Set<string>()
    for (const s of allSeries) {
      for (const p of s.points) dateSet.add(p.date.toISOString().slice(0, 10))
    }
    const dates = Array.from(dateSet).sort()

    const pivot: Record<string, Record<string, number | null>> = {}
    for (const d of dates) {
      pivot[d] = {}
      for (const s of allSeries) pivot[d][s.id] = null
    }
    for (const s of allSeries) {
      for (const p of s.points) {
        pivot[p.date.toISOString().slice(0, 10)][s.id] = p.value
      }
    }
    return { dates, pivot }
  }, [allSeries])

  // Measure the widest series name using canvas (no DOM re-flow needed)
  const colWidth = useMemo(() => {
    if (allSeries.length === 0) return 100
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return 120
    ctx.font = '500 14px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    const maxTextPx = Math.max(...allSeries.map((s) => ctx.measureText(nameEdits[s.id] ?? s.name).width))
    return Math.ceil(maxTextPx) + 32
  }, [allSeries, nameEdits])

  const isDirty = Object.values(edits).some((row) => Object.keys(row).length > 0)
    || Object.keys(nameEdits).length > 0

  const numRows = dates.length
  const numCols = allSeries.length

  // ── Cell value helpers ─────────────────────────────────────────────────────

  function getCellDisplay(seriesId: string, date: string): string {
    if (edits[seriesId]?.[date] !== undefined) return edits[seriesId][date]
    const v = pivot[date]?.[seriesId]
    return v !== null && v !== undefined ? String(v) : ''
  }

  function getCellValue(r: number, c: number): string {
    if (r < 0 || r >= numRows || c < 0 || c >= numCols) return ''
    return getCellDisplay(allSeries[c].id, dates[r])
  }

  function isInRange(r: number, c: number): boolean {
    if (!range) return false
    const minR = Math.min(range.cursor.rowIdx, range.anchor.rowIdx)
    const maxR = Math.max(range.cursor.rowIdx, range.anchor.rowIdx)
    const minC = Math.min(range.cursor.colIdx, range.anchor.colIdx)
    const maxC = Math.max(range.cursor.colIdx, range.anchor.colIdx)
    return r >= minR && r <= maxR && c >= minC && c <= maxC
  }

  // ── Excel Ctrl+Arrow: find block edge ─────────────────────────────────────

  function ctrlTarget(axis: 'row' | 'col', dir: 1 | -1, from: CellCoord): CellCoord {
    let r = from.rowIdx
    let c = from.colIdx
    const limit = axis === 'row' ? numRows - 1 : numCols - 1
    const getPos  = () => axis === 'row' ? r : c
    const setPos  = (v: number) => { if (axis === 'row') r = v; else c = v }

    const currentEmpty = getCellValue(r, c) === ''

    if (currentEmpty) {
      // From empty: jump to next non-empty, or edge if none
      let p = getPos() + dir
      while (p >= 0 && p <= limit) {
        setPos(p)
        if (getCellValue(r, c) !== '') break
        p += dir
      }
      if (getCellValue(r, c) === '') setPos(dir > 0 ? limit : 0)
    } else {
      const nextPos = getPos() + dir
      if (nextPos < 0 || nextPos > limit) {
        // Already at edge
        setPos(dir > 0 ? limit : 0)
      } else {
        const nR = axis === 'row' ? nextPos : r
        const nC = axis === 'col' ? nextPos : c
        if (getCellValue(nR, nC) === '') {
          // Next is empty: jump to next non-empty after the gap
          let p = nextPos
          setPos(p)
          while (p >= 0 && p <= limit) {
            setPos(p)
            if (getCellValue(r, c) !== '') break
            p += dir
          }
          if (getCellValue(r, c) === '') setPos(dir > 0 ? limit : 0)
        } else {
          // Next is filled: scan to end of contiguous block
          let p = nextPos
          while (p >= 0 && p <= limit) {
            const after = p + dir
            if (after < 0 || after > limit) { setPos(p); break }
            const aR = axis === 'row' ? after : r
            const aC = axis === 'col' ? after : c
            if (getCellValue(aR, aC) === '') { setPos(p); break }
            p += dir
          }
        }
      }
    }
    return { rowIdx: r, colIdx: c }
  }

  // ── Selection + edit management ────────────────────────────────────────────

  function clampCoord(coord: CellCoord): CellCoord {
    return {
      rowIdx: Math.max(0, Math.min(numRows - 1, coord.rowIdx)),
      colIdx: Math.max(0, Math.min(numCols - 1, coord.colIdx)),
    }
  }

  function commitEdit(value: string, coord: CellCoord) {
    const seriesId = allSeries[coord.colIdx].id
    const date     = dates[coord.rowIdx]
    setEdits((prev) => ({
      ...prev,
      [seriesId]: { ...(prev[seriesId] ?? {}), [date]: value },
    }))
    setEditMode(false)
  }

  function enterEdit(coord: CellCoord, initial: string, clearFirst: boolean) {
    const current = getCellValue(coord.rowIdx, coord.colIdx)
    setPreEditValue(current)
    setEditValue(clearFirst ? initial : current)
    setEditMode(true)
  }

  function move(dr: number, dc: number, extend: boolean, ctrl: boolean) {
    setRange((prev) => {
      const from = prev?.cursor ?? { rowIdx: 0, colIdx: 0 }
      let target = { rowIdx: from.rowIdx + dr, colIdx: from.colIdx + dc }
      if (ctrl) {
        if (dr !== 0) target = ctrlTarget('row', dr as 1 | -1, from)
        if (dc !== 0) target = ctrlTarget('col', dc as 1 | -1, from)
      }
      const cursor = clampCoord(target)
      // extend=true (Shift held): keep anchor fixed, advance cursor only
      // extend=false: anchor collapses to new cursor position (single-cell select)
      const anchor = extend ? (prev?.anchor ?? cursor) : cursor
      return { anchor, cursor }
    })
    setEditMode(false)
  }

  // Ctrl+scroll → zoom the table only (non-passive so we can preventDefault)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -TABLE_SCALE_STEP : TABLE_SCALE_STEP
      setTableScale((prev) => Math.max(TABLE_SCALE_MIN, Math.min(TABLE_SCALE_MAX, +(prev + delta).toFixed(2))))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Focus the editing input when entering edit mode
  useEffect(() => {
    if (editMode) {
      inputRef.current?.focus()
    }
  }, [editMode])

  // Scroll active cell into view, accounting for the sticky thead and sticky Date column
  useEffect(() => {
    const container = scrollRef.current
    if (!sel || !container) return

    const cell = container.querySelector(
      `td[data-row="${sel.rowIdx}"][data-col="${sel.colIdx}"]`,
    ) as HTMLElement | null
    if (!cell) return

    const cRect     = container.getBoundingClientRect()
    const cellRect  = cell.getBoundingClientRect()

    // Measure the sticky header height so we don't scroll the cell behind it
    const thead      = container.querySelector('thead') as HTMLElement | null
    const stickyTop  = thead ? thead.getBoundingClientRect().height : 0

    // Measure the sticky Date column width
    const dateTh      = container.querySelector('th.sticky') as HTMLElement | null
    const stickyLeft  = dateTh ? dateTh.getBoundingClientRect().width : 0

    // Vertical: if cell is above the visible area (behind sticky header) scroll up;
    // if below the visible area scroll down
    if (cellRect.top < cRect.top + stickyTop) {
      container.scrollTop -= (cRect.top + stickyTop) - cellRect.top
    } else if (cellRect.bottom > cRect.bottom) {
      container.scrollTop += cellRect.bottom - cRect.bottom
    }

    // Horizontal: account for sticky Date column on the left
    if (cellRect.left < cRect.left + stickyLeft) {
      container.scrollLeft -= (cRect.left + stickyLeft) - cellRect.left
    } else if (cellRect.right > cRect.right) {
      container.scrollLeft += cellRect.right - cRect.right
    }
  }, [sel])

  // ── Keyboard: navigation mode (wrapRef) ───────────────────────────────────

  function handleWrapKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (editMode) return

    const ctrl  = e.ctrlKey || e.metaKey
    const shift = e.shiftKey
    const nav   = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter']

    // No cell selected: any nav key selects (0,0)
    if (!sel) {
      if (nav.includes(e.key)) {
        e.preventDefault()
        const c = { rowIdx: 0, colIdx: 0 }
        setRange({ anchor: c, cursor: c })
      }
      return
    }

    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); move(-1,  0, shift, ctrl); break
      case 'ArrowDown':  e.preventDefault(); move( 1,  0, shift, ctrl); break
      case 'ArrowLeft':  e.preventDefault(); move( 0, -1, shift, ctrl); break
      case 'ArrowRight': e.preventDefault(); move( 0,  1, shift, ctrl); break

      case 'Tab':
        e.preventDefault()
        move(0, shift ? -1 : 1, false, false)
        break

      case 'Enter':
        e.preventDefault()
        move(shift ? -1 : 1, 0, false, false)
        break

      case 'F2':
        e.preventDefault()
        enterEdit(sel, '', false)
        break

      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        setEdits((prev) => {
          const next = { ...prev }
          const minR = anchor ? Math.min(sel.rowIdx, anchor.rowIdx) : sel.rowIdx
          const maxR = anchor ? Math.max(sel.rowIdx, anchor.rowIdx) : sel.rowIdx
          const minC = anchor ? Math.min(sel.colIdx, anchor.colIdx) : sel.colIdx
          const maxC = anchor ? Math.max(sel.colIdx, anchor.colIdx) : sel.colIdx
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              const sid = allSeries[c].id
              const d   = dates[r]
              next[sid] = { ...(next[sid] ?? {}), [d]: '' }
            }
          }
          return next
        })
        break

      case 'Escape':
        e.preventDefault()
        setRange(null)
        break

      default:
        // Printable char → clear and start editing
        if (e.key.length === 1 && !ctrl && !e.altKey) {
          e.preventDefault()
          enterEdit(sel, e.key, true)
        }
        break
    }
  }

  // ── Keyboard: edit mode (input inside Cell) ────────────────────────────────

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!sel) return

    const refocus = () => setTimeout(() => wrapRef.current?.focus({ preventScroll: true }), 0)

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setEditMode(false)
        setEditValue(preEditValue)
        refocus()
        break

      case 'Enter':
        e.preventDefault()
        commitEdit(editValue, sel)
        move(e.shiftKey ? -1 : 1, 0, false, false)
        refocus()
        break

      case 'Tab':
        e.preventDefault()
        commitEdit(editValue, sel)
        move(0, e.shiftKey ? -1 : 1, false, false)
        refocus()
        break

      case 'ArrowUp':
        e.preventDefault()
        commitEdit(editValue, sel)
        move(-1, 0, false, false)
        refocus()
        break

      case 'ArrowDown':
        e.preventDefault()
        commitEdit(editValue, sel)
        move(1, 0, false, false)
        refocus()
        break
    }
  }

  // ── Pointer handlers ───────────────────────────────────────────────────────

  function handleCellPointerDown(e: React.PointerEvent, rowIdx: number, colIdx: number) {
    e.preventDefault()
    // Commit any in-progress edit first
    if (editMode && sel) commitEdit(editValue, sel)
    const coord = { rowIdx, colIdx }
    setRange((prev) => e.shiftKey && prev
      ? { anchor: prev.anchor, cursor: coord }
      : { anchor: coord, cursor: coord }
    )
    setEditMode(false)
    wrapRef.current?.focus({ preventScroll: true })
  }

  function handleCellDoubleClick(rowIdx: number, colIdx: number) {
    const coord = { rowIdx, colIdx }
    setRange({ anchor: coord, cursor: coord })
    enterEdit(coord, '', false)
  }

  // ── Name / save handlers ───────────────────────────────────────────────────

  function handleNameCommit(id: string, newName: string) {
    setNameEdits((prev) => ({ ...prev, [id]: newName }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      for (const s of allSeries) {
        const seriesEdits   = edits[s.id]
        const newName       = nameEdits[s.id]
        const hasPointEdits = seriesEdits && Object.keys(seriesEdits).length > 0
        if (!hasPointEdits && !newName) continue

        const pointMap = new Map<string, number>()
        for (const p of s.points) pointMap.set(p.date.toISOString().slice(0, 10), p.value)

        if (hasPointEdits) {
          for (const [date, raw] of Object.entries(seriesEdits!)) {
            const n = parseValue(raw)
            if (n === null) pointMap.delete(date)
            else pointMap.set(date, n)
          }
        }

        const updatedPoints = Array.from(pointMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({ date: new Date(date), value }))

        const updated: DataSeries = {
          ...s,
          name: newName ?? s.name,
          points: updatedPoints,
          originalPoints: updatedPoints.map((p) => ({ ...p })),
        }

        if (dbPath) await ipc.external.saveSeries(dbPath, updated)
        else        await ipc.memory.saveSeries(updated)
      }

      // Flush edits into allSeries so the table reflects saved state
      setAllSeries((prev) =>
        prev.map((s) => {
          const seriesEdits   = edits[s.id]
          const newName       = nameEdits[s.id]
          const hasPointEdits = seriesEdits && Object.keys(seriesEdits).length > 0
          if (!hasPointEdits && !newName) return s
          const pointMap = new Map<string, number>()
          for (const p of s.points) pointMap.set(p.date.toISOString().slice(0, 10), p.value)
          if (hasPointEdits) {
            for (const [date, raw] of Object.entries(seriesEdits!)) {
              const n = parseValue(raw)
              if (n === null) pointMap.delete(date)
              else pointMap.set(date, n)
            }
          }
          const pts = Array.from(pointMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ date: new Date(date), value }))
          return { ...s, name: newName ?? s.name, points: pts, originalPoints: pts.map((p) => ({ ...p })) }
        }),
      )
      setEdits({})
      setNameEdits({})
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground italic">
        No series in this database.
      </div>
    )
  }

  if (allSeries.length === 0 || dates.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground italic">
        No data points.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Save bar — only rendered when there is something to show */}
      {(isDirty || saveError) && (
        <div className="flex items-center justify-between">
          {saveError && (
            <span className="text-xs text-destructive">{saveError}</span>
          )}
          {isDirty && !saveError && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <div className="ml-auto">
            {isDirty && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                  'bg-blue-600 hover:bg-blue-700 text-white transition-colors',
                  saving && 'opacity-60 cursor-not-allowed',
                )}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={handleWrapKeyDown}
        className="w-fit max-w-full flex-1 min-h-0 outline-none"
      >
        <div ref={scrollRef} className="overflow-x-auto overflow-y-auto h-full rounded-lg border border-border bg-card shadow-sm">
          <table className="text-sm border-collapse" style={{ zoom: tableScale }}>
            <thead className="sticky top-0 z-20 bg-card">
              <tr className="border-b border-border bg-muted/40">
                <th className="sticky left-0 z-30 bg-card px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap border-r border-border">
                  Date
                </th>
                {allSeries.map((s) => (
                  <th
                    key={s.id}
                    className="p-0 text-center font-medium whitespace-nowrap border-r border-border last:border-r-0"
                    style={{ minWidth: colWidth, width: colWidth }}
                  >
                    <EditableHeader
                      name={nameEdits[s.id] ?? s.name}
                      dirty={nameEdits[s.id] !== undefined}
                      onCommit={(newName) => handleNameCommit(s.id, newName)}
                      onFocus={() => { setRange(null); setEditMode(false) }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, rowIdx) => (
                <tr
                  key={date}
                  className={cn(
                    'border-b border-border last:border-none',
                    rowIdx % 2 === 0 ? 'bg-card' : 'bg-muted/20',
                    'hover:bg-muted/40 transition-colors',
                  )}
                >
                  <td className="sticky left-0 z-10 px-3 py-0 font-mono text-xs text-muted-foreground whitespace-nowrap border-r border-border bg-inherit">
                    {fmtDate(date)}
                  </td>
                  {allSeries.map((s, colIdx) => {
                    const isSelected = sel?.rowIdx === rowIdx && sel?.colIdx === colIdx
                    const isEditing  = isSelected && editMode
                    const display    = getCellDisplay(s.id, date)
                    const dirty      = edits[s.id]?.[date] !== undefined

                    return (
                      <Cell
                        key={s.id}
                        displayValue={display}
                        dirty={dirty}
                        selected={isSelected}
                        inRange={isInRange(rowIdx, colIdx)}
                        editing={isEditing}
                        editValue={isEditing ? editValue : display}
                        inputRef={inputRef}
                        rowIdx={rowIdx}
                        colIdx={colIdx}
                        onPointerDown={(e) => handleCellPointerDown(e, rowIdx, colIdx)}
                        onDoubleClick={() => handleCellDoubleClick(rowIdx, colIdx)}
                        onEditChange={setEditValue}
                        onInputKeyDown={handleInputKeyDown}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
