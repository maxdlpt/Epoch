import { useEffect } from 'react'
import { ipc } from '../lib/ipc'
import { useDBStore } from '../store/db'
import { useAppStore } from '../store/app'

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
        useAppStore.getState().setColorPalette(settings.colorPalette)
        useDBStore.getState().setExternalDBs(settings.externalDBs)
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
