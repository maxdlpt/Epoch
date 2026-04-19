import { create } from 'zustand'
import { generateComplement } from '../lib/colors'
import type { CustomPaletteEntry } from '../../shared/types'

type Tab = 'graph' | 'upload' | 'settings' | 'db' | 'new-graph'

export const CHART_DEFAULT_WIDTH = 1024

interface AppState {
  activeTab: Tab
  theme: 'light' | 'dark' | 'system'
  colorPalette: string
  chartMaxWidth: number
  customPalettes: Record<string, CustomPaletteEntry>
  // Task #25 coordination flag — see useHydrateSettings for full explanation.
  settingsHydrated: boolean
  setActiveTab: (tab: Tab) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setColorPalette: (key: string) => void
  setChartMaxWidth: (w: number) => void
  setCustomPalettes: (palettes: Record<string, CustomPaletteEntry>) => void
  addCustomPalette: (name: string, colors: string[], isDark: boolean) => void
  updateCustomPalette: (oldName: string, newName: string, colors: string[], isDark: boolean) => void
  removeCustomPalette: (name: string) => void
  setSettingsHydrated: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'new-graph',
  theme: 'system',
  colorPalette: 'default',
  chartMaxWidth: CHART_DEFAULT_WIDTH,
  customPalettes: {},
  settingsHydrated: false,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setTheme: (theme) => set({ theme }),
  setColorPalette: (colorPalette) => set({ colorPalette }),
  setChartMaxWidth: (chartMaxWidth) => set({ chartMaxWidth }),
  setCustomPalettes: (customPalettes) => set({ customPalettes }),
  addCustomPalette: (name, colors, isDark) =>
    set((s) => ({
      customPalettes: {
        ...s.customPalettes,
        [name]: isDark
          ? { light: generateComplement(colors), dark: colors }
          : { light: colors, dark: generateComplement(colors) },
      },
    })),
  updateCustomPalette: (oldName, newName, colors, isDark) =>
    set((s) => {
      const updated = Object.fromEntries(
        Object.entries(s.customPalettes).filter(([k]) => k !== oldName),
      )
      updated[newName] = isDark
        ? { light: generateComplement(colors), dark: colors }
        : { light: colors, dark: generateComplement(colors) }
      return {
        customPalettes: updated,
        colorPalette: s.colorPalette === oldName ? newName : s.colorPalette,
      }
    }),
  removeCustomPalette: (name) =>
    set((s) => ({
      customPalettes: Object.fromEntries(
        Object.entries(s.customPalettes).filter(([k]) => k !== name),
      ),
      colorPalette: s.colorPalette === name ? 'default' : s.colorPalette,
    })),
  setSettingsHydrated: () => set({ settingsHydrated: true }),
}))
