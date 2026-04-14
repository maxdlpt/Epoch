// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddLinePanel } from '../AddLinePanel'
import { useGraphStore } from '../../../store/graph'
import { useDBStore } from '../../../store/db'
import type { DBRecord, RawSeries } from '../../../../shared/types'

const MEMORY_RECORDS: DBRecord[] = [
  {
    id: 'm1',
    name: 'US CPI',
    code: 'USCPI',
    description: 'Consumer Price Index',
    startDate: '2020-01-01',
    endDate: '2020-03-01',
    pointCount: 3,
  },
  {
    id: 'm2',
    name: 'US GDP',
    code: 'USGDP',
    description: 'Gross Domestic Product',
    startDate: '2020-01-01',
    endDate: '2020-03-01',
    pointCount: 3,
  },
]

const EXTERNAL_RECORDS: DBRecord[] = [
  {
    id: 'e1',
    name: 'UK CPI',
    code: 'UKCPI',
    description: '',
    startDate: '2020-01-01',
    endDate: '2020-06-01',
    pointCount: 6,
  },
]

const RAW_SERIES: RawSeries = {
  id: 'm1',
  name: 'US CPI',
  code: 'USCPI',
  description: 'Consumer Price Index',
  points: [
    { date: '2020-01-01', value: 100 },
    { date: '2020-02-01', value: 110 },
    { date: '2020-03-01', value: 120 },
  ],
}

beforeEach(() => {
  useGraphStore.setState({ activeSeries: [], zoomDomain: null, rightPanel: 'addLine' })
  useDBStore.setState({ externalDBs: [] })
  // Default mocks: memory has 2 records, external has 1; single series fetch returns RAW_SERIES.
  ;(globalThis as unknown as { window: { tsv: unknown } }).window.tsv = {
    memory: {
      listSeries: vi.fn().mockResolvedValue(MEMORY_RECORDS),
      getSeries: vi.fn().mockResolvedValue(RAW_SERIES),
    },
    external: {
      listSeries: vi.fn().mockResolvedValue(EXTERNAL_RECORDS),
      getSeries: vi.fn().mockResolvedValue(RAW_SERIES),
    },
  } as unknown as typeof window.tsv
})

describe('AddLinePanel', () => {
  it('renders Add Line heading and close button', async () => {
    render(<AddLinePanel />)
    expect(screen.getByText(/add line/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/close add line panel/i)).toBeInTheDocument()
  })

  it('lists memory-DB series on mount', async () => {
    render(<AddLinePanel />)
    await waitFor(() => {
      expect(screen.getByText('US CPI')).toBeInTheDocument()
      expect(screen.getByText('US GDP')).toBeInTheDocument()
    })
  })

  it('filters the list by search input', async () => {
    const user = userEvent.setup()
    render(<AddLinePanel />)
    await waitFor(() => expect(screen.getByText('US CPI')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText(/search/i), 'GDP')
    expect(screen.queryByText('US CPI')).not.toBeInTheDocument()
    expect(screen.getByText('US GDP')).toBeInTheDocument()
  })

  it('clicking a series adds it to activeSeries via ipc.memory.getSeries', async () => {
    const user = userEvent.setup()
    render(<AddLinePanel />)
    await waitFor(() => expect(screen.getByText('US CPI')).toBeInTheDocument())

    await user.click(screen.getByText('US CPI'))

    await waitFor(() => {
      const active = useGraphStore.getState().activeSeries
      expect(active).toHaveLength(1)
      expect(active[0].id).toBe('m1')
      expect(active[0].source).toBe('memory')
      // Points should be rehydrated as Date objects (not ISO strings).
      expect(active[0].points[0].date).toBeInstanceOf(Date)
      expect(active[0].points[0].value).toBe(100)
    })
  })

  it('switching to an external DB fetches from ipc.external.listSeries', async () => {
    useDBStore.setState({
      externalDBs: [{ id: 'db-1', name: 'Macro', path: '/tmp/macro.db', reachable: true }],
    })
    const user = userEvent.setup()
    render(<AddLinePanel />)
    await waitFor(() => expect(screen.getByText('US CPI')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /macro/i }))

    await waitFor(() => {
      expect(screen.getByText('UK CPI')).toBeInTheDocument()
      expect(screen.queryByText('US CPI')).not.toBeInTheDocument()
    })
    expect(window.tsv.external.listSeries).toHaveBeenCalledWith('/tmp/macro.db')
  })

  it('unreachable external DBs are not offered as sources', async () => {
    useDBStore.setState({
      externalDBs: [
        { id: 'db-up', name: 'UpDB', path: '/tmp/up.db', reachable: true },
        { id: 'db-down', name: 'DownDB', path: '/tmp/down.db', reachable: false },
      ],
    })
    render(<AddLinePanel />)
    expect(screen.getByRole('button', { name: /updb/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /downdb/i })).not.toBeInTheDocument()
  })

  it('close button clears rightPanel in store', async () => {
    const user = userEvent.setup()
    render(<AddLinePanel />)
    await user.click(screen.getByLabelText(/close add line panel/i))
    expect(useGraphStore.getState().rightPanel).toBeNull()
  })

  it('does not re-add a series that is already on the chart', async () => {
    const user = userEvent.setup()
    render(<AddLinePanel />)
    await waitFor(() => expect(screen.getByText('US CPI')).toBeInTheDocument())

    // Click twice rapidly.
    await user.click(screen.getByText('US CPI'))
    await waitFor(() => expect(useGraphStore.getState().activeSeries).toHaveLength(1))
    await user.click(screen.getByText('US CPI'))

    // The graph store's addSeries is already idempotent on id, so this just confirms
    // the panel does not throw or duplicate.
    expect(useGraphStore.getState().activeSeries).toHaveLength(1)
  })
})
