import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useMotionValue } from 'motion/react'
import { Check, ChevronDown, Eye, EyeOff, Plus, RotateCcw, Save, X } from 'lucide-react'
import { useGraphStore } from '../../store/graph'
import { useAppStore } from '../../store/app'
import { useGraphManagerStore } from '../../store/graph-manager'
import { Button } from '../ui/button'
import { AreaChart, Area, XAxis, YAxis, Grid, SegmentBackground, SegmentLineFrom, SegmentLineTo, Crosshair, ChartTooltip, OriginLine, BaseLine } from '../ui/area-chart'
import { AddLinePanel } from '../graph/AddLinePanel'
import { SeriesEditPanel } from '../graph/SeriesEditPanel'
import { cn } from '../../lib/utils'
import { ipc, serializeSeries } from '../../lib/ipc'
import { Selector } from '../ui/segment-group'
import { computeMA } from '../../lib/ma'
import type { ChartMode, CumMethod } from '../../store/graph'
import { detectFrequency } from '../../lib/freq'
import type { DataFreq, DataSeries, DataPoint, SavedGraph } from '../../../shared/types'

function ExportImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect width="18" height="18" rx="2" transform="translate(3 3)" stroke="currentColor" strokeMiterlimit="10" strokeWidth="1.5" />
      <circle cx="2" cy="2" r="2" transform="translate(9 6)" stroke="currentColor" strokeMiterlimit="10" strokeWidth="1.5" />
      <path d="M0,5.616,4.776,2.121l3.773,2.9L13.8,0l3.835,2.1" transform="translate(3.226 11.839)" stroke="currentColor" strokeMiterlimit="10" strokeWidth="1.5" />
    </svg>
  )
}

function LineChartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path stroke="currentColor" strokeWidth="1" strokeLinejoin="round" d="M13,15c1.4854,0,2.5544,1.4966,3.6863,3.0811C17.9983,19.918,19.4854,22,22,22c5.6709,0,7.78-10.79,8-12l-1.9678-.3584C27.55,12.2827,25.3938,20,22,20c-1.4854,0-2.5544-1.4966-3.6863-3.0811C17.0017,15.082,15.5146,13,13,13c-4.186,0-7.4448,7.4043-9,11.7617V2H2V28a2.0025,2.0025,0,0,0,2,2H30V28H5.0439C6.5544,22.8574,9.9634,15,13,15Z"/>
    </svg>
  )
}

// ─── WindowDateTicker ─────────────────────────────────────────────────────────
// Spring-animated date scroller for the time-window header.
// Same dual-spring logic as the Crosshair DateTicker; styled to match the
// large bold date display (text-3xl font-black leading-none).

const WIN_ITEM_H = 30 // px — text-2xl font-black cap-height + descender room
const WIN_FONT_STYLE: CSSProperties = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
}
// #1C1C1C in light, its per-channel inverse #E3E3E3 in dark
const WIN_COLOR_CLASS = 'text-[#1C1C1C] dark:text-[#E3E3E3]'

function WindowDateTicker({ currentIndex, labels }: { currentIndex: number; labels: string[] }) {
  const parts = useMemo(
    () => labels.map(l => {
      const sp = l.lastIndexOf(' ')
      return sp === -1 ? { month: l, year: '' } : { month: l.slice(0, sp), year: l.slice(sp + 1) }
    }),
    [labels],
  )

  const uniqueYears = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const p of parts) {
      if (!seen.has(p.year)) { seen.add(p.year); result.push(p.year) }
    }
    return result
  }, [parts])

  const currentYearIndex = useMemo(() => {
    const year = parts[currentIndex]?.year ?? ''
    const i = uniqueYears.indexOf(year)
    return i === -1 ? 0 : i
  }, [currentIndex, parts, uniqueYears])

  const monthMV = useMotionValue(-currentIndex * WIN_ITEM_H)
  const yearMV  = useMotionValue(-currentYearIndex * WIN_ITEM_H)

  useEffect(() => { monthMV.set(-currentIndex * WIN_ITEM_H) }, [currentIndex, monthMV])
  useEffect(() => { yearMV.set(-currentYearIndex * WIN_ITEM_H) }, [currentYearIndex, yearMV])

  if (labels.length === 0) return null
  const hasYear = parts.some(p => p.year !== '')

  return (
    <div className="flex items-center gap-1.5" style={{ height: WIN_ITEM_H }}>
      <div className="relative overflow-hidden" style={{ height: WIN_ITEM_H }}>
        <motion.div className="flex flex-col" style={{ y: monthMV }}>
          {parts.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered index
            <div key={i} className="flex shrink-0 items-center" style={{ height: WIN_ITEM_H }}>
              <span className="whitespace-nowrap text-2xl font-black tabular-nums leading-none" style={WIN_FONT_STYLE}>
                {p.month}
              </span>
            </div>
          ))}
        </motion.div>
      </div>
      {hasYear && (
        <div className="relative overflow-hidden" style={{ height: WIN_ITEM_H }}>
          <motion.div className="flex flex-col" style={{ y: yearMV }}>
            {uniqueYears.map(year => (
              <div key={year} className="flex shrink-0 items-center" style={{ height: WIN_ITEM_H }}>
                <span className="whitespace-nowrap text-2xl font-black tabular-nums leading-none" style={WIN_FONT_STYLE}>
                  {year}
                </span>
              </div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  )
}

/**
 * Transform `activeSeries` into cumulative-return series.
 *
 * Intersection semantics: only dates where ALL visible series have an
 * originalPoint are included, so the chart never shows partial readings.
 * Hidden series are also filtered to the same intersection dates so they
 * display correctly if the user re-shows them.
 *
 * MAs are recomputed from the cumulative points so they smooth the index,
 * not the underlying raw returns.
 */
function applyCumulativeReturns(
  series: DataSeries[],
  method: CumMethod,
  baseInput: string,
): DataSeries[] {
  if (series.length === 0) return series

  const visible = series.filter(s => s.visible !== false)
  if (visible.length === 0) return series

  // Build timestamp intersection across all visible series
  const sets = visible.map(s => new Set(s.originalPoints.map(p => p.date.getTime())))
  const intersectionTs = new Set<number>(
    [...sets[0]].filter(t => sets.every(set => set.has(t))),
  )
  const sorted = Array.from(intersectionTs).sort((a, b) => a - b)
  if (sorted.length === 0) return series

  // Resolve base timestamp — closest intersection date to the user input
  let baseTs = sorted[0]
  if (baseInput.trim()) {
    const parsed = new Date(baseInput.trim())
    if (!isNaN(parsed.getTime())) {
      const target = parsed.getTime()
      baseTs = sorted.reduce((best, t) =>
        Math.abs(t - target) < Math.abs(best - target) ? t : best,
      )
    }
  }
  const baseIdx = sorted.indexOf(baseTs)

  return series.map(s => {
    const filtered = s.originalPoints.filter(p => intersectionTs.has(p.date.getTime()))
    if (filtered.length === 0) return s

    let cumPoints: DataPoint[]

    if (method === 'geometric') {
      const products: number[] = []
      let product = 1
      for (const p of filtered) {
        product *= (1 + p.value / 100)
        products.push(product)
      }
      const baseProduct = products[baseIdx] ?? products[0]
      cumPoints = filtered.map((p, i) => ({ date: p.date, value: 100 * products[i] / baseProduct }))
    } else {
      const sums: number[] = []
      let sum = 0
      for (const p of filtered) {
        sum += p.value
        sums.push(sum)
      }
      const baseSum = sums[baseIdx] ?? sums[0]
      cumPoints = filtered.map((p, i) => ({ date: p.date, value: 100 + (sums[i] - baseSum) }))
    }

    const newMAs = (s.movingAverages ?? []).map(ma => ({
      ...ma,
      points: computeMA(cumPoints, ma.type, ma.window),
    }))

    return { ...s, points: cumPoints, movingAverages: newMAs }
  })
}

/**
 * Apply drawdown transform to all series.
 *
 * 1. Compound period returns into a cumulative wealth index (geometric).
 * 2. Track the running peak of that index.
 * 3. Drawdown = (wealth - peak) / peak × 100  — always ≤ 0.
 *
 * Uses the same intersection-date semantics as cumulative mode so all
 * series start on the same date at 0%.
 */
function applyDrawdown(series: DataSeries[]): DataSeries[] {
  if (series.length === 0) return series

  const visible = series.filter(s => s.visible !== false)
  if (visible.length === 0) return series

  // Build timestamp intersection across all visible series
  const sets = visible.map(s => new Set(s.originalPoints.map(p => p.date.getTime())))
  const intersectionTs = new Set<number>(
    [...sets[0]].filter(t => sets.every(set => set.has(t))),
  )
  if (intersectionTs.size === 0) return series

  return series.map(s => {
    const filtered = s.originalPoints.filter(p => intersectionTs.has(p.date.getTime()))
    if (filtered.length === 0) return s

    // Step 1: compound returns into a wealth index
    let wealth = 1
    const levels: number[] = []
    for (const p of filtered) {
      wealth *= (1 + p.value / 100)
      levels.push(wealth)
    }

    // Step 2 & 3: running peak → drawdown percentage
    let peak = levels[0]
    const ddPoints: DataPoint[] = filtered.map((p, i) => {
      if (levels[i] > peak) peak = levels[i]
      return { date: p.date, value: ((levels[i] - peak) / peak) * 100 }
    })

    const newMAs = (s.movingAverages ?? []).map(ma => ({
      ...ma,
      points: computeMA(ddPoints, ma.type, ma.window),
    }))

    return { ...s, points: ddPoints, movingAverages: newMAs }
  })
}

/**
 * Pivot N series into a single row-per-date table for the chart.
 * Strategy: union of all dates across series, null where a series has no value at that date.
 * This preserves visible gaps in sparse data — honest for financial time-series.
 */
function pivotSeries(series: DataSeries[]): Record<string, unknown>[] {
  if (series.length === 0) return []

  // MA timestamps are always a strict subset of the parent series' timestamps
  // (same date indices, trimmed at edges), so only series.points need to seed
  // the timestamp set — no extra timestamps from MAs.
  const timestamps = new Set<number>()
  for (const s of series) for (const p of s.points) timestamps.add(p.date.getTime())
  const sorted = Array.from(timestamps).sort((a, b) => a - b)

  const lookups = series.map((s) => {
    const m = new Map<number, number>()
    for (const p of s.points) m.set(p.date.getTime(), p.value)
    return m
  })

  // MA data keys use `__ma__<uuid>` — collision-free with any user series code
  const maLookups = new Map<string, Map<number, number>>()
  for (const s of series) {
    for (const ma of s.movingAverages ?? []) {
      const m = new Map<number, number>()
      for (const p of ma.points) m.set(p.date.getTime(), p.value)
      maLookups.set(ma.id, m)
    }
  }

  return sorted.map((ts) => {
    const row: Record<string, unknown> = { date: new Date(ts) }
    series.forEach((s, i) => {
      const v = lookups[i].get(ts)
      row[s.code] = v ?? null
    })
    for (const [maId, maLookup] of maLookups) {
      row[`__ma__${maId}`] = maLookup.get(ts) ?? null
    }
    return row
  })
}

// ─── BaseDatePicker helpers ────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const
const QUARTERS = ['Q1','Q2','Q3','Q4'] as const

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ─── SpinDropdown ─────────────────────────────────────────────────────────────
// Compact AnimatedDropdown-style picker that also cycles on scroll-wheel hover.

interface SpinDropdownProps {
  /** Ordered selectable values (strings). */
  options: string[]
  /** Display labels — same length as options; defaults to options. */
  labels?: string[]
  value: string
  onSelect: (v: string) => void
}

function SpinDropdown({ options, labels, value, onSelect }: SpinDropdownProps) {
  const [open, setOpen] = useState(false)
  // Fixed position of the dropdown portal — captured at open time so it doesn't
  // shift if the trigger scrolls while the list is open.
  const [dropRect, setDropRect] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef    = useRef<HTMLDivElement>(null)

  function openDropdown() {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setDropRect({ top: r.bottom + 4, left: r.left + r.width / 2, minWidth: r.width })
    }
    setOpen(true)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      // Close if click is outside both the trigger wrapper and the portal list
      const target = e.target as Node
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        listRef.current   && !listRef.current.contains(target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Scroll selected item into view each time the list opens
  useEffect(() => {
    if (!open || !listRef.current) return
    requestAnimationFrame(() => {
      listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    })
  }, [open])

  // Wheel-on-hover: cycle through options without opening the list.
  const optionsRef  = useRef(options);  optionsRef.current  = options
  const valueRef    = useRef(value);    valueRef.current    = value
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const opts = optionsRef.current
      const idx  = opts.indexOf(valueRef.current)
      if (idx === -1) return
      const next = Math.max(0, Math.min(opts.length - 1, idx + (e.deltaY < 0 ? 1 : -1)))
      if (next !== idx) onSelectRef.current(opts[next])
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const displayLabels = labels ?? options
  const selIdx   = options.indexOf(value)
  const selLabel = selIdx !== -1 ? displayLabels[selIdx] : value
  const stagger  = Math.min(0.03, 0.45 / Math.max(options.length, 1))

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? setOpen(false) : openDropdown()}
        className="inline-flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs font-medium tabular-nums hover:bg-accent transition-colors focus-visible:outline-none"
      >
        <span>{selLabel}</span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15, ease: 'easeInOut' }}
        >
          <ChevronDown className="h-2.5 w-2.5" />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && dropRect && createPortal(
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            // position: fixed escapes all overflow:hidden ancestors
            style={{ position: 'fixed', top: dropRect.top, left: dropRect.left, minWidth: dropRect.minWidth, zIndex: 500, transform: 'translateX(-50%)' }}
            className="max-h-44 overflow-y-auto overflow-x-hidden rounded-md border-2 border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 shadow-lg"
          >
            <motion.div
              ref={listRef}
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: stagger } } }}
            >
              {options.map((opt, i) => (
                <motion.button
                  key={opt}
                  type="button"
                  data-selected={opt === value ? 'true' : undefined}
                  onClick={() => { onSelect(opt); setOpen(false) }}
                  variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'block w-full px-3 py-1.5 text-xs text-left tabular-nums',
                    'border-b border-slate-200 last:border-b-0 dark:border-zinc-800',
                    'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                    'transition-colors text-foreground',
                    opt === value && 'font-semibold',
                  )}
                >
                  {displayLabels[i]}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>,
          document.body,
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── BaseDatePicker ────────────────────────────────────────────────────────────
// Renders 1–3 SpinDropdowns depending on data frequency.
// Writing to `onChange` uses YYYY-MM-DD strings; the existing
// `resolveBaseDate`/`applyCumulativeReturns` resolver snaps to the nearest
// real intersection date, so we don't need to constrain options manually.

interface BaseDatePickerProps {
  availableDates: Date[]
  resolvedDate: Date | null
  onChange: (s: string) => void
  freq: DataFreq | undefined
}

// Exported for future use — replaces the inline cumBaseInput text field with frequency-aware spin dropdowns.
export function BaseDatePicker({ availableDates, resolvedDate, onChange, freq }: BaseDatePickerProps) {
  if (availableDates.length === 0 || !resolvedDate) return null

  const selYear    = resolvedDate.getFullYear()
  const selMonth   = resolvedDate.getMonth() + 1       // 1-indexed
  const selDay     = resolvedDate.getDate()
  const selQuarter = Math.floor((selMonth - 1) / 3) + 1 // 1-indexed Q1..Q4

  // Unique sorted option arrays derived from available dates
  const years = [...new Set(availableDates.map(d => d.getFullYear()))].sort((a, b) => a - b)

  const monthsForYear = (y: number) =>
    [...new Set(availableDates.filter(d => d.getFullYear() === y).map(d => d.getMonth() + 1))]
    .sort((a, b) => a - b)

  const quartersForYear = (y: number) =>
    [...new Set(availableDates.filter(d => d.getFullYear() === y)
      .map(d => Math.floor(d.getMonth() / 3) + 1))]
    .sort((a, b) => a - b)

  const daysForYearMonth = (y: number, m: number) =>
    [...new Set(availableDates.filter(d => d.getFullYear() === y && d.getMonth() + 1 === m)
      .map(d => d.getDate()))]
    .sort((a, b) => a - b)

  // ── Change handlers ──────────────────────────────────────────────────────────
  // Each handler snaps to the nearest date *within the target pool* so that
  // changing one component (e.g. year) cannot cause another (e.g. month) to
  // jump via the global resolveBaseDate snap.
  function nearestInPool(pool: Date[], target: Date): string {
    const ts = target.getTime()
    const nearest = pool.reduce((best, d) =>
      Math.abs(d.getTime() - ts) < Math.abs(best.getTime() - ts) ? d : best
    )
    return isoDate(nearest.getFullYear(), nearest.getMonth() + 1, nearest.getDate())
  }

  function handleYearChange(yearStr: string) {
    const y = parseInt(yearStr)
    const pool = availableDates.filter(d => d.getFullYear() === y)
    if (pool.length === 0) return
    // Project resolvedDate into the new year to preserve month/day preference
    const target = new Date(resolvedDate!)
    target.setFullYear(y)
    onChange(nearestInPool(pool, target))
  }

  function handleQuarterChange(qStr: string) {
    const q = parseInt(qStr) // 1-indexed
    const pool = availableDates.filter(d =>
      d.getFullYear() === selYear && Math.floor(d.getMonth() / 3) + 1 === q
    )
    if (pool.length === 0) return
    onChange(nearestInPool(pool, resolvedDate!))
  }

  function handleMonthChange(mStr: string) {
    const m = parseInt(mStr) // 1-indexed
    const pool = availableDates.filter(d =>
      d.getFullYear() === selYear && d.getMonth() + 1 === m
    )
    if (pool.length === 0) return
    onChange(nearestInPool(pool, resolvedDate!))
  }

  function handleDayChange(dStr: string) {
    onChange(isoDate(selYear, selMonth, parseInt(dStr)))
  }

  // ── Option arrays (string keys for SpinDropdown) ──────────────────────────
  const yearOptions     = years.map(y => String(y))
  const curQuarters     = quartersForYear(selYear)
  const curMonths       = monthsForYear(selYear)
  const curDays         = daysForYearMonth(selYear, selMonth)

  return (
    <div className="flex items-center gap-1">
      <SpinDropdown
        options={yearOptions}
        value={String(selYear)}
        onSelect={handleYearChange}
      />

      {freq === 'quarterly' && (
        <SpinDropdown
          options={curQuarters.map(q => String(q))}
          labels={curQuarters.map(q => QUARTERS[q - 1])}
          value={String(selQuarter)}
          onSelect={handleQuarterChange}
        />
      )}

      {(freq === 'monthly' || freq === 'daily') && (
        <SpinDropdown
          options={curMonths.map(m => String(m))}
          labels={curMonths.map(m => MONTHS[m - 1])}
          value={String(selMonth)}
          onSelect={handleMonthChange}
        />
      )}

      {freq === 'daily' && (
        <SpinDropdown
          options={curDays.map(d => String(d))}
          labels={curDays.map(d => String(d).padStart(2, '0'))}
          value={String(selDay)}
          onSelect={handleDayChange}
        />
      )}
    </div>
  )
}

/**
 * Resolve the cumulative-return base date from the series intersection and the
 * user-supplied `baseInput` string (YYYY-MM-DD).  Returns null when no visible
 * series are present.  Mirrors the base-resolution logic inside
 * `applyCumulativeReturns` so the two always agree.
 */
function resolveBaseDate(series: DataSeries[], baseInput: string): Date | null {
  const visible = series.filter((s) => s.visible !== false)
  if (visible.length === 0) return null
  const sets = visible.map((s) => new Set(s.originalPoints.map((p) => p.date.getTime())))
  const intersectionTs = new Set<number>(
    [...sets[0]].filter((t) => sets.every((set) => set.has(t))),
  )
  const sorted = Array.from(intersectionTs).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  let baseTs = sorted[0]
  if (baseInput.trim()) {
    const parsed = new Date(baseInput.trim())
    if (!isNaN(parsed.getTime())) {
      const target = parsed.getTime()
      baseTs = sorted.reduce((best, t) =>
        Math.abs(t - target) < Math.abs(best - target) ? t : best,
      )
    }
  }
  return new Date(baseTs)
}

export function GraphTab(): JSX.Element {
  const { activeSeries, removeSeries, reorderSeries, toggleSeriesVisibility, updateSeries, rightPanel, setRightPanel, zoomDomain, setZoomDomain, chartMode, setChartMode, cumMethod, setCumMethod, cumBaseInput, setCumBaseInput, showGrid, setShowGrid, graphTitle, setGraphTitle, savedFilename, setSavedFilename } = useGraphStore()
  const activeTab        = useAppStore((s) => s.activeTab)
  const chartMaxWidth    = useAppStore((s) => s.chartMaxWidth)
  const setChartMaxWidth = useAppStore((s) => s.setChartMaxWidth)

  const [selectedSeriesId,  setSelectedSeriesId]  = useState<string | null>(null)
  const [selectedSeriesTab, setSelectedSeriesTab] = useState<'format' | 'calculations' | 'save'>('format')
  const selectedSeries = activeSeries.find(s => s.id === selectedSeriesId) ?? null

  const [showTooltip, setShowTooltip] = useState(true)

  // ── Export dropdown ───────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const exportTitleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const h = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [exportOpen])

  const handleExportPNG = useCallback(async () => {
    setExportOpen(false)
    const chartEl = document.querySelector('[data-testid="graph-chart"]') as HTMLElement | null
    const titleEl = exportTitleRef.current
    if (!chartEl || !titleEl) {
      console.error('[ExportPNG] Missing elements:', { chartEl: !!chartEl, titleEl: !!titleEl })
      return
    }

    try {
      const dpr = window.devicePixelRatio || 1
      const chartRect = chartEl.getBoundingClientRect()
      const titleRect = titleEl.getBoundingClientRect()
      // Capture both regions in parallel (add a few px to chart height to avoid legend clipping)
      const [titleBuf, chartBuf] = await Promise.all([
        ipc.capture.rect({ x: titleRect.x, y: titleRect.y, width: titleRect.width, height: titleRect.height }),
        ipc.capture.rect({ x: chartRect.x, y: chartRect.y, width: chartRect.width, height: chartRect.height + 8 }),
      ])
      if (!titleBuf || !chartBuf) {
        console.error('[ExportPNG] Capture returned null')
        return
      }

      // Decode both images
      const [titleImg, chartImg] = await Promise.all([
        createImageBitmap(new Blob([titleBuf as BlobPart], { type: 'image/png' })),
        createImageBitmap(new Blob([chartBuf as BlobPart], { type: 'image/png' })),
      ])
      // Stitch: title above chart, left-aligned to chart's left edge
      const pad = Math.round(24 * dpr)
      const gap = Math.round(12 * dpr)
      const canvasW = chartImg.width + pad * 2
      const canvasH = pad + titleImg.height + gap + chartImg.height + pad

      const canvas = document.createElement('canvas')
      canvas.width = canvasW
      canvas.height = canvasH
      const ctx = canvas.getContext('2d')!

      // Fill background — read from the app layout root (bg-gray-50 / bg-gray-950)
      const appRoot = document.querySelector('.flex.h-screen') as HTMLElement | null
      ctx.fillStyle = appRoot ? getComputedStyle(appRoot).backgroundColor : '#f9fafb'
      ctx.fillRect(0, 0, canvasW, canvasH)

      // Draw title at top-left with padding
      ctx.drawImage(titleImg, pad, pad)
      // Draw chart below
      ctx.drawImage(chartImg, pad, pad + titleImg.height + gap)

      // Save to file via native dialog
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) {
        console.error('[ExportPNG] canvas.toBlob returned null')
        return
      }
      const buf = new Uint8Array(await blob.arrayBuffer())
      const fileName = `${graphTitle.replace(/[^a-zA-Z0-9 _-]/g, '')}.png`
      await ipc.dialog.savePNG(fileName, buf)
    } catch (err) {
      console.error('[ExportPNG] failed:', err)
    }
  }, [])

  // ── Right-click context menu ───────────────────────────────────────────────
  const [rebaseMenu, setRebaseMenu] = useState<{ date: Date; x: number; y: number } | null>(null)
  const rebaseMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rebaseMenu) return
    const h = (e: MouseEvent) => {
      if (rebaseMenuRef.current && !rebaseMenuRef.current.contains(e.target as Node)) setRebaseMenu(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [rebaseMenu])

  // ── Legend drag-and-drop (HTML5, works across wrapped rows) ─────────────────
  const draggedIdRef = useRef<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const liveReorder = useCallback((targetId: string) => {
    const srcId = draggedIdRef.current
    if (!srcId || srcId === targetId) return
    const order = [...activeSeries]
    const srcIdx = order.findIndex(s => s.id === srcId)
    const tgtIdx = order.findIndex(s => s.id === targetId)
    if (srcIdx === -1 || tgtIdx === -1) return
    const [moved] = order.splice(srcIdx, 1)
    order.splice(tgtIdx, 0, moved)
    reorderSeries(order)
  }, [activeSeries, reorderSeries])

  // ── Uniform chip height ────────────────────────────────────────────────────
  const maxMACount = useMemo(() =>
    activeSeries.reduce((m, s) => Math.max(m, (s.movingAverages ?? []).length), 0),
  [activeSeries])
  // 36px base (series row) + 22px per MA row
  const chipMinHeight = maxMACount > 0 ? 36 + maxMACount * 22 : undefined

  // Press 'g' to toggle gridlines, 't' to toggle the tooltip price label.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'g') setShowGrid(!showGrid)
      if (e.key === 't') setShowTooltip(prev => !prev)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showGrid, setShowGrid])

  // ── Chart mode ───────────────────────────────────────────────────────────────
  const [titleMenuOpen, setTitleMenuOpen] = useState(false)
  const titleMenuRef = useRef<HTMLDivElement>(null)

  // Close title menu on outside click
  useEffect(() => {
    if (!titleMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (titleMenuRef.current && !titleMenuRef.current.contains(e.target as Node)) {
        setTitleMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [titleMenuOpen])

  // ── Chart width (Ctrl+scroll to resize) ──────────────────────────────────────
  const chartMaxWidthRef                       = useRef(chartMaxWidth)
  chartMaxWidthRef.current                     = chartMaxWidth   // always current for event handlers

  // ── Panel placement — left when there's room, below the legend otherwise ──
  // The panel has a fixed intrinsic width; left-mode requires a gutter large enough
  // to fit it plus 16 px of breathing room on each side.
  const MIN_PANEL_WIDTH = 300
  const [panelMode,     setPanelMode]     = useState<'left' | 'below'>('below')
  const [leftPanelLeft, setLeftPanelLeft] = useState(0)

  // Whether any panel is open (used by wheel handler to decide scroll vs zoom)
  const panelOpen = selectedSeries !== null || rightPanel !== null

  // Editable graph title — contentEditable is uncontrolled, so we sync from
  // the store only when the value changes externally (e.g. session restore).
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleSyncedRef = useRef(graphTitle)
  useEffect(() => {
    if (titleRef.current && graphTitle !== titleSyncedRef.current) {
      titleRef.current.textContent = graphTitle
      titleSyncedRef.current = graphTitle
    }
  }, [graphTitle])
  const handleTitleBlur = useCallback(() => {
    const text = titleRef.current?.textContent?.trim() || 'New Graph'
    titleSyncedRef.current = text
    setGraphTitle(text)
  }, [setGraphTitle])
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); titleRef.current?.blur() }
  }, [])

  // Measure the header row's rendered top so the left panel title lines up with the date.
  const chartWrapRef   = useRef<HTMLDivElement>(null)
  const headerRowRef   = useRef<HTMLDivElement>(null)
  const [panelTop, setPanelTop] = useState(16)

  const measurePanelTop = useCallback(() => {
    if (!headerRowRef.current || !chartWrapRef.current) return
    const wrapRect   = chartWrapRef.current.getBoundingClientRect()
    const headerRect = headerRowRef.current.getBoundingClientRect()
    setPanelTop(Math.round(headerRect.top - wrapRect.top))
  }, [])

  // Recalculate gutter geometry — reads chartMaxWidthRef so it's always fresh.
  const recalcGutter = useCallback(() => {
    const el = chartWrapRef.current
    if (!el) return
    const W      = el.offsetWidth
    const innerW = W - 32                               // strip p-4 on both sides
    const chartW = Math.min(innerW, chartMaxWidthRef.current)
    const gutter = (innerW - chartW) / 2
    const hasRoom = gutter >= MIN_PANEL_WIDTH + 32
    setLeftPanelLeft(hasRoom ? Math.floor(16 + gutter / 2 - MIN_PANEL_WIDTH / 2) : 0)
    setPanelMode(hasRoom ? 'left' : 'below')
    measurePanelTop()
  }, [measurePanelTop])

  useEffect(() => {
    const el = chartWrapRef.current
    if (!el) return
    recalcGutter()
    const ro = new ResizeObserver(recalcGutter)
    ro.observe(el)
    return () => ro.disconnect()
  // recalcGutter is stable (useCallback []); chartWrapRef is a stable ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-run when chart width changes (ResizeObserver won't fire for max-width state change)
  useEffect(() => { recalcGutter() }, [chartMaxWidth, recalcGutter])

  // Re-measure when series are added/removed (legend height shifts justify-center midpoint)
  useEffect(() => { measurePanelTop() }, [activeSeries.length, measurePanelTop])

  // ── Animation key — bumped to re-mount AreaChart and replay draw animation ───
  const [animKey, setAnimKey] = useState(0)
  const prevTabRef = useRef<string | null>(null)
  const prevSeriesCountRef = useRef(activeSeries.length)

  // Replay when navigating back to the graph tab (not on initial mount)
  useEffect(() => {
    if (prevTabRef.current !== null && prevTabRef.current !== 'graph' && activeTab === 'graph') {
      setAnimKey((k) => k + 1)
    }
    prevTabRef.current = activeTab
  }, [activeTab])

  // Replay when a new series is added
  useEffect(() => {
    if (activeSeries.length > prevSeriesCountRef.current) setAnimKey((k) => k + 1)
    prevSeriesCountRef.current = activeSeries.length
  }, [activeSeries.length])

  // Apply mode transform for display only — originalPoints in the store are never touched
  const displaySeries = useMemo(() => {
    if (chartMode === 'cumulative') return applyCumulativeReturns(activeSeries, cumMethod, cumBaseInput)
    if (chartMode === 'drawdown') return applyDrawdown(activeSeries)
    return activeSeries
  }, [activeSeries, chartMode, cumMethod, cumBaseInput])

  const visibleSeries = useMemo(() => displaySeries.filter(s => s.visible !== false), [displaySeries])
  const pivoted = useMemo(() => pivotSeries(visibleSeries), [visibleSeries])

  // Resolved base date for the cumulative-mode base-line
  const resolvedBaseDate = useMemo(() =>
    chartMode === 'cumulative' ? resolveBaseDate(activeSeries, cumBaseInput) : null,
  [activeSeries, cumBaseInput, chartMode])

  // Available dates for BaseDatePicker (intersection of all visible series)
  const availableDates = useMemo(() => {
    const visible = activeSeries.filter(s => s.visible !== false)
    if (visible.length === 0) return []
    const sets = visible.map(s => new Set(s.originalPoints.map(p => p.date.getTime())))
    const inter = [...sets[0]].filter(t => sets.every(set => set.has(t)))
    return inter.sort((a, b) => a - b).map(t => new Date(t))
  }, [activeSeries])

  // Dominant frequency across visible series — drives which SpinDropdowns appear
  const dominantFreq = useMemo<DataFreq | undefined>(() => {
    const visible = activeSeries.filter(s => s.visible !== false)
    if (visible.length === 0) return undefined
    // Use the finest frequency among visible series
    const order: DataFreq[] = ['daily', 'monthly', 'quarterly', 'yearly']
    let finest = 3 // start at 'yearly'
    for (const s of visible) {
      const f = s.data_freq ?? detectFrequency(s.originalPoints)
      const idx = order.indexOf(f)
      if (idx < finest) finest = idx
    }
    return order[finest]
  }, [activeSeries])

  // Build a lookup from data-key (series code or __ma__<id>) to display info
  // so the ChartTooltip rows callback can resolve names, colours, and styles.
  const seriesInfoMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string; lineStyle?: string; lineWidth?: number }>()
    for (const s of displaySeries) {
      m.set(s.code, { name: s.name, color: s.color ?? '#3b82f6', lineStyle: s.lineStyle, lineWidth: s.lineWidth })
      for (const ma of s.movingAverages ?? []) {
        m.set(`__ma__${ma.id}`, {
          name: `${s.name} MA(${ma.window})`,
          color: ma.color ?? s.color ?? '#888',
          lineStyle: ma.lineStyle ?? 'dotted',
          lineWidth: ma.lineWidth ?? 1,
        })
      }
    }
    return m
  }, [displaySeries])

  const handleExportCSV = useCallback(async () => {
    setExportOpen(false)
    const codes = visibleSeries.map(s => s.code)
    const names = visibleSeries.map(s => s.name)
    const header = ['Date', ...names].map(v => `"${v}"`).join(',')
    const rows = pivoted.map(row => {
      const date = (row.date as Date).toISOString().slice(0, 10)
      const vals = codes.map(code => {
        const v = row[code]
        return typeof v === 'number' ? v.toString() : ''
      })
      return [date, ...vals].join(',')
    })
    const csv = [header, ...rows].join('\n')
    const fileName = `${graphTitle.replace(/[^a-zA-Z0-9 _-]/g, '')}.csv`
    await ipc.dialog.saveCSV(fileName, csv)
  }, [visibleSeries, pivoted, graphTitle])

  const buildSavedGraph = useCallback((): SavedGraph => ({
    version: 1,
    name: graphTitle,
    savedAt: new Date().toISOString(),
    session: {
      series: activeSeries.map(serializeSeries),
      zoomDomain: zoomDomain
        ? { start: zoomDomain.start.toISOString().slice(0, 10), end: zoomDomain.end.toISOString().slice(0, 10) }
        : null,
      chartMode,
      cumMethod,
      cumBaseInput,
      showGrid,
      graphTitle,
    },
  }), [activeSeries, zoomDomain, chartMode, cumMethod, cumBaseInput, showGrid, graphTitle])

  // ── Dirty tracking ─────────────────────────────────────────────────────────
  // Derived comparison: compute a fingerprint of meaningful graph state
  // (excluding colors — those are palette-dependent and get reassigned on tab
  // switch by the recolor effect).  Compare against a snapshot taken at save time.
  // No useEffect, no race conditions with mount/recolor cascades.
  const graphStateKey = useMemo(() => {
    const seriesKey = activeSeries.map(s => {
      const maKey = (s.movingAverages ?? []).map(m =>
        `${m.id}:${m.type}:${m.window}:${m.visible}:${m.lineStyle}:${m.lineWidth}`
      ).join('|')
      return `${s.id}:${s.visible}:${s.lineStyle}:${s.lineWidth}:${maKey}`
    }).join(';')
    const zoomKey = zoomDomain
      ? `${zoomDomain.start.getTime()}-${zoomDomain.end.getTime()}`
      : 'null'
    return `${seriesKey}::${zoomKey}::${chartMode}::${cumMethod}::${cumBaseInput}::${showGrid}::${graphTitle}`
  }, [activeSeries, zoomDomain, chartMode, cumMethod, cumBaseInput, showGrid, graphTitle])

  // Snapshot of graphStateKey at the time of last save.  Initialised to current
  // state when savedFilename exists (session was just restored — nothing changed yet).
  const savedStateKeyRef = useRef<string | null>(savedFilename ? graphStateKey : null)

  // Never saved + has data → show button.  Saved + state diverged → show button.
  const isDirty = savedFilename
    ? graphStateKey !== savedStateKeyRef.current
    : activeSeries.length > 0

  // Sync dirty flag to graph manager so the sidebar close button can check it
  const setActiveGraphDirty = useGraphManagerStore(s => s.setActiveGraphDirty)
  useEffect(() => { setActiveGraphDirty(isDirty) }, [isDirty, setActiveGraphDirty])

  const [saveFlash, setSaveFlash] = useState(false)
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const saveMenuRef = useRef<HTMLDivElement>(null)

  // Close save menu on outside click
  useEffect(() => {
    if (!saveMenuOpen) return
    const h = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) setSaveMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [saveMenuOpen])

  const doSave = useCallback(async (asNew: boolean) => {
    setSaveMenuOpen(false)
    const filename = await ipc.graph.save(buildSavedGraph(), asNew ? undefined : (savedFilename ?? undefined))
    // Update the snapshot BEFORE setting savedFilename so the next render sees isDirty = false
    savedStateKeyRef.current = graphStateKey
    setSavedFilename(filename)
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 1500)
  }, [buildSavedGraph, savedFilename, setSavedFilename, graphStateKey])

  const handleSaveGraph = useCallback(async () => {
    if (savedFilename) {
      // Already saved before — show dropdown
      setSaveMenuOpen(o => !o)
    } else {
      // First save — just save directly
      await doSave(true)
    }
  }, [savedFilename, doSave])

  const handleExportGraph = useCallback(async () => {
    setExportOpen(false)
    await ipc.graph.export(buildSavedGraph())
  }, [buildSavedGraph])

  // Tooltip display order: series codes first (in legend order), then MAs
  const tooltipOrder = useMemo(() => {
    const order: string[] = []
    for (const s of displaySeries) {
      if (s.visible !== false) {
        order.push(s.code)
        for (const ma of s.movingAverages ?? []) {
          if (ma.visible !== false) order.push(`__ma__${ma.id}`)
        }
      }
    }
    return order
  }, [displaySeries])

  // Pre-compute the full data extent once per series change so the wheel handler
  // never has to iterate or spread the full array on every scroll event.
  const pivotBounds = useMemo(() => {
    const fallback = { totalMin: 0, totalMax: 0, minRange: 7 * 86400000 }
    if (pivoted.length < 2) return fallback
    let min = Infinity, max = -Infinity, minGap = Infinity, maxGap = 0
    let prevT = (pivoted[0].date as Date).getTime()
    min = max = prevT
    for (let i = 1; i < pivoted.length; i++) {
      const t = (pivoted[i].date as Date).getTime()
      if (t < min) min = t
      if (t > max) max = t
      const gap = t - prevT
      if (gap > 0 && gap < minGap) minGap = gap
      if (gap > maxGap) maxGap = gap
      prevT = t
    }
    // minRange = maxGap * 2 + minGap: any window of this size is guaranteed to contain
    // >= 2 data points by pigeonhole, even with irregular gaps (weekends, holidays).
    const safeMinGap = minGap === Infinity ? 86400000 : minGap
    return { totalMin: min, totalMax: max, minRange: maxGap * 2 + safeMinGap }
  }, [pivoted])

  // ── Zoom: filter pivoted rows to the current domain ──────────────────────────
  // Cap at MAX_DISPLAY_POINTS: beyond ~1 point/px the extra points add no visual
  // detail but make @visx recompute a much longer SVG path on every render.
  const MAX_DISPLAY_POINTS = 1000
  const displayedData = useMemo(() => {
    const base = (() => {
      if (!zoomDomain || pivoted.length === 0) return pivoted
      const startT = zoomDomain.start.getTime()
      const endT   = zoomDomain.end.getTime()
      const filtered = pivoted.filter((row) => {
        const t = (row.date as Date).getTime()
        return t >= startT && t <= endT
      })
      return filtered.length >= 2 ? filtered : pivoted
    })()
    if (base.length <= MAX_DISPLAY_POINTS) return base
    const step = Math.ceil(base.length / MAX_DISPLAY_POINTS)
    return base.filter((_, i) => i % step === 0 || i === base.length - 1)
  }, [pivoted, zoomDomain])

  // ── Date-window ticker data ───────────────────────────────────────────────────
  // Build a *deduplicated* list of "Mon YYYY" labels (one per unique month-year)
  // and map the current zoom-window edges to indices in that list.
  // Daily data over 5 years: 1 825 raw rows -> 60 unique labels — same animation,
  // ~97 % fewer DOM nodes inside WindowDateTicker.
  const { uniqueDateLabels, startLabelIdx, endLabelIdx } = useMemo(() => {
    if (pivoted.length === 0) return { uniqueDateLabels: [] as string[], startLabelIdx: 0, endLabelIdx: 0 }

    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    // Single pass: build ordered unique list + reverse-lookup map
    const unique: string[] = []
    const labelIdx = new Map<string, number>()
    for (const row of pivoted) {
      const l = fmt(row.date as Date)
      if (!labelIdx.has(l)) { labelIdx.set(l, unique.length); unique.push(l) }
    }

    // Binary-search helpers for zoom edge -> raw pivot index
    const startT = zoomDomain ? zoomDomain.start.getTime() : (pivoted[0].date as Date).getTime()
    const endT   = zoomDomain ? zoomDomain.end.getTime()   : (pivoted[pivoted.length - 1].date as Date).getTime()

    let sRaw = pivoted.findIndex(r => (r.date as Date).getTime() >= startT)
    if (sRaw === -1) sRaw = 0

    let eRaw = pivoted.length - 1
    for (let i = pivoted.length - 1; i >= 0; i--) {
      if ((pivoted[i].date as Date).getTime() <= endT) { eRaw = i; break }
    }

    return {
      uniqueDateLabels: unique,
      startLabelIdx: labelIdx.get(fmt(pivoted[sRaw].date as Date)) ?? 0,
      endLabelIdx:   labelIdx.get(fmt(pivoted[eRaw].date as Date)) ?? unique.length - 1,
    }
  }, [pivoted, zoomDomain])

  // ── Scroll-wheel zoom ─────────────────────────────────────────────────────────
  // Keep mutable refs so the event listener never goes stale without being re-added.
  // Ref to the chart SVG wrapper so we can map cursor pixels -> time fraction.
  const chartAreaRef    = useRef<HTMLDivElement>(null)
  const [isZooming, setIsZooming] = useState(false)
  const zoomEndTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  // rAF batching: collapse burst wheel events into one update per paint frame.
  const pendingWheelRef  = useRef<{ deltaX: number; deltaY: number; clientX: number; ctrlKey: boolean } | null>(null)
  const wheelRafRef      = useRef<number | null>(null)
  // Ref to the header row (buttons + date) used to align the left-mode edit panel.
  const stateRef = useRef({ pivoted, zoomDomain, activeSeries, ...pivotBounds, panelOpen })
  stateRef.current = { pivoted, zoomDomain, activeSeries, ...pivotBounds, panelOpen }

  useEffect(() => {
    const el = chartWrapRef.current
    if (!el) return

    // ── rAF processor — runs once per animation frame, consuming the latest event ─
    const processWheel = (): void => {
      wheelRafRef.current = null
      const ev = pendingWheelRef.current
      if (!ev) return
      pendingWheelRef.current = null

      const { pivoted: piv, zoomDomain: zd, activeSeries: active, totalMin, totalMax, minRange } = stateRef.current

      // ── Ctrl+scroll -> widen / narrow the chart ────────────────────────────────
      if (ev.ctrlKey) {
        const factor   = Math.exp(-ev.deltaY * 0.001)
        const minWidth = Math.floor(window.innerWidth * 0.4)
        const maxWidth = Math.floor(window.innerWidth * 0.9)
        const newWidth = Math.round(Math.min(maxWidth, Math.max(minWidth, chartMaxWidthRef.current * factor)))
        chartMaxWidthRef.current = newWidth
        setChartMaxWidth(newWidth)
        return
      }

      if (active.length === 0 || piv.length === 0) return

      const cur = zd
        ? { start: zd.start.getTime(), end: zd.end.getTime() }
        : { start: totalMin, end: totalMax }
      const range = cur.end - cur.start

      // ── Horizontal scroll -> pan ────────────────────────────────────────────────
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        const rect = chartAreaRef.current?.getBoundingClientRect()
        const innerWidth = rect ? rect.width - 56 - 24 : 800
        const timeDelta = -ev.deltaX * (range / innerWidth)
        let newStart = cur.start - timeDelta
        let newEnd   = cur.end   - timeDelta
        if (newStart < totalMin) { newStart = totalMin; newEnd = totalMin + range }
        if (newEnd   > totalMax) { newEnd = totalMax; newStart = totalMax - range }
        setZoomDomain({ start: new Date(newStart), end: new Date(newEnd) })
        return
      }

      // ── Vertical scroll -> zoom ─────────────────────────────────────────────────
      const factor   = Math.exp(ev.deltaY * 0.003)
      const newRange = Math.min(totalMax - totalMin, Math.max(minRange, range * factor))

      const rect       = chartAreaRef.current?.getBoundingClientRect()
      const anchorFrac = rect
        ? Math.max(0, Math.min(1, (ev.clientX - rect.left - 56) / (rect.width - 56 - 24)))
        : 0.5
      const anchorTime = cur.start + anchorFrac * range

      let newStart = anchorTime - anchorFrac * newRange
      let newEnd   = anchorTime + (1 - anchorFrac) * newRange
      if (newStart < totalMin) { newStart = totalMin; newEnd = Math.min(totalMax, totalMin + newRange) }
      if (newEnd   > totalMax) { newEnd = totalMax; newStart = Math.max(totalMin, totalMax - newRange) }

      setZoomDomain({ start: new Date(newStart), end: new Date(newEnd) })

      setIsZooming(true)
      if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current)
      zoomEndTimerRef.current = setTimeout(() => setIsZooming(false), 200)
    }

    // ── Wheel event — preventDefault immediately, defer all math to rAF ─────────
    const handler = (e: WheelEvent): void => {
      // When a below-panel is open and the cursor is outside the chart SVG area,
      // let the browser scroll the page instead of zooming/panning.
      if (stateRef.current.panelOpen) {
        const chartRect = chartAreaRef.current?.getBoundingClientRect()
        const outsideChart = !chartRect
          || e.clientX < chartRect.left || e.clientX > chartRect.right
          || e.clientY < chartRect.top  || e.clientY > chartRect.bottom
        if (outsideChart) return
      }
      e.preventDefault()
      pendingWheelRef.current = { deltaX: e.deltaX, deltaY: e.deltaY, clientX: e.clientX, ctrlKey: e.ctrlKey }
      if (wheelRafRef.current === null) {
        wheelRafRef.current = requestAnimationFrame(processWheel)
      }
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => {
      el.removeEventListener('wheel', handler)
      if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current)
    }
  }, [setZoomDomain, setChartMaxWidth])

  // ── Pan (left-click drag) ─────────────────────────────────────────────────────
  // timeDelta = dx * timePerPixel (positive = dragging right = view shifts left/earlier).
  const handlePanDelta = useCallback(
    (timeDelta: number): void => {
      const { pivoted: piv, zoomDomain: zd } = stateRef.current
      if (piv.length === 0) return

      const allTimes = piv.map((r) => (r.date as Date).getTime())
      const totalMin = Math.min(...allTimes)
      const totalMax = Math.max(...allTimes)

      const cur = zd
        ? { start: zd.start.getTime(), end: zd.end.getTime() }
        : { start: totalMin, end: totalMax }

      const range = cur.end - cur.start
      let newStart = cur.start - timeDelta
      let newEnd = cur.end - timeDelta

      // Clamp without shrinking the window
      if (newStart < totalMin) { newStart = totalMin; newEnd = totalMin + range }
      if (newEnd > totalMax) { newEnd = totalMax; newStart = totalMax - range }

      setZoomDomain({ start: new Date(newStart), end: new Date(newEnd) })
    },
    [setZoomDomain],
  )

  // ── Drag-select zoom ──────────────────────────────────────────────────────────
  const handleSelectionComplete = useCallback(
    (startDate: Date, endDate: Date): void => {
      setZoomDomain({ start: startDate, end: endDate })
    },
    [setZoomDomain],
  )

  // Double-click on the chart area resets zoom to full range
  const handleDoubleClick = useCallback((): void => {
    setZoomDomain(null)
  }, [setZoomDomain])

  // Right-click on chart opens a context menu; crosshair stays frozen (area-chart internal ref)
  const handleRightClickPoint = useCallback(
    (date: Date, clientX: number, clientY: number): void => {
      setRebaseMenu({ date, x: clientX, y: clientY })
    },
    [],
  )

  const handleCopyValues = useCallback(() => {
    if (!rebaseMenu) return
    const t = rebaseMenu.date.getTime()
    let nearest = pivoted[0]
    let bestDist = Infinity
    for (const row of pivoted) {
      const dist = Math.abs((row.date as Date).getTime() - t)
      if (dist < bestDist) { bestDist = dist; nearest = row }
    }
    if (!nearest) return
    const lines: string[] = []
    for (const key of tooltipOrder) {
      const info = seriesInfoMap.get(key)
      if (!info) continue
      const raw = nearest[key]
      if (typeof raw !== 'number') continue
      const isCum = chartMode === 'cumulative'
      const suffix = isCum ? '' : '%'
      const decimals = isCum ? 1 : 2
      const formatted = raw < 0
        ? `(${Math.abs(raw).toFixed(decimals)}${suffix})`
        : `${raw.toFixed(decimals)}${suffix}`
      lines.push(`"${info.name}"\t${formatted}`)
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
    setRebaseMenu(null)
  }, [rebaseMenu, pivoted, tooltipOrder, seriesInfoMap, chartMode])

  const confirmRebase = useCallback(
    (date: Date): void => {
      setCumBaseInput(isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate()))
      if (chartMode !== 'cumulative') setChartMode('cumulative')
      setRebaseMenu(null)
    },
    [setCumBaseInput, setChartMode, chartMode],
  )

  return (
    <div className="relative flex h-full w-full">
      <div className="flex flex-1 flex-col min-w-0 overflow-y-auto">
        {/* Graph title — editable inline, top-left aligned like Upload/Settings tabs */}
        <div className="flex items-center justify-between px-8 pt-8 shrink-0">
          <div ref={exportTitleRef} className="flex items-center gap-3 leading-none select-none text-foreground" style={WIN_FONT_STYLE}>
            <LineChartIcon className="h-8 w-8 text-blue-500 shrink-0" />
            <h2
              ref={titleRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              className="text-4xl font-black leading-none outline-none cursor-text caret-blue-500"
            >
              {graphTitle}
            </h2>
          </div>
          {/* Export dropdown */}
          <div ref={exportRef} className="relative">
            <button
              type="button"
              onClick={() => setExportOpen(o => !o)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Export
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', exportOpen && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {exportOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-full mt-1 z-50 min-w-[11rem] rounded-lg border border-border bg-popover shadow-md overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-popover-foreground hover:bg-accent/60 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    Export as CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPNG}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-popover-foreground hover:bg-accent/60 transition-colors"
                  >
                    <ExportImageIcon className="h-4 w-4 shrink-0" />
                    Export as PNG
                  </button>
                  <div className="mx-2 border-t border-border/40" />
                  <button
                    type="button"
                    onClick={handleExportGraph}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-popover-foreground hover:bg-accent/60 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                    Export as Graph File
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Chart viewport — flex-1 fills remaining space to center the chart;
            below-panels sit outside this div so they don't displace it. */}
        <div
          ref={chartWrapRef}
          className="relative flex-1 p-4 pb-24 flex flex-col items-center justify-center"
          onDoubleClick={handleDoubleClick}
          onMouseDown={(e) => {
            // Close any open card when the user clicks blank space (the padding/gutter).
            // e.target === e.currentTarget is only true when the click lands directly on
            // this container — any child element (chart, legend, panel) breaks the match.
            if (e.target === e.currentTarget) {
              setSelectedSeriesId(null)
              setRightPanel(null)
            }
          }}
        >
          {activeSeries.length === 0 ? (
            <div
              data-testid="graph-empty-state"
              className="flex flex-1 w-full flex-col items-center justify-center gap-4 text-gray-400 dark:text-gray-500"
            >
              <LineChartIcon className="h-12 w-12 opacity-25" />
              <p className="text-sm">No series selected.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSelectedSeriesId(null); setRightPanel('addLine') }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Series
              </Button>
            </div>
          ) : (
            <div data-testid="graph-chart" className="relative flex flex-col w-full gap-2" style={{ maxWidth: `min(${chartMaxWidth}px, calc(100% - 32px))`, transition: 'max-width 0.18s ease-out' }}>
              {/* Header: chart mode left, date window right */}
              <div ref={headerRowRef} className="flex items-center justify-between">
                {/* Title dropdown */}
                <div ref={titleMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setTitleMenuOpen(o => !o)}
                    className={`text-left text-2xl font-black leading-tight select-none ${WIN_COLOR_CLASS} group`}
                    style={WIN_FONT_STYLE}
                  >
                    {chartMode === 'cumulative' ? 'Cumulative Returns' : chartMode === 'drawdown' ? 'Drawdowns' : 'Returns'}
                    <ChevronDown
                      className={cn(
                        'inline-block ml-1 h-4 w-4 align-middle transition-transform duration-150 opacity-40 group-hover:opacity-80',
                        titleMenuOpen && 'rotate-180',
                      )}
                      strokeWidth={2.5}
                    />
                  </button>
                  <AnimatePresence>
                    {titleMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.12 }}
                        className="absolute left-0 top-full mt-2 z-50 min-w-[13rem] rounded-lg border border-border bg-popover shadow-md overflow-hidden"
                      >
                        {([
                          ['returns', 'Returns'],
                          ['cumulative', 'Cumulative Returns'],
                          ['drawdown', 'Drawdowns'],
                        ] as [ChartMode, string][]).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => { setChartMode(mode); setTitleMenuOpen(false) }}
                            className={cn(
                              'w-full px-4 py-2.5 text-left text-sm transition-colors',
                              chartMode === mode
                                ? 'bg-accent text-accent-foreground font-medium'
                                : 'text-popover-foreground hover:bg-accent/60',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {uniqueDateLabels.length > 0 && (
                  <div className="flex items-center gap-2">
                    <WindowDateTicker currentIndex={startLabelIdx} labels={uniqueDateLabels} />
                    <span className={`text-2xl font-black tabular-nums leading-none select-none ${WIN_COLOR_CLASS}`} style={WIN_FONT_STYLE}>–</span>
                    <WindowDateTicker currentIndex={endLabelIdx} labels={uniqueDateLabels} />
                  </div>
                )}
              </div>

              {/* Sub-options row — only visible in cumulative mode */}
              <AnimatePresence>
                {chartMode === 'cumulative' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-4 pb-1 text-sm text-muted-foreground">
                      {/* Method toggle */}
                      <Selector<CumMethod>
                        options={[
                          { value: 'geometric', label: 'Geometric' },
                          { value: 'arithmetic', label: 'Arithmetic' },
                        ]}
                        value={cumMethod}
                        onChange={setCumMethod}
                        className="w-auto"
                        compact
                      />
                      {/* Base 100 date — frequency-aware SpinDropdown picker */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Base 100 =</span>
                        <BaseDatePicker
                          availableDates={availableDates}
                          resolvedDate={resolvedBaseDate}
                          onChange={setCumBaseInput}
                          freq={dominantFreq}
                        />
                        <button
                          type="button"
                          title="Reset to first common date"
                          onClick={() => setCumBaseInput('')}
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Chart — capped at 45 vh, never below 180 px */}
              <div ref={chartAreaRef} className="relative h-[45vh] min-h-[180px] w-full">
                <AreaChart
                  key={animKey}
                  data={displayedData}
                  xDataKey="date"
                  aspectRatio="auto"
                  className="h-full"
                  animationDuration={600}
                  onSelectionComplete={handleSelectionComplete}
                  onPanDelta={handlePanDelta}
                  onRightClickPoint={handleRightClickPoint}
                  freezeTooltip={rebaseMenu !== null}
                  yPadTop={chartMode === 'drawdown' ? 0.25 : undefined}
                  yClampMax={chartMode === 'drawdown' ? 0 : undefined}
                >
                  {showGrid && <Grid origin={chartMode === 'cumulative' ? 100 : 0} />}
                  <XAxis />
                  <YAxis origin={chartMode === 'cumulative' ? 100 : 0} />
                  <Crosshair skipAnimation={isZooming} />
                  {showTooltip && <ChartTooltip
                    order={tooltipOrder}
                    anchor={chartMode === 'drawdown' ? 'bottom' : 'top'}
                    rows={(dataKey, color, value) => {
                      const info = seriesInfoMap.get(dataKey)
                      if (!info) return null
                      const isMA = dataKey.startsWith('__ma__')
                      const fmtVal = (v: number | null) => {
                        if (v === null) return '\u2013'
                        const isCum = chartMode === 'cumulative'
                        const absStr = Math.abs(v).toFixed(isCum ? 1 : 2)
                        const suffix = isCum ? '' : '%'
                        return v < 0 ? `(${absStr}${suffix})` : `${absStr}${suffix}`
                      }
                      const dashArray =
                        info.lineStyle === 'dashed' ? '4 2' :
                        info.lineStyle === 'dotted' ? '1.5 2' :
                        undefined
                      return (
                        <div className={cn('flex items-center gap-2', isMA ? 'pl-3 opacity-75' : 'py-0.5')}>
                          <svg width="16" height="8" aria-hidden="true" className="shrink-0">
                            <line
                              x1="1" y1="4" x2="15" y2="4"
                              stroke={color}
                              strokeWidth={info.lineWidth ?? (isMA ? 1 : 2)}
                              strokeLinecap="round"
                              strokeDasharray={dashArray}
                            />
                          </svg>
                          <span className="tabular-nums text-xs font-medium text-popover-foreground">{fmtVal(value)}</span>
                        </div>
                      )
                    }}
                  />}
                  {/* Origin line — horizontal at 100 (cumulative) or 0 (returns) */}
                  <OriginLine value={chartMode === 'cumulative' ? 100 : 0} />
                  {/* Base line — vertical at the resolved base date (cumulative only) */}
                  {chartMode === 'cumulative' && <BaseLine date={resolvedBaseDate} />}
                  {/* Drag-select highlight — renders inside the SVG at selection time */}
                  <SegmentBackground />
                  <SegmentLineFrom />
                  <SegmentLineTo />
                  {/* Render visible series in reverse so legend[0] paints last = on top */}
                  {[...visibleSeries].reverse().map((s) => (
                    <Area
                      key={s.id}
                      dataKey={s.code}
                      stroke={s.color ?? '#3b82f6'}
                      fillOpacity={0}
                      strokeWidth={s.lineWidth ?? 2}
                      strokeDasharray={
                        s.lineStyle === 'dashed' ? '6 3' :
                        s.lineStyle === 'dotted' ? '2 3' :
                        undefined
                      }
                    />
                  ))}
                  {/* MA overlay lines — rendered above parent series */}
                  {visibleSeries.flatMap(s =>
                    (s.movingAverages ?? [])
                      .filter(ma => ma.visible !== false)
                      .map(ma => (
                        <Area
                          key={ma.id}
                          dataKey={`__ma__${ma.id}`}
                          stroke={ma.color ?? s.color ?? '#888'}
                          fillOpacity={0}
                          strokeWidth={ma.lineWidth ?? 1}
                          strokeDasharray={
                            (ma.lineStyle ?? 'dotted') === 'dashed' ? '6 3' :
                            (ma.lineStyle ?? 'dotted') === 'dotted' ? '2 3' :
                            undefined
                          }
                        />
                      ))
                  )}
                </AreaChart>
              </div>

              {/* Legend — draggable chips + Add Series button.
                  HTML5 drag-and-drop for 2D reordering across wrapped rows (Framer's
                  Reorder.Group is axis-constrained and breaks with flex-wrap). */}
              <ol className="mt-2 flex flex-row flex-wrap items-start gap-2">
                {activeSeries.map((s) => {
                  const isVisible = s.visible !== false
                  const isSelected = selectedSeriesId === s.id
                  const maList = s.movingAverages ?? []
                  const isBeingDragged = draggedId === s.id
                  // HTML5 drag handlers — spread with cast to bypass Framer's
                  // onDragStart type (it shadows React's DragEvent with its own
                  // PointerEvent-based handler type).
                  const dragHandlers = {
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => {
                      draggedIdRef.current = s.id
                      setDraggedId(s.id)
                      e.dataTransfer.effectAllowed = 'move'
                      const ghost = document.createElement('div')
                      ghost.style.cssText = 'position:absolute;top:-9999px'
                      document.body.appendChild(ghost)
                      e.dataTransfer.setDragImage(ghost, 0, 0)
                      setTimeout(() => document.body.removeChild(ghost), 0)
                    },
                    onDragEnter: (e: React.DragEvent) => {
                      e.preventDefault()
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return
                      liveReorder(s.id)
                    },
                    onDragOver: (e: React.DragEvent) => e.preventDefault(),
                    onDrop: (e: React.DragEvent) => e.preventDefault(),
                    onDragEnd: () => { draggedIdRef.current = null; setDraggedId(null) },
                  }
                  return (
                    <motion.li
                      key={s.id}
                      layout
                      layoutId={s.id}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      {...(dragHandlers as Record<string, unknown>)}
                      className="flex flex-col justify-center rounded-md border bg-card shadow-sm select-none list-none transition-colors duration-150"
                      style={{
                        borderColor: isSelected ? 'hsl(var(--foreground) / 0.6)' : 'hsl(var(--border) / 0.45)',
                        opacity: isBeingDragged ? 0.4 : (isVisible ? 1 : 0.45),
                        minHeight: chipMinHeight,
                      }}
                      onClick={() => { setRightPanel(null); setSelectedSeriesId(isSelected ? null : s.id); setSelectedSeriesTab('format') }}
                    >
                      {/* ── Series row ────────────────────────────────────── */}
                      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <svg width="18" height="10" aria-hidden="true" className="shrink-0">
                          <line
                            x1="1" y1="5" x2="17" y2="5"
                            stroke={s.color ?? '#3b82f6'}
                            strokeWidth={s.lineWidth ?? 2}
                            strokeLinecap="round"
                            strokeDasharray={
                              s.lineStyle === 'dashed' ? '4 2' :
                              s.lineStyle === 'dotted' ? '1.5 2' :
                              undefined
                            }
                          />
                        </svg>
                        <span className="text-foreground font-medium">{s.name}</span>
                        {/* Visibility toggle */}
                        <button
                          type="button"
                          aria-label={isVisible ? `Hide ${s.name}` : `Show ${s.name}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); toggleSeriesVisibility(s.id) }}
                          className="text-muted-foreground/50 hover:text-foreground transition-colors"
                        >
                          {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        {/* Remove */}
                        <button
                          type="button"
                          aria-label={`Remove ${s.name}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); removeSeries(s.id) }}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* ── MA sub-rows ───────────────────────────────────── */}
                      {maList.length > 0 && (
                        <div
                          className="px-3 pb-2 space-y-1.5"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            setRightPanel(null)
                            setSelectedSeriesId(s.id)
                            setSelectedSeriesTab('calculations')
                          }}
                        >
                          {maList.map(ma => {
                            const maVisible = ma.visible !== false
                            const maDash =
                              (ma.lineStyle ?? 'dotted') === 'dashed' ? '4 2' :
                              (ma.lineStyle ?? 'dotted') === 'dotted' ? '1.5 2' :
                              undefined
                            return (
                              <div key={ma.id} className="flex items-center gap-2 pl-4 text-xs">
                                {/* Small line swatch — shows actual dash pattern */}
                                <svg width="16" height="8" aria-hidden="true" className="shrink-0">
                                  <line
                                    x1="1" y1="4" x2="15" y2="4"
                                    stroke={ma.color ?? s.color ?? '#888'}
                                    strokeWidth={ma.lineWidth ?? 1}
                                    strokeLinecap="round"
                                    strokeDasharray={maDash}
                                    opacity={maVisible ? 1 : 0.4}
                                  />
                                </svg>
                                <span className={cn(
                                  'flex-1 text-muted-foreground',
                                  !maVisible && 'opacity-45',
                                )}>
                                  MA – {ma.type === 'centered' ? 'Centered' : 'Rolling'} ({ma.window})
                                </span>
                                <button
                                  type="button"
                                  aria-label={maVisible ? 'Hide MA' : 'Show MA'}
                                  onClick={(e) => { e.stopPropagation(); updateSeries(s.id, {
                                    movingAverages: maList.map(m =>
                                      m.id === ma.id ? { ...m, visible: !maVisible } : m
                                    ),
                                  }) }}
                                  className="text-muted-foreground/50 hover:text-foreground transition-colors"
                                >
                                  {maVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                                </button>
                                <button
                                  type="button"
                                  aria-label="Remove MA"
                                  onClick={(e) => { e.stopPropagation(); updateSeries(s.id, {
                                    movingAverages: maList.filter(m => m.id !== ma.id),
                                  }) }}
                                  className="text-muted-foreground/40 hover:text-destructive transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </motion.li>
                  )
                })}
                {/* Add Series — plain li, never draggable */}
                <li className="list-none">
                  <button
                  type="button"
                  onClick={() => { setSelectedSeriesId(null); setRightPanel(rightPanel === 'addLine' ? null : 'addLine') }}
                  className="flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                    Add Series
                  </button>
                </li>
              </ol>

            </div>
          )}
          {/* Left gutter — both cards use the same absolute slot; click-outside ensures mutual exclusion */}
          <AnimatePresence>
            {selectedSeries && panelMode === 'left' && (
              <div
                className="absolute z-10"
                style={{ left: leftPanelLeft, width: MIN_PANEL_WIDTH, top: panelTop }}
              >
                <SeriesEditPanel
                  key={`left-${selectedSeries.id}`}
                  series={selectedSeries}
                  placement="left"
                  activeTab={selectedSeriesTab}
                  onTabChange={setSelectedSeriesTab}
                  onClose={() => setSelectedSeriesId(null)}
                  onUpdate={(patch) => updateSeries(selectedSeries.id, patch)}
                />
              </div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {rightPanel === 'addLine' && panelMode === 'left' && (
              <div
                className="absolute z-10"
                style={{ left: leftPanelLeft, width: MIN_PANEL_WIDTH, top: panelTop }}
              >
                <AddLinePanel key="addLine-left" placement="left" />
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Below-placement panels — outside chartWrap so they don't displace the
            centered chart.  Horizontally centered, scrollable via the parent. */}
        <AnimatePresence>
          {selectedSeries && panelMode === 'below' && (
            <div className="flex flex-col items-center -mt-16 pb-8" style={{ maxWidth: chartMaxWidth, marginInline: 'auto' }}>
              <div className="w-full border-t border-border/30 mb-4" />
              <SeriesEditPanel
                key={`below-${selectedSeries.id}`}
                series={selectedSeries}
                placement="below"
                activeTab={selectedSeriesTab}
                onTabChange={setSelectedSeriesTab}
                onClose={() => setSelectedSeriesId(null)}
                onUpdate={(patch) => updateSeries(selectedSeries.id, patch)}
              />
            </div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {rightPanel === 'addLine' && panelMode === 'below' && (
            <div className="flex flex-col items-center -mt-16 pb-8" style={{ maxWidth: chartMaxWidth, marginInline: 'auto' }}>
              <div className="w-full border-t border-border/30 mb-4" />
              <AddLinePanel key="addLine-below" placement="below" />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Save button — bottom-right corner; hidden when clean (already saved, no changes) */}
      <AnimatePresence>
        {(isDirty || saveFlash) && (
          <motion.div
            ref={saveMenuRef}
            className="absolute bottom-6 right-6 z-40"
            variants={{
              hidden: { opacity: 0, y: 10, scale: 0.9 },
              visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2 } },
              exit: { opacity: 0, y: 6, transition: { duration: 0.4, ease: 'easeIn' } },
            }}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.button
              type="button"
              onClick={handleSaveGraph}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-colors',
                saveFlash
                  ? 'bg-emerald-500 text-white'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
              whileTap={{ scale: 0.95 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {saveFlash ? (
                  <motion.span key="check" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={{ duration: 0.15 }}>
                    <Check className="h-4 w-4" />
                  </motion.span>
                ) : (
                  <motion.span key="save" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={{ duration: 0.15 }}>
                    <Save className="h-4 w-4" />
                  </motion.span>
                )}
              </AnimatePresence>
              {saveFlash ? 'Saved' : savedFilename ? 'Save...' : 'Save'}
            </motion.button>
            {/* Save/Save As dropdown — only when we have an existing file to overwrite */}
            <AnimatePresence>
              {saveMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.12 }}
                  className="absolute bottom-full right-0 mb-2 min-w-[10rem] rounded-lg border border-border bg-popover shadow-md overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => doSave(false)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-popover-foreground hover:bg-accent/60 transition-colors"
                  >
                    <Save className="h-4 w-4 shrink-0" />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => doSave(true)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-popover-foreground hover:bg-accent/60 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                    Save As New
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right-click context menu — portaled to document.body.
           AnimatePresence lives INSIDE the portal so it can track the motion.div
           in the same DOM subtree (wrapping a createPortal from outside breaks
           mount/unmount detection). */}
      {createPortal(
        <AnimatePresence>
          {rebaseMenu && (
            <motion.div
              key="rebase-menu"
              ref={rebaseMenuRef}
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ position: 'fixed', left: rebaseMenu.x, top: rebaseMenu.y, zIndex: 600 }}
              className="min-w-[11rem] overflow-hidden rounded-md bg-slate-100 dark:bg-zinc-900 border-2 border-slate-200 dark:border-zinc-800 shadow-lg"
            >
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
              >
                <motion.button
                  type="button"
                  onClick={handleCopyValues}
                  variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'w-full px-4 py-2.5 text-left text-sm font-medium',
                    'text-foreground hover:bg-slate-200 dark:hover:bg-zinc-800',
                    'transition-colors',
                  )}
                >
                  Copy Values
                </motion.button>
                {chartMode === 'cumulative' && (
                  <motion.button
                    type="button"
                    onClick={() => confirmRebase(rebaseMenu.date)}
                    variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                    className={cn(
                      'w-full px-4 py-2.5 text-left text-sm font-medium',
                      'text-foreground hover:bg-slate-200 dark:hover:bg-zinc-800',
                      'transition-colors',
                    )}
                  >
                    Re-base Index
                  </motion.button>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

// Exposed for unit tests.
export { pivotSeries }
