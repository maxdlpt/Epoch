import { useState, useCallback, forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import { Check, ChevronDown, Database, HardDrive, BarChart2, X, Table2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { DataSeries, DataFreq, DataType } from '../../../shared/types'
import { formatFreq } from '../../lib/freq'
import { useDBStore } from '../../store/db'
import { cn } from '../../lib/utils'
import { Input } from '../ui/input'

// ─── Destination type ─────────────────────────────────────────────────────────

export type Destination =
  | { type: 'graph' }
  | { type: 'memory' }
  | { type: 'external'; id: string; path: string }
  | { type: 'skip' }

export interface Assignment {
  series: DataSeries
  destination: Destination
}

// ─── Imperative handle ────────────────────────────────────────────────────────

export interface SeriesReviewHandle {
  /** Returns all series with their current drafts and destinations applied. */
  getAll: () => Assignment[]
}

// ─── Draft ────────────────────────────────────────────────────────────────────

const FREQS: DataFreq[] = ['daily', 'weekly', 'monthly', 'quarterly', 'semi-annual', 'yearly']

interface Draft {
  name: string
  code: string
  description: string
  data_freq: DataFreq
  dataType: DataType
}

// ─── Destination selector ─────────────────────────────────────────────────────

type ExternalDB = { id: string; name: string; path: string; reachable: boolean }

function destLabel(dest: Destination, dbs: ExternalDB[]): string {
  switch (dest.type) {
    case 'graph':    return 'Graph'
    case 'memory':   return 'Memory'
    case 'skip':     return 'Skip'
    case 'external': return dbs.find(db => db.id === dest.id)?.name ?? 'Database'
  }
}

function DestIcon({ dest, className }: { dest: Destination; className?: string }) {
  switch (dest.type) {
    case 'graph':    return <BarChart2 className={className} />
    case 'memory':   return <HardDrive className={className} />
    case 'skip':     return <X className={className} />
    case 'external': return <Database className={className} />
  }
}

function destMatch(a: Destination, b: Destination): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'external' && b.type === 'external') return a.id === b.id
  return true
}

interface DestSelectorProps {
  value: Destination
  onChange: (dest: Destination) => void
  dbs: ExternalDB[]
}

function DestSelector({ value, onChange, dbs }: DestSelectorProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const options: Destination[] = [
    { type: 'graph' },
    { type: 'memory' },
    ...dbs.filter(db => db.reachable).map(db => ({ type: 'external' as const, id: db.id, path: db.path })),
    { type: 'skip' },
  ]

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-muted hover:bg-accent text-foreground transition-colors"
      >
        <DestIcon dest={value} className="h-3 w-3 shrink-0" />
        <span>{destLabel(value, dbs)}</span>
        <ChevronDown className={cn('h-2.5 w-2.5 opacity-50 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full mt-1 z-50 min-w-[9rem] rounded-lg overflow-hidden shadow-lg bg-card border border-border"
          >
            {options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { onChange(opt); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent transition-colors"
              >
                <DestIcon dest={opt} className="h-3 w-3 shrink-0 opacity-60" />
                <span className="flex-1">{destLabel(opt, dbs)}</span>
                {destMatch(opt, value) && <Check className="h-3 w-3 shrink-0 opacity-50" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatDateRange(points: DataSeries['points']): string {
  if (points.length === 0) return '—'
  let minT = Infinity, maxT = -Infinity
  for (const p of points) {
    const t = p.date.getTime()
    if (t < minT) minT = t
    if (t > maxT) maxT = t
  }
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  return `${fmt(new Date(minT))} – ${fmt(new Date(maxT))}`
}

// ─── Data preview table ──────────────────────────────────────────────────────

const MAX_PREVIEW_ROWS = 50

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = SHORT_MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day} ${mon} ${year}`
}

function fmtValue(v: number): string {
  return `${(v * 100).toFixed(2)}%`
}

function DataPreview({ series }: { series: DataSeries }) {
  const pts = series.points
  const capped = pts.length > MAX_PREVIEW_ROWS
  const rows = capped ? pts.slice(0, MAX_PREVIEW_ROWS) : pts

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="max-h-64 overflow-y-auto rounded border border-border mt-2">
        <table className="min-w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted z-10">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground border-b border-border">#</th>
              <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground border-b border-border">Date</th>
              <th className="text-right px-3 py-1.5 font-semibold text-muted-foreground border-b border-border">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-1 text-muted-foreground/60 tabular-nums">{i + 1}</td>
                <td className="px-3 py-1 tabular-nums">{fmtDate(p.date)}</td>
                <td className="px-3 py-1 text-right font-mono tabular-nums">
                  {fmtValue(p.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {capped && (
          <div className="text-center text-[10px] text-muted-foreground py-1.5 border-t border-border bg-muted/30">
            Showing {MAX_PREVIEW_ROWS} of {pts.length.toLocaleString()} rows
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── SeriesReviewPanel ────────────────────────────────────────────────────────

interface Props {
  series: DataSeries[]
  onAddSingle: (assignment: Assignment) => void
}

export const SeriesReviewPanel = forwardRef<SeriesReviewHandle, Props>(
  function SeriesReviewPanel({ series, onAddSingle }, ref) {
    const externalDBs = useDBStore(s => s.externalDBs)

    const [drafts, setDrafts] = useState<Map<string, Draft>>(
      () => new Map(series.map(s => [s.id, {
        name: s.name,
        code: s.code,
        description: s.description,
        data_freq: s.data_freq ?? 'daily',
        dataType: s.dataType ?? 'growth',
      }]))
    )
    const [destinations, setDestinations] = useState<Map<string, Destination>>(
      () => new Map(series.map(s => [s.id, { type: 'graph' as const }]))
    )
    const [expandedData, setExpandedData] = useState<Set<string>>(new Set())
    const toggleData = useCallback((id: string) => {
      setExpandedData(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
    }, [])

    const updateDraft = useCallback((id: string, patch: Partial<Draft>) => {
      setDrafts(prev => new Map(prev).set(id, { ...prev.get(id)!, ...patch }))
    }, [])

    const setDest = useCallback((id: string, dest: Destination) => {
      setDestinations(prev => new Map(prev).set(id, dest))
    }, [])

    // Detect duplicate codes within the batch
    const codeDuplicates = new Set<string>()
    const codeMap = new Map<string, number>()
    for (const [, d] of drafts) {
      const c = d.code.trim()
      if (!c) continue
      codeMap.set(c, (codeMap.get(c) ?? 0) + 1)
    }
    for (const [code, count] of codeMap) {
      if (count > 1) codeDuplicates.add(code)
    }

    useImperativeHandle(ref, () => ({
      getAll: () => series.map(s => ({
        series: { ...s, ...(drafts.get(s.id) ?? {}) },
        destination: destinations.get(s.id) ?? { type: 'graph' },
      })),
    }), [series, drafts, destinations])

    return (
      <div className="flex flex-col gap-3 overflow-y-auto">
        {series.map(s => {
          const draft = drafts.get(s.id)!
          const dest  = destinations.get(s.id)!
          const isDupCode = codeDuplicates.has(draft.code.trim())
          const hasError = !draft.name.trim() || !draft.code.trim() || isDupCode

          return (
            <div key={s.id} className="rounded-lg border border-border p-4 space-y-3">
              {/* Header row: swatch · date range · destination · add button */}
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: s.color ?? '#3b82f6' }}
                />
                <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                  {formatDateRange(s.points)} · {s.points.length.toLocaleString()} pts
                  {s.dateFormat && s.dateFormat !== 'ISO' && (
                    <span className="text-blue-500 ml-1" title={`Detected date format: ${s.dateFormat === 'DMY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'}`}>
                      [{s.dateFormat}]
                    </span>
                  )}
                  {(s.droppedRows ?? 0) > 0 && (
                    <span className="text-amber-500 ml-1">({s.droppedRows} rows dropped)</span>
                  )}
                </span>
                <button
                  type="button"
                  title="View data"
                  onClick={() => toggleData(s.id)}
                  className={cn(
                    'flex items-center justify-center h-[26px] w-[26px] rounded transition-colors shrink-0',
                    expandedData.has(s.id)
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-accent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Table2 className="h-3 w-3" />
                </button>
                <DestSelector value={dest} onChange={d => setDest(s.id, d)} dbs={externalDBs} />
                <button
                  type="button"
                  disabled={hasError || dest.type === 'skip'}
                  title="Add this series"
                  onClick={() => onAddSingle({ series: { ...s, ...draft }, destination: dest })}
                  className="flex items-center justify-center h-[26px] w-[26px] rounded bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  title="Exclude this series"
                  onClick={() => setDest(s.id, { type: 'skip' })}
                  className={cn(
                    'flex items-center justify-center h-[26px] w-[26px] rounded transition-colors shrink-0',
                    dest.type === 'skip'
                      ? 'bg-muted text-muted-foreground'
                      : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive',
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Name</label>
                  <Input
                    value={draft.name}
                    onChange={e => updateDraft(s.id, { name: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="Series name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Code {isDupCode && <span className="text-destructive ml-1">(duplicate)</span>}
                  </label>
                  <Input
                    value={draft.code}
                    onChange={e => updateDraft(s.id, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                    className={cn('h-8 text-sm font-mono', isDupCode && 'border-destructive')}
                    placeholder="MY_CODE"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Description</label>
                  <Input
                    value={draft.description}
                    onChange={e => updateDraft(s.id, { description: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Frequency
                    {draft.data_freq === (s.data_freq ?? 'daily') && (
                      <span className="ml-1 text-[10px] text-blue-500 font-normal">auto</span>
                    )}
                  </label>
                  <select
                    value={draft.data_freq}
                    onChange={e => updateDraft(s.id, { data_freq: e.target.value as DataFreq })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {FREQS.map(f => <option key={f} value={f}>{formatFreq(f)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Data Type</label>
                  <select
                    value={draft.dataType}
                    onChange={e => updateDraft(s.id, { dataType: e.target.value as DataType })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="growth">Returns</option>
                    <option value="level">Level (index/price)</option>
                  </select>
                </div>
              </div>

              {/* Data preview table */}
              <AnimatePresence>
                {expandedData.has(s.id) && <DataPreview series={s} />}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    )
  }
)
