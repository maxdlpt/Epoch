import { useEffect, useMemo, useState } from 'react'
import { X, Database } from 'lucide-react'
import { motion } from 'motion/react'
import { useGraphStore } from '../../store/graph'
import { useDBStore } from '../../store/db'
import { ipc } from '../../lib/ipc'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { DBRecord } from '../../../shared/types'

// Source identifies where the list of records comes from. 'memory' is the
// built-in memory DB; anything else is an external DB id from useDBStore.
type Source = 'memory' | string

interface ExternalSourceRef {
  id: string
  name: string
  path: string
}

export function AddLinePanel(): JSX.Element {
  const { setRightPanel, addSeries } = useGraphStore()
  const externalDBs = useDBStore((s) => s.externalDBs)

  const [source, setSource] = useState<Source>('memory')
  const [records, setRecords] = useState<DBRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only reachable external DBs are offered — unreachable paths would raise
  // noisy errors and the user can't do anything about them from here.
  const sources = useMemo<ExternalSourceRef[]>(
    () =>
      externalDBs
        .filter((db) => db.reachable)
        .map((db) => ({ id: db.id, name: db.name, path: db.path })),
    [externalDBs],
  )

  // Fetch the record list for the currently selected source.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const fetcher =
      source === 'memory'
        ? ipc.memory.listSeries()
        : (() => {
            const ref = sources.find((r) => r.id === source)
            return ref ? ipc.external.listSeries(ref.path) : Promise.resolve<DBRecord[]>([])
          })()

    fetcher
      .then((list) => {
        if (!cancelled) setRecords(list)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [source, sources])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return records
    return records.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    )
  }, [records, query])

  const handlePick = async (rec: DBRecord): Promise<void> => {
    try {
      const series =
        source === 'memory'
          ? await ipc.memory.getSeries(rec.id)
          : await (async () => {
              const ref = sources.find((r) => r.id === source)
              return ref ? ipc.external.getSeries(ref.path, rec.id, ref.id) : null
            })()
      if (series) addSeries(series)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="flex flex-col gap-4 p-4 h-full w-80 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add Line</h3>
        <button
          type="button"
          aria-label="Close Add Line panel"
          onClick={() => setRightPanel(null)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Source picker: memory + each reachable external DB */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant={source === 'memory' ? 'default' : 'outline'}
          size="sm"
          className="text-xs"
          onClick={() => setSource('memory')}
        >
          <Database className="mr-1 h-3 w-3" />
          Memory
        </Button>
        {sources.map((ref) => (
          <Button
            key={ref.id}
            variant={source === ref.id ? 'default' : 'outline'}
            size="sm"
            className="text-xs"
            onClick={() => setSource(ref.id)}
          >
            <Database className="mr-1 h-3 w-3" />
            {ref.name}
          </Button>
        ))}
      </div>

      <Input
        type="search"
        placeholder="Search series…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 text-sm"
      />

      {/* Record list — scrollable; clicking a row adds it to the chart */}
      <div className="flex-1 overflow-y-auto -mx-1">
        {loading ? (
          <p className="px-1 text-xs text-gray-500 dark:text-gray-400">Loading…</p>
        ) : error ? (
          <p className="px-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="px-1 text-xs text-gray-500 dark:text-gray-400">
            {records.length === 0 ? 'No series available.' : 'No matches.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void handlePick(r)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">{r.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {r.code} · {r.pointCount} points
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  )
}
