import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, ChevronDown, Database, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useDropdownKeyboard } from '../../hooks/useDropdownKeyboard'
import { useGraphStore } from '../../store/graph'
import { useDBStore } from '../../store/db'
import { useAppStore } from '../../store/app'
import { ipc } from '../../lib/ipc'
import { getColor } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { toGeomIndex } from '../../lib/transforms'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { AreaChart, Area } from '../ui/area-chart'
import type { CustomPaletteEntry, DBRecord, DataSeries, ExternalDB } from '../../../shared/types'
import { inferFreqFromRecord, formatFreq } from '../../lib/freq'

type Source = 'memory' | string

function formatDateRange(startDate: string, endDate: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  return `${fmt(startDate)} – ${fmt(endDate)}`
}

// ─── Source Dropdown ──────────────────────────────────────────────────────────

interface SourceDropdownProps {
  source: Source
  onSelect: (source: Source) => void
  externalDBs: ExternalDB[]
}

function SourceDropdown({ source, onSelect, externalDBs }: SourceDropdownProps) {
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

  const closeSourceDD = useCallback(() => setOpen(false), [])
  useDropdownKeyboard(wrapperRef, open, closeSourceDD)

  const label =
    source === 'memory'
      ? 'Local Memory'
      : (externalDBs.find((db) => db.id === source)?.name ?? 'Select Source')

  const handleSelect = (s: Source, reachable: boolean): void => {
    if (!reachable) return
    onSelect(s)
    setOpen(false)
  }

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
          <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{label}</span>
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
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={cn(
              'absolute top-[calc(100%+0.35rem)] left-0 right-0 z-50',
              'overflow-hidden rounded-md',
              'bg-muted',
              'border-2 border-border',
              'shadow-lg',
            )}
          >
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
            >
              <motion.button
                type="button"
                role="option"
                aria-selected={source === 'memory'}
                onClick={() => handleSelect('memory', true)}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                  'bg-card hover:bg-accent',
                  'transition-colors duration-150',
                  source === 'memory' && 'font-medium',
                )}
              >
                <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="flex-1">Local Memory</span>
                {source === 'memory' && <Check className="h-3.5 w-3.5 shrink-0" />}
              </motion.button>

              {externalDBs.length > 0 && (
                <div className="border-t-2 border-border" />
              )}

              {externalDBs.map((db) => (
                <motion.button
                  key={db.id}
                  type="button"
                  role="option"
                  aria-selected={source === db.id}
                  aria-disabled={!db.reachable}
                  onClick={() => handleSelect(db.id, db.reachable)}
                  variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                    'border-b-2 border-border last:border-b-0',
                    'transition-colors duration-150',
                    db.reachable
                      ? 'bg-card hover:bg-accent'
                      : 'opacity-40 cursor-not-allowed bg-card',
                    source === db.id && 'font-medium',
                  )}
                >
                  <Database className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{db.name}</span>
                  {!db.reachable && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  {source === db.id && db.reachable && <Check className="h-3.5 w-3.5 shrink-0" />}
                </motion.button>
              ))}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Series Row (accordion item) ─────────────────────────────────────────────

interface SeriesRowProps {
  record: DBRecord
  source: Source
  sourcePath: string | null
  sourceDbId: string | null
  onAdd: (series: DataSeries) => void
  colorPalette: string
  colorIndex: number
  customPalettes: Record<string, CustomPaletteEntry>
  isDark: boolean
  uiTheme: string
  expanded: boolean
  onToggle: () => void
}

function SeriesRow({
  record,
  source,
  sourcePath,
  sourceDbId,
  onAdd,
  colorPalette,
  colorIndex,
  customPalettes,
  isDark,
  uiTheme,
  expanded,
  onToggle,
}: SeriesRowProps) {
  const [series, setSeries] = useState<DataSeries | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!expanded || series !== null) return
    let cancelled = false
    setLoading(true)

    const fetcher =
      source === 'memory'
        ? ipc.memory.getSeries(record.id)
        : sourcePath && sourceDbId
          ? ipc.external.getSeries(sourcePath, record.id, sourceDbId)
          : Promise.resolve(null)

    fetcher
      .then((result) => {
        if (!cancelled && result) {
          setSeries({ ...result, color: getColor(colorPalette, colorIndex, customPalettes, isDark, uiTheme), colorIndex })
        }
      })
      .catch(() => { /* preview failure is non-critical */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [expanded, series, source, sourcePath, sourceDbId, record.id, colorPalette, colorIndex, customPalettes, isDark])

  const previewData = useMemo(() => {
    if (!series) return []
    const geomPts = toGeomIndex(series.points)
    return geomPts.map((p) => ({ date: p.date, [record.code]: p.value }))
  }, [series, record.code])

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-2 px-3 py-2.5 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{record.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatFreq(inferFreqFromRecord(record.pointCount, record.startDate, record.endDate))}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatDateRange(record.startDate, record.endDate)}
          </div>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="shrink-0 mt-0.5"
        >
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t border-border bg-muted/20"
          >
            <div className="p-3 space-y-3">
              {loading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading preview…</p>
              ) : series && previewData.length > 0 ? (
                <>
                  <div className="h-28">
                    <AreaChart
                      data={previewData}
                      xDataKey="date"
                      aspectRatio="auto"
                      className="h-full"
                      animationDuration={350}
                      margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                    >
                      <Area
                        dataKey={record.code}
                        stroke={getColor(colorPalette, 0, customPalettes, isDark, uiTheme)}
                        fill={getColor(colorPalette, 0, customPalettes, isDark, uiTheme)}
                        fillOpacity={0.15}
                      />
                    </AreaChart>
                  </div>
                  {record.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {record.description}
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAdd(series)
                      onToggle()
                    }}
                  >
                    Add to Graph
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">No preview available.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── AddLinePanel (modal) ────────────────────────────────────────────────────

export function AddLinePanel(): JSX.Element {
  const { setRightPanel, addSeries, activeSeries, rightPanel } = useGraphStore()
  const externalDBs = useDBStore((s) => s.externalDBs)
  const colorPalette   = useAppStore((s) => s.colorPalette)
  const customPalettes = useAppStore((s) => s.customPalettes)
  const theme          = useAppStore((s) => s.theme)
  const uiTheme        = useAppStore((s) => s.uiTheme)
  const setActiveTab   = useAppStore((s) => s.setActiveTab)
  const isDark         = isDarkTheme(theme)

  const isOpen = rightPanel === 'addLine'

  const [source, setSource] = useState<Source>('memory')
  const [records, setRecords] = useState<DBRecord[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => setRightPanel(null), [setRightPanel])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, close])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close()
  }, [close])

  const sourceRef = useMemo(
    () => (source === 'memory' ? null : (externalDBs.find((db) => db.id === source) ?? null)),
    [source, externalDBs],
  )

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setRecords([])
    setExpandedId(null)

    const fetcher =
      source === 'memory'
        ? ipc.memory.listSeries()
        : sourceRef
          ? ipc.external.listSeries(sourceRef.path)
          : Promise.resolve<DBRecord[]>([])

    fetcher
      .then((list) => { if (!cancelled) setRecords(list) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [source, sourceRef, isOpen])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return records
    return records.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    )
  }, [records, query])

  const handleAdd = useCallback(
    (series: DataSeries): void => {
      const duplicate = activeSeries.some(s => s.id === series.id)
      addSeries(duplicate ? { ...series, id: crypto.randomUUID() } : series)
      close()
    },
    [addSeries, close, activeSeries],
  )

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleBackdropClick}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col w-[380px] max-h-[75vh] rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <h2 className="text-base font-semibold text-foreground">Add Series</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">
              {/* Source */}
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  Source
                </p>
                <SourceDropdown
                  source={source}
                  onSelect={setSource}
                  externalDBs={externalDBs}
                />
              </section>

              {/* Search */}
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  Search
                </p>
                <Input
                  type="search"
                  placeholder="Search series…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 text-sm"
                />
              </section>

              {/* Results */}
              <section className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  Results
                </p>
                {loading ? (
                  <p className="text-xs text-muted-foreground/50">Loading…</p>
                ) : error ? (
                  <p className="text-xs text-destructive">{error}</p>
                ) : filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50 italic">
                    {records.length === 0 ? 'No series available.' : 'No matches.'}
                  </p>
                ) : (
                  <div className="rounded-lg border border-border overflow-hidden">
                    {filtered.map((r, i) => (
                      <SeriesRow
                        key={r.id}
                        record={r}
                        source={source}
                        sourcePath={sourceRef?.path ?? null}
                        sourceDbId={sourceRef?.id ?? null}
                        onAdd={handleAdd}
                        colorPalette={colorPalette}
                        colorIndex={activeSeries.length + i}
                        customPalettes={customPalettes}
                        isDark={isDark}
                        uiTheme={uiTheme}
                        expanded={expandedId === r.id}
                        onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Upload shortcut */}
              <button
                type="button"
                onClick={() => { close(); setActiveTab('upload') }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                  'border border-dashed border-border',
                  'text-muted-foreground hover:text-foreground hover:bg-accent',
                  'transition-colors duration-150',
                )}
              >
                <Upload className="h-3.5 w-3.5 shrink-0" />
                <span>Upload data…</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
