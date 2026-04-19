"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Database, FilePlus, FolderOpen, HardDrive, Plus, Save, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { useDBStore } from '../../store/db'
import { cn } from '../../lib/utils'
import { inferFreqFromRecord, formatFreq } from '../../lib/freq'
import { Tabs, TabsList, TabsTab, TabsPanel } from '../ui/tabs'
import { SeriesList, MiniChart } from '../ui/series-list'
import { DataTable } from '../ui/data-table'
import { ipc } from '../../lib/ipc'
import type { DBRecord, DataSeries, ExternalDB } from '../../../shared/types'

type SelectedDB = 'memory' | string

// ─── Tab Icons ────────────────────────────────────────────────────────────────

function BulletListIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <line x1="10" y1="7"  x2="19" y2="7"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="5"  y1="7"  x2="5.1" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="5"  y1="12" x2="5.1" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="17" x2="19" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="5"  y1="17" x2="5.1" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function TableIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M40.15 5H7.85C6.276 5 5 6.276 5 7.85V40.15C5 41.724 6.276 43 7.85 43H40.15C41.724 43 43 41.724 43 40.15V7.85C43 6.276 41.724 5 40.15 5Z" stroke="currentColor" strokeWidth="4" />
      <path d="M17 5V43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M31 5V43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M5 17H43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M5 31H43"  stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function DBSettingsIcon({ className }: { className?: string }) {
  // The gear is drawn in its own 24×24 coordinate space and placed bottom-right
  // via a scale + translate transform.  strokeWidth is scaled up to compensate
  // so the rendered stroke appears the same weight as the Database paths.
  const SCALE = 0.65
  const SW    = 2 / SCALE   // compensate so rendered stroke ≈ 2 px
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Database cylinder */}
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
      {/* Punch-out background — r=7.8 fully covers gear knobs at SCALE=0.65 */}
      <circle cx="17.5" cy="17.5" r="7.8" fill="var(--color-background)" stroke="none" />
      {/* Settings gear — centre (12,12) → translate(9.7,9.7) + 12×0.65 = 17.5 */}
      <g transform={`translate(9.7,9.7) scale(${SCALE})`} strokeWidth={SW}>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </svg>
  )
}

const FONT_STYLE = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
}

function deriveDBName(filePath: string): string {
  const basename = filePath.split(/[\\/]/).pop() ?? ''
  return basename.replace(/\.db$/i, '') || 'external'
}

function dbLabel(selected: SelectedDB, externalDBs: ExternalDB[]): string {
  if (selected === 'memory') return 'Local Memory'
  return externalDBs.find((db) => db.id === selected)?.name ?? 'Select Database'
}

function DBIcon({ selected, externalDBs }: { selected: SelectedDB; externalDBs: ExternalDB[] }) {
  if (selected === 'memory') return <HardDrive className="h-8 w-8 text-blue-500 shrink-0" />
  const db = externalDBs.find((d) => d.id === selected)
  return (
    <Database
      className={cn('h-8 w-8 shrink-0', db?.reachable === false ? 'text-red-400' : 'text-blue-500')}
    />
  )
}

// ─── Title Dropdown ───────────────────────────────────────────────────────────
// Styled like the GraphTab chart-mode title: text-4xl font-black with a
// ChevronDown. The list reuses the AddLinePanel SourceDropdown visual style.

interface TitleDropdownProps {
  selected: SelectedDB
  onSelect: (id: SelectedDB) => void
  externalDBs: ExternalDB[]
  onAddDB: () => void
  onCreateDB: () => void
}

function TitleDropdown({ selected, onSelect, externalDBs, onAddDB, onCreateDB }: TitleDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = (id: SelectedDB, reachable: boolean) => {
    if (!reachable) return
    onSelect(id)
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-start gap-3 leading-none select-none text-foreground group"
        style={FONT_STYLE}
      >
        <DBIcon selected={selected} externalDBs={externalDBs} />
        <span className="text-4xl font-black text-left">
          {dbLabel(selected, externalDBs)}
          <ChevronDown
            className={cn(
              'inline-block align-middle ml-1 h-6 w-6 transition-transform duration-150 opacity-40 group-hover:opacity-80',
              open && 'rotate-180',
            )}
            strokeWidth={3}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute left-0 top-full mt-2 z-50',
              'min-w-[16rem] rounded-lg overflow-hidden',
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
                onClick={() => handleSelect('memory', true)}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                  'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  'transition-colors duration-150',
                  selected === 'memory' && 'font-medium',
                )}
              >
                <HardDrive className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="flex-1">Local Memory</span>
                {selected === 'memory' && <Check className="h-3.5 w-3.5 shrink-0" />}
              </motion.button>

              {externalDBs.length > 0 && (
                <div className="border-t-2 border-slate-200 dark:border-zinc-800" />
              )}

              {externalDBs.map((db) => (
                <motion.button
                  key={db.id}
                  type="button"
                  onClick={() => handleSelect(db.id, db.reachable)}
                  variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                    'border-b-2 border-slate-200 last:border-b-0 dark:border-zinc-800',
                    'transition-colors duration-150',
                    db.reachable
                      ? 'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                      : 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-zinc-900',
                    selected === db.id && 'font-medium',
                  )}
                >
                  <Database className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{db.name}</span>
                  {!db.reachable && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  {selected === db.id && db.reachable && <Check className="h-3.5 w-3.5 shrink-0" />}
                </motion.button>
              ))}

              {/* ── Management actions ─────────────────────────────── */}
              <div className="border-t-2 border-slate-200 dark:border-zinc-800" />

              <motion.button
                type="button"
                onClick={() => { setOpen(false); onAddDB() }}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                  'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  'transition-colors duration-150',
                )}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">Add</span>
              </motion.button>

              <motion.button
                type="button"
                onClick={() => { setOpen(false); onCreateDB() }}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                  'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  'transition-colors duration-150',
                )}
              >
                <FilePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">Create database</span>
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Series Dropdown (Data tab) ───────────────────────────────────────────────

interface SeriesDropdownProps {
  selected: string | 'all'
  onSelect: (id: string | 'all') => void
  records: DBRecord[]
}

function SeriesDropdown({ selected, onSelect, records }: SeriesDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = selected === 'all'
    ? 'All'
    : (records.find((r) => r.id === selected)?.name ?? 'All')

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-start pb-1 select-none group"
        style={FONT_STYLE}
      >
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/50 group-hover:text-muted-foreground transition-colors text-left">
          {label}
          <ChevronDown
            className={cn(
              'inline-block align-middle ml-0.5 h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-[transform,color] duration-150',
              open && 'rotate-180',
            )}
            strokeWidth={2.5}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute left-0 top-full z-50',
              'min-w-[14rem] max-h-64 overflow-y-auto overflow-x-hidden rounded-lg',
              'bg-slate-100 dark:bg-zinc-900',
              'border-2 border-slate-200 dark:border-zinc-800',
              'shadow-lg',
            )}
          >
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.02 } } }}
            >
              {/* All option */}
              <motion.button
                type="button"
                onClick={() => { onSelect('all'); setOpen(false) }}
                variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                  'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  'transition-colors duration-150',
                  selected === 'all' && 'font-medium',
                )}
              >
                <span className="flex-1">All</span>
                {selected === 'all' && <Check className="h-3.5 w-3.5 shrink-0" />}
              </motion.button>

              {records.length > 0 && (
                <div className="border-t-2 border-slate-200 dark:border-zinc-800" />
              )}

              {records.map((r) => (
                <motion.button
                  key={r.id}
                  type="button"
                  onClick={() => { onSelect(r.id); setOpen(false) }}
                  variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left',
                    'border-b border-slate-200 last:border-b-0 dark:border-zinc-800',
                    'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                    'transition-colors duration-150',
                    selected === r.id && 'font-medium',
                  )}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  {selected === r.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Import Series Modal ──────────────────────────────────────────────────────

const IMPORT_FREQ_STYLES: Record<string, string> = {
  daily:     'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400',
  monthly:   'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-400',
  quarterly: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400',
  yearly:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400',
  unknown:   'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-300',
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${y} ${MONTHS[parseInt(m, 10) - 1]} ${d}`
}

interface ImportSeriesModalProps {
  destDbPath: string | null
  onClose: () => void
  onImported: () => void
}

function ImportSeriesModal({ destDbPath, onClose, onImported }: ImportSeriesModalProps) {
  const externalDBs = useDBStore((s) => s.externalDBs)
  const [source, setSource]         = useState<string>('memory')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [records, setRecords]       = useState<DBRecord[]>([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [query, setQuery]           = useState('')
  // Two-phase state: pending = staged by clicking +; importStatus = set during confirm
  const [pendingIds, setPendingIds]     = useState<Set<string>>(new Set())
  const [importStatus, setImportStatus] = useState<Record<string, 'loading' | 'done'>>({})
  const [confirming, setConfirming]     = useState(false)
  const [hoveredId, setHoveredId]       = useState<string | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const sourceRef = useMemo(
    () => source === 'memory' ? null : (externalDBs.find((db) => db.id === source) ?? null),
    [source, externalDBs],
  )

  useEffect(() => {
    if (!sourceOpen) return
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setSourceOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sourceOpen])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setRecords([])
    setPendingIds(new Set())
    setImportStatus({})

    const fetcher = source === 'memory'
      ? ipc.memory.listSeries()
      : sourceRef
        ? ipc.external.listSeries(sourceRef.path)
        : Promise.resolve<DBRecord[]>([])

    fetcher
      .then((list) => { if (!cancelled) setRecords(list) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [source, sourceRef])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return records
    return records.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q),
    )
  }, [records, query])

  function handleToggle(id: string) {
    if (confirming || importStatus[id]) return
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirm() {
    if (pendingIds.size === 0 || confirming) return
    setConfirming(true)

    const toImport = records.filter((r) => pendingIds.has(r.id))

    await Promise.all(
      toImport.map(async (r) => {
        setImportStatus((prev) => ({ ...prev, [r.id]: 'loading' }))
        try {
          const series = source === 'memory'
            ? await ipc.memory.getSeries(r.id)
            : sourceRef
              ? await ipc.external.getSeries(sourceRef.path, r.id, sourceRef.id)
              : null
          if (!series) throw new Error('Not found')

          if (destDbPath) await ipc.external.saveSeries(destDbPath, series)
          else            await ipc.memory.saveSeries(series)

          setImportStatus((prev) => ({ ...prev, [r.id]: 'done' }))
        } catch {
          // Leave as 'loading' briefly then remove so button reverts to staged
          setImportStatus((prev) => { const n = { ...prev }; delete n[r.id]; return n })
        }
      }),
    )

    setConfirming(false)
    onImported()
  }

  const sourceLabel = source === 'memory'
    ? 'Local Memory'
    : (externalDBs.find((db) => db.id === source)?.name ?? 'Select Source')

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0" style={{ width: 'min(88vw, 700px)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-3xl font-black leading-none text-foreground" style={FONT_STYLE}>
          Import Series
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="mt-1 shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Source dropdown */}
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Source</p>
        <div ref={dropRef} className="relative">
          <button
            type="button"
            onClick={() => setSourceOpen((o) => !o)}
            className={cn(
              'w-full inline-flex items-center justify-between gap-2 rounded-md text-sm font-medium',
              'border border-input bg-background text-foreground px-3 h-9',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Database className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              <span className="truncate">{sourceLabel}</span>
            </span>
            <motion.span
              animate={{ rotate: sourceOpen ? 180 : 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="shrink-0"
            >
              <ChevronDown className="h-4 w-4" />
            </motion.span>
          </button>

          <AnimatePresence>
            {sourceOpen && (
              <motion.div
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
                  <motion.button
                    type="button"
                    onClick={() => { setSource('memory'); setSourceOpen(false) }}
                    variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-foreground',
                      'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                      'transition-colors duration-150',
                      source === 'memory' && 'font-medium',
                    )}
                  >
                    <Database className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="flex-1">Local Memory</span>
                    {source === 'memory' && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </motion.button>

                  {externalDBs.length > 0 && (
                    <div className="border-t-2 border-slate-200 dark:border-zinc-800" />
                  )}

                  {externalDBs.map((db) => (
                    <motion.button
                      key={db.id}
                      type="button"
                      onClick={() => { if (db.reachable) { setSource(db.id); setSourceOpen(false) } }}
                      variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-foreground',
                        'border-b-2 border-slate-200 last:border-b-0 dark:border-zinc-800',
                        'transition-colors duration-150',
                        db.reachable
                          ? 'bg-slate-50 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                          : 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-zinc-900',
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
      </section>

      {/* Search */}
      <section className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Search</p>
        <input
          type="search"
          placeholder="Search series…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(
            'w-full h-8 px-3 text-sm rounded-md',
            'border border-input bg-background text-foreground',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
      </section>

      {/* Results table */}
      <section className="flex flex-col gap-2 flex-1 min-h-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Results</p>
        {loading ? (
          <p className="text-xs text-muted-foreground/50">Loading…</p>
        ) : error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">
            {records.length === 0 ? 'No series available.' : 'No matches.'}
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border bg-muted/40">
                  <th className="w-10 p-3" />
                  <th className="p-3 font-medium text-muted-foreground">Name</th>
                  <th className="p-3 font-medium text-muted-foreground text-center">Chart</th>
                  <th className="p-3 font-medium text-muted-foreground text-center">Data Points</th>
                  <th className="p-3 font-medium text-muted-foreground text-center">Frequency</th>
                  <th className="p-3 font-medium text-muted-foreground">Start Date</th>
                  <th className="p-3 font-medium text-muted-foreground">End Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const freq      = inferFreqFromRecord(r.pointCount, r.startDate, r.endDate)
                  const label     = freq ? formatFreq(freq) : 'Unknown'
                  const style     = IMPORT_FREQ_STYLES[freq ?? 'unknown']
                  const status    = importStatus[r.id]
                  const pending   = pendingIds.has(r.id)
                  const isHovered = hoveredId === r.id
                  // Show ✓ when staged and mouse is away; show rotated + (×) when hovering over staged
                  const showCheck = status === 'done' || (pending && !isHovered)
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        'border-b border-border last:border-none transition-colors',
                        pending && !status ? 'bg-blue-50/50 dark:bg-blue-950/20' : 'hover:bg-muted/40',
                      )}
                    >
                      {/* toggle button */}
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          disabled={!!status || confirming}
                          onMouseEnter={() => { if (!status && !confirming) setHoveredId(r.id) }}
                          onMouseLeave={() => setHoveredId(null)}
                          onClick={() => handleToggle(r.id)}
                          aria-label={pending ? `Remove ${r.name} from selection` : `Stage ${r.name} for import`}
                          className={cn(
                            'relative inline-flex items-center justify-center h-6 w-6 rounded-full transition-colors duration-200 overflow-hidden',
                            !status && !pending                   && 'bg-muted/60 text-muted-foreground hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/40 dark:hover:text-blue-400',
                            !status &&  pending && !isHovered     && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
                            !status &&  pending &&  isHovered     && 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
                            status === 'loading'                  && 'bg-muted text-muted-foreground cursor-wait',
                            status === 'done'                     && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 cursor-default',
                          )}
                        >
                          {/* Plus / X — always mounted, fades out when check is shown */}
                          <motion.span
                            className="absolute inset-0 flex items-center justify-center"
                            animate={{ opacity: showCheck ? 0 : 1, scale: showCheck ? 0.5 : 1 }}
                            transition={{ duration: 0.1, ease: 'easeInOut' }}
                          >
                            <motion.span
                              animate={{ rotate: pending ? 45 : 0 }}
                              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                              className="flex"
                            >
                              <Plus className="h-3 w-3" />
                            </motion.span>
                          </motion.span>
                          {/* Check — always mounted, fades in when staged and not hovering */}
                          <motion.span
                            className="absolute inset-0 flex items-center justify-center"
                            animate={{ opacity: showCheck ? 1 : 0, scale: showCheck ? 1 : 0.5 }}
                            transition={{ duration: 0.1, ease: 'easeInOut' }}
                          >
                            <Check className="h-3 w-3" />
                          </motion.span>
                        </button>
                      </td>
                      {/* Name */}
                      <td className="p-3">
                        <div className="font-medium text-foreground">{r.name}</div>
                        {r.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.description}</div>
                        )}
                      </td>
                      {/* Chart */}
                      <td className="p-2 text-center">
                        <div className="inline-block">
                          <MiniChart
                            record={r}
                            dbPath={sourceRef?.path ?? null}
                            dbId={sourceRef?.id ?? null}
                            className="h-7 w-20"
                          />
                        </div>
                      </td>
                      {/* Data Points */}
                      <td className="p-3 text-muted-foreground text-center tabular-nums">
                        {r.pointCount.toLocaleString()}
                      </td>
                      {/* Frequency */}
                      <td className="p-3 text-center">
                        <div className="flex justify-center">
                          <span className={cn('px-2.5 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap', style)}>
                            {label}
                          </span>
                        </div>
                      </td>
                      {/* Start Date */}
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{fmtDate(r.startDate)}</td>
                      {/* End Date */}
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{fmtDate(r.endDate)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Confirm / Cancel */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={confirming}
          className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pendingIds.size === 0 || confirming}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-md transition-colors',
            'bg-blue-600 text-white hover:bg-blue-700',
            (pendingIds.size === 0 || confirming) && 'opacity-50 cursor-not-allowed',
          )}
        >
          {confirming
            ? 'Importing…'
            : `Import ${pendingIds.size > 0 ? `${pendingIds.size} ` : ''}series`}
        </button>
      </div>
    </div>
  )
}

// ─── Series metadata panel ───────────────────────────────────────────────────


interface SeriesMetaPanelProps {
  record: DBRecord
  dbPath: string | null
  dbId: string | null
  onUpdated: (updated: DBRecord) => void
}

function SeriesMetaPanel({ record, dbPath, dbId, onUpdated }: SeriesMetaPanelProps) {
  const [series, setSeries]           = useState<DataSeries | null>(null)
  const [name, setName]               = useState(record.name)
  const [code, setCode]               = useState(record.code)
  const [description, setDescription] = useState(record.description)
  const [saving, setSaving]           = useState(false)
  const [saveStatus, setSaveStatus]   = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError]     = useState<string | null>(null)

  useEffect(() => {
    setName(record.name)
    setCode(record.code)
    setDescription(record.description)
    setSaveStatus('idle')
    setSaveError(null)
  }, [record.id])

  useEffect(() => {
    let cancelled = false
    setSeries(null)
    const fetcher = dbPath
      ? ipc.external.getSeries(dbPath, record.id, dbId ?? record.id)
      : ipc.memory.getSeries(record.id)
    fetcher.then((s) => { if (!cancelled) setSeries(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [record.id, dbPath, dbId])

  const freq     = series?.data_freq ?? inferFreqFromRecord(record.pointCount, record.startDate, record.endDate)
  const freqStyle = IMPORT_FREQ_STYLES[freq ?? 'unknown']
  const isDirty  = name !== record.name || code !== record.code || description !== record.description

  function sanitizeCode(raw: string): string {
    return raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  }

  async function handleSave() {
    if (!series || saving) return
    setSaving(true)
    setSaveError(null)
    const n = name.trim(), c = code.trim(), d = description.trim()
    try {
      const updated: DataSeries = { ...series, name: n, code: c, description: d }
      if (dbPath) await ipc.external.saveSeries(dbPath, updated)
      else        await ipc.memory.saveSeries(updated)
      onUpdated({ ...record, name: n, code: c, description: d })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (e) {
      setSaveStatus('error')
      setSaveError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full py-1 pr-4">
      <div className="flex-1 max-w-xl flex flex-col">

        {/* ── Identity block ──────────────────────────────────────────── */}
        <div className="pb-8 flex flex-col gap-4">

          {/* Code chip — pill-shaped, monospace, editable inline */}
          <input
            type="text"
            value={code}
            spellCheck={false}
            onChange={(e) => { setCode(sanitizeCode(e.target.value)); setSaveStatus('idle') }}
            className={cn(
              'w-fit font-mono text-[11px] tracking-widest uppercase',
              'px-3 py-1 rounded-full',
              'bg-muted/50 text-muted-foreground border border-border/60',
              'hover:border-border hover:bg-muted/70',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:bg-muted/70',
              'transition-colors duration-150 cursor-text',
            )}
          />

          {/* Name — ghost heading, underline on hover/focus */}
          <input
            type="text"
            value={name}
            placeholder="Series name"
            onChange={(e) => { setName(e.target.value); setSaveStatus('idle') }}
            className={cn(
              'w-full text-2xl font-bold text-foreground placeholder:text-muted-foreground/30',
              'bg-transparent border-0 border-b-2 border-transparent',
              'hover:border-border/40 focus:border-ring',
              'focus:outline-none focus:ring-0 pb-1',
              'transition-colors duration-150',
            )}
          />
        </div>

        <div className="border-t border-border/40" />

        {/* ── Description ─────────────────────────────────────────────── */}
        <div className="py-8 flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
            Description
          </p>
          <textarea
            value={description}
            placeholder="Add a description for this series…"
            rows={6}
            onChange={(e) => { setDescription(e.target.value); setSaveStatus('idle') }}
            className={cn(
              'w-full text-sm text-foreground leading-relaxed',
              'bg-transparent border-0 resize-none',
              'placeholder:text-muted-foreground/30',
              'focus:outline-none focus:ring-0',
            )}
          />
        </div>

        <div className="border-t border-border/40" />

        {/* ── Stats ───────────────────────────────────────────────────── */}
        <div className="py-8 grid grid-cols-2 gap-x-12 gap-y-7">

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
              Frequency
            </p>
            {freq ? (
              <span className={cn('w-fit px-2.5 py-0.5 text-xs font-semibold rounded-full', freqStyle)}>
                {formatFreq(freq)}
              </span>
            ) : (
              <p className="text-sm text-muted-foreground/50">—</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
              Data points
            </p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {record.pointCount.toLocaleString()}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
              Start date
            </p>
            <p className="text-sm font-medium text-foreground">{fmtDate(record.startDate)}</p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
              End date
            </p>
            <p className="text-sm font-medium text-foreground">{fmtDate(record.endDate)}</p>
          </div>

        </div>

        <div className="border-t border-border/40" />

        {/* ── Save ────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {(isDirty || saveStatus !== 'idle') && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="pt-6 flex items-center gap-4"
            >
              {isDirty && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !name.trim() || !code.trim()}
                  className={cn(
                    'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors',
                    'bg-blue-600 hover:bg-blue-700 text-white',
                    (saving || !name.trim() || !code.trim()) && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              )}
              {saveStatus === 'saved' && !isDirty && (
                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Saved
                </span>
              )}
              {saveStatus === 'error' && saveError && (
                <span className="text-sm text-destructive">{saveError}</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}

// ─── Add DB Modal ─────────────────────────────────────────────────────────────

interface AddDBModalProps {
  onClose: () => void
  onAdded: (id: string) => void
}

function AddDBModal({ onClose, onAdded }: AddDBModalProps) {
  const addExternalDB = useDBStore((s) => s.addExternalDB)
  const [pathInput, setPathInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [status, setStatus] = useState<'idle' | 'checking' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleBrowse() {
    const p = await ipc.dialog.openDB()
    if (p) { setPathInput(p); setStatus('idle'); setErrorMsg('') }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    // Electron exposes the full path on the File object
    const p = (file as File & { path?: string }).path ?? file.name
    setPathInput(p)
    setStatus('idle')
    setErrorMsg('')
  }

  async function handleAdd() {
    const p = pathInput.trim()
    if (!p) return
    setStatus('checking')
    setErrorMsg('')
    try {
      const reachable = await ipc.external.checkPath(p)
      if (!reachable) {
        setStatus('error')
        setErrorMsg('File not found or is not a compatible database.')
        return
      }
      const id = crypto.randomUUID()
      addExternalDB({ id, name: deriveDBName(p), path: p, reachable: true })
      onAdded(id)
    } catch {
      setStatus('error')
      setErrorMsg('Could not open the database. Check the file path and try again.')
    }
  }

  return (
    <div className="flex flex-col gap-6" style={{ width: 'min(90vw, 480px)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-3xl font-black leading-none text-foreground" style={FONT_STYLE}>
          Add Database
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="mt-1 shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Drag-drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 transition-colors cursor-default',
          isDragging
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400'
            : 'border-border bg-muted/30 text-muted-foreground',
        )}
      >
        <Database className={cn('h-8 w-8', isDragging ? 'text-blue-500' : 'text-muted-foreground/40')} />
        <p className="text-sm">
          {isDragging ? 'Drop to set path' : 'Drag & drop a .db file here'}
        </p>
      </div>

      {/* Path input row */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          File path
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => { setPathInput(e.target.value); setStatus('idle'); setErrorMsg('') }}
            placeholder="/path/to/database.db"
            className={cn(
              'flex-1 h-9 px-3 text-sm rounded-md',
              'border border-input bg-background text-foreground',
              'placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />
          <button
            type="button"
            onClick={handleBrowse}
            className="px-3 h-9 text-sm rounded-md border border-input bg-background hover:bg-muted/60 transition-colors whitespace-nowrap"
          >
            Browse…
          </button>
        </div>
        {status === 'error' && (
          <p className="text-xs text-destructive">{errorMsg}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!pathInput.trim() || status === 'checking'}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-md transition-colors',
            'bg-blue-600 text-white hover:bg-blue-700',
            (!pathInput.trim() || status === 'checking') && 'opacity-50 cursor-not-allowed',
          )}
        >
          {status === 'checking' ? 'Checking…' : 'Add database'}
        </button>
      </div>
    </div>
  )
}

// ─── DBTab ────────────────────────────────────────────────────────────────────

export function DBTab() {
  const externalDBs    = useDBStore((s) => s.externalDBs)
  const addExternalDB  = useDBStore((s) => s.addExternalDB)
  const [selectedDB, setSelectedDB]         = useState<SelectedDB>('memory')
  const [records, setRecords]               = useState<DBRecord[]>([])
  const [loading, setLoading]               = useState(false)
  const [fetchError, setFetchError]         = useState<string | null>(null)
  const [isImportOpen, setIsImportOpen]     = useState(false)
  const [isAddDBOpen, setIsAddDBOpen]       = useState(false)
  const [activeInnerTab, setActiveInnerTab] = useState('list-series')
  const [dataSeriesFilter, setDataSeriesFilter] = useState<string | 'all'>('all')
  const [refreshCounter, setRefreshCounter] = useState(0)

  async function handleCreateDB() {
    const p = await ipc.dialog.createDB()
    if (!p) return
    const id = crypto.randomUUID()
    addExternalDB({ id, name: deriveDBName(p), path: p, reachable: true })
    setSelectedDB(id)
  }

  const extDB = selectedDB !== 'memory'
    ? (externalDBs.find((db) => db.id === selectedDB) ?? null)
    : null
  const dbPath = extDB?.path ?? null
  const dbId   = extDB?.id ?? null

  const selectedRecord = dataSeriesFilter !== 'all'
    ? (records.find((r) => r.id === dataSeriesFilter) ?? null)
    : null

  // Fetch series list whenever the selected DB changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFetchError(null)
    setRecords([])

    const fetcher = selectedDB === 'memory'
      ? ipc.memory.listSeries()
      : extDB
        ? ipc.external.listSeries(extDB.path)
        : Promise.resolve<DBRecord[]>([])

    fetcher
      .then((list) => { if (!cancelled) setRecords(list) })
      .catch((err) => { if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [selectedDB, externalDBs, refreshCounter])

  const handleDelete = useCallback(async (id: string) => {
    try {
      if (dbPath) {
        await ipc.external.deleteSeries(dbPath, id)
      } else {
        await ipc.memory.deleteSeries(id)
      }
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch {
      // Silently ignore — the row stays in the list if deletion fails
    }
  }, [dbPath])

  return (
    <div className="flex flex-col h-full w-full p-8 gap-6">
      <TitleDropdown
        selected={selectedDB}
        onSelect={setSelectedDB}
        externalDBs={externalDBs}
        onAddDB={() => setIsAddDBOpen(true)}
        onCreateDB={handleCreateDB}
      />

      <Tabs value={activeInnerTab} onValueChange={setActiveInnerTab} className="flex flex-col gap-4 flex-1 min-h-0">
        <div className="flex items-end justify-between">
          {activeInnerTab === 'list-series' && (
            <span
              className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/50 pb-1"
              style={FONT_STYLE}
            >
              Time-Series
            </span>
          )}
          {activeInnerTab === 'data' && (
            <SeriesDropdown
              selected={dataSeriesFilter}
              onSelect={setDataSeriesFilter}
              records={records}
            />
          )}
          {activeInnerTab === 'settings' && <div />}
          <TabsList>
            <TabsTab value="list-series"><BulletListIcon />List Series</TabsTab>
            <TabsTab value="data"><TableIcon />Data</TabsTab>
            <TabsTab value="settings"><DBSettingsIcon />Settings</TabsTab>
          </TabsList>
        </div>

        <TabsPanel value="list-series">
          <SeriesList
            records={records}
            loading={loading}
            error={fetchError}
            dbPath={dbPath}
            dbId={dbId}
            onDelete={handleDelete}
            onImportSeries={() => setIsImportOpen(true)}
            onRowClick={(id) => { setDataSeriesFilter(id); setActiveInnerTab('data') }}
          />
        </TabsPanel>
        <TabsPanel value="data" className="min-h-0 flex flex-col">
          <div className="flex flex-1 min-h-0">
            {/* Data grid — constrained when metadata panel is open */}
            <div className={cn(
              'min-h-0 min-w-0 flex flex-col',
              selectedRecord ? 'w-[38%] shrink-0' : 'flex-1',
            )}>
              <DataTable
                records={records}
                dbPath={dbPath}
                dbId={dbId}
                filter={dataSeriesFilter}
              />
            </div>

            {/* Metadata panel — fills the rest of the space */}
            {selectedRecord && (
              <>
                <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
                  <SeriesMetaPanel
                    key={selectedRecord.id}
                    record={selectedRecord}
                    dbPath={dbPath}
                    dbId={dbId}
                    onUpdated={(updated) =>
                      setRecords((prev) => prev.map((r) => r.id === updated.id ? updated : r))
                    }
                  />
                </div>
              </>
            )}
          </div>
        </TabsPanel>
        <TabsPanel value="settings" />
      </Tabs>

      {/* Add DB modal */}
      {isAddDBOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setIsAddDBOpen(false)}
        >
          <div
            className="bg-background rounded-xl shadow-xl p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <AddDBModal
              onClose={() => setIsAddDBOpen(false)}
              onAdded={(id) => { setIsAddDBOpen(false); setSelectedDB(id) }}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* Import Series modal */}
      {isImportOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setIsImportOpen(false)}
        >
          <div
            className="bg-background rounded-xl shadow-xl p-8 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <ImportSeriesModal
              destDbPath={dbPath}
              onClose={() => setIsImportOpen(false)}
              onImported={() => setRefreshCounter((c) => c + 1)}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
