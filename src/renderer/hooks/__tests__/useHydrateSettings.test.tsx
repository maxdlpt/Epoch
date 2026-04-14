// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { waitFor } from '@testing-library/react'
import { useHydrateSettings } from '../useHydrateSettings'
import { useDBStore } from '../../store/db'
import { useAppStore } from '../../store/app'
import type { AppSettings } from '../../../shared/types'

// Mock the ipc module so we can drive settings.get returns per-test.
vi.mock('../../lib/ipc', () => ({
  ipc: {
    settings: { get: vi.fn() },
  },
}))

// Re-import after mock so mocks are accessible to assertions.
import { ipc } from '../../lib/ipc'

beforeEach(() => {
  // Default both stores to non-hydrated values so we can tell if setters fired.
  // settingsHydrated starts false — the hook flips it to true after a successful hydrate.
  useAppStore.setState({ theme: 'system', colorPalette: 'default', settingsHydrated: false })
  useDBStore.setState({ externalDBs: [] })
  vi.mocked(ipc.settings.get).mockReset()
})

describe('useHydrateSettings', () => {
  it('calls all three store setters with the persisted AppSettings on mount', async () => {
    const persisted: AppSettings = {
      theme: 'dark',
      colorPalette: 'viridis',
      externalDBs: [
        { id: 'a', name: 'prod', path: 'C:/a.db', reachable: true },
      ],
    }
    vi.mocked(ipc.settings.get).mockResolvedValue(persisted)

    renderHook(() => useHydrateSettings())

    await waitFor(() => {
      expect(useAppStore.getState().theme).toBe('dark')
      expect(useAppStore.getState().colorPalette).toBe('viridis')
      expect(useDBStore.getState().externalDBs).toEqual(persisted.externalDBs)
    })

    expect(ipc.settings.get).toHaveBeenCalledTimes(1)
  })

  it('sets settingsHydrated to true AFTER the three store setters fire', async () => {
    const persisted: AppSettings = {
      theme: 'dark',
      colorPalette: 'viridis',
      externalDBs: [{ id: 'a', name: 'prod', path: 'C:/a.db', reachable: true }],
    }
    vi.mocked(ipc.settings.get).mockResolvedValue(persisted)

    // Pre-condition — beforeEach seeds settingsHydrated: false
    expect(useAppStore.getState().settingsHydrated).toBe(false)

    renderHook(() => useHydrateSettings())

    await waitFor(() => {
      expect(useAppStore.getState().settingsHydrated).toBe(true)
    })
    // When the flag flips, the three setters MUST have already fired; anything
    // downstream that gates on `settingsHydrated === true` must be able to read
    // the hydrated values safely.
    expect(useAppStore.getState().theme).toBe('dark')
    expect(useAppStore.getState().colorPalette).toBe('viridis')
    expect(useDBStore.getState().externalDBs).toEqual(persisted.externalDBs)
  })

  it('handles empty externalDBs without crashing (setExternalDBs called with [])', async () => {
    const persisted: AppSettings = {
      theme: 'light',
      colorPalette: 'default',
      externalDBs: [],
    }
    vi.mocked(ipc.settings.get).mockResolvedValue(persisted)

    renderHook(() => useHydrateSettings())

    await waitFor(() => {
      expect(useAppStore.getState().theme).toBe('light')
    })
    expect(useDBStore.getState().externalDBs).toEqual([])
    // Empty-list hydrate still counts as hydrated — the user really has no DBs
    // configured, and sweep should be allowed to run (it'll no-op at line :24
    // of useStartupDBCheck.ts, which is correct behaviour).
    expect(useAppStore.getState().settingsHydrated).toBe(true)
  })

  it('does not call setters when unmounted before ipc.settings.get resolves', async () => {
    // Deferred resolver so we can unmount before get() returns.
    let resolveGet: (v: AppSettings) => void = () => {}
    vi.mocked(ipc.settings.get).mockImplementation(
      () => new Promise<AppSettings>((resolve) => {
        resolveGet = resolve
      }),
    )

    const { unmount } = renderHook(() => useHydrateSettings())
    unmount()

    // Now resolve the in-flight get with values that WOULD change the stores.
    resolveGet({
      theme: 'dark',
      colorPalette: 'viridis',
      externalDBs: [{ id: 'z', name: 'late', path: 'C:/z.db', reachable: true }],
    })
    await new Promise((r) => setTimeout(r, 20))

    // Stores remain at beforeEach defaults; unmount cancelled the write.
    expect(useAppStore.getState().theme).toBe('system')
    expect(useAppStore.getState().colorPalette).toBe('default')
    expect(useDBStore.getState().externalDBs).toEqual([])
    // Critical: settingsHydrated must NOT have been flipped — sweep must not
    // run on an unmounted boot (though in practice App.tsx doesn't unmount,
    // the guarantee matters for tests + future hot-reload boundaries).
    expect(useAppStore.getState().settingsHydrated).toBe(false)
  })

  it('swallows ipc.settings.get rejection without throwing (transport-level guard)', async () => {
    vi.mocked(ipc.settings.get).mockRejectedValue(new Error('IPC transport failure'))

    // If the hook didn't catch, this renderHook call would cause an unhandled
    // rejection that vitest flags. We also assert the stores stayed at defaults.
    renderHook(() => useHydrateSettings())
    await new Promise((r) => setTimeout(r, 20))

    expect(useAppStore.getState().theme).toBe('system')
    expect(useAppStore.getState().colorPalette).toBe('default')
    expect(useDBStore.getState().externalDBs).toEqual([])
    // On transport rejection, settingsHydrated MUST stay false — otherwise the
    // sweep would run against empty stores and save an empty config on top of
    // the persisted one. Keeping the flag false lets sweep no-op until a
    // successful hydrate completes (e.g. next boot when transport recovers).
    expect(useAppStore.getState().settingsHydrated).toBe(false)
  })
})
