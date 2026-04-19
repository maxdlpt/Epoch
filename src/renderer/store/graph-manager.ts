import { create } from 'zustand'
import { useGraphStore } from './graph'
import { useAppStore } from './app'
import { serializeSeries, deserializeSeries } from '../lib/ipc'
import { getColor } from '../lib/colors'
import { isDarkTheme } from '../lib/theme'
import type { GraphSession, SavedGraph } from '../../shared/types'

// ── Helpers: snapshot ↔ graph store ──────────────────────────────────────────

/** Serialize the live graph store into a GraphSession snapshot. */
function snapshotFromStore(): GraphSession {
  const s = useGraphStore.getState()
  return {
    series: s.activeSeries.map(serializeSeries),
    zoomDomain: s.zoomDomain
      ? { start: s.zoomDomain.start.toISOString().slice(0, 10), end: s.zoomDomain.end.toISOString().slice(0, 10) }
      : null,
    chartMode: s.chartMode,
    cumMethod: s.cumMethod,
    cumBaseInput: s.cumBaseInput,
    showGrid: s.showGrid,
    graphTitle: s.graphTitle,
    savedFilename: s.savedFilename ?? undefined,
  }
}

/** Load a GraphSession snapshot into the live graph store. */
function loadSnapshotToStore(session: GraphSession) {
  const g = useGraphStore.getState()
  g.resetGraph()
  for (const s of session.series) g.addSeries(deserializeSeries(s))
  if (session.zoomDomain) {
    g.setZoomDomain({
      start: new Date(session.zoomDomain.start),
      end: new Date(session.zoomDomain.end),
    })
  }
  if (session.chartMode) g.setChartMode(session.chartMode)
  if (session.cumMethod) g.setCumMethod(session.cumMethod)
  if (session.cumBaseInput) g.setCumBaseInput(session.cumBaseInput)
  if (session.showGrid !== undefined) g.setShowGrid(session.showGrid)
  if (session.graphTitle) g.setGraphTitle(session.graphTitle)
  g.setSavedFilename(session.savedFilename ?? null)

  // Recolor all series by position index to match the current palette.
  // Snapshots may carry stale colors from a different palette or from a
  // previous session where the series was at a different index.
  recolorActiveSeries()
}

/** Assign palette colors to all active series by their position index. */
function recolorActiveSeries() {
  const { colorPalette, customPalettes, theme } = useAppStore.getState()
  const { activeSeries, updateSeries } = useGraphStore.getState()
  const dark = isDarkTheme(theme)
  activeSeries.forEach((s, i) => {
    updateSeries(s.id, { color: getColor(colorPalette, i, customPalettes, dark) })
  })
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenGraph {
  id: string
  /** Serialized state. `null` when this is the active graph (live state in useGraphStore). */
  snapshot: GraphSession | null
  /** Whether this graph has unsaved changes. Synced from GraphTab for the active graph. */
  dirty: boolean
}

interface GraphManagerState {
  openGraphs: OpenGraph[]
  activeGraphId: string | null
  graphsExpanded: boolean

  createGraph: () => void
  switchGraph: (id: string) => void
  closeGraph: (id: string) => void
  loadSavedGraph: (saved: SavedGraph, filename: string) => void
  loadDroppedGraph: (saved: SavedGraph) => void
  reorderGraphs: (newOrder: OpenGraph[]) => void
  setGraphsExpanded: (expanded: boolean) => void
  toggleGraphsExpanded: () => void
  /** Sync dirty flag from GraphTab for the currently active graph. */
  setActiveGraphDirty: (dirty: boolean) => void
  /** Discard the active graph if it has no series and hasn't been saved. */
  discardActiveIfEmpty: () => void
  /** Bulk-load open graphs from a restored session (called by useRestoreSession). */
  restoreGraphs: (graphs: { id: string; session: GraphSession }[], activeId: string | null, expanded: boolean) => void
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useGraphManagerStore = create<GraphManagerState>((set, get) => ({
  openGraphs: [],
  activeGraphId: null,
  graphsExpanded: true,

  createGraph: () => {
    const state = get()
    const store = useGraphStore.getState()

    // Auto-discard current graph if empty and unsaved
    let graphs = state.openGraphs
    if (state.activeGraphId && store.activeSeries.length === 0 && !store.savedFilename) {
      graphs = graphs.filter(g => g.id !== state.activeGraphId)
    } else if (state.activeGraphId) {
      const snapshot = snapshotFromStore()
      graphs = graphs.map(g =>
        g.id === state.activeGraphId ? { ...g, snapshot } : g
      )
    }

    const id = crypto.randomUUID()
    store.resetGraph()

    set({
      openGraphs: [...graphs, { id, snapshot: null, dirty: false }],
      activeGraphId: id,
      graphsExpanded: true,
    })
  },

  switchGraph: (id) => {
    const state = get()
    if (id === state.activeGraphId) return
    const target = state.openGraphs.find(g => g.id === id)
    if (!target?.snapshot) return

    const store = useGraphStore.getState()

    // Auto-discard current graph if empty and unsaved, otherwise snapshot it
    let graphs = state.openGraphs
    if (state.activeGraphId && store.activeSeries.length === 0 && !store.savedFilename) {
      graphs = graphs.filter(g => g.id !== state.activeGraphId)
    } else if (state.activeGraphId) {
      const snapshot = snapshotFromStore()
      graphs = graphs.map(g =>
        g.id === state.activeGraphId ? { ...g, snapshot } : g
      )
    }

    // Load target into store
    loadSnapshotToStore(target.snapshot)

    set({
      openGraphs: graphs.map(g => g.id === id ? { ...g, snapshot: null } : g),
      activeGraphId: id,
    })
  },

  closeGraph: (id) => {
    const state = get()
    const remaining = state.openGraphs.filter(g => g.id !== id)

    if (id === state.activeGraphId) {
      if (remaining.length > 0) {
        // Switch to the first available graph
        const next = remaining[0]
        if (next.snapshot) loadSnapshotToStore(next.snapshot)
        set({
          openGraphs: remaining.map(g => g.id === next.id ? { ...g, snapshot: null } : g),
          activeGraphId: next.id,
        })
      } else {
        // No more graphs open — navigate to new-graph tab
        useGraphStore.getState().resetGraph()
        useAppStore.getState().setActiveTab('new-graph')
        set({ openGraphs: [], activeGraphId: null })
      }
    } else {
      set({ openGraphs: remaining })
    }
  },

  loadSavedGraph: (saved, filename) => {
    const state = get()
    const store = useGraphStore.getState()

    // Auto-discard current graph if empty and unsaved
    let graphs = state.openGraphs
    if (state.activeGraphId && store.activeSeries.length === 0 && !store.savedFilename) {
      graphs = graphs.filter(g => g.id !== state.activeGraphId)
    } else if (state.activeGraphId) {
      const snapshot = snapshotFromStore()
      graphs = graphs.map(g =>
        g.id === state.activeGraphId ? { ...g, snapshot } : g
      )
    }

    const id = crypto.randomUUID()
    const session = { ...saved.session, savedFilename: filename }
    loadSnapshotToStore(session)

    set({
      openGraphs: [...graphs, { id, snapshot: null, dirty: false }],
      activeGraphId: id,
      graphsExpanded: true,
    })
  },

  loadDroppedGraph: (saved) => {
    const state = get()
    const store = useGraphStore.getState()

    let graphs = state.openGraphs
    if (state.activeGraphId && store.activeSeries.length === 0 && !store.savedFilename) {
      graphs = graphs.filter(g => g.id !== state.activeGraphId)
    } else if (state.activeGraphId) {
      const snapshot = snapshotFromStore()
      graphs = graphs.map(g =>
        g.id === state.activeGraphId ? { ...g, snapshot } : g
      )
    }

    const id = crypto.randomUUID()
    loadSnapshotToStore(saved.session)

    set({
      openGraphs: [...graphs, { id, snapshot: null, dirty: false }],
      activeGraphId: id,
      graphsExpanded: true,
    })
  },

  reorderGraphs: (newOrder) => set({ openGraphs: newOrder }),
  setGraphsExpanded: (expanded) => set({ graphsExpanded: expanded }),
  toggleGraphsExpanded: () => set((s) => ({ graphsExpanded: !s.graphsExpanded })),

  setActiveGraphDirty: (dirty) => {
    const { activeGraphId, openGraphs } = get()
    if (!activeGraphId) return
    const current = openGraphs.find(g => g.id === activeGraphId)
    if (current && current.dirty === dirty) return // avoid unnecessary re-renders
    set({
      openGraphs: openGraphs.map(g =>
        g.id === activeGraphId ? { ...g, dirty } : g
      ),
    })
  },

  discardActiveIfEmpty: () => {
    const { activeGraphId } = get()
    if (!activeGraphId) return
    const { activeSeries, savedFilename } = useGraphStore.getState()
    // Only discard if the graph has no series and was never saved
    if (activeSeries.length === 0 && !savedFilename) {
      get().closeGraph(activeGraphId)
    }
  },

  restoreGraphs: (graphs, activeId, expanded) => {
    // Find which graph to make active
    const active = graphs.find(g => g.id === activeId) ?? graphs[0]
    if (!active) {
      set({ openGraphs: [], activeGraphId: null, graphsExpanded: expanded })
      return
    }

    // Load the active graph into the store
    loadSnapshotToStore(active.session)

    set({
      openGraphs: graphs.map(g => ({
        id: g.id,
        snapshot: g.id === active.id ? null : g.session,
        dirty: false,
      })),
      activeGraphId: active.id,
      graphsExpanded: expanded,
    })
  },
}))

// ── Snapshot helper for session persistence ──────────────────────────────────

/** Get all open graphs as serialized sessions (including the active one). */
export function getAllGraphSessions(): { id: string; session: GraphSession }[] {
  const { openGraphs, activeGraphId } = useGraphManagerStore.getState()
  const activeSnapshot = snapshotFromStore()
  return openGraphs.map(g => ({
    id: g.id,
    session: g.id === activeGraphId ? activeSnapshot : g.snapshot!,
  }))
}
