import { useCallback, useState } from 'react'
import { Upload, AlertCircle } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useGraphStore } from '../../store/graph'
import { getColor } from '../../lib/colors'
import { isDarkTheme } from '../../lib/theme'
import { ipc } from '../../lib/ipc'
import { FileDropZone } from '../upload/FileDropZone'
import { PasteTable } from '../upload/PasteTable'
import { UploadTablePage } from '../upload/UploadTablePage'
import { UploadCardPage } from '../upload/UploadCardPage'
import type { Assignment } from '../upload/SeriesReviewPanel'
import { Selector } from '../ui/segment-group'
import type { DataSeries } from '../../../shared/types'

type InputMode = 'file' | 'paste'
type Phase = 'input' | 'table' | 'cards'

const TITLE_FONT_STYLE = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
}

function FileIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="currentColor" viewBox="-64 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <path d="M369.9 97.9L286 14C277 5 264.8-.1 252.1-.1H48C21.5 0 0 21.5 0 48v416c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48V131.9c0-12.7-5.1-25-14.1-34zM332.1 128H256V51.9l76.1 76.1zM48 464V48h160v104c0 13.3 10.7 24 24 24h104v288H48zm212-240h-28.8c-4.4 0-8.4 2.4-10.5 6.3-18 33.1-22.2 42.4-28.6 57.7-13.9-29.1-6.9-17.3-28.6-57.7-2.1-3.9-6.2-6.3-10.6-6.3H124c-9.3 0-15 10-10.4 18l46.3 78-46.3 78c-4.7 8 1.1 18 10.4 18h28.9c4.4 0 8.4-2.4 10.5-6.3 21.7-40 23-45 28.6-57.7 14.9 30.2 5.9 15.9 28.6 57.7 2.1 3.9 6.2 6.3 10.6 6.3H260c9.3 0 15-10 10.4-18L224 320c.7-1.1 30.3-50.5 46.3-78 4.7-8-1.1-18-10.3-18z" />
    </svg>
  )
}

function PasteIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H9M15 5H17C18.1046 5 19 5.89543 19 7V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.902 20.3343L12.7153 20.7716L13.1526 18.585C13.1914 18.3914 13.2865 18.2136 13.4261 18.074L17.5 14L19.5 12L21.4869 13.9869L19.4869 15.9869L15.413 20.0608C15.2734 20.2004 15.0956 20.2956 14.902 20.3343Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5V7H9V5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── UploadTab ────────────────────────────────────────────────────────────────

export function UploadTab(): JSX.Element {
  const [inputMode, setInputMode] = useState<InputMode>('file')
  const [phase, setPhase]         = useState<Phase>('input')
  const [pendingSeries, setPendingSeries] = useState<DataSeries[]>([])
  const [pendingGrid, setPendingGrid]     = useState<string[][] | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const colorPalette      = useAppStore((s) => s.colorPalette)
  const customPalettes    = useAppStore((s) => s.customPalettes)
  const theme             = useAppStore((s) => s.theme)
  const uiTheme           = useAppStore((s) => s.uiTheme)
  const activeSeriesCount = useGraphStore((s) => s.activeSeries.length)

  // Assign colors and transition to the table phase
  const handleParsed = useCallback(
    (series: DataSeries[]) => {
      const colored = series.map((s, i) => ({
        ...s,
        color: s.color ?? getColor(colorPalette, activeSeriesCount + i, customPalettes, isDarkTheme(theme), uiTheme),
        colorIndex: s.colorIndex ?? activeSeriesCount + i,
      }))
      setPendingSeries(colored)
      setPhase('table')
    },
    [colorPalette, customPalettes, theme, uiTheme, activeSeriesCount],
  )

  // Table "Done" → transition to cards phase with re-parsed series (colors re-assigned)
  const handleTableDone = useCallback(
    (series: DataSeries[]) => {
      const colored = series.map((s, i) => ({
        ...s,
        color: s.color ?? getColor(colorPalette, activeSeriesCount + i, customPalettes, isDarkTheme(theme), uiTheme),
        colorIndex: s.colorIndex ?? activeSeriesCount + i,
      }))
      setPendingSeries(colored)
      setPhase('cards')
    },
    [colorPalette, customPalettes, theme, uiTheme, activeSeriesCount],
  )

  // Dateless path: raw grid from PasteTable (no date column in pasted data)
  const handleRawGrid = useCallback((grid: string[][]) => {
    setPendingGrid(grid)
    setPendingSeries([])
    setPhase('table')
  }, [])

  // Reset to initial input phase
  const handleCancel = useCallback(() => {
    setPendingSeries([])
    setPendingGrid(null)
    setSaveError(null)
    setPhase('input')
  }, [])

  // Execute a batch of assignments — add to graph and/or save to databases.
  const dispatch = useCallback(async (assignments: Assignment[]) => {
    setSaveError(null)
    const graphItems = assignments.filter(a => a.destination.type === 'graph')
    const memItems   = assignments.filter(a => a.destination.type === 'memory')
    const extItems   = assignments.filter(a => a.destination.type === 'external')

    const { addSeries } = useGraphStore.getState()
    for (const { series } of graphItems) addSeries(series)

    try {
      await Promise.all(memItems.map(({ series }) => ipc.memory.saveSeries(series)))
      await Promise.all(
        extItems.map(({ series, destination }) =>
          destination.type === 'external'
            ? ipc.external.saveSeries(destination.path, series)
            : Promise.resolve()
        )
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSaveError(`Failed to save to database: ${msg}`)
    }

    return graphItems.length > 0
  }, [])

  // Card page dispatches series, then discards them from the pending list.
  // When the list empties and items went to a graph, navigate to the graph tab.
  const handleCardDispatch = useCallback(async (assignments: Assignment[]) => {
    const wentToGraph = await dispatch(assignments)
    // Remove dispatched series from pending
    const dispatched = new Set(assignments.map(a => a.series.id))
    setPendingSeries(prev => {
      const next = prev.filter(s => !dispatched.has(s.id))
      if (next.length === 0) {
        if (wentToGraph) useAppStore.getState().setActiveTab('graph')
        setPhase('input')
      }
      return next
    })
    return wentToGraph
  }, [dispatch])

  const handleDiscard = useCallback((id: string) => {
    setPendingSeries(prev => {
      const next = prev.filter(s => s.id !== id)
      if (next.length === 0) setPhase('input')
      return next
    })
  }, [])

  const onInputModeChange = (next: InputMode): void => {
    setPendingSeries([])
    setInputMode(next)
  }

  return (
    <div className="flex flex-col h-full w-full px-8 pb-8 gap-6">
      {/* Title row — height matches sidebar logo section (top → separator) */}
      <div className="flex items-center gap-3 h-[108px] shrink-0 leading-none select-none text-foreground" style={TITLE_FONT_STYLE}>
        <Upload className="h-8 w-8 text-primary shrink-0" />
        <h2 className="text-4xl font-black leading-none flex-1">Upload Series</h2>
      </div>

      {saveError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{saveError}</span>
        </div>
      )}

      {phase === 'input' && (
        <>
          <Selector<InputMode>
            options={[
              { value: 'file',  label: 'File',  icon: <FileIcon />  },
              { value: 'paste', label: 'Paste', icon: <PasteIcon /> },
            ]}
            value={inputMode}
            onChange={onInputModeChange}
            className="mx-auto max-w-sm w-full"
          />
          {inputMode === 'file' ? (
            <FileDropZone onSeries={handleParsed} />
          ) : (
            <PasteTable onSeries={handleParsed} onRawGrid={handleRawGrid} />
          )}
        </>
      )}

      {phase === 'table' && (
        <UploadTablePage
          series={pendingSeries}
          initialGrid={pendingGrid ?? undefined}
          onDone={handleTableDone}
          onCancel={handleCancel}
        />
      )}

      {phase === 'cards' && (
        <UploadCardPage
          series={pendingSeries}
          onDispatch={handleCardDispatch}
          onDiscard={handleDiscard}
          onCancel={handleCancel}
        />
      )}
    </div>
  )
}
