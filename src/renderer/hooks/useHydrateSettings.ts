import { useEffect } from 'react'
import { ipc } from '../lib/ipc'
import { generateComplement } from '../lib/colors'
import { applyUiTheme } from '../lib/theme'
import { useDBStore } from '../store/db'
import { useAppStore, DEFAULT_KEYBINDINGS } from '../store/app'
import type { CustomPaletteEntry } from '../../shared/types'

// Task #25: on mount, load persisted settings via `ipc.settings.get()` and
// push them into the renderer stores. Without this hook, every restart resets
// external DB configs, theme, and palette to defaults (found during the #23
// IPC consult — `ipc.settings.get` and `setExternalDBs` had zero callers).
//
// Design notes:
//  - Cancel guard: if the component unmounts before the IPC resolves, we drop
//    the result rather than writing into stores that may no longer have
//    subscribers — AND we do not flip `settingsHydrated`.
//  - Catch guard: `ipc.settings.get` goes over Electron IPC transport; even
//    though the main handler is non-throwing, the transport itself can reject
//    on structured-clone errors or bridge teardown. Swallow silently — a
//    failed hydrate leaves defaults in place, which is the same behaviour as
//    a first-ever boot.
//  - Uses `.getState()` form (one-shot writes inside effect, not reactive
//    subscriptions) — we're writing, not reading.
//  - `setSettingsHydrated()` fires LAST so downstream effects that gate on
//    `settingsHydrated === true` (e.g. `useStartupDBCheck`'s sweep) observe
//    a fully-populated store when they re-fire.
export function useHydrateSettings(): void {
  useEffect(() => {
    let cancelled = false

    ipc.settings
      .get()
      .then((settings) => {
        if (cancelled) return
        useAppStore.getState().setTheme(settings.theme)
        localStorage.setItem('tsv-theme', settings.theme)
        if (settings.uiTheme) {
          useAppStore.getState().setUiTheme(settings.uiTheme)
          localStorage.setItem('tsv-ui-theme', settings.uiTheme)
          applyUiTheme(settings.uiTheme)
        }
        useAppStore.getState().setColorPalette(settings.colorPalette)
        if (settings.chartMaxWidth) {
          useAppStore.getState().setChartMaxWidth(settings.chartMaxWidth)
        }
        if (settings.customPalettes) {
          // Migrate pre-v3 palette format: entries were plain string[] arrays.
          // New format is { light: string[], dark: string[] }. Detect by shape.
          const raw = settings.customPalettes as Record<string, CustomPaletteEntry | string[]>
          const migrated: Record<string, CustomPaletteEntry> = {}
          for (const [name, entry] of Object.entries(raw)) {
            if (Array.isArray(entry)) {
              migrated[name] = { light: entry, dark: generateComplement(entry) }
            } else {
              migrated[name] = entry
            }
          }
          useAppStore.getState().setCustomPalettes(migrated)
        }
        useDBStore.getState().setExternalDBs(settings.externalDBs)
        if (settings.alwaysCommonDates) {
          useAppStore.getState().setAlwaysCommonDates(settings.alwaysCommonDates)
        }
        if (settings.keybindings) {
          useAppStore.getState().setKeybindings({ ...DEFAULT_KEYBINDINGS, ...settings.keybindings })
        }
        // Flip the flag LAST so gated downstream effects see populated stores.
        useAppStore.getState().setSettingsHydrated()
      })
      .catch(() => {
        // Transport-level failure — leave stores at defaults AND leave the
        // hydration flag false so the sweep stays gated off and doesn't
        // persist an empty config over the real one. Next successful hydrate
        // flips the flag.
      })

    return () => {
      cancelled = true
    }
  }, [])
}
