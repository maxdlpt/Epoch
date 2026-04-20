import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, ChevronUp, Database, GripVertical, Plus, Save, X } from 'lucide-react'
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import { useAppStore } from '../../store/app'
import { useDBStore } from '../../store/db'
import { getAllPalettes } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { computeMA } from '../../lib/ma'
import { ipc } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import type { DataFreq, DataPoint, DataSeries, ExternalDB, MAComponent } from '../../../shared/types'

// ─── usePressAndHold ─────────────────────────────────────────────────────────
// Fires `action` immediately on mousedown, then again repeatedly after an
// initial delay.  The actionRef pattern ensures the interval always calls the
// latest version of the function — no stale-closure issues with changing state.

function usePressAndHold(action: () => void, initialDelay = 350, repeatMs = 80) {
  const actionRef  = useRef(action)
  actionRef.current = action          // keep current without rebuilding callbacks

  const timerRef   = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current)    { clearTimeout(timerRef.current);    timerRef.current   = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const start = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if ((e.currentTarget as HTMLButtonElement).disabled) return
    e.preventDefault()                // prevent focus shift / double-fire
    actionRef.current()
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => actionRef.current(), repeatMs)
    }, initialDelay)
  }, [initialDelay, repeatMs])

  // Clean up if the component unmounts while a button is held
  useEffect(() => stop, [stop])

  return { onMouseDown: start, onMouseUp: stop, onMouseLeave: stop } as const
}

// ─── Constants ────────────────────────────────────────────────────────────────

type Tab = 'format' | 'calculations' | 'save'

const LINE_STYLES = [
  { value: 'solid'  as const, label: 'Solid',  dasharray: undefined },
  { value: 'dashed' as const, label: 'Dashed', dasharray: '6 3'     },
  { value: 'dotted' as const, label: 'Dotted', dasharray: '2 3'     },
]

const LINE_WIDTHS = [1, 2, 3] as const

function defaultWindow(freq?: DataFreq): number {
  if (freq === 'monthly')   return 3
  if (freq === 'quarterly') return 4
  if (freq === 'yearly')    return 3
  return 20
}

function freqUnit(freq?: DataFreq): string {
  if (freq === 'monthly')   return 'months'
  if (freq === 'quarterly') return 'quarters'
  if (freq === 'yearly')    return 'years'
  return 'days'
}

// ─── MAToast ─────────────────────────────────────────────────────────────────
// Draggable chip representing one moving average. The drag handle (≡) is the
// only initiator — clicking the rest of the card interacts with controls.

interface MAToastProps {
  ma: MAComponent
  seriesPoints: DataPoint[]
  seriesFreq?: DataFreq
  onChange: (patch: Partial<MAComponent>) => void
  onRemove: () => void
}

function MAToast({ ma, seriesPoints, seriesFreq, onChange, onRemove }: MAToastProps) {
  const controls     = useDragControls()
  const [typeOpen, setTypeOpen] = useState(false)
  const dropdownRef  = useRef<HTMLDivElement>(null)

  const decHandlers = usePressAndHold(() => handleWindowChange(ma.window - 1))
  const incHandlers = usePressAndHold(() => handleWindowChange(ma.window + 1))

  // Close the type dropdown when clicking outside it.
  useEffect(() => {
    if (!typeOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTypeOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [typeOpen])

  function handleTypeChange(newType: 'rolling' | 'centered'): void {
    const pts = computeMA(seriesPoints, newType, ma.window)
    onChange({ type: newType, points: pts.length > 0 ? pts : ma.points })
    setTypeOpen(false)
  }

  function handleWindowChange(raw: number): void {
    const w = Math.max(2, Math.min(seriesPoints.length, raw))
    const pts = computeMA(seriesPoints, ma.type, w)
    onChange({ window: w, points: pts.length > 0 ? pts : ma.points })
  }

  return (
    <Reorder.Item
      value={ma}
      dragControls={controls}
      dragListener={false}
      as="div"
      layout
      className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 shadow-sm select-none"
      whileDrag={{ scale: 1.02, boxShadow: '0 6px 18px rgba(0,0,0,0.13)', zIndex: 50, position: 'relative' }}
    >
      {/* ── Drag handle ───────────────────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Drag to reorder"
        className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors"
        onPointerDown={(e) => { e.preventDefault(); controls.start(e) }}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* ── Colour dot ────────────────────────────────────────────────────── */}
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: ma.color ?? '#888' }}
      />

      {/* ── Type dropdown ─────────────────────────────────────────────────── */}
      <div ref={dropdownRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setTypeOpen((o) => !o)}
          className="flex items-center gap-0.5 text-xs font-medium text-foreground hover:text-muted-foreground transition-colors"
        >
          <span className="capitalize">{ma.type}</span>
          <motion.div
            animate={{ rotate: typeOpen ? 180 : 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
          >
            <ChevronDown className="h-3 w-3" />
          </motion.div>
        </button>

        <AnimatePresence>
          {typeOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute top-[calc(100%+5px)] left-0 z-50 min-w-[7rem] overflow-hidden rounded-md border-2 border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 shadow-lg"
            >
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
              >
                {(['rolling', 'centered'] as const).map((t) => (
                  <motion.button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    variants={{ hidden: { opacity: 0, x: -12 }, visible: { opacity: 1, x: 0 } }}
                    className={cn(
                      'block w-full px-3 py-1.5 text-xs text-left capitalize',
                      'border-b-2 border-slate-200 last:border-b-0 dark:border-zinc-800',
                      'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                      'transition-colors text-foreground',
                      ma.type === t && 'font-semibold',
                    )}
                  >
                    {t}
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Spacer ────────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Window spinner ────────────────────────────────────────────────── */}
      <div className="flex items-center shrink-0" title={freqUnit(seriesFreq)}>
        <button
          type="button"
          aria-label="Decrease periods"
          disabled={ma.window <= 2}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          {...decHandlers}
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        <input
          type="number"
          min={2}
          max={seriesPoints.length}
          value={ma.window}
          onChange={(e) => handleWindowChange(parseInt(e.target.value) || 2)}
          className="w-8 h-5 text-center text-xs tabular-nums bg-transparent border-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded [appearance:textfield] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
        />
        <button
          type="button"
          aria-label="Increase periods"
          disabled={ma.window >= seriesPoints.length}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          {...incHandlers}
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      </div>

      {/* ── Remove ────────────────────────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Remove moving average"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Reorder.Item>
  )
}

// ─── SaveDropdown ─────────────────────────────────────────────────────────────
// Multi-select variant of AddLinePanel's SourceDropdown. Clicking a DB toggles
// a tick but keeps the dropdown open so multiple destinations can be chosen.

interface SaveDropdownProps {
  selected: Set<string>
  onToggle: (id: string) => void
  externalDBs: ExternalDB[]
}

function SaveDropdown({ selected, onToggle, externalDBs }: SaveDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const count = selected.size
  const label = count === 0 ? 'Choose destinations…' : `${count} selected`

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full inline-flex items-center justify-between gap-2 rounded-md text-sm font-medium',
          'border border-input bg-background px-3 h-9',
          'hover:bg-accent hover:text-accent-foreground',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Database className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <span className="truncate text-muted-foreground">{label}</span>
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="shrink-0"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-multiselectable="true"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={cn(
              'absolute top-[calc(100%+0.35rem)] left-0 right-0 z-50',
              'overflow-hidden rounded-md',
              'bg-slate-100 dark:bg-zinc-900',
              'border-2 border-slate-200 dark:border-zinc-800',
              'shadow-lg',
            )}
          >
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
            >
              {/* Local Memory */}
              <motion.button
                type="button"
                role="option"
                aria-selected={selected.has('memory')}
                onClick={() => onToggle('memory')}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                  'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  'transition-colors duration-150',
                  selected.has('memory') && 'font-medium',
                )}
              >
                <Database className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="flex-1">Local Memory</span>
                {selected.has('memory') && <Check className="h-3.5 w-3.5 shrink-0" />}
              </motion.button>

              {/* External DBs */}
              {externalDBs.length > 0 && (
                <div className="border-t-2 border-slate-200 dark:border-zinc-800" />
              )}

              {externalDBs.map((db) => (
                <motion.button
                  key={db.id}
                  type="button"
                  role="option"
                  aria-selected={selected.has(db.id)}
                  aria-disabled={!db.reachable}
                  onClick={() => { if (db.reachable) onToggle(db.id) }}
                  variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                    'border-b-2 border-slate-200 last:border-b-0 dark:border-zinc-800',
                    'transition-colors duration-150',
                    db.reachable
                      ? 'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                      : 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-zinc-900',
                    selected.has(db.id) && 'font-medium',
                  )}
                >
                  <Database className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{db.name}</span>
                  {!db.reachable && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  {selected.has(db.id) && db.reachable && <Check className="h-3.5 w-3.5 shrink-0" />}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── SeriesEditPanel ──────────────────────────────────────────────────────────

interface Props {
  series: DataSeries
  /**
   * 'left'  — absolutely positioned in the gutter to the left of the chart.
   * 'below' — rendered inline in the chart column, below the legend.
   */
  placement: 'left' | 'below'
  activeTab: Tab
  onTabChange: (t: Tab) => void
  onClose: () => void
  onUpdate: (patch: Partial<DataSeries>) => void
}

export function SeriesEditPanel({ series, placement, activeTab, onTabChange, onClose, onUpdate }: Props) {
  const [addingMA, setAddingMA] = useState(false)
  const [maType, setMAType]     = useState<'centered' | 'rolling'>('rolling')
  const [maWindow, setMAWindow] = useState(() => defaultWindow(series.data_freq))

  // ── Save tab state ─────────────────────────────────────────────────────────
  const [saveTargets, setSaveTargets] = useState<Set<string>>(new Set())
  const [saving, setSaving]           = useState(false)
  const [saveResult, setSaveResult]   = useState<'ok' | 'error' | null>(null)

  const toggleSaveTarget = useCallback((id: string) => {
    setSaveTargets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setSaveResult(null)
  }, [])

  const addMADecHandlers = usePressAndHold(() => setMAWindow(w => Math.max(2, w - 1)))
  const addMAIncHandlers = usePressAndHold(() => setMAWindow(w => Math.min(series.points.length, w + 1)))

  const colorPalette   = useAppStore(s => s.colorPalette)
  const customPalettes = useAppStore(s => s.customPalettes)
  const theme          = useAppStore(s => s.theme)
  const externalDBs    = useDBStore(s => s.externalDBs)
  const allPalettes    = getAllPalettes(customPalettes, isDarkTheme(theme))
  const paletteColors  = allPalettes[colorPalette] ?? Object.values(allPalettes)[0]
  const panelRef       = useRef<HTMLDivElement>(null)
  const existingMAs    = series.movingAverages ?? []

  const currentLineStyle = series.lineStyle ?? 'solid'
  const currentLineWidth = series.lineWidth ?? 2

  const handleAddMA = (): void => {
    const computed = computeMA(series.points, maType, maWindow)
    if (computed.length === 0) return

    const newMA: MAComponent = {
      id: crypto.randomUUID(),
      type: maType,
      window: maWindow,
      color: series.color,
      lineStyle: 'dotted',
      lineWidth: 1,
      visible: true,
      points: computed,
    }

    onUpdate({ movingAverages: [...existingMAs, newMA] })
    setAddingMA(false)
  }

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'flex flex-col w-[300px] shrink-0',
        placement === 'below' && 'self-center',
      )}
    >
      {/* ── Title + close ───────────────────────────────────────────────────── */}
      <div className="relative flex items-end mb-4" style={{ minHeight: 76 }}>
        <h2
          className="text-3xl font-black leading-tight text-foreground pr-5"
          style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif" }}
        >
          {series.name}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-0 right-0 text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-5 border-b border-border/30 mb-5">
        {(['format', 'calculations', 'save'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={cn(
              'pb-2 text-xs font-semibold uppercase tracking-wider transition-colors',
              activeTab === t
                ? 'text-foreground border-b-2 border-foreground -mb-px'
                : 'text-muted-foreground/50 hover:text-muted-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Format tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'format' && (
        <div className="flex flex-col gap-6">

          {/* Colour */}
          <section className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Colour
            </p>
            <div className="flex w-full justify-between">
              {paletteColors.map(c => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Set colour ${c}`}
                  onClick={() => onUpdate({ color: c })}
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform hover:scale-110 focus-visible:outline-none',
                    series.color === c && 'ring-2 ring-offset-2 ring-foreground/60',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </section>

          {/* Line style */}
          <section className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Line Style
            </p>
            <div className="flex w-full justify-between">
              {LINE_STYLES.map(({ value, label, dasharray }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onUpdate({ lineStyle: value })}
                  className={cn(
                    'flex flex-col items-start gap-1.5 py-2 rounded transition-colors',
                    currentLineStyle === value
                      ? 'text-foreground'
                      : 'text-muted-foreground/40 hover:text-muted-foreground',
                  )}
                >
                  <svg width="32" height="8" aria-hidden="true">
                    <line
                      x1="2" y1="4" x2="30" y2="4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray={dasharray}
                    />
                  </svg>
                  <span className="text-[10px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Line weight */}
          <section className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Weight
            </p>
            <div className="flex w-full justify-between items-end">
              {LINE_WIDTHS.map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onUpdate({ lineWidth: w })}
                  className={cn(
                    'flex flex-col items-start gap-1.5 transition-opacity',
                    currentLineWidth === w ? 'opacity-100' : 'opacity-25 hover:opacity-60',
                  )}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      height: w,
                      width: 32,
                      backgroundColor: series.color ?? '#3b82f6',
                    }}
                  />
                  <span className="text-[10px] text-muted-foreground">{w}px</span>
                </button>
              ))}
            </div>
          </section>

        </div>
      )}

      {/* ── Save tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'save' && (
        <div className="flex flex-col gap-5">
          <section className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Save to
            </p>
            <SaveDropdown
              selected={saveTargets}
              onToggle={toggleSaveTarget}
              externalDBs={externalDBs}
            />
          </section>

          <button
            type="button"
            disabled={saveTargets.size === 0 || saving}
            onClick={async () => {
              setSaving(true)
              setSaveResult(null)
              try {
                const tasks: Promise<void>[] = []
                for (const id of saveTargets) {
                  if (id === 'memory') {
                    tasks.push(ipc.memory.saveSeries(series))
                  } else {
                    const db = externalDBs.find((d) => d.id === id)
                    if (db) tasks.push(ipc.external.saveSeries(db.path, series))
                  }
                }
                await Promise.all(tasks)
                setSaveResult('ok')
              } catch {
                setSaveResult('error')
              } finally {
                setSaving(false)
              }
            }}
            className={cn(
              'flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-all',
              saveTargets.size === 0 || saving
                ? 'border border-border text-muted-foreground/40 cursor-not-allowed'
                : 'bg-foreground text-background hover:opacity-80',
            )}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </button>

          <AnimatePresence>
            {saveResult === 'ok' && (
              <motion.p
                key="ok"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
              >
                <Check className="h-3.5 w-3.5" />
                Saved successfully
              </motion.p>
            )}
            {saveResult === 'error' && (
              <motion.p
                key="err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs text-destructive"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                Save failed — check the destination DB
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Calculations tab ─────────────────────────────────────────────────── */}
      {activeTab === 'calculations' && (
        <div className="flex flex-col gap-4">

          {/* ── Display As (per-series transform selector) ───────────────── */}
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Display As
            </p>
            <div className="flex gap-2">
              {([
                { value: 'returns' as const, label: 'Raw Returns' },
                { value: 'cumulative' as const, label: 'Cumulative' },
                { value: 'drawdown' as const, label: 'Drawdowns' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdate({ transform: opt.value })}
                  className={cn(
                    'flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors',
                    (series.transform ?? 'returns') === opt.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Cumulative sub-options — only when this series is set to cumulative */}
            <AnimatePresence>
              {(series.transform ?? 'returns') === 'cumulative' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 space-y-2 pl-1">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Method</p>
                      <div className="flex gap-2">
                        {(['geometric', 'arithmetic'] as const).map(m => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => onUpdate({ cumMethod: m })}
                            className={cn(
                              'flex-1 rounded-md border py-1 text-xs font-medium capitalize transition-colors',
                              (series.cumMethod ?? 'geometric') === m
                                ? 'border-foreground bg-foreground text-background'
                                : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                            )}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Base Date</p>
                      <input
                        type="text"
                        placeholder="YYYY-MM-DD (default: first date)"
                        value={series.cumBaseInput ?? ''}
                        onChange={(e) => onUpdate({ cumBaseInput: e.target.value })}
                        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* ── Draggable MA list ─────────────────────────────────────────── */}
          {existingMAs.length > 0 && (
            <section className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                Moving Averages
              </p>
              <Reorder.Group
                axis="y"
                values={existingMAs}
                onReorder={(newOrder) => onUpdate({ movingAverages: newOrder })}
                as="div"
                className="flex flex-col gap-1.5"
              >
                {existingMAs.map((ma) => (
                  <MAToast
                    key={ma.id}
                    ma={ma}
                    seriesPoints={series.points}
                    seriesFreq={series.data_freq}
                    onChange={(patch) =>
                      onUpdate({
                        movingAverages: existingMAs.map((m) =>
                          m.id === ma.id ? { ...m, ...patch } : m,
                        ),
                      })
                    }
                    onRemove={() =>
                      onUpdate({
                        movingAverages: existingMAs.filter((m) => m.id !== ma.id),
                      })
                    }
                  />
                ))}
              </Reorder.Group>
            </section>
          )}

          {/* ── Add MA ────────────────────────────────────────────────────── */}
          {addingMA ? (
            <section className="space-y-4 rounded-lg border border-border/50 p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                New Moving Average
              </p>

              {/* Type toggle */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Type</p>
                <div className="flex gap-2">
                  {(['rolling', 'centered'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setMAType(t)}
                      className={cn(
                        'flex-1 rounded-md border py-1.5 text-xs font-medium capitalize transition-colors',
                        maType === t
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                  {maType === 'rolling'
                    ? 'Trailing — each point averages the preceding window only.'
                    : 'Symmetric — each point averages the surrounding window.'}
                </p>
              </div>

              {/* Window spinner */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Window</p>
                <div className="flex items-center gap-2">
                  <div className="flex items-center border border-input rounded-md overflow-hidden bg-background">
                    <button
                      type="button"
                      aria-label="Decrease"
                      disabled={maWindow <= 2}
                      className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                      {...addMADecHandlers}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      min={2}
                      max={series.points.length}
                      value={maWindow}
                      onChange={e => setMAWindow(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-12 h-8 text-center text-sm tabular-nums bg-transparent border-0 focus-visible:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                    />
                    <button
                      type="button"
                      aria-label="Increase"
                      disabled={maWindow >= series.points.length}
                      className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                      {...addMAIncHandlers}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="text-xs text-muted-foreground">{freqUnit(series.data_freq)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddingMA(false)}
                  className="flex-1 rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddMA}
                  disabled={maWindow > series.points.length}
                  className="flex-1 rounded-md bg-foreground text-background py-1.5 text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </section>
          ) : (
            <button
              type="button"
              onClick={() => setAddingMA(true)}
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Moving Average
            </button>
          )}

        </div>
      )}

    </motion.div>
  )
}
