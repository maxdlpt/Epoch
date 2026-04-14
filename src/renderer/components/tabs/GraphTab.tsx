import { useMemo } from 'react'
import { AnimatePresence } from 'motion/react'
import { BarChart3, Plus, Sliders } from 'lucide-react'
import { useGraphStore } from '../../store/graph'
import { Button } from '../ui/button'
import { AreaChart, Area, XAxis, YAxis, Grid } from '../ui/area-chart'
import { OperationsPanel } from '../graph/OperationsPanel'
import type { DataSeries } from '../../../shared/types'

// TODO(task 12): render <AddLinePanel /> when rightPanel === 'addLine'.

/**
 * Pivot N series into a single row-per-date table for the chart.
 * Strategy: union of all dates across series, null where a series has no value at that date.
 * This preserves visible gaps in sparse data — honest for financial time-series.
 */
function pivotSeries(series: DataSeries[]): Record<string, unknown>[] {
  if (series.length === 0) return []
  // Collect union of all date timestamps.
  const timestamps = new Set<number>()
  for (const s of series) for (const p of s.points) timestamps.add(p.date.getTime())
  const sorted = Array.from(timestamps).sort((a, b) => a - b)

  // Build a quick lookup per series: timestamp -> value.
  const lookups = series.map((s) => {
    const m = new Map<number, number>()
    for (const p of s.points) m.set(p.date.getTime(), p.value)
    return m
  })

  return sorted.map((ts) => {
    const row: Record<string, unknown> = { date: new Date(ts) }
    series.forEach((s, i) => {
      const v = lookups[i].get(ts)
      row[s.code] = v ?? null
    })
    return row
  })
}

export function GraphTab(): JSX.Element {
  const { activeSeries, rightPanel, setRightPanel } = useGraphStore()
  const pivoted = useMemo(() => pivotSeries(activeSeries), [activeSeries])

  return (
    <div className="relative flex h-full w-full">
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <BarChart3 className="h-4 w-4" />
            <span>Graph</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRightPanel(rightPanel === 'addLine' ? null : 'addLine')}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Line
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRightPanel(rightPanel === 'operations' ? null : 'operations')}
            >
              <Sliders className="mr-1 h-4 w-4" />
              Operations
            </Button>
          </div>
        </div>

        {/* Chart or empty state */}
        <div className="flex-1 p-4">
          {activeSeries.length === 0 ? (
            <div
              data-testid="graph-empty-state"
              className="flex h-full w-full items-center justify-center text-sm text-gray-400 dark:text-gray-500"
            >
              No series selected. Use Add Line to plot a series.
            </div>
          ) : (
            <div data-testid="graph-chart" className="flex h-full w-full flex-col">
              <div className="flex-1">
                <AreaChart data={pivoted} xDataKey="date">
                  <Grid />
                  <XAxis />
                  <YAxis />
                  {activeSeries.map((s) => (
                    <Area
                      key={s.id}
                      dataKey={s.code}
                      stroke={s.color ?? '#3b82f6'}
                      fill={s.color ?? '#3b82f6'}
                      fillOpacity={0.15}
                    />
                  ))}
                </AreaChart>
              </div>
              {/* Legend */}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
                {activeSeries.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.color ?? '#3b82f6' }}
                    />
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <AnimatePresence>
        {rightPanel === 'operations' && <OperationsPanel key="operations" />}
      </AnimatePresence>
    </div>
  )
}

// Exposed for unit tests.
export { pivotSeries }
