import { create } from 'zustand'

type Tab = 'graph' | 'upload' | 'settings'

interface AppState {
  activeTab: Tab
  theme: 'light' | 'dark' | 'system'
  colorPalette: string
  // Task #25 coordination flag: `useHydrateSettings` flips this to true after
  // it has pushed the persisted settings into the stores, and downstream
  // boot-time effects (e.g. `useStartupDBCheck`) gate on it so they don't run
  // against a pre-hydrate empty store. Ephemeral — never persisted to disk,
  // always false on a cold boot. NOT part of `AppSettings` in shared/types.ts.
  settingsHydrated: boolean
  setActiveTab: (tab: Tab) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setColorPalette: (key: string) => void
  setSettingsHydrated: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'graph',
  theme: 'system',
  colorPalette: 'default',
  settingsHydrated: false,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setTheme: (theme) => set({ theme }),
  setColorPalette: (key) => set({ colorPalette: key }),
  setSettingsHydrated: () => set({ settingsHydrated: true }),
}))
