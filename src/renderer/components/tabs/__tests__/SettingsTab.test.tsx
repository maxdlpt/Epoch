// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsModal } from '../SettingsTab'
import { useAppStore } from '../../../store/app'
import { useDBStore } from '../../../store/db'

vi.mock('../../../lib/ipc', () => ({
  ipc: {
    dialog: { openDB: vi.fn() },
    external: { checkPath: vi.fn() },
    settings: { save: vi.fn() },
  },
}))

// Disable framer-motion animations so portalled content renders immediately
vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react')
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: new Proxy(actual.motion, {
      get(_target, prop) {
        // Return a simple forwardRef wrapper that strips motion props
        return ({ children, initial: _i, animate: _a, exit: _e, transition: _t, variants: _v, whileDrag: _w, layout: _l, ...rest }: any) => {
          const Tag = String(prop) as keyof JSX.IntrinsicElements
          return <Tag {...rest}>{children}</Tag>
        }
      },
    }),
  }
})

import { ipc } from '../../../lib/ipc'

beforeEach(() => {
  useAppStore.setState({ theme: 'system', colorPalette: 'default', settingsOpen: true })
  useDBStore.setState({ externalDBs: [] })
  vi.mocked(ipc.dialog.openDB).mockReset()
  vi.mocked(ipc.external.checkPath).mockReset()
  vi.mocked(ipc.settings.save).mockReset().mockResolvedValue(undefined)
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

describe('SettingsModal', () => {
  it('renders the modal with sidebar tabs when settingsOpen is true', () => {
    render(<SettingsModal />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeInTheDocument()
    // Sidebar has the three section buttons
    expect(screen.getByRole('button', { name: /accessibility/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /databases/i })).toBeInTheDocument()
  })

  it('does not render when settingsOpen is false', () => {
    useAppStore.setState({ settingsOpen: false })
    render(<SettingsModal />)
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
  })

  it('clicking a theme button updates useAppStore.theme', async () => {
    const user = userEvent.setup()
    render(<SettingsModal />)

    await user.click(screen.getByText('Themes'))
    await user.click(screen.getByRole('radio', { name: /dark/i }))
    expect(useAppStore.getState().theme).toBe('dark')

    await user.click(screen.getByRole('radio', { name: /light/i }))
    expect(useAppStore.getState().theme).toBe('light')
  })

  it('clicking a palette swatch updates useAppStore.colorPalette', async () => {
    const user = userEvent.setup()
    render(<SettingsModal />)

    await user.click(screen.getByText('Themes'))
    await user.click(screen.getByRole('button', { name: /palette-corporate/i }))
    expect(useAppStore.getState().colorPalette).toBe('corporate')
  })

  it('switching to Databases tab shows DB content', async () => {
    const user = userEvent.setup()
    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: /databases/i }))
    expect(screen.getByText(/no external databases configured/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse for db file/i })).toBeEnabled()
  })

  it('lists external DBs when switching to Databases tab', async () => {
    useDBStore.setState({
      externalDBs: [
        { id: 'a', name: 'Macro', path: 'C:/data/macro.db', reachable: true },
        { id: 'b', name: 'Prices', path: '/tmp/prices.db', reachable: false },
      ],
    })
    const user = userEvent.setup()
    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: /databases/i }))
    expect(screen.getByText('Macro')).toBeInTheDocument()
    expect(screen.getByText('Prices')).toBeInTheDocument()
  })

  it('browse cancel leaves store untouched', async () => {
    vi.mocked(ipc.dialog.openDB).mockResolvedValue(null)
    const user = userEvent.setup()
    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: /databases/i }))
    await user.click(screen.getByRole('button', { name: /browse for db file/i }))

    await waitFor(() => expect(ipc.dialog.openDB).toHaveBeenCalledTimes(1))
    expect(ipc.external.checkPath).not.toHaveBeenCalled()
    expect(useDBStore.getState().externalDBs).toHaveLength(0)
  })

  it('browse happy path: valid DB is added to the store', async () => {
    vi.mocked(ipc.dialog.openDB).mockResolvedValue('C:/data/macro.db')
    vi.mocked(ipc.external.checkPath).mockResolvedValue(true)
    const user = userEvent.setup()
    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: /databases/i }))
    await user.click(screen.getByRole('button', { name: /browse for db file/i }))

    await waitFor(() => expect(useDBStore.getState().externalDBs).toHaveLength(1))
    const added = useDBStore.getState().externalDBs[0]
    expect(added.path).toBe('C:/data/macro.db')
    expect(added.name).toBe('macro')
    expect(added.reachable).toBe(true)
  })

  it('switching to Accessibility tab shows graph functionality toggles', async () => {
    const user = userEvent.setup()
    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: /accessibility/i }))
    expect(screen.getByText(/always sync date windows/i)).toBeInTheDocument()
  })
})
