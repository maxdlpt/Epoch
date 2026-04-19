import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/app'
import { useGraphManagerStore } from '../store/graph-manager'
import { ipc } from '../lib/ipc'
import type { GraphSession, MultiGraphSession } from '../../shared/types'

/**
 * Detect whether a persisted session is the new multi-graph envelope (version 2)
 * or the legacy single-graph format (no `version` field).
 */
function isMultiGraphSession(data: any): data is MultiGraphSession {
  return data && data.version === 2 && Array.isArray(data.graphs)
}

/**
 * Migrate a legacy single-graph `GraphSession` into a `MultiGraphSession`
 * containing one open graph. This lets us handle both formats with one code path.
 */
function migrateV1(session: GraphSession): MultiGraphSession {
  const id = crypto.randomUUID()
  return {
    version: 2,
    graphs: [{ id, session }],
    activeGraphId: id,
    graphsExpanded: true,
  }
}

/**
 * On first mount after settings hydration, load the last saved session and
 * push it into the graph manager + graph stores.
 *
 * Handles two formats:
 * - **v1 (legacy):** A bare `GraphSession` — migrated into a single-graph
 *   `MultiGraphSession` on the fly.
 * - **v2:** `MultiGraphSession` with multiple open graphs, active ID, and
 *   expand state.
 *
 * Gated on `settingsHydrated` so external-DB reachability is set up before
 * series from external sources are restored.
 *
 * The `hasRestored` ref prevents double-fire in React 18 Strict Mode.
 */
export function useRestoreSession(): void {
  const settingsHydrated = useAppStore((s) => s.settingsHydrated)
  const hasRestoredRef   = useRef(false)

  useEffect(() => {
    if (!settingsHydrated) return
    if (hasRestoredRef.current) return
    hasRestoredRef.current = true

    ipc.session
      .get()
      .then((raw) => {
        if (!raw) return

        // Normalise to v2 format
        const multi = isMultiGraphSession(raw)
          ? raw
          : migrateV1(raw as GraphSession)

        if (multi.graphs.length === 0) return

        // Delegate bulk restore to the graph manager
        useGraphManagerStore.getState().restoreGraphs(
          multi.graphs,
          multi.activeGraphId,
          multi.graphsExpanded,
        )

        // Navigate to graph tab so the user sees the restored graph
        useAppStore.getState().setActiveTab('graph')
      })
      .catch(() => {})
  }, [settingsHydrated])
}
