// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsTab } from '../SettingsTab'
import { useAppStore } from '../../../store/app'
import { useDBStore } from '../../../store/db'

// Mock the ipc wrapper so we can drive dialog/checkPath/settings.save returns per-test.
vi.mock('../../../lib/ipc', () => ({
  ipc: {
    dialog: { openDB: vi.fn() },
    external: { checkPath: vi.fn() },
    settings: { save: vi.fn() },
  },
}))

// Re-import after mock so the mocked methods are accessible to assertions.
import { ipc } from '../../../lib/ipc'

beforeEach(() => {
  useAppStore.setState({ theme: 'system', colorPalette: 'default' })
  useDBStore.setState({ externalDBs: [] })
  vi.mocked(ipc.dialog.openDB).mockReset()
  vi.mocked(ipc.external.checkPath).mockReset()
  vi.mocked(ipc.settings.save).mockReset().mockResolvedValue(undefined)
  // jsdom doesn't implement matchMedia — the 'system' theme branch in
  // applyTheme reads it, so stub it as "light mode" for determinism.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

describe('SettingsTab', () => {
  it('renders the three sections (theme, palette, external DBs)', () => {
    render(<SettingsTab />)
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /theme/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /colou?r palette/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /external databases/i })).toBeInTheDocument()
  })

  it('clicking a theme button updates useAppStore.theme', async () => {
    const user = userEvent.setup()
    render(<SettingsTab />)

    await user.click(screen.getByRole('button', { name: /^dark$/i }))
    expect(useAppStore.getState().theme).toBe('dark')

    await user.click(screen.getByRole('button', { name: /^light$/i }))
    expect(useAppStore.getState().theme).toBe('light')
  })

  it('clicking a palette swatch updates useAppStore.colorPalette', async () => {
    const user = userEvent.setup()
    render(<SettingsTab />)

    await user.click(screen.getByRole('button', { name: /palette-pastel/i }))
    expect(useAppStore.getState().colorPalette).toBe('pastel')
  })

  it('renders the empty-state message when no external DBs are configured', () => {
    render(<SettingsTab />)
    expect(screen.getByText(/no external databases configured/i)).toBeInTheDocument()
  })

  it('lists external DBs from the db store', () => {
    useDBStore.setState({
      externalDBs: [
        { id: 'a', name: 'Macro', path: 'C:/data/macro.db', reachable: true },
        { id: 'b', name: 'Prices', path: '/tmp/prices.db', reachable: false },
      ],
    })
    render(<SettingsTab />)
    expect(screen.getByText('Macro')).toBeInTheDocument()
    expect(screen.getByText('C:/data/macro.db')).toBeInTheDocument()
    expect(screen.getByText('Prices')).toBeInTheDocument()
  })

  it('renders the "Browse for DB file" button enabled', () => {
    render(<SettingsTab />)
    const addButton = screen.getByRole('button', { name: /browse for db file/i })
    expect(addButton).toBeEnabled()
  })

  it('browse cancel (openDB returns null) leaves store and persistence untouched', async () => {
    vi.mocked(ipc.dialog.openDB).mockResolvedValue(null)
    const user = userEvent.setup()
    render(<SettingsTab />)

    await user.click(screen.getByRole('button', { name: /browse for db file/i }))

    // Dialog invoked, but nothing else.
    await waitFor(() => expect(ipc.dialog.openDB).toHaveBeenCalledTimes(1))
    expect(ipc.external.checkPath).not.toHaveBeenCalled()
    expect(ipc.settings.save).not.toHaveBeenCalled()
    expect(useDBStore.getState().externalDBs).toHaveLength(0)
  })

  it('browse happy path: valid DB is added to the store and persisted', async () => {
    vi.mocked(ipc.dialog.openDB).mockResolvedValue('C:/data/macro.db')
    vi.mocked(ipc.external.checkPath).mockResolvedValue(true)
    const user = userEvent.setup()
    render(<SettingsTab />)

    await user.click(screen.getByRole('button', { name: /browse for db file/i }))

    await waitFor(() => expect(useDBStore.getState().externalDBs).toHaveLength(1))
    const added = useDBStore.getState().externalDBs[0]
    expect(added.path).toBe('C:/data/macro.db')
    expect(added.name).toBe('macro')
    expect(added.reachable).toBe(true)
    expect(added.id).toMatch(/[0-9a-f-]{10,}/i) // crypto.randomUUID shape

    // Persisted via settings.save with the full AppSettings snapshot.
    expect(ipc.settings.save).toHaveBeenCalledWith({
      theme: 'system',
      colorPalette: 'default',
      externalDBs: [added],
    })

    // The new DB renders in the list.
    expect(screen.getByText('macro')).toBeInTheDocument()
    expect(screen.getByText('C:/data/macro.db')).toBeInTheDocument()
  })

  it('browse invalid DB: checkPath=false shows inline error, nothing added/persisted', async () => {
    vi.mocked(ipc.dialog.openDB).mockResolvedValue('/tmp/garbage.db')
    vi.mocked(ipc.external.checkPath).mockResolvedValue(false)
    const user = userEvent.setup()
    render(<SettingsTab />)

    await user.click(screen.getByRole('button', { name: /browse for db file/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/garbage\.db/i),
    )
    expect(useDBStore.getState().externalDBs).toHaveLength(0)
    expect(ipc.settings.save).not.toHaveBeenCalled()
  })
})
