import { useCallback, useRef, useState, useEffect } from 'react'
import { Upload, BarChart2, ChevronDown, Database, HardDrive, Layers } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useAppStore } from '../../store/app'
import { useGraphStore } from '../../store/graph'
import { useDBStore } from '../../store/db'
import { getColor } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { ipc } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { FileDropZone } from '../upload/FileDropZone'
import { PasteTable } from '../upload/PasteTable'
import { SeriesReviewPanel } from '../upload/SeriesReviewPanel'
import type { SeriesReviewHandle, Assignment, Destination } from '../upload/SeriesReviewPanel'
import { Selector } from '../ui/segment-group'
import type { DataSeries } from '../../../shared/types'

type Mode = 'file' | 'paste'

const TITLE_FONT_STYLE = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
}

function FileIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="-64 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <path d="M369.9 97.9L286 14C277 5 264.8-.1 252.1-.1H48C21.5 0 0 21.5 0 48v416c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48V131.9c0-12.7-5.1-25-14.1-34zM332.1 128H256V51.9l76.1 76.1zM48 464V48h160v104c0 13.3 10.7 24 24 24h104v288H48zm212-240h-28.8c-4.4 0-8.4 2.4-10.5 6.3-18 33.1-22.2 42.4-28.6 57.7-13.9-29.1-6.9-17.3-28.6-57.7-2.1-3.9-6.2-6.3-10.6-6.3H124c-9.3 0-15 10-10.4 18l46.3 78-46.3 78c-4.7 8 1.1 18 10.4 18h28.9c4.4 0 8.4-2.4 10.5-6.3 21.7-40 23-45 28.6-57.7 14.9 30.2 5.9 15.9 28.6 57.7 2.1 3.9 6.2 6.3 10.6 6.3H260c9.3 0 15-10 10.4-18L224 320c.7-1.1 30.3-50.5 46.3-78 4.7-8-1.1-18-10.3-18z" />
    </svg>
  )
}

function PasteIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H9M15 5H17C18.1046 5 19 5.89543 19 7V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.902 20.3343L12.7153 20.7716L13.1526 18.585C13.1914 18.3914 13.2865 18.2136 13.4261 18.074L17.5 14L19.5 12L21.4869 13.9869L19.4869 15.9869L15.413 20.0608C15.2734 20.2004 15.0956 20.2956 14.902 20.3343Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5V7H9V5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Add All dropdown ─────────────────────────────────────────────────────────

type AddAllOption =
  | { kind: 'individual' }
  | { kind: 'destination'; dest: Destination }

interface AddAllDropdownProps {
  onSelect: (option: AddAllOption) => void
}

function AddAllDropdown({ onSelect }: AddAllDropdownProps) {
  const [open, setOpen]   = useState(false)
  const wrapRef           = useRef<HTMLDivElement>(null)
  const externalDBs       = useDBStore(s => s.externalDBs)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const pick = (opt: AddAllOption) => { onSelect(opt); setOpen(false) }

  const reachableDBs = externalDBs.filter(db => db.reachable)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
        style={TITLE_FONT_STYLE}
      >
        Add All
        <ChevronDown className={cn('h-3.5 w-3.5 opacity-80 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-2 z-50 min-w-[14rem] rounded-lg overflow-hidden shadow-lg bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800"
          >
            <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.03 } } }}>

              {/* Use individual card settings */}
              <motion.button
                type="button"
                variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                onClick={() => pick({ kind: 'individual' })}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Layers className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="flex-1">Per-card settings</span>
              </motion.button>

              <div className="border-t border-slate-200 dark:border-zinc-800" />

              {/* Graphs section */}
              <div className="px-4 pt-2 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Graph</span>
              </div>
              <motion.button
                type="button"
                variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                onClick={() => pick({ kind: 'destination', dest: { type: 'graph' } })}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <BarChart2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="flex-1">Current Graph</span>
              </motion.button>

              <div className="border-t border-slate-200 dark:border-zinc-800 mt-1" />

              {/* Databases section */}
              <div className="px-4 pt-2 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Database</span>
              </div>
              <motion.button
                type="button"
                variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                onClick={() => pick({ kind: 'destination', dest: { type: 'memory' } })}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <HardDrive className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="flex-1">Local Memory</span>
              </motion.button>

              {reachableDBs.map(db => (
                <motion.button
                  key={db.id}
                  type="button"
                  variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0 } }}
                  onClick={() => pick({ kind: 'destination', dest: { type: 'external', id: db.id, path: db.path } })}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <Database className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="flex-1 truncate">{db.name}</span>
                </motion.button>
              ))}

              <div className="pb-1" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── UploadTab ────────────────────────────────────────────────────────────────

export function UploadTab(): JSX.Element {
  const [mode, setMode]               = useState<Mode>('file')
  const [pendingSeries, setPendingSeries] = useState<DataSeries[]>([])
  const reviewRef                     = useRef<SeriesReviewHandle | null>(null)

  const colorPalette   = useAppStore((s) => s.colorPalette)
  const customPalettes = useAppStore((s) => s.customPalettes)
  const theme          = useAppStore((s) => s.theme)
  const activeSeriesCount = useGraphStore((s) => s.activeSeries.length)

  const handleSeries = useCallback(
    (series: DataSeries[]) => {
      const colored = series.map((s, i) => ({
        ...s,
        color: s.color ?? getColor(colorPalette, activeSeriesCount + i, customPalettes, isDarkTheme(theme)),
      }))
      setPendingSeries(colored)
    },
    [colorPalette, customPalettes, theme, activeSeriesCount],
  )

  const onModeChange = (next: Mode): void => {
    setPendingSeries([])
    setMode(next)
  }

  // Execute a batch of assignments — add to graph and/or save to databases.
  const dispatch = useCallback(async (assignments: Assignment[]) => {
    const graphItems = assignments.filter(a => a.destination.type === 'graph')
    const memItems   = assignments.filter(a => a.destination.type === 'memory')
    const extItems   = assignments.filter(a => a.destination.type === 'external')

    const { addSeries } = useGraphStore.getState()
    for (const { series } of graphItems) addSeries(series)

    await Promise.all(memItems.map(({ series }) => ipc.memory.saveSeries(series)))
    await Promise.all(
      extItems.map(({ series, destination }) =>
        destination.type === 'external'
          ? ipc.external.saveSeries(destination.path, series)
          : Promise.resolve()
      )
    )

    return graphItems.length > 0
  }, [])

  // "Add All" dropdown — override all destinations or respect per-card settings.
  const handleAddAll = useCallback(async (option: AddAllOption) => {
    if (!reviewRef.current) return
    const all = reviewRef.current.getAll()
    const assignments = option.kind === 'individual'
      ? all.filter(a => a.destination.type !== 'skip')
      : all.map(a => ({ ...a, destination: option.dest }))

    const wentToGraph = await dispatch(assignments)
    setPendingSeries([])
    if (wentToGraph) useAppStore.getState().setActiveTab('graph')
  }, [dispatch])

  // Per-card add — dispatches a single series and removes it from the pending list.
  const handleAddSingle = useCallback(async (assignment: Assignment) => {
    const wentToGraph = await dispatch([assignment])
    setPendingSeries(prev => {
      const next = prev.filter(s => s.id !== assignment.series.id)
      // Navigate to graph when the last item is added to the graph.
      if (next.length === 0 && wentToGraph) useAppStore.getState().setActiveTab('graph')
      return next
    })
  }, [dispatch])

  const inReview = pendingSeries.length > 0

  return (
    <div className="flex flex-col h-full w-full p-8 gap-6">
      {/* Title row */}
      <div className="flex items-center gap-3 leading-none select-none text-foreground" style={TITLE_FONT_STYLE}>
        <Upload className="h-8 w-8 text-blue-500 shrink-0" />
        <h2 className="text-4xl font-black leading-none flex-1">Upload Series</h2>

        {inReview && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPendingSeries([])}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              style={TITLE_FONT_STYLE}
            >
              Cancel
            </button>
            <AddAllDropdown onSelect={handleAddAll} />
          </div>
        )}
      </div>

      {inReview ? (
        <SeriesReviewPanel
          ref={reviewRef}
          series={pendingSeries}
          onAddSingle={handleAddSingle}
        />
      ) : (
        <>
          <Selector<Mode>
            options={[
              { value: 'file',  label: 'File',  icon: <FileIcon />  },
              { value: 'paste', label: 'Paste', icon: <PasteIcon /> },
            ]}
            value={mode}
            onChange={onModeChange}
            className="mx-auto max-w-sm w-full"
          />
          {mode === 'file' ? (
            <FileDropZone onSeries={handleSeries} />
          ) : (
            <PasteTable onSeries={handleSeries} />
          )}
        </>
      )}
    </div>
  )
}
