import { useEffect, useRef } from 'react'
import { useGraphStore } from '../store/graph'
import { useGraphManagerStore, getAllGraphSessions } from '../store/graph-manager'
import { ipc } from '../lib/ipc'
import type { MultiGraphSession } from '../../shared/types'

const DEBOUNCE_MS = 1500

/**
 * Debounced auto-save of the full multi-graph session to SQLite.
 *
 * Subscribes to the *active* graph's store fields as change triggers (series,
 * zoom, chart mode, etc.), plus the graph manager's structural state (open
 * graphs list, active ID, expand toggle). When anything changes, we snapshot
 * ALL open graphs via `getAllGraphSessions()` and persist the whole envelope.
 *
 * Saves are best-effort — IPC failures are silently swallowed.
 */
export function useSessionPersistence(): void {
  // Active graph fields — trigger re-save when the live graph changes
  const activeSeries  = useGraphStore((s) => s.activeSeries)
  const zoomDomain    = useGraphStore((s) => s.zoomDomain)
  const chartMode     = useGraphStore((s) => s.chartMode)
  const cumMethod     = useGraphStore((s) => s.cumMethod)
  const cumBaseInput  = useGraphStore((s) => s.cumBaseInput)
  const showGrid      = useGraphStore((s) => s.showGrid)
  const graphTitle    = useGraphStore((s) => s.graphTitle)
  const savedFilename = useGraphStore((s) => s.savedFilename)

  // Manager fields — trigger re-save on structural changes (new graph, close, switch)
  const openGraphs     = useGraphManagerStore((s) => s.openGraphs)
  const activeGraphId  = useGraphManagerStore((s) => s.activeGraphId)
  const graphsExpanded = useGraphManagerStore((s) => s.graphsExpanded)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      const payload: MultiGraphSession = {
        version: 2,
        graphs: getAllGraphSessions(),
        activeGraphId,
        graphsExpanded,
      }
      // Persist via the same session IPC — main process just JSON-stringifies it
      ipc.session.save(payload).catch(() => {})
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [
    activeSeries, zoomDomain, chartMode, cumMethod, cumBaseInput,
    showGrid, graphTitle, savedFilename,
    openGraphs, activeGraphId, graphsExpanded,
  ])
}
