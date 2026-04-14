import { create } from 'zustand'

type Tab = 'graph' | 'upload' | 'settings'

interface AppState {
  activeTab: Tab
  theme: 'light' | 'dark' | 'system'
  colorPalette: string
  setActiveTab: (tab: Tab) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setColorPalette: (key: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'graph',
  theme: 'system',
  colorPalette: 'default',
  setActiveTab: (tab) => set({ activeTab: tab }),
  setTheme: (theme) => set({ theme }),
  setColorPalette: (key) => set({ colorPalette: key }),
}))
