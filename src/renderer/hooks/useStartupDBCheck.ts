import { useEffect } from 'react'
import { ipc } from '../lib/ipc'
import { useDBStore } from '../store/db'
import { useAppStore } from '../store/app'

// Task #23: on mount, re-probe every configured external DB and self-heal the
// `reachable` flag. Unreachable DBs stay in the list (filtered from the picker
// at AddLinePanel.tsx:36) so users don't lose their configuration when a network
// share is briefly offline — the next startup just flips the flag back on.
//
// Design notes (from dev-1 IPC consult, 2026-04-14):
//  - Per-probe cancelled check inside each .then() (not batched after Promise.all)
//    so each resolved probe commits independently and late resolutions after
//    unmount cannot mutate the store.
//  - Save-on-change guard: snapshot {id, reachable} before the sweep, compare
//    against the post-sweep store state, only call ipc.settings.save if any
//    reachable actually flipped. Matches the settings-save semantics used in
//    SettingsTab (full AppSettings replace, not a patch).
//  - Task #25: subscribes to `settingsHydrated` so the effect re-fires when
//    `useHydrateSettings` finishes populating the stores. Without this gate,
//    the sweep would read the empty initial store on first boot, no-op at
//    line :28, and `reachable` flags would only self-heal on the SECOND boot.
//    Reading via hook subscription (not `.getState()`) is deliberate: we WANT
//    the effect to re-fire when the flag flips, which requires the hook form.
export function useStartupDBCheck(): void {
  const settingsHydrated = useAppStore((s) => s.settingsHydrated)

  useEffect(() => {
    if (!settingsHydrated) return

    let cancelled = false

    const dbs = useDBStore.getState().externalDBs
    if (dbs.length === 0) return

    const before = dbs.map((d) => ({ id: d.id, reachable: d.reachable }))

    const probes = dbs.map((db) =>
      ipc.external
        .checkPath(db.path)
        .then((reachable) => {
          if (!cancelled) {
            useDBStore.getState().updateReachability(db.id, reachable)
          }
        })
        .catch(() => {
          // checkPath is contractually non-throwing, but guard anyway so one
          // rejection doesn't poison the Promise.all and skip the save pass.
        }),
    )

    void Promise.all(probes).then(() => {
      if (cancelled) return

      const after = useDBStore.getState().externalDBs
      const changed = after.some((a) => {
        const prior = before.find((b) => b.id === a.id)
        return prior ? prior.reachable !== a.reachable : false
      })

      if (changed) {
        const { theme, colorPalette } = useAppStore.getState()
        void ipc.settings.save({ theme, colorPalette, externalDBs: after })
      }
    })

    return () => {
      cancelled = true
    }
  }, [settingsHydrated])
}
