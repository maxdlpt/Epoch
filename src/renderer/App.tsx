import { useEffect } from 'react'
import { AppLayout } from "./components/layout/AppLayout"
import { GraphTab } from "./components/tabs/GraphTab"
import { UploadTab } from "./components/tabs/UploadTab"
import { SettingsTab } from "./components/tabs/SettingsTab"
import { DBTab } from "./components/tabs/DBTab"
import { NewGraphTab } from "./components/tabs/NewGraphTab"
import { useAppStore } from "./store/app"
import { useGraphStore } from "./store/graph"
import { useGraphManagerStore } from "./store/graph-manager"
import { getColor } from "./lib/colors"
import { applyTheme, applyUiTheme, isDarkTheme } from "./lib/theme"
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
      {activeTab === 'upload' && <UploadTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'db' && <DBTab />}
    </AppLayout>
  )
}
