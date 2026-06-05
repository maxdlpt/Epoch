import { create } from 'zustand'
import { generateComplement } from '../lib/colors'
import type { CustomPaletteEntry, Keybindings } from '../../shared/types'

type Tab = 'graph' | 'upload' | 'db' | 'new-graph'

export const CHART_DEFAULT_WIDTH = 1024

export const DEFAULT_KEYBINDINGS: Keybindings = {
  toggleGrid: 'alt+g',
  toggleTooltip: 'alt+t',
  setAllReturns: 'alt+r',
  setAllIndex: 'alt+i',
  setAllDrawdown: 'alt+d',
  saveGraph: 'alt+s',
  addSeries: 'alt+shift++',
  openSettings: 'ctrl+s',
  exportGraph: 'alt+e',
}

interface AppState {
  activeTab: Tab
  settingsOpen: boolean
  theme: 'light' | 'dark' | 'system'
  uiTheme: string
  colorPalette: string
  chartMaxWidth: number
  customPalettes: Record<string, CustomPaletteEntry>
  alwaysCommonDates: boolean
  keybindings: Keybindings
  // Task #25 coordination flag — see useHydrateSettings for full explanation.
  settingsHydrated: boolean
  setActiveTab: (tab: Tab) => void
  toggleSettings: () => void
  closeSettings: () => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setUiTheme: (theme: string) => void
  setColorPalette: (key: string) => void
  setChartMaxWidth: (w: number) => void
  setCustomPalettes: (palettes: Record<string, CustomPaletteEntry>) => void
  setAlwaysCommonDates: (v: boolean) => void
  setKeybindings: (kb: Keybindings) => void
  setKeybinding: (action: keyof Keybindings, key: string) => void
  addCustomPalette: (name: string, colors: string[], isDark: boolean) => void
  updateCustomPalette: (oldName: string, newName: string, colors: string[], isDark: boolean) => void
  removeCustomPalette: (name: string) => void
  setSettingsHydrated: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'new-graph',
  settingsOpen: false,
  theme: 'system',
  uiTheme: 'original',
  colorPalette: 'mono',
  chartMaxWidth: CHART_DEFAULT_WIDTH,
  customPalettes: {},
  alwaysCommonDates: false,
  keybindings: { ...DEFAULT_KEYBINDINGS },
  settingsHydrated: false,
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  closeSettings: () => set({ settingsOpen: false }),
  setTheme: (theme) => set({ theme }),
  setUiTheme: (uiTheme) => set({ uiTheme }),
  setColorPalette: (colorPalette) => set({ colorPalette }),
  setChartMaxWidth: (chartMaxWidth) => set({ chartMaxWidth }),
  setCustomPalettes: (customPalettes) => set({ customPalettes }),
  setAlwaysCommonDates: (alwaysCommonDates) => set({ alwaysCommonDates }),
  setKeybindings: (keybindings) => set({ keybindings }),
  setKeybinding: (action, key) => set((s) => ({ keybindings: { ...s.keybindings, [action]: key } })),
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
      colorPalette: s.colorPalette === name ? 'mono' : s.colorPalette,
    })),
  setSettingsHydrated: () => set({ settingsHydrated: true }),
}))
