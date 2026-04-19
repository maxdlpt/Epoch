import { create } from 'zustand'
import type { DataSeries } from '../../shared/types'

interface ZoomDomain {
  start: Date
  end: Date
}

type RightPanel = 'operations' | 'addLine' | null

export type ChartMode = 'returns' | 'cumulative' | 'drawdown'
export type CumMethod  = 'geometric' | 'arithmetic'

interface GraphState {
  activeSeries: DataSeries[]
  zoomDomain: ZoomDomain | null
  rightPanel: RightPanel
  chartMode: ChartMode
  cumMethod: CumMethod
  cumBaseInput: string
  showGrid: boolean
  graphTitle: string
  savedFilename: string | null
  addSeries: (s: DataSeries) => void
  removeSeries: (id: string) => void
  updateSeries: (id: string, patch: Partial<DataSeries>) => void
  reorderSeries: (newOrder: DataSeries[]) => void
  toggleSeriesVisibility: (id: string) => void
  setZoomDomain: (domain: ZoomDomain | null) => void
  setRightPanel: (panel: RightPanel) => void
  setChartMode: (mode: ChartMode) => void
  setCumMethod: (method: CumMethod) => void
  setCumBaseInput: (input: string) => void
  setShowGrid: (show: boolean) => void
  setGraphTitle: (title: string) => void
  setSavedFilename: (filename: string | null) => void
  resetGraph: () => void
}

export const useGraphStore = create<GraphState>((set) => ({
  activeSeries: [],
  zoomDomain: null,
  rightPanel: null,
  chartMode: 'returns',
  cumMethod: 'geometric',
  cumBaseInput: '',
  showGrid: true,
  graphTitle: 'New Graph',
  savedFilename: null,
  addSeries: (s) => set((state) => ({
    activeSeries: state.activeSeries.find(x => x.id === s.id)
      ? state.activeSeries
      : [...state.activeSeries, s]
  })),
  removeSeries: (id) => set((state) => ({
    activeSeries: state.activeSeries.filter(s => s.id !== id)
  })),
  updateSeries: (id, patch) => set((state) => ({
    activeSeries: state.activeSeries.map(s => s.id === id ? { ...s, ...patch } : s)
  })),
  reorderSeries: (newOrder) => set({ activeSeries: newOrder }),
  toggleSeriesVisibility: (id) => set((state) => ({
    activeSeries: state.activeSeries.map(s => {
      if (s.id !== id) return s
      const nowVisible = !(s.visible ?? true)
      return {
        ...s,
        visible: nowVisible,
        // When hiding: mark all MAs hidden so their buttons reflect the right state
        // and one click is enough to show a single MA independently.
        // When showing: leave MA states as-is (preserves any independent choices).
        movingAverages: nowVisible
          // Show: restore only MAs that were hidden by the parent hide (not explicitly hidden by user)
          ? (s.movingAverages ?? []).map(ma =>
              ma.hiddenWithParent ? { ...ma, visible: true, hiddenWithParent: undefined } : ma
            )
          // Hide: mark visible MAs as hidden-by-parent; leave already-hidden MAs untouched
          : (s.movingAverages ?? []).map(ma =>
              ma.visible !== false ? { ...ma, visible: false, hiddenWithParent: true } : ma
            ),
      }
    }),
  })),
  setZoomDomain: (domain) => set({ zoomDomain: domain }),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  setChartMode: (mode) => set({ chartMode: mode }),
  setCumMethod: (method) => set({ cumMethod: method }),
  setCumBaseInput: (input) => set({ cumBaseInput: input }),
  setShowGrid: (show) => set({ showGrid: show }),
  setGraphTitle: (title) => set({ graphTitle: title }),
  setSavedFilename: (filename) => set({ savedFilename: filename }),
  resetGraph: () => set({
    activeSeries: [],
    zoomDomain: null,
    rightPanel: null,
    chartMode: 'returns',
    cumMethod: 'geometric',
    cumBaseInput: '',
    showGrid: true,
    graphTitle: 'New Graph',
    savedFilename: null,
  }),
}))
