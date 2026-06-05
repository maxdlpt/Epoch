import { useEffect } from 'react'
import { AppLayout } from "./components/layout/AppLayout"
import { GraphTab } from "./components/tabs/GraphTab"
import { UploadTab } from "./components/tabs/UploadTab"
import { SettingsModal } from "./components/tabs/SettingsTab"
import { DBTab } from "./components/tabs/DBTab"
import { NewGraphTab } from "./components/tabs/NewGraphTab"
import { useAppStore } from "./store/app"
import { useGraphStore } from "./store/graph"
import { useGraphManagerStore } from "./store/graph-manager"
import { getColor } from "./lib/colors"
import { applyTheme, applyUiTheme, isDarkTheme } from "./lib/theme"
import { matchesBinding } from "./lib/keybindings"
import { useHydrateSettings } from "./hooks/useHydrateSettings"
import { useStartupDBCheck } from "./hooks/useStartupDBCheck"
import { useAutoSaveSettings } from "./hooks/useAutoSaveSettings"
import { useRestoreSession } from "./hooks/useRestoreSession"
import { useSessionPersistence } from "./hooks/useSessionPersistence"

export default function App() {
  const activeTab        = useAppStore(s => s.activeTab)
  const activeGraphId    = useGraphManagerStore(s => s.activeGraphId)
  const colorPalette     = useAppStore(s => s.colorPalette)
  const customPalettes   = useAppStore(s => s.customPalettes)
  const theme            = useAppStore(s => s.theme)
  const uiTheme          = useAppStore(s => s.uiTheme)
  const settingsHydrated = useAppStore(s => s.settingsHydrated)
  useHydrateSettings()
  useStartupDBCheck()
  useAutoSaveSettings()
  useRestoreSession()
  useSessionPersistence()

  // Apply theme to <html> whenever the store value changes (covers all tabs).
  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { applyUiTheme(uiTheme) }, [uiTheme])

  // Global keyboard navigation
  useEffect(() => {
    const MAIN_TABS: ('graph' | 'db' | 'upload')[] = ['graph', 'db', 'upload']

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Toggle settings modal
      if (matchesBinding(e, useAppStore.getState().keybindings.openSettings)) {
        e.preventDefault()
        useAppStore.getState().toggleSettings()
        return
      }

      // Ctrl+PageUp / Ctrl+PageDown — cycle main sections
      if (e.ctrlKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault()
        const current = useAppStore.getState().activeTab
        // Map 'new-graph' to 'graph' for cycling purposes
        const effective = current === 'new-graph' ? 'graph' : current
        const idx = MAIN_TABS.indexOf(effective as typeof MAIN_TABS[number])
        if (idx === -1) return
        const next = e.key === 'PageDown'
          ? MAIN_TABS[(idx + 1) % MAIN_TABS.length]
          : MAIN_TABS[(idx - 1 + MAIN_TABS.length) % MAIN_TABS.length]
        useAppStore.getState().setActiveTab(next)
        return
      }

      // PageUp / PageDown — cycle between open graphs
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        const { openGraphs, activeGraphId, switchGraph } = useGraphManagerStore.getState()
        if (openGraphs.length < 2) return
        const idx = openGraphs.findIndex(g => g.id === activeGraphId)
        if (idx === -1) return
        const next = e.key === 'PageDown'
          ? openGraphs[(idx + 1) % openGraphs.length]
          : openGraphs[(idx - 1 + openGraphs.length) % openGraphs.length]
        switchGraph(next.id)
        useAppStore.getState().setActiveTab('graph')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Re-colour all active series by their position index whenever the palette changes.
  // Read the graph store imperatively (no subscription) so this only fires on palette
  // changes, not on every series add/remove.
  useEffect(() => {
    if (!settingsHydrated) return
    const { activeSeries, updateSeries } = useGraphStore.getState()
    const dark = isDarkTheme(theme)
    activeSeries.forEach((s, i) => {
      updateSeries(s.id, { color: getColor(colorPalette, s.colorIndex ?? i, customPalettes, dark, uiTheme) })
    })
  }, [colorPalette, customPalettes, theme, uiTheme, settingsHydrated, activeGraphId])

  return (
    <AppLayout>
      {activeTab === 'graph' && <GraphTab key={activeGraphId ?? 'no-graph'} />}
      {activeTab === 'new-graph' && <NewGraphTab />}
      {/* Keep UploadTab mounted so pending series survive tab switches */}
      <div className={activeTab === 'upload' ? 'contents' : 'hidden'}>
        <UploadTab />
      </div>
      {activeTab === 'db' && <DBTab />}
      <SettingsModal />
    </AppLayout>
  )
}
