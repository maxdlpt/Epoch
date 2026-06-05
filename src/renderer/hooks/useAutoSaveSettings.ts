import { useEffect, useRef } from 'react'
import { ipc } from '../lib/ipc'
import { useAppStore } from '../store/app'
import { useDBStore } from '../store/db'

const DEBOUNCE_MS = 600

/**
 * Watches user-configurable preferences in the app store and persists them to
 * SQLite whenever they change, debounced so rapid changes (e.g. Ctrl+scroll
 * resizing the chart) don't hammer IPC.
 *
 * Gated on `settingsHydrated`: we must not save defaults over the real stored
 * values before the initial `useHydrateSettings` load completes.
 */
export function useAutoSaveSettings(): void {
  const settingsHydrated  = useAppStore(s => s.settingsHydrated)
  const theme             = useAppStore(s => s.theme)
  const uiTheme           = useAppStore(s => s.uiTheme)
  const colorPalette      = useAppStore(s => s.colorPalette)
  const chartMaxWidth     = useAppStore(s => s.chartMaxWidth)
  const customPalettes    = useAppStore(s => s.customPalettes)
  const alwaysCommonDates = useAppStore(s => s.alwaysCommonDates)
  const keybindings       = useAppStore(s => s.keybindings)
  const externalDBs       = useDBStore(s => s.externalDBs)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Don't save until hydration is complete — avoids overwriting real data with defaults.
    if (!settingsHydrated) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      ipc.settings.save({ theme, uiTheme, colorPalette, chartMaxWidth, customPalettes, alwaysCommonDates, keybindings, externalDBs }).catch(() => {
        // Best-effort: IPC save failures are silent. The stored value simply
        // stays at whatever was last successfully written.
      })
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [settingsHydrated, theme, uiTheme, colorPalette, chartMaxWidth, customPalettes, alwaysCommonDates, keybindings, externalDBs])
}
