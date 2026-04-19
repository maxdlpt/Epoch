import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, FolderOpen, X, FileUp, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useGraphStore } from '../../store/graph'
import { useGraphManagerStore } from '../../store/graph-manager'
import { ipc } from '../../lib/ipc'
import type { SavedGraphMeta } from '../../../shared/types'

function LineChartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path stroke="currentColor" strokeWidth="1" strokeLinejoin="round" d="M13,15c1.4854,0,2.5544,1.4966,3.6863,3.0811C17.9983,19.918,19.4854,22,22,22c5.6709,0,7.78-10.79,8-12l-1.9678-.3584C27.55,12.2827,25.3938,20,22,20c-1.4854,0-2.5544-1.4966-3.6863-3.0811C17.0017,15.082,15.5146,13,13,13c-4.186,0-7.4448,7.4043-9,11.7617V2H2V28a2.0025,2.0025,0,0,0,2,2H30V28H5.0439C6.5544,22.8574,9.9634,15,13,15Z"/>
    </svg>
  )
}

export function NewGraphTab() {
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const createGraph = useGraphManagerStore(s => s.createGraph)
  const loadSavedGraph = useGraphManagerStore(s => s.loadSavedGraph)
  const loadDroppedGraph = useGraphManagerStore(s => s.loadDroppedGraph)
  const openGraphs = useGraphManagerStore(s => s.openGraphs)
  const activeGraphId = useGraphManagerStore(s => s.activeGraphId)
  const switchGraph = useGraphManagerStore(s => s.switchGraph)
  const liveSavedFilename = useGraphStore(s => s.savedFilename)

  // Build a map of filename → graphId for all currently open graphs
  const openFilenameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const g of openGraphs) {
      const isActive = g.id === activeGraphId
      const filename = isActive ? liveSavedFilename : g.snapshot?.savedFilename
      if (filename) map.set(filename, g.id)
    }
    return map
  }, [openGraphs, activeGraphId, liveSavedFilename])

  // ── Modal state ──────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false)
  const [savedGraphs, setSavedGraphs] = useState<SavedGraphMeta[]>([])
  const [loadingList, setLoadingList] = useState(false)

  const openModal = useCallback(async () => {
    setModalOpen(true)
    setLoadingList(true)
    const list = await ipc.graph.list()
    setSavedGraphs(list)
    setLoadingList(false)
  }, [])

  const handleOpenSaved = useCallback(async (meta: SavedGraphMeta) => {
    // If already open, switch to it instead of opening a duplicate
    const existingId = openFilenameMap.get(meta.filename)
    if (existingId) {
      if (existingId !== activeGraphId) switchGraph(existingId)
      setModalOpen(false)
      setActiveTab('graph')
      return
    }
    const saved = await ipc.graph.load(meta.filename)
    if (!saved) return
    loadSavedGraph(saved, meta.filename)
    setModalOpen(false)
    setActiveTab('graph')
  }, [setActiveTab, loadSavedGraph, openFilenameMap, activeGraphId, switchGraph])

  const handleDeleteSaved = useCallback(async (filename: string) => {
    await ipc.graph.delete(filename)
    setSavedGraphs(prev => prev.filter(g => g.filename !== filename))
  }, [])

  const handleImportFile = useCallback(async () => {
    const saved = await ipc.graph.import()
    if (!saved) return
    // Save to local library, then load as a new graph tab
    const filename = await ipc.graph.save(saved)
    loadSavedGraph(saved, filename)
    setModalOpen(false)
    setActiveTab('graph')
  }, [setActiveTab, loadSavedGraph])

  // ── Create new ───────────────────────────────────────────────────────────
  const handleCreateNew = useCallback(() => {
    createGraph()
    setActiveTab('graph')
  }, [createGraph, setActiveTab])

  // ── Drag & drop on the Open Graph card ───────────────────────────────────
  const [dragOver, setDragOver] = useState(false)
  const dragCountRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current++
    setDragOver(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current--
    if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) }
  }, [])
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault() }, [])
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current = 0
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !file.name.endsWith('.tsv-graph')) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!parsed.session?.series) return
      loadDroppedGraph(parsed)
      setActiveTab('graph')
    } catch { /* invalid file, ignore */ }
  }, [setActiveTab, loadDroppedGraph])

  // ── Close modal on Escape ────────────────────────────────────────────────
  useEffect(() => {
    if (!modalOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [modalOpen])

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      {/* Title */}
      <div className="flex items-center gap-3 px-8 pt-8 pb-6">
        <LineChartIcon className="h-8 w-8 text-blue-500 shrink-0" />
        <h1 className="text-4xl font-black text-foreground">Open/Create Graph</h1>
      </div>

      {/* Two cards */}
      <div className="flex-1 flex items-center justify-center px-8 pb-16">
        <div className="flex gap-6 w-full max-w-3xl">
          {/* Create New Graph */}
          <motion.button
            type="button"
            onClick={handleCreateNew}
            className="flex-1 group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border p-12 transition-colors hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="grid h-16 w-16 place-content-center rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 transition-colors group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50">
              <Plus className="h-8 w-8" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-foreground">Create New Graph</p>
              <p className="mt-1 text-sm text-muted-foreground">Start with a blank chart</p>
            </div>
          </motion.button>

          {/* Open Graph — also a drop zone */}
          <motion.button
            type="button"
            onClick={openModal}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={`flex-1 group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors ${
              dragOver
                ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
                : 'border-border hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'
            }`}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className={`grid h-16 w-16 place-content-center rounded-2xl transition-colors ${
              dragOver
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50'
            }`}>
              <FolderOpen className="h-8 w-8" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-foreground">Open Graph</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {dragOver ? 'Drop .tsv-graph file here' : 'From library or drag a file here'}
              </p>
            </div>
          </motion.button>
        </div>
      </div>

      {/* ── Saved Graphs Modal ────────────────────────────────────────────── */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg max-h-[70vh] flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">Saved Graphs</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleImportFile}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <FileUp className="h-4 w-4" />
                    Import File
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto p-2">
                {loadingList ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading...</div>
                ) : savedGraphs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-1">
                    <p>No saved graphs yet.</p>
                    <p className="text-xs">Save a graph from the chart view, or import a .tsv-graph file.</p>
                  </div>
                ) : (
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
                  >
                    {savedGraphs.map(g => {
                      const isOpen = openFilenameMap.has(g.filename)
                      return (
                        <motion.div
                          key={g.filename}
                          variants={{ hidden: { opacity: 0, x: -10 }, visible: { opacity: 1, x: 0 } }}
                          className={`group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                            isOpen
                              ? 'opacity-50 cursor-default'
                              : 'hover:bg-accent/60 cursor-pointer'
                          }`}
                          onClick={() => !isOpen && handleOpenSaved(g)}
                        >
                          <LineChartIcon className={`h-5 w-5 shrink-0 ${isOpen ? 'text-gray-400' : 'text-blue-500'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                              {isOpen && (
                                <span className="shrink-0 rounded bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                                  Open
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {g.seriesCount} series &middot; {new Date(g.savedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </p>
                          </div>
                          {!isOpen && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDeleteSaved(g.filename) }}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </motion.div>
                      )
                    })}
                  </motion.div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
