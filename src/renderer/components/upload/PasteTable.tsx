import { useState, useEffect } from 'react'
import { parseCSVText } from '../../lib/parse'
import type { DataSeries } from '../../../shared/types'

interface Props {
  onSeries: (series: DataSeries[]) => void
}

// User pastes tab-separated or CSV data into this table
// The pasted content is parsed on every change
export function PasteTable({ onSeries }: Props) {
  const [raw, setRaw] = useState('')

  useEffect(() => {
    if (!raw.trim()) return
    // Normalize tabs to commas for papaparse
    const normalized = raw.trim().replace(/\t/g, ',')
    const series = parseCSVText(normalized)
    if (series.length > 0 && series[0].points.length > 0) {
      onSeries(series)
    }
  }, [raw, onSeries])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Paste your data below. First row = headers (date, series1, series2...). First column = dates.
      </p>
      <textarea
        value={raw}
        onChange={e => setRaw(e.target.value)}
        placeholder={"date\tSeries 1\tSeries 2\n2020-01-01\t100\t200\n2020-02-01\t110\t195"}
        className="min-h-48 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 font-mono text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        spellCheck={false}
      />
    </div>
  )
}
