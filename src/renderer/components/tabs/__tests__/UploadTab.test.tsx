// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DataSeries } from '../../../../shared/types'
import { useGraphStore } from '../../../store/graph'
import { useAppStore } from '../../../store/app'

// Mock the upload primitives so the tab tests focus on compositional behaviour,
// not parse-on-input (already covered in FileDropZone.test.tsx / the primitives).
// The mocks expose data-testid hooks and an 'Emit' button that fires onSeries
// with a fixture payload — this lets us drive the tab as if a file was dropped
// or paste-parsed, without jsdom's limited File/drag event support.
vi.mock('../../upload/FileDropZone', () => ({
  FileDropZone: ({ onSeries }: { onSeries: (s: DataSeries[]) => void }) => (
    <div data-testid="file-drop-zone">
      <button
        type="button"
        data-testid="file-emit"
        onClick={() =>
          onSeries([
            makeSeries('upload-1', 'Alpha'),
            makeSeries('upload-2', 'Beta'),
          ])
        }
      >
        emit-file
      </button>
    </div>
  ),
}))

vi.mock('../../upload/PasteTable', () => ({
  PasteTable: ({ onSeries }: { onSeries: (s: DataSeries[]) => void }) => (
    <div data-testid="paste-table">
      <button
        type="button"
        data-testid="paste-emit"
        onClick={() => onSeries([makeSeries('paste-1', 'Pasted')])}
      >
        emit-paste
      </button>
    </div>
  ),
}))

// Import AFTER vi.mock() so hoisted mocks take effect.
import { UploadTab } from '../UploadTab'

function makeSeries(id: string, name: string): DataSeries {
  const pt = [{ date: new Date('2020-01-01'), value: 100 }]
  return {
    id,
    name,
    code: name.toUpperCase(),
    description: '',
    source: 'memory',
    points: pt,
    originalPoints: pt.map((p) => ({ ...p })),
  }
}

beforeEach(() => {
  useGraphStore.setState({ activeSeries: [], zoomDomain: null, rightPanel: null })
  useAppStore.setState({ activeTab: 'upload', theme: 'system', colorPalette: 'default' })
})

describe('UploadTab', () => {
  it('renders heading and the File/Paste mode selector', () => {
    render(<UploadTab />)
    expect(screen.getByRole('heading', { name: /upload data/i })).toBeInTheDocument()
    expect(screen.getByText(/^file$/i)).toBeInTheDocument()
    expect(screen.getByText(/^paste$/i)).toBeInTheDocument()
  })

  it('defaults to File mode and renders FileDropZone', () => {
    render(<UploadTab />)
    expect(screen.getByTestId('file-drop-zone')).toBeInTheDocument()
    expect(screen.queryByTestId('paste-table')).not.toBeInTheDocument()
  })

  it('switches to Paste mode and renders PasteTable', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByText(/^paste$/i))
    expect(screen.getByTestId('paste-table')).toBeInTheDocument()
    expect(screen.queryByTestId('file-drop-zone')).not.toBeInTheDocument()
  })

  it('hides the Add-to-Graph button when no series are pending', () => {
    render(<UploadTab />)
    expect(screen.queryByRole('button', { name: /add to graph/i })).not.toBeInTheDocument()
  })

  it('shows Add-to-Graph button with count + names after primitive emits series', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    expect(screen.getByRole('button', { name: /add to graph/i })).toBeInTheDocument()
    // Count line mentions 2 and both names
    expect(screen.getByText(/2 series ready/i)).toBeInTheDocument()
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Beta/)).toBeInTheDocument()
  })

  it('click Add-to-Graph commits each pending series to graph store and flips tab', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    await user.click(screen.getByRole('button', { name: /add to graph/i }))

    const active = useGraphStore.getState().activeSeries
    expect(active).toHaveLength(2)
    expect(active.map((s) => s.id)).toEqual(['upload-1', 'upload-2'])
    expect(useAppStore.getState().activeTab).toBe('graph')
    // Pending buffer cleared: the button is gone.
    expect(screen.queryByRole('button', { name: /add to graph/i })).not.toBeInTheDocument()
  })

  it('switching mode clears pendingSeries so mid-flight data does not leak', async () => {
    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    expect(screen.getByRole('button', { name: /add to graph/i })).toBeInTheDocument()

    await user.click(screen.getByText(/^paste$/i))
    expect(screen.queryByRole('button', { name: /add to graph/i })).not.toBeInTheDocument()
    // No file-emit anymore either (primitive swapped)
    expect(screen.queryByTestId('file-emit')).not.toBeInTheDocument()
  })

  it('assigns colors from palette starting at activeSeries.length offset', async () => {
    // Seed one existing series so the palette offset is non-zero.
    const existing = makeSeries('existing-1', 'Existing')
    useGraphStore.setState({ activeSeries: [{ ...existing, color: '#3b82f6' }] })

    const user = userEvent.setup()
    render(<UploadTab />)
    await user.click(screen.getByTestId('file-emit'))
    await user.click(screen.getByRole('button', { name: /add to graph/i }))

    const active = useGraphStore.getState().activeSeries
    // existing (idx 0 = #3b82f6) + upload-1 (idx 1 = #ef4444) + upload-2 (idx 2 = #22c55e)
    // from the 'default' palette in colors.ts
    expect(active[0].color).toBe('#3b82f6')
    expect(active[1].color).toBe('#ef4444')
    expect(active[2].color).toBe('#22c55e')
  })
})
