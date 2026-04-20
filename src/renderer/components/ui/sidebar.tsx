"use client"
import { useCallback, useState } from "react"
import { createPortal } from "react-dom"
import { BarChart2, Upload, Settings, Database, ChevronsRight, Plus, ChevronDown, X } from "lucide-react"
import { AnimatePresence, motion, Reorder } from "motion/react"
import { useAppStore } from "../../store/app"
import { useGraphStore } from "../../store/graph"
import { useGraphManagerStore } from "../../store/graph-manager"
import type { OpenGraph } from "../../store/graph-manager"
import { ipc, serializeSeries } from "../../lib/ipc"
import type { ReactNode } from "react"
import type { SavedGraph } from "../../../shared/types"

function LineChartIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path stroke="currentColor" strokeWidth="1" strokeLinejoin="round" d="M13,15c1.4854,0,2.5544,1.4966,3.6863,3.0811C17.9983,19.918,19.4854,22,22,22c5.6709,0,7.78-10.79,8-12l-1.9678-.3584C27.55,12.2827,25.3938,20,22,20c-1.4854,0-2.5544-1.4966-3.6863-3.0811C17.0017,15.082,15.5146,13,13,13c-4.186,0-7.4448,7.4043-9,11.7617V2H2V28a2.0025,2.0025,0,0,0,2,2H30V28H5.0439C6.5544,22.8574,9.9634,15,13,15Z"/>
    </svg>
  )
}

type Tab = 'graph' | 'upload' | 'settings' | 'db' | 'new-graph'

interface OptionProps {
  icon: ReactNode
  title: string
  tab: Tab
  selected: Tab
  open: boolean
  onClick?: () => void
}

const Option = ({ icon, title, tab, selected, open, onClick }: OptionProps) => {
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const isSelected = selected === tab
  return (
    <motion.button
      layout
      onClick={() => { onClick?.(); setActiveTab(tab) }}
      className={`relative flex h-11 w-full items-center rounded-md transition-colors duration-200 ${
        isSelected
          ? "bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shadow-sm border-l-2 border-blue-500"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200"
      }`}
      transition={{ layout: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } }}
    >
      <div className="grid h-full w-12 place-content-center">{icon}</div>
      {open && (
        <span className="text-sm font-medium">{title}</span>
      )}
    </motion.button>
  )
}

// ── Close confirmation dialog ─────────────────────────────────────────────────

interface CloseDialogProps {
  graphTitle: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

function CloseConfirmDialog({ graphTitle, onSave, onDiscard, onCancel }: CloseDialogProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-2xl"
      >
        <h3 className="text-base font-semibold text-foreground">Save changes?</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{graphTitle}</span> has unsaved changes.
          Do you want to save before closing?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onDiscard}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Don't Save
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Build SavedGraph from active store or snapshot ─────────────────────────────

function buildSavedGraphFromStore(): SavedGraph {
  const s = useGraphStore.getState()
  return {
    version: 1,
    name: s.graphTitle,
    savedAt: new Date().toISOString(),
    session: {
      series: s.activeSeries.map(serializeSeries),
      zoomDomain: s.zoomDomain
        ? { start: s.zoomDomain.start.toISOString().slice(0, 10), end: s.zoomDomain.end.toISOString().slice(0, 10) }
        : null,
      showGrid: s.showGrid,
      graphTitle: s.graphTitle,
      savedFilename: s.savedFilename ?? undefined,
    },
  }
}

function buildSavedGraphFromSnapshot(snapshot: NonNullable<OpenGraph['snapshot']>): SavedGraph {
  return {
    version: 1,
    name: snapshot.graphTitle ?? 'New Graph',
    savedAt: new Date().toISOString(),
    session: snapshot,
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export const Sidebar = () => {
  const [open, setOpen] = useState(true)
  const activeTab = useAppStore(s => s.activeTab)
  const setActiveTab = useAppStore(s => s.setActiveTab)

  // Graph manager state
  const openGraphs = useGraphManagerStore(s => s.openGraphs)
  const activeGraphId = useGraphManagerStore(s => s.activeGraphId)
  const graphsExpanded = useGraphManagerStore(s => s.graphsExpanded)
  const toggleGraphsExpanded = useGraphManagerStore(s => s.toggleGraphsExpanded)
  const switchGraph = useGraphManagerStore(s => s.switchGraph)
  const closeGraph = useGraphManagerStore(s => s.closeGraph)
  const reorderGraphs = useGraphManagerStore(s => s.reorderGraphs)
  const discardActiveIfEmpty = useGraphManagerStore(s => s.discardActiveIfEmpty)

  // Active graph's live title (from graph store)
  const liveTitle = useGraphStore(s => s.graphTitle)

  // ── Close confirmation state ────────────────────────────────────────────
  const [closeTarget, setCloseTarget] = useState<{ id: string; title: string } | null>(null)

  const handleGraphHeaderClick = useCallback(() => {
    if (openGraphs.length === 0) {
      setActiveTab('new-graph')
    } else {
      // Navigate to the active graph (if not already there) AND toggle sub-tabs
      setActiveTab('graph')
      toggleGraphsExpanded()
    }
  }, [openGraphs.length, setActiveTab, toggleGraphsExpanded])

  const handleSubTabClick = useCallback((graphId: string) => {
    if (graphId !== activeGraphId) switchGraph(graphId)
    setActiveTab('graph')
  }, [activeGraphId, switchGraph, setActiveTab])

  // Auto-discard empty graphs when navigating to a non-graph tab
  const handleNonGraphTabClick = useCallback(() => {
    discardActiveIfEmpty()
  }, [discardActiveIfEmpty])

  // ── Close logic ─────────────────────────────────────────────────────────

  const handleCloseClick = useCallback((e: React.MouseEvent, graphId: string) => {
    e.stopPropagation()
    const graph = openGraphs.find(g => g.id === graphId)
    if (!graph) return

    // Determine if dirty
    if (graph.dirty) {
      const isActive = graphId === activeGraphId
      const title = isActive ? liveTitle : (graph.snapshot?.graphTitle ?? 'New Graph')
      setCloseTarget({ id: graphId, title })
    } else {
      closeGraph(graphId)
    }
  }, [openGraphs, activeGraphId, liveTitle, closeGraph])

  const handleConfirmSave = useCallback(async () => {
    if (!closeTarget) return
    const graphId = closeTarget.id
    const graph = openGraphs.find(g => g.id === graphId)
    if (!graph) { setCloseTarget(null); return }

    const isActive = graphId === activeGraphId
    const saved = isActive
      ? buildSavedGraphFromStore()
      : graph.snapshot ? buildSavedGraphFromSnapshot(graph.snapshot) : null

    if (saved) {
      const existingFilename = isActive
        ? useGraphStore.getState().savedFilename
        : graph.snapshot?.savedFilename
      await ipc.graph.save(saved, existingFilename ?? undefined)
    }

    setCloseTarget(null)
    closeGraph(graphId)
  }, [closeTarget, openGraphs, activeGraphId, closeGraph])

  const handleConfirmDiscard = useCallback(() => {
    if (!closeTarget) return
    closeGraph(closeTarget.id)
    setCloseTarget(null)
  }, [closeTarget, closeGraph])

  const handleConfirmCancel = useCallback(() => {
    setCloseTarget(null)
  }, [])

  const isGraphSection = activeTab === 'graph' || activeTab === 'new-graph'

  return (
    <nav
      className={`sticky top-0 h-screen shrink-0 border-r transition-all duration-300 ease-in-out ${
        open ? 'w-56' : 'w-16'
      } border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2 shadow-sm flex flex-col`}
    >
      {/* Logo */}
      <div className="mb-6 border-b border-gray-200 dark:border-gray-800 pb-4">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="grid size-10 shrink-0 place-content-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-sm">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          {open && <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">TimeSeries</span>}
        </div>
      </div>

      {/* Main nav */}
      <div className="space-y-1 flex-1">
        {/* Graph header row — click toggles expand, + button opens new-graph page */}
        <div className="relative flex items-center group">
          <button
            onClick={handleGraphHeaderClick}
            className={`relative flex h-11 w-full items-center rounded-md transition-all duration-200 ${
              isGraphSection
                ? "bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shadow-sm border-l-2 border-blue-500"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            <div className="grid h-full w-12 place-content-center"><LineChartIcon className="h-5 w-5" /></div>
            {open && (
              <>
                <span className="text-sm font-medium">Graph</span>
                {openGraphs.length > 0 && (
                  <ChevronDown className={`ml-auto mr-8 h-3.5 w-3.5 transition-transform duration-200 ${graphsExpanded ? '' : '-rotate-90'}`} />
                )}
              </>
            )}
          </button>
          {open && (
            <button
              onClick={(e) => { e.stopPropagation(); setActiveTab('new-graph') }}
              className="absolute right-1.5 p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-all duration-150"
              title="New graph"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Open graph sub-tabs — shown when expanded and sidebar is open */}
        <AnimatePresence initial={false}>
          {open && graphsExpanded && openGraphs.length > 0 && (
            <motion.div
              key="graph-subtabs"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <Reorder.Group
                axis="y"
                values={openGraphs}
                onReorder={reorderGraphs}
                as="div"
              >
                {openGraphs.map(g => {
                  const isActive = g.id === activeGraphId
                  const title = isActive ? liveTitle : (g.snapshot?.graphTitle ?? 'New Graph')
                  const isCurrent = isActive && activeTab === 'graph'
                  return (
                    <Reorder.Item
                      key={g.id}
                      value={g}
                      as="div"
                      className="group/tab relative flex items-center"
                      whileDrag={{ scale: 1.02, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
                    >
                      <button
                        onClick={() => handleSubTabClick(g.id)}
                        className={`flex h-9 w-full items-center rounded-md pl-12 pr-8 transition-colors duration-200 ${
                          isCurrent
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                      >
                        <span className="truncate text-xs font-medium">{title}</span>
                      </button>
                      <button
                        onClick={(e) => handleCloseClick(e, g.id)}
                        className="absolute right-1.5 p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 opacity-0 group-hover/tab:opacity-100 transition-all duration-150"
                        title="Close graph"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Reorder.Item>
                  )
                })}
              </Reorder.Group>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-5 mb-2 border-t border-gray-200 dark:border-gray-800" />

        <Option icon={<Database className="h-4 w-4" />} title="Databases" tab="db" selected={activeTab} open={open} onClick={handleNonGraphTabClick} />
        <Option icon={<Upload className="h-4 w-4" />} title="Upload" tab="upload" selected={activeTab} open={open} onClick={handleNonGraphTabClick} />
      </div>

      {/* Settings at bottom, above collapse */}
      <div className="space-y-1 border-t border-gray-200 dark:border-gray-800 pt-2 pb-[68px]">
        <Option icon={<Settings className="h-4 w-4" />} title="Settings" tab="settings" selected={activeTab} open={open} onClick={handleNonGraphTabClick} />
      </div>

      {/* Toggle collapse */}
      <button
        onClick={() => setOpen(!open)}
        className="absolute bottom-0 left-0 right-0 border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center p-3">
          <div className="grid size-10 place-content-center">
            <ChevronsRight
              className={`h-4 w-4 transition-transform duration-300 text-gray-500 dark:text-gray-400 ${open ? "rotate-180" : ""}`}
            />
          </div>
          {open && <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Hide</span>}
        </div>
      </button>

      {/* Close confirmation dialog — portaled to body to escape sidebar stacking context */}
      {createPortal(
        <AnimatePresence>
          {closeTarget && (
            <CloseConfirmDialog
              graphTitle={closeTarget.title}
              onSave={handleConfirmSave}
              onDiscard={handleConfirmDiscard}
              onCancel={handleConfirmCancel}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </nav>
  )
}
