import { create } from 'zustand'
import type { DataSeries } from '../../shared/types'

interface ZoomDomain {
  start: Date
  end: Date
}

type RightPanel = 'operations' | 'addLine' | null

interface GraphState {
  activeSeries: DataSeries[]
  zoomDomain: ZoomDomain | null
  rightPanel: RightPanel
  addSeries: (s: DataSeries) => void
  removeSeries: (id: string) => void
  updateSeries: (id: string, patch: Partial<DataSeries>) => void
  setZoomDomain: (domain: ZoomDomain | null) => void
  setRightPanel: (panel: RightPanel) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  activeSeries: [],
  zoomDomain: null,
  rightPanel: null,
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
  setZoomDomain: (domain) => set({ zoomDomain: domain }),
  setRightPanel: (panel) => set({ rightPanel: panel }),
}))
