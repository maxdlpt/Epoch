import { useCallback, useState } from 'react'
import { useAppStore } from '../../store/app'
import { useGraphStore } from '../../store/graph'
import { getColor } from '../../lib/colors'
import { FileDropZone } from '../upload/FileDropZone'
import { PasteTable } from '../upload/PasteTable'
import { Selector } from '../ui/segment-group'
import { Button } from '../ui/button'
import type { DataSeries } from '../../../shared/types'

type Mode = 'file' | 'paste'

// Two-stage flow: the primitive emits parsed series into a local `pendingSeries`
// buffer (re-parse on every keystroke in PasteTable just overwrites the buffer,
// no store flood), then an explicit "Add to Graph" click commits to the graph
// store and navigates to the graph tab. Colors are assigned at buffer-in time
// so the Add-to-Graph preview accurately reflects what will be rendered.
export function UploadTab(): JSX.Element {
  const [mode, setMode] = useState<Mode>('file')
  const [pendingSeries, setPendingSeries] = useState<DataSeries[]>([])
  const colorPalette = useAppStore((s) => s.colorPalette)
  const activeSeriesCount = useGraphStore((s) => s.activeSeries.length)

  const handleSeries = useCallback(
    (series: DataSeries[]) => {
      const colored = series.map((s, i) => ({
        ...s,
        color: s.color ?? getColor(colorPalette, activeSeriesCount + i),
      }))
      setPendingSeries(colored)
    },
    [colorPalette, activeSeriesCount],
  )

  const addToGraph = (): void => {
    const { addSeries } = useGraphStore.getState()
    for (const s of pendingSeries) addSeries(s)
    useAppStore.getState().setActiveTab('graph')
    setPendingSeries([])
  }

  const onModeChange = (next: Mode): void => {
    // Discard any mid-flight pending series — mixing file-drop output with
    // paste-table output is almost never what the user wants.
    setPendingSeries([])
    setMode(next)
  }

  return (
    <div className="flex flex-col gap-6 p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Upload Data</h2>

      <Selector<Mode>
        options={[
          { value: 'file', label: 'File' },
          { value: 'paste', label: 'Paste' },
        ]}
        value={mode}
        onChange={onModeChange}
      />

      {mode === 'file' ? (
        <FileDropZone onSeries={handleSeries} />
      ) : (
        <PasteTable onSeries={handleSeries} />
      )}

      {pendingSeries.length > 0 && (
        <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
          <p className="text-sm text-green-700 dark:text-green-300 mb-3">
            {pendingSeries.length} series ready: {pendingSeries.map((s) => s.name).join(', ')}
          </p>
          <Button onClick={addToGraph} className="w-full">
            Add to Graph
          </Button>
        </div>
      )}
    </div>
  )
}
