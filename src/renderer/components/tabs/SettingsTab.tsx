import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, FolderOpen } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useDBStore } from '../../store/db'
import { PALETTES } from '../../lib/colors'
import { applyTheme } from '../../lib/theme'
import { ipc } from '../../lib/ipc'
import { Button } from '../ui/button'

type Theme = 'light' | 'dark' | 'system'
const THEMES: readonly Theme[] = ['light', 'dark', 'system']

// Derive a display name from the selected path: strip directory + ".db" suffix.
// Windows and POSIX separators both handled; falls back to "external" for empty basenames.
function deriveDBName(path: string): string {
  const basename = path.split(/[\\/]/).pop() ?? ''
  return basename.replace(/\.db$/i, '') || 'external'
}

export function SettingsTab() {
  const { theme, setTheme, colorPalette, setColorPalette } = useAppStore()
  const { externalDBs, addExternalDB } = useDBStore()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  async function handleBrowseForDB(): Promise<void> {
    setError(null)
    const path = await ipc.dialog.openDB()
    if (!path) return
    const reachable = await ipc.external.checkPath(path)
    if (!reachable) {
      const basename = path.split(/[\\/]/).pop() ?? path
      setError(`Couldn't open '${basename}' — not a valid TimeSeriesVisualiser database.`)
      return
    }
    const newDB = {
      id: crypto.randomUUID(),
      name: deriveDBName(path),
      path,
      reachable: true,
    }
    addExternalDB(newDB)
    // Persist the full AppSettings snapshot using the post-add store state.
    const dbsAfter = useDBStore.getState().externalDBs
    await ipc.settings.save({ theme, colorPalette, externalDBs: dbsAfter })
  }

  return (
    <div className="flex flex-col gap-10 p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h2>

      {/* Theme */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Theme</h3>
        <div className="flex gap-2">
          {THEMES.map(t => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`flex-1 rounded-lg border py-2 text-sm capitalize transition-colors ${
                theme === t
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {/* Color palette */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Colour palette</h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PALETTES).map(([key, colors]) => (
            <button
              key={key}
              aria-label={`palette-${key}`}
              onClick={() => setColorPalette(key)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                colorPalette === key
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <p className="text-xs font-medium capitalize mb-2 text-gray-900 dark:text-gray-100">{key}</p>
              <div className="flex gap-1">
                {colors.slice(0, 5).map(c => (
                  <span key={c} className="h-4 w-4 rounded-full" style={{ backgroundColor: c }} />
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="border-t border-gray-200 dark:border-gray-800" />

      {/* External DBs */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">External databases</h3>

        <div>
          <Button variant="outline" size="sm" onClick={handleBrowseForDB}>
            <FolderOpen className="h-4 w-4 mr-2" /> Browse for DB file
          </Button>
        </div>

        {error && (
          <p
            role="alert"
            className="text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <div className="space-y-2">
          {externalDBs.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">No external databases configured.</p>
          )}
          {externalDBs.map(db => (
            <div
              key={db.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3"
            >
              {db.reachable
                ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                : <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{db.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{db.path}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
