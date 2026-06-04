// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OperationsPanel } from '../OperationsPanel'
import { useGraphStore } from '../../../store/graph'
import type { DataSeries } from '../../../../shared/types'

const RAW_POINTS = [
  { date: new Date('2020-01-01'), value: 100 },
  { date: new Date('2020-02-01'), value: 110 },
]
const SERIES: DataSeries = {
  id: 's1',
  name: 'CPI',
  code: 'CPI',
  description: '',
  source: 'memory',
  points: [...RAW_POINTS],
  originalPoints: [...RAW_POINTS],
}

beforeEach(() => {
  useGraphStore.setState({ activeSeries: [], zoomDomain: null, rightPanel: 'operations' })
  // Mock IPC surface used by SaveMenu so imports don't throw when the panel renders.
  ;(globalThis as unknown as { window: { tsv: unknown } }).window.tsv = {
    memory: { saveSeries: vi.fn().mockResolvedValue(undefined) },
    dialog: { openDB: vi.fn(), saveDB: vi.fn() },
  } as unknown as typeof window.tsv
})

describe('OperationsPanel', () => {
  it('renders Operations heading and transform buttons', () => {
    render(<OperationsPanel />)
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cumulative return/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /normalize to 100/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /period % change/i })).toBeInTheDocument()
  })

  it('applying Cumulative Return transform updates active series in store', async () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    const user = userEvent.setup()
    render(<OperationsPanel />)

    await user.click(screen.getByRole('button', { name: /cumulative return/i }))

    const after = useGraphStore.getState().activeSeries[0]
    // base 100 -> 0, second point 110 -> 0.10 (decimal form)
    expect(after.points[0].value).toBe(0)
    expect(after.points[1].value).toBeCloseTo(0.10)
  })

  it('applying Normalize rebases series to 100', async () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    const user = userEvent.setup()
    render(<OperationsPanel />)

    await user.click(screen.getByRole('button', { name: /normalize to 100/i }))

    const after = useGraphStore.getState().activeSeries[0]
    expect(after.points[0].value).toBe(100)
    expect(after.points[1].value).toBeCloseTo(110)
  })

  it('Reset to Raw restores originalPoints after a CumReturn transform', async () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    const user = userEvent.setup()
    render(<OperationsPanel />)

    // Apply CumReturn: 100 -> 0%, 110 -> 10%
    await user.click(screen.getByRole('button', { name: /cumulative return/i }))
    expect(useGraphStore.getState().activeSeries[0].points[0].value).toBe(0)

    // Reset back: should restore the raw 100 / 110 values exactly.
    await user.click(screen.getByRole('button', { name: /reset to raw values/i }))
    const after = useGraphStore.getState().activeSeries[0]
    expect(after.points[0].value).toBe(100)
    expect(after.points[1].value).toBe(110)
  })

  it('chained transforms always read from originalPoints (no stacking)', async () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    const user = userEvent.setup()
    render(<OperationsPanel />)

    // CumReturn first (replaces points with 0% / 10%).
    await user.click(screen.getByRole('button', { name: /cumulative return/i }))
    expect(useGraphStore.getState().activeSeries[0].points[0].value).toBe(0)

    // Now Normalize. If we (incorrectly) read from current points we'd rebase
    // [0, 10] to 100 (yielding 100, Infinity). The contract says we read from
    // originalPoints [100, 110] so the result is 100, ~110.
    await user.click(screen.getByRole('button', { name: /normalize to 100/i }))
    const after = useGraphStore.getState().activeSeries[0]
    expect(after.points[0].value).toBe(100)
    expect(after.points[1].value).toBeCloseTo(110)
    expect(Number.isFinite(after.points[1].value)).toBe(true)
  })

  it('close button clears rightPanel in store', async () => {
    const user = userEvent.setup()
    render(<OperationsPanel />)
    // The close button is icon-only; it's the first button in the header
    const closeBtn = screen.getByLabelText(/close operations panel/i)
    await user.click(closeBtn)
    expect(useGraphStore.getState().rightPanel).toBeNull()
  })
})
