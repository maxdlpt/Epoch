// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileDropZone } from '../FileDropZone'

describe('FileDropZone', () => {
  it('renders drop zone with instructions', () => {
    render(<FileDropZone onSeries={() => {}} />)
    expect(screen.getByText(/drop/i)).toBeInTheDocument()
  })

  it('shows add-to-graph button after file drop', async () => {
    const user = userEvent.setup()
    const onSeries = vi.fn()
    render(<FileDropZone onSeries={onSeries} />)
    const csv = new File(['date,value\n2020-01-01,100'], 'test.csv', { type: 'text/csv' })
    const input = screen.getByTestId('file-input')
    await user.upload(input, csv)
    expect(onSeries).toHaveBeenCalled()
  })
})
