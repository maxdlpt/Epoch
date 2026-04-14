// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphTab, pivotSeries } from '../GraphTab'
import { useGraphStore } from '../../../store/graph'
import type { DataSeries } from '../../../../shared/types'

const SERIES_A: DataSeries = {
  id: 's1',
  name: 'CPI',
  code: 'CPI',
  description: '',
  source: 'memory',
  color: '#3b82f6',
  points: [
    { date: new Date('2020-01-01'), value: 100 },
    { date: new Date('2020-02-01'), value: 110 },
    { date: new Date('2020-03-01'), value: 120 },
  ],
}

const SERIES_B: DataSeries = {
  id: 's2',
  name: 'GDP',
  code: 'GDP',
  description: '',
  source: 'memory',
  color: '#10b981',
  points: [
    { date: new Date('2020-01-01'), value: 200 },
    { date: new Date('2020-02-01'), value: 210 },
    { date: new Date('2020-03-01'), value: 215 },
  ],
}

beforeEach(() => {
  useGraphStore.setState({ activeSeries: [], zoomDomain: null, rightPanel: null })
  // Mock window.tsv for any downstream component that imports IPC wrappers.
  ;(globalThis as unknown as { window: { tsv: unknown } }).window.tsv = {
    memory: { saveSeries: vi.fn().mockResolvedValue(undefined) },
    dialog: { openDB: vi.fn(), saveDB: vi.fn() },
  } as unknown as typeof window.tsv
})

describe('GraphTab', () => {
  it('shows empty state when no active series', () => {
    render(<GraphTab />)
    expect(screen.getByTestId('graph-empty-state')).toBeInTheDocument()
  })

  it('renders chart container when activeSeries is populated', () => {
    act(() => {
      useGraphStore.getState().addSeries(SERIES_A)
      useGraphStore.getState().addSeries(SERIES_B)
    })
    render(<GraphTab />)
    expect(screen.getByTestId('graph-chart')).toBeInTheDocument()
    // Legend should enumerate each active series by name.
    expect(screen.getByText('CPI')).toBeInTheDocument()
    expect(screen.getByText('GDP')).toBeInTheDocument()
  })

  it('Operations button toggles rightPanel to "operations"', async () => {
    act(() => useGraphStore.getState().addSeries(SERIES_A))
    const user = userEvent.setup()
    render(<GraphTab />)

    await user.click(screen.getByRole('button', { name: /operations/i }))
    expect(useGraphStore.getState().rightPanel).toBe('operations')
  })

  it('Add Line button toggles rightPanel to "addLine"', async () => {
    const user = userEvent.setup()
    render(<GraphTab />)

    await user.click(screen.getByRole('button', { name: /add line/i }))
    expect(useGraphStore.getState().rightPanel).toBe('addLine')
  })
})

describe('pivotSeries', () => {
  it('returns empty array when no series', () => {
    expect(pivotSeries([])).toEqual([])
  })

  it('unions dates across series and uses null for missing values', () => {
    const a: DataSeries = {
      id: 'a',
      name: 'A',
      code: 'A',
      description: '',
      source: 'memory',
      points: [
        { date: new Date('2020-01-01'), value: 1 },
        { date: new Date('2020-02-01'), value: 2 },
        { date: new Date('2020-03-01'), value: 3 },
      ],
    }
    const b: DataSeries = {
      id: 'b',
      name: 'B',
      code: 'B',
      description: '',
      source: 'memory',
      points: [
        { date: new Date('2020-02-01'), value: 20 },
        { date: new Date('2020-03-01'), value: 30 },
      ],
    }
    const rows = pivotSeries([a, b])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ A: 1, B: null })
    expect(rows[1]).toMatchObject({ A: 2, B: 20 })
    expect(rows[2]).toMatchObject({ A: 3, B: 30 })
  })

  it('sorts rows by date ascending', () => {
    const a: DataSeries = {
      id: 'a',
      name: 'A',
      code: 'A',
      description: '',
      source: 'memory',
      points: [
        { date: new Date('2020-03-01'), value: 3 },
        { date: new Date('2020-01-01'), value: 1 },
      ],
    }
    const rows = pivotSeries([a])
    const dates = rows.map((r) => (r.date as Date).getTime())
    expect(dates).toEqual([...dates].sort((x, y) => x - y))
  })
})
