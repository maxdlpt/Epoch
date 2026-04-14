import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useGraphStore } from '../graph'
import type { DataSeries } from '../../../shared/types'

const SERIES: DataSeries = {
  id: 's1', name: 'CPI', code: 'CPI', description: '', source: 'memory',
  points: [{ date: new Date('2020-01-01'), value: 257 }],
}

beforeEach(() => {
  useGraphStore.setState({ activeSeries: [], zoomDomain: null, rightPanel: null })
})

describe('useGraphStore', () => {
  it('adds a series', () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    expect(useGraphStore.getState().activeSeries).toHaveLength(1)
  })

  it('removes a series by id', () => {
    act(() => useGraphStore.getState().addSeries(SERIES))
    act(() => useGraphStore.getState().removeSeries('s1'))
    expect(useGraphStore.getState().activeSeries).toHaveLength(0)
  })

  it('sets zoom domain', () => {
    const domain = { start: new Date('2020-01-01'), end: new Date('2021-01-01') }
    act(() => useGraphStore.getState().setZoomDomain(domain))
    expect(useGraphStore.getState().zoomDomain).toEqual(domain)
  })
})
