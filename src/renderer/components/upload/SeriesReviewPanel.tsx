import { useState, useCallback, forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import { Check, ChevronDown, Database, HardDrive, BarChart2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { DataSeries, DataFreq } from '../../../shared/types'
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

const FREQS: DataFreq[] = ['daily', 'monthly', 'quarterly', 'yearly']

interface Draft {
  name: string
  code: string
  description: string
  data_freq: DataFreq
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
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-foreground transition-colors"
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
            className="absolute right-0 top-full mt-1 z-50 min-w-[9rem] rounded-lg overflow-hidden shadow-lg bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
          >
            {options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { onChange(opt); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
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
      }]))
    )
    const [destinations, setDestinations] = useState<Map<string, Destination>>(
      () => new Map(series.map(s => [s.id, { type: 'graph' as const }]))
    )

    const updateDraft = useCallback((id: string, patch: Partial<Draft>) => {
      setDrafts(prev => new Map(prev).set(id, { ...prev.get(id)!, ...patch }))
    }, [])

    const setDest = useCallback((id: string, dest: Destination) => {
      setDestinations(prev => new Map(prev).set(id, dest))
    }, [])

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
          const hasError = !draft.name.trim() || !draft.code.trim()

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
                </span>
                <DestSelector value={dest} onChange={d => setDest(s.id, d)} dbs={externalDBs} />
                <button
                  type="button"
                  disabled={hasError || dest.type === 'skip'}
                  title="Add this series"
                  onClick={() => onAddSingle({ series: { ...s, ...draft }, destination: dest })}
                  className="flex items-center justify-center h-[26px] w-[26px] rounded bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
                >
                  <Check className="h-3 w-3" />
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
                  <label className="text-xs font-medium text-muted-foreground">Code</label>
                  <Input
                    value={draft.code}
                    onChange={e => updateDraft(s.id, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                    className="h-8 text-sm font-mono"
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
                  <label className="text-xs font-medium text-muted-foreground">Frequency</label>
                  <select
                    value={draft.data_freq}
                    onChange={e => updateDraft(s.id, { data_freq: e.target.value as DataFreq })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {FREQS.map(f => <option key={f} value={f}>{formatFreq(f)}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }
)
