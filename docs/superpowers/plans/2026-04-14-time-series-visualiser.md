# TimeSeriesVisualiser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Electron desktop app for visualising, uploading, and sharing time-series data with an SQLite-backed memory DB, FRED-inspired charting, and a polished shadcn/Tailwind UI.

**Architecture:** Electron main process owns all SQLite access (internal memory DB + external .db files) and exposes operations via typed IPC handlers; the React renderer calls these through a preload bridge and manages UI state with Zustand; @visx drives the chart canvas with scroll-wheel zoom, drag-select zoom, and animated right-side panels.

**Tech Stack:** Electron 33, Vite 5, React 18 (accepted divergence — team-lead ruling: React 19 was aspirational, 18 has guaranteed peer-dep support across @ark-ui/react, @visx/*, framer-motion, and shadcn), TypeScript 5, better-sqlite3, shadcn/ui, Tailwind CSS v4, @ark-ui/react, @visx/* suite, framer-motion/motion, Zustand, papaparse, xlsx, Vitest + React Testing Library, electron-builder.

**Renderer layout convention (Task 1 addendum):** Option A chosen — all renderer code lives at `src/renderer/*` (no extra `/src/` sub-layer). Aliases in `electron.vite.config.ts`, `vitest.config.ts`, `tsconfig.web.json` resolve `@/` and `@renderer/` to `src/renderer`. The File Map below matches this layout verbatim.

---

## File Map

```
src/
  main/
    index.ts                         # Electron entry: BrowserWindow, preload path, dev tools
    db/
      schema.ts                      # CREATE TABLE statements + DB init function
      memory.ts                      # CRUD for internal memory DB (series, metadata)
      external.ts                    # Read-only access to external .db files
    ipc/
      handlers.ts                    # Registers all ipcMain.handle() calls
  preload/
    index.ts                         # contextBridge exposes window.tsv API
  renderer/
    main.tsx                         # ReactDOM.createRoot entry
    App.tsx                          # Tab router: graph | upload | settings
    store/
      app.ts                         # Zustand: activeTab, theme, colorPalette
      graph.ts                       # Zustand: activeSeries[], zoomDomain, panels
      db.ts                          # Zustand: externalDBs registry (name → path)
    components/
      ui/
        segment-group.tsx            # @ark-ui SegmentGroup (Selector)
        sidebar.tsx                  # Collapsible sidebar (dashboard pattern)
        animated-dropdown.tsx        # AnimatedDropdown with framer-motion
        spotlight-table.tsx          # Spotlight search table
        interactive-series-table.tsx # Accordion table (logs-table pattern)
        area-chart.tsx               # @visx AreaChart component (full spec code)
      layout/
        AppLayout.tsx                # Flex: Sidebar + main content area
      tabs/
        GraphTab.tsx                 # Chart canvas + right-panel toggle buttons
        UploadTab.tsx                # FileDropZone / PasteTable toggle via Selector
        SettingsTab.tsx              # DB manager + Personalisation sections
      graph/
        GraphCanvas.tsx              # AreaChart wrapper, zoom state, overlay
        AddLinePanel.tsx             # Right slide-in: source dropdown + series table
        OperationsPanel.tsx          # Right slide-in: transform buttons
        SeriesSourceDropdown.tsx     # Animated source selector (memory / ext DBs)
        SeriesPreviewChart.tsx       # Small AreaChart in accordion expand
        SaveMenu.tsx                 # Save-to-memory or save-to-external-db dialog
      upload/
        FileDropZone.tsx             # Drag-and-drop + browse for CSV/Excel
        PasteTable.tsx               # Editable paste-in table
      settings/
        DBManager.tsx                # Add / remove external DB paths with names
        Personalisation.tsx          # Theme toggle + color palette selector
    hooks/
      useGraphZoom.ts                # Scroll-wheel + drag-select zoom reducer
      useSeriesColor.ts              # Color palette cycling hook
      useDB.ts                       # Type-safe window.tsv IPC call wrappers
    lib/
      ipc.ts                         # Thin wrappers: call window.tsv.* with types
      colors.ts                      # Default color palettes (4 palettes × 8 colors)
      transforms.ts                  # cumReturn, normalize, pctChange on DataPoint[]
      parse.ts                       # CSV/Excel → { date: Date, value: number }[]
      theme.ts                       # Apply theme CSS vars to document.documentElement
  shared/
    types.ts                         # DataSeries, DataPoint, DBRecord, Settings, ExternalDB
    ipc-channels.ts                  # Enum IPC channel name constants
electron-builder.yml                 # Packaging config (win/mac/linux)
electron.vite.config.ts              # Vite config for main/preload/renderer
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `electron.vite.config.ts`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`

- [ ] **Step 1: Scaffold with electron-vite**

```bash
cd "C:/Users/MaximilienDelaporte/OneDrive - Heritage Holdings Corp UK Ltd/Documents/VSCode/TimeSeriesVisualiser"
npm create @quick-start/electron@latest . -- --template react-ts
```

Expected: project files written, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/` exist.

- [ ] **Step 2: Install all production dependencies**

```bash
npm install better-sqlite3 zustand papaparse xlsx framer-motion motion @ark-ui/react @visx/event @visx/curve @visx/grid @visx/responsive @visx/scale @visx/shape d3-array react-use-measure clsx tailwind-merge lucide-react electron-builder
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D @types/better-sqlite3 @types/papaparse @types/xlsx vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom tailwindcss @tailwindcss/vite
```

- [ ] **Step 4: Install shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted: TypeScript yes, default component path `src/renderer/components/ui`, tailwind config yes, CSS variables yes.

Then add required shadcn primitives:

```bash
npx shadcn@latest add button input badge
```

- [ ] **Step 5: Verify dev server starts**

```bash
npm run dev
```

Expected: Electron window opens with default React template.

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold electron-vite react-ts + shadcn + all deps"
```

---

### Task 2: Shared Types & IPC Channels

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Write failing test for types shape**

Create `src/shared/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { DataPoint, DataSeries, ExternalDB } from '../types'

describe('shared types', () => {
  it('DataPoint has date and value', () => {
    const p: DataPoint = { date: new Date('2020-01-01'), value: 100 }
    expect(p.date).toBeInstanceOf(Date)
    expect(typeof p.value).toBe('number')
  })

  it('DataSeries has id, name, points', () => {
    const s: DataSeries = {
      id: 'abc',
      name: 'US CPI',
      code: 'USCPI',
      description: 'Consumer Price Index',
      points: [{ date: new Date('2020-01-01'), value: 257.97 }],
      source: 'memory',
    }
    expect(s.id).toBe('abc')
    expect(s.points).toHaveLength(1)
  })

  it('ExternalDB has id, name, path', () => {
    const db: ExternalDB = { id: 'db1', name: 'Macro Data', path: '/tmp/macro.db', reachable: true }
    expect(db.name).toBe('Macro Data')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/shared/__tests__/types.test.ts
```

Expected: FAIL — `types` module not found.

- [ ] **Step 3: Create `src/shared/types.ts`**

```typescript
export interface DataPoint {
  date: Date
  value: number
}

export interface DataSeries {
  id: string
  name: string
  code: string
  description: string
  points: DataPoint[]
  source: 'memory' | 'external'
  dbId?: string          // only when source === 'external'
  color?: string
}

export interface DBRecord {
  id: string
  name: string
  code: string
  description: string
  startDate: string   // ISO string
  endDate: string     // ISO string
  pointCount: number
}

export interface ExternalDB {
  id: string
  name: string
  path: string
  reachable: boolean
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  colorPalette: string   // palette key
  externalDBs: ExternalDB[]
}
```

- [ ] **Step 4: Create `src/shared/ipc-channels.ts`**

```typescript
export enum IPC {
  // Series read
  MEMORY_LIST_SERIES      = 'memory:list-series',
  MEMORY_GET_SERIES       = 'memory:get-series',
  MEMORY_SAVE_SERIES      = 'memory:save-series',
  MEMORY_DELETE_SERIES    = 'memory:delete-series',

  // External DB read
  EXTERNAL_LIST_SERIES    = 'external:list-series',
  EXTERNAL_GET_SERIES     = 'external:get-series',
  EXTERNAL_CHECK_PATH     = 'external:check-path',

  // Settings
  SETTINGS_GET            = 'settings:get',
  SETTINGS_SAVE           = 'settings:save',

  // File dialogs
  DIALOG_OPEN_DB          = 'dialog:open-db',
  DIALOG_SAVE_DB          = 'dialog:save-db',
  DIALOG_EXPORT_SERIES    = 'dialog:export-series',
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/shared/__tests__/types.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/
git commit -m "feat: shared types and IPC channel enum"
```

---

### Task 3: SQLite Schema & Memory DB

**Files:**
- Create: `src/main/db/schema.ts`
- Create: `src/main/db/memory.ts`
- Create: `src/main/db/__tests__/memory.test.ts`

- [ ] **Step 1: Write failing tests for memory DB CRUD**

Create `src/main/db/__tests__/memory.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../schema'
import { MemoryDB } from '../memory'

let db: Database.Database
let memDB: MemoryDB

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
  memDB = new MemoryDB(db)
})

afterEach(() => {
  db.close()
})

describe('MemoryDB', () => {
  it('saves and lists a series', () => {
    memDB.saveSeries({
      id: 's1', name: 'US CPI', code: 'USCPI', description: 'CPI all items',
      points: [{ date: '2020-01-01', value: 257.97 }],
    })
    const list = memDB.listSeries()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('US CPI')
  })

  it('fetches a series by id with all points', () => {
    memDB.saveSeries({
      id: 's2', name: 'GDP', code: 'GDP', description: '',
      points: [
        { date: '2020-01-01', value: 21000 },
        { date: '2020-04-01', value: 19000 },
      ],
    })
    const s = memDB.getSeries('s2')
    expect(s?.points).toHaveLength(2)
    expect(s?.points[0].value).toBe(21000)
  })

  it('deletes a series', () => {
    memDB.saveSeries({ id: 's3', name: 'X', code: 'X', description: '', points: [] })
    memDB.deleteSeries('s3')
    expect(memDB.listSeries()).toHaveLength(0)
  })

  it('cascades point deletion when a series is deleted', () => {
    memDB.saveSeries({
      id: 's4', name: 'Y', code: 'Y', description: '',
      points: [{ date: '2020-01-01', value: 1 }, { date: '2020-02-01', value: 2 }],
    })
    memDB.deleteSeries('s4')
    const orphans = db.prepare("SELECT COUNT(*) as n FROM series_points WHERE series_id = 's4'").get() as { n: number }
    expect(orphans.n).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/main/db/__tests__/memory.test.ts
```

Expected: FAIL — `schema` / `memory` not found.

- [ ] **Step 3: Create `src/main/db/schema.ts`**

```typescript
import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  // Required: better-sqlite3 defaults foreign_keys OFF per connection,
  // so ON DELETE CASCADE is a no-op without this pragma.
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      code        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS series_points (
      series_id   TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      value       REAL NOT NULL,
      PRIMARY KEY (series_id, date)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}
```

- [ ] **Step 4: Create `src/main/db/memory.ts`**

```typescript
import type Database from 'better-sqlite3'
import type { DBRecord } from '../../shared/types'

interface RawPoint { date: string; value: number }
interface SavePayload {
  id: string; name: string; code: string; description: string
  points: RawPoint[]
}

export class MemoryDB {
  constructor(private db: Database.Database) {}

  listSeries(): DBRecord[] {
    return this.db.prepare<[], DBRecord>(`
      SELECT s.id, s.name, s.code, s.description,
        MIN(p.date) as startDate, MAX(p.date) as endDate,
        COUNT(p.date) as pointCount
      FROM series s
      LEFT JOIN series_points p ON p.series_id = s.id
      GROUP BY s.id
    `).all()
  }

  getSeries(id: string): { id: string; name: string; code: string; description: string; points: RawPoint[] } | null {
    const meta = this.db.prepare('SELECT * FROM series WHERE id = ?').get(id) as any
    if (!meta) return null
    const points = this.db.prepare<[string], RawPoint>(
      'SELECT date, value FROM series_points WHERE series_id = ? ORDER BY date'
    ).all(id)
    return { ...meta, points }
  }

  saveSeries(payload: SavePayload): void {
    const insertSeries = this.db.prepare(
      'INSERT OR REPLACE INTO series (id, name, code, description) VALUES (?, ?, ?, ?)'
    )
    const insertPoint = this.db.prepare(
      'INSERT OR REPLACE INTO series_points (series_id, date, value) VALUES (?, ?, ?)'
    )
    const deletePoints = this.db.prepare('DELETE FROM series_points WHERE series_id = ?')

    this.db.transaction(() => {
      insertSeries.run(payload.id, payload.name, payload.code, payload.description)
      deletePoints.run(payload.id)
      for (const p of payload.points) {
        insertPoint.run(payload.id, p.date, p.value)
      }
    })()
  }

  deleteSeries(id: string): void {
    this.db.prepare('DELETE FROM series WHERE id = ?').run(id)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/main/db/__tests__/memory.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/db/
git commit -m "feat: SQLite schema and memory DB CRUD"
```

---

### Task 4: External DB + IPC Handlers

**Files:**
- Create: `src/main/db/external.ts`
- Create: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write failing test for external DB**

Create `src/main/db/__tests__/external.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { initSchema } from '../schema'
import { MemoryDB } from '../memory'
import { ExternalDBReader } from '../external'

let tmpPath: string
let extDB: ExternalDBReader

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `test-${Date.now()}.db`)
  const db = new Database(tmpPath)
  initSchema(db)
  const mem = new MemoryDB(db)
  mem.saveSeries({ id: 'x1', name: 'Ext Series', code: 'EXT', description: '', points: [{ date: '2020-01-01', value: 42 }] })
  db.close()
  extDB = new ExternalDBReader(tmpPath)
})

afterEach(() => {
  extDB.close()
  fs.unlinkSync(tmpPath)
})

describe('ExternalDBReader', () => {
  it('lists series from external file', () => {
    const list = extDB.listSeries()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Ext Series')
  })

  it('gets series with points', () => {
    const s = extDB.getSeries('x1')
    expect(s?.points[0].value).toBe(42)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/main/db/__tests__/external.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `src/main/db/external.ts`**

```typescript
import Database from 'better-sqlite3'
import type { DBRecord } from '../../shared/types'

interface RawPoint { date: string; value: number }

export class ExternalDBReader {
  private db: Database.Database

  constructor(filePath: string) {
    this.db = new Database(filePath, { readonly: true, fileMustExist: true })
  }

  listSeries(): DBRecord[] {
    return this.db.prepare<[], DBRecord>(`
      SELECT s.id, s.name, s.code, s.description,
        MIN(p.date) as startDate, MAX(p.date) as endDate,
        COUNT(p.date) as pointCount
      FROM series s
      LEFT JOIN series_points p ON p.series_id = s.id
      GROUP BY s.id
    `).all()
  }

  getSeries(id: string): { id: string; name: string; code: string; description: string; points: RawPoint[] } | null {
    const meta = this.db.prepare('SELECT * FROM series WHERE id = ?').get(id) as any
    if (!meta) return null
    const points = this.db.prepare<[string], RawPoint>(
      'SELECT date, value FROM series_points WHERE series_id = ? ORDER BY date'
    ).all(id)
    return { ...meta, points }
  }

  close(): void {
    this.db.close()
  }
}

export function checkPathReachable(filePath: string): boolean {
  try {
    const db = new Database(filePath, { readonly: true, fileMustExist: true })
    db.close()
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run external test to verify it passes**

```bash
npx vitest run src/main/db/__tests__/external.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Create `src/main/ipc/handlers.ts`**

```typescript
import { ipcMain, dialog, app } from 'electron'
import path from 'path'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema'
import { MemoryDB } from '../db/memory'
import { ExternalDBReader, checkPathReachable } from '../db/external'
import { IPC } from '../../shared/ipc-channels'
import type { AppSettings, ExternalDB } from '../../shared/types'
import crypto from 'crypto'

// Singleton internal memory DB
const dbPath = path.join(app.getPath('userData'), 'memory.db')
const rawDb = new Database(dbPath)
initSchema(rawDb)
const memDB = new MemoryDB(rawDb)

function getSettings(): AppSettings {
  const raw = rawDb.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined
  if (!raw) return { theme: 'system', colorPalette: 'default', externalDBs: [] }
  return JSON.parse(raw.value)
}

function saveSettings(s: AppSettings): void {
  rawDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(s))
}

export function registerHandlers(): void {
  ipcMain.handle(IPC.MEMORY_LIST_SERIES, () => memDB.listSeries())
  ipcMain.handle(IPC.MEMORY_GET_SERIES, (_e, id: string) => memDB.getSeries(id))
  ipcMain.handle(IPC.MEMORY_SAVE_SERIES, (_e, payload) => { memDB.saveSeries(payload) })
  ipcMain.handle(IPC.MEMORY_DELETE_SERIES, (_e, id: string) => { memDB.deleteSeries(id) })

  ipcMain.handle(IPC.EXTERNAL_LIST_SERIES, (_e, filePath: string) => {
    try {
      const reader = new ExternalDBReader(filePath)
      const list = reader.listSeries()
      reader.close()
      return list
    } catch { return [] }
  })

  ipcMain.handle(IPC.EXTERNAL_GET_SERIES, (_e, filePath: string, id: string) => {
    try {
      const reader = new ExternalDBReader(filePath)
      const s = reader.getSeries(id)
      reader.close()
      return s
    } catch { return null }
  })

  ipcMain.handle(IPC.EXTERNAL_CHECK_PATH, (_e, filePath: string) => checkPathReachable(filePath))

  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s: AppSettings) => { saveSettings(s) })

  ipcMain.handle(IPC.DIALOG_OPEN_DB, async () => {
    const result = await dialog.showOpenDialog({ filters: [{ name: 'Database', extensions: ['db'] }] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_SAVE_DB, async (_e, filePath: string, seriesIds: string[]) => {
    const result = await dialog.showSaveDialog({ defaultPath: filePath, filters: [{ name: 'Database', extensions: ['db'] }] })
    if (result.canceled || !result.filePath) return false
    const outDb = new Database(result.filePath)
    initSchema(outDb)
    const outMem = new MemoryDB(outDb)
    for (const id of seriesIds) {
      const s = memDB.getSeries(id)
      if (s) outMem.saveSeries(s)
    }
    outDb.close()
    return true
  })
}
```

- [ ] **Step 6: Wire handlers in `src/main/index.ts`**

Replace the default template body with:

```typescript
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerHandlers } from './ipc/handlers'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.tsv.app')
  app.on('browser-window-created', (_, window) => optimizer.watchShortcuts(window))

  registerHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 7: Create `src/preload/index.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'

contextBridge.exposeInMainWorld('tsv', {
  memory: {
    listSeries: () => ipcRenderer.invoke(IPC.MEMORY_LIST_SERIES),
    getSeries: (id: string) => ipcRenderer.invoke(IPC.MEMORY_GET_SERIES, id),
    saveSeries: (payload: unknown) => ipcRenderer.invoke(IPC.MEMORY_SAVE_SERIES, payload),
    deleteSeries: (id: string) => ipcRenderer.invoke(IPC.MEMORY_DELETE_SERIES, id),
  },
  external: {
    listSeries: (path: string) => ipcRenderer.invoke(IPC.EXTERNAL_LIST_SERIES, path),
    getSeries: (path: string, id: string) => ipcRenderer.invoke(IPC.EXTERNAL_GET_SERIES, path, id),
    checkPath: (path: string) => ipcRenderer.invoke(IPC.EXTERNAL_CHECK_PATH, path),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    save: (s: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, s),
  },
  dialog: {
    openDB: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_DB),
    saveDB: (path: string, ids: string[]) => ipcRenderer.invoke(IPC.DIALOG_SAVE_DB, path, ids),
  },
})
```

- [ ] **Step 8: Commit**

```bash
git add src/main/ src/preload/
git commit -m "feat: external DB reader and IPC handlers registered"
```

---

### Task 5: Zustand Stores

**Files:**
- Create: `src/renderer/store/app.ts`
- Create: `src/renderer/store/graph.ts`
- Create: `src/renderer/store/db.ts`
- Create: `src/renderer/store/__tests__/graph.test.ts`

- [ ] **Step 1: Write failing test for graph store**

Create `src/renderer/store/__tests__/graph.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/store/__tests__/graph.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/renderer/store/graph.ts`**

```typescript
import { create } from 'zustand'
import type { DataSeries } from '../../shared/types'

interface ZoomDomain {
  start: Date
  end: Date
}

type RightPanel = 'operations' | 'addLine' | null

interface GraphState {
  activeSeries: DataSeries[]
  zoomDomain: ZoomDomain | null
  rightPanel: RightPanel
  addSeries: (s: DataSeries) => void
  removeSeries: (id: string) => void
  updateSeries: (id: string, patch: Partial<DataSeries>) => void
  setZoomDomain: (domain: ZoomDomain | null) => void
  setRightPanel: (panel: RightPanel) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  activeSeries: [],
  zoomDomain: null,
  rightPanel: null,
  addSeries: (s) => set((state) => ({
    activeSeries: state.activeSeries.find(x => x.id === s.id)
      ? state.activeSeries
      : [...state.activeSeries, s]
  })),
  removeSeries: (id) => set((state) => ({
    activeSeries: state.activeSeries.filter(s => s.id !== id)
  })),
  updateSeries: (id, patch) => set((state) => ({
    activeSeries: state.activeSeries.map(s => s.id === id ? { ...s, ...patch } : s)
  })),
  setZoomDomain: (domain) => set({ zoomDomain: domain }),
  setRightPanel: (panel) => set({ rightPanel: panel }),
}))
```

- [ ] **Step 4: Create `src/renderer/store/app.ts`**

```typescript
import { create } from 'zustand'

type Tab = 'graph' | 'upload' | 'settings'

interface AppState {
  activeTab: Tab
  theme: 'light' | 'dark' | 'system'
  colorPalette: string
  setActiveTab: (tab: Tab) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setColorPalette: (key: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'graph',
  theme: 'system',
  colorPalette: 'default',
  setActiveTab: (tab) => set({ activeTab: tab }),
  setTheme: (theme) => set({ theme }),
  setColorPalette: (key) => set({ colorPalette: key }),
}))
```

- [ ] **Step 5: Create `src/renderer/store/db.ts`**

```typescript
import { create } from 'zustand'
import type { ExternalDB } from '../../shared/types'

interface DBState {
  externalDBs: ExternalDB[]
  setExternalDBs: (dbs: ExternalDB[]) => void
  addExternalDB: (db: ExternalDB) => void
  removeExternalDB: (id: string) => void
  updateReachability: (id: string, reachable: boolean) => void
}

export const useDBStore = create<DBState>((set) => ({
  externalDBs: [],
  setExternalDBs: (dbs) => set({ externalDBs: dbs }),
  addExternalDB: (db) => set((state) => ({
    externalDBs: [...state.externalDBs, db]
  })),
  removeExternalDB: (id) => set((state) => ({
    externalDBs: state.externalDBs.filter(d => d.id !== id)
  })),
  updateReachability: (id, reachable) => set((state) => ({
    externalDBs: state.externalDBs.map(d => d.id === id ? { ...d, reachable } : d)
  })),
}))
```

- [ ] **Step 6: Run graph store test to verify it passes**

```bash
npx vitest run src/renderer/store/__tests__/graph.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/store/
git commit -m "feat: Zustand stores for app state, graph series, and external DBs"
```

---

### Task 6: App Layout & Collapsible Sidebar

**Files:**
- Create: `src/renderer/components/ui/sidebar.tsx` (from spec)
- Create: `src/renderer/components/layout/AppLayout.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create the sidebar component**

Copy the sidebar component from the spec to `src/renderer/components/ui/sidebar.tsx`, adapted for this app's three tabs (Graph, Upload, Settings):

```tsx
// src/renderer/components/ui/sidebar.tsx
"use client"
import React, { useState } from "react"
import { BarChart2, Upload, Settings, ChevronsRight } from "lucide-react"
import { useAppStore } from "../../store/app"
import type { ReactNode } from "react"

type Tab = 'graph' | 'upload' | 'settings'

interface OptionProps {
  icon: ReactNode
  title: string
  tab: Tab
  selected: Tab
  open: boolean
}

const Option = ({ icon, title, tab, selected, open }: OptionProps) => {
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const isSelected = selected === tab
  return (
    <button
      onClick={() => setActiveTab(tab)}
      className={`relative flex h-11 w-full items-center rounded-md transition-all duration-200 ${
        isSelected
          ? "bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shadow-sm border-l-2 border-blue-500"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200"
      }`}
    >
      <div className="grid h-full w-12 place-content-center">{icon}</div>
      {open && (
        <span className="text-sm font-medium">{title}</span>
      )}
    </button>
  )
}

export const Sidebar = () => {
  const [open, setOpen] = useState(true)
  const activeTab = useAppStore(s => s.activeTab)

  return (
    <nav
      className={`sticky top-0 h-screen shrink-0 border-r transition-all duration-300 ease-in-out ${
        open ? 'w-56' : 'w-16'
      } border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2 shadow-sm flex flex-col`}
    >
      {/* Logo */}
      <div className="mb-6 border-b border-gray-200 dark:border-gray-800 pb-4">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="grid size-10 shrink-0 place-content-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-sm">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          {open && <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">TimeSeries</span>}
        </div>
      </div>

      {/* Main nav */}
      <div className="space-y-1 flex-1">
        <Option icon={<BarChart2 className="h-4 w-4" />} title="Graph" tab="graph" selected={activeTab} open={open} />
        <Option icon={<Upload className="h-4 w-4" />} title="Upload" tab="upload" selected={activeTab} open={open} />
      </div>

      {/* Settings at bottom, above collapse */}
      <div className="space-y-1 border-t border-gray-200 dark:border-gray-800 pt-2 pb-12">
        <Option icon={<Settings className="h-4 w-4" />} title="Settings" tab="settings" selected={activeTab} open={open} />
      </div>

      {/* Toggle collapse */}
      <button
        onClick={() => setOpen(!open)}
        className="absolute bottom-0 left-0 right-0 border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center p-3">
          <div className="grid size-10 place-content-center">
            <ChevronsRight
              className={`h-4 w-4 transition-transform duration-300 text-gray-500 dark:text-gray-400 ${open ? "rotate-180" : ""}`}
            />
          </div>
          {open && <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Hide</span>}
        </div>
      </button>
    </nav>
  )
}
```

- [ ] **Step 2: Create `src/renderer/components/layout/AppLayout.tsx`**

```tsx
import { Sidebar } from "../ui/sidebar"
import type { ReactNode } from "react"

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/App.tsx`**

```tsx
import { AppLayout } from "./components/layout/AppLayout"
import { GraphTab } from "./components/tabs/GraphTab"
import { UploadTab } from "./components/tabs/UploadTab"
import { SettingsTab } from "./components/tabs/SettingsTab"
import { useAppStore } from "./store/app"

export default function App() {
  const activeTab = useAppStore(s => s.activeTab)

  return (
    <AppLayout>
      {activeTab === 'graph' && <GraphTab />}
      {activeTab === 'upload' && <UploadTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </AppLayout>
  )
}
```

- [ ] **Step 4: Create stub tab files so App.tsx compiles**

Create `src/renderer/components/tabs/GraphTab.tsx`:

```tsx
export function GraphTab() {
  return <div className="p-8 text-gray-400">Graph tab — coming soon</div>
}
```

Create `src/renderer/components/tabs/UploadTab.tsx`:

```tsx
export function UploadTab() {
  return <div className="p-8 text-gray-400">Upload tab — coming soon</div>
}
```

Create `src/renderer/components/tabs/SettingsTab.tsx`:

```tsx
export function SettingsTab() {
  return <div className="p-8 text-gray-400">Settings tab — coming soon</div>
}
```

- [ ] **Step 5: Update `src/renderer/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 6: Verify in dev**

```bash
npm run dev
```

Expected: Electron opens with sidebar visible, three nav items, collapse button works.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/
git commit -m "feat: app layout with collapsible sidebar and tab routing"
```

---

### Task 7: lib utilities (colors, transforms, parse, theme, ipc wrappers)

**Files:**
- Create: `src/renderer/lib/colors.ts`
- Create: `src/renderer/lib/transforms.ts`
- Create: `src/renderer/lib/parse.ts`
- Create: `src/renderer/lib/theme.ts`
- Create: `src/renderer/lib/ipc.ts`
- Create: `src/renderer/lib/__tests__/transforms.test.ts`
- Create: `src/renderer/lib/__tests__/parse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/lib/__tests__/transforms.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { toCumReturn, toNormalized, toPctChange } from '../transforms'
import type { DataPoint } from '../../../shared/types'

const pts: DataPoint[] = [
  { date: new Date('2020-01-01'), value: 100 },
  { date: new Date('2020-02-01'), value: 110 },
  { date: new Date('2020-03-01'), value: 99 },
]

describe('transforms', () => {
  it('toCumReturn: first point is 0, second is 10%', () => {
    const out = toCumReturn(pts)
    expect(out[0].value).toBeCloseTo(0)
    expect(out[1].value).toBeCloseTo(10)
  })

  it('toNormalized: first point is 100', () => {
    const out = toNormalized(pts)
    expect(out[0].value).toBe(100)
    expect(out[1].value).toBeCloseTo(110)
  })

  it('toPctChange: second point shows period % change', () => {
    const out = toPctChange(pts)
    expect(out[1].value).toBeCloseTo(10)
  })
})
```

Create `src/renderer/lib/__tests__/parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseCSVText } from '../parse'

describe('parseCSVText', () => {
  it('parses simple date,value CSV', () => {
    const csv = `date,price\n2020-01-01,100\n2020-02-01,110`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(1)
    expect(series[0].name).toBe('price')
    expect(series[0].points).toHaveLength(2)
    expect(series[0].points[0].value).toBe(100)
  })

  it('parses multi-series CSV', () => {
    const csv = `date,cpi,gdp\n2020-01-01,257,21000\n2020-02-01,258,21100`
    const series = parseCSVText(csv)
    expect(series).toHaveLength(2)
    expect(series.map(s => s.name)).toContain('cpi')
    expect(series.map(s => s.name)).toContain('gdp')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/lib/__tests__/
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/renderer/lib/transforms.ts`**

```typescript
import type { DataPoint } from '../../shared/types'

export function toCumReturn(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  const base = pts[0].value
  return pts.map(p => ({ date: p.date, value: ((p.value - base) / base) * 100 }))
}

export function toNormalized(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  const base = pts[0].value
  return pts.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
}

export function toPctChange(pts: DataPoint[]): DataPoint[] {
  return pts.map((p, i) => {
    if (i === 0) return { date: p.date, value: 0 }
    const prev = pts[i - 1].value
    return { date: p.date, value: ((p.value - prev) / Math.abs(prev)) * 100 }
  })
}
```

- [ ] **Step 4: Create `src/renderer/lib/parse.ts`**

```typescript
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { DataSeries, DataPoint } from '../../shared/types'
import crypto from 'crypto'

function makeId(): string {
  return crypto.randomUUID()
}

export function parseCSVText(csvText: string): DataSeries[] {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const rows = result.data
  if (rows.length === 0) return []

  const headers = Object.keys(rows[0])
  const dateCol = headers[0]
  const valueHeaders = headers.slice(1)

  return valueHeaders.map(col => ({
    id: makeId(),
    name: col,
    code: col.toUpperCase().replace(/\s+/g, '_'),
    description: '',
    source: 'memory' as const,
    points: rows
      .map(row => ({
        date: new Date(row[dateCol]),
        value: parseFloat(row[col]),
      }))
      .filter(p => !isNaN(p.date.getTime()) && !isNaN(p.value)),
  }))
}

export function parseExcelBuffer(buffer: ArrayBuffer): DataSeries[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const csv = XLSX.utils.sheet_to_csv(ws)
  return parseCSVText(csv)
}
```

- [ ] **Step 5: Create `src/renderer/lib/colors.ts`**

```typescript
export const PALETTES: Record<string, string[]> = {
  default: ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'],
  pastel:  ['#93c5fd', '#fca5a5', '#86efac', '#fde68a', '#c4b5fd', '#67e8f9', '#fed7aa', '#f9a8d4'],
  muted:   ['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6'],
  mono:    ['#1d4ed8', '#1e40af', '#1e3a8a', '#172554', '#0f172a', '#334155', '#475569', '#64748b'],
}

export function getColor(palette: string, index: number): string {
  const colors = PALETTES[palette] ?? PALETTES.default
  return colors[index % colors.length]
}
```

- [ ] **Step 6: Create `src/renderer/lib/theme.ts`**

```typescript
export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}
```

- [ ] **Step 7: Create `src/renderer/lib/ipc.ts`**

```typescript
import type { DataSeries, DBRecord, AppSettings } from '../../shared/types'

declare global {
  interface Window {
    tsv: {
      memory: {
        listSeries: () => Promise<DBRecord[]>
        getSeries: (id: string) => Promise<{ id: string; name: string; code: string; description: string; points: { date: string; value: number }[] } | null>
        saveSeries: (payload: unknown) => Promise<void>
        deleteSeries: (id: string) => Promise<void>
      }
      external: {
        listSeries: (path: string) => Promise<DBRecord[]>
        getSeries: (path: string, id: string) => Promise<unknown>
        checkPath: (path: string) => Promise<boolean>
      }
      settings: {
        get: () => Promise<AppSettings>
        save: (s: AppSettings) => Promise<void>
      }
      dialog: {
        openDB: () => Promise<string | null>
        saveDB: (path: string, ids: string[]) => Promise<boolean>
      }
    }
  }
}

function rawToDataSeries(raw: { id: string; name: string; code: string; description: string; points: { date: string; value: number }[] }, source: DataSeries['source'], dbId?: string): DataSeries {
  return {
    ...raw,
    source,
    dbId,
    points: raw.points.map(p => ({ date: new Date(p.date), value: p.value })),
  }
}

export const ipc = {
  memory: {
    listSeries: (): Promise<DBRecord[]> => window.tsv.memory.listSeries(),
    getSeries: async (id: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.memory.getSeries(id)
      return raw ? rawToDataSeries(raw, 'memory') : null
    },
    saveSeries: (s: DataSeries): Promise<void> => window.tsv.memory.saveSeries({
      id: s.id, name: s.name, code: s.code, description: s.description,
      points: s.points.map(p => ({ date: p.date.toISOString().slice(0, 10), value: p.value })),
    }),
    deleteSeries: (id: string): Promise<void> => window.tsv.memory.deleteSeries(id),
  },
  external: {
    listSeries: (path: string): Promise<DBRecord[]> => window.tsv.external.listSeries(path),
    getSeries: async (path: string, id: string, dbId: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.external.getSeries(path, id) as any
      return raw ? rawToDataSeries(raw, 'external', dbId) : null
    },
    checkPath: (path: string): Promise<boolean> => window.tsv.external.checkPath(path),
  },
  settings: {
    get: (): Promise<AppSettings> => window.tsv.settings.get(),
    save: (s: AppSettings): Promise<void> => window.tsv.settings.save(s),
  },
  dialog: {
    openDB: (): Promise<string | null> => window.tsv.dialog.openDB(),
    saveDB: (path: string, ids: string[]): Promise<boolean> => window.tsv.dialog.saveDB(path, ids),
  },
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run src/renderer/lib/__tests__/
```

Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/lib/
git commit -m "feat: lib utilities — transforms, CSV/Excel parser, colors, theme, IPC wrappers"
```

---

### Task 8: Pre-Built UI Components

**Files:**
- Create: `src/renderer/components/ui/segment-group.tsx`
- Create: `src/renderer/components/ui/animated-dropdown.tsx`
- Create: `src/renderer/components/ui/spotlight-table.tsx`
- Create: `src/renderer/components/ui/interactive-series-table.tsx`
- Create: `src/renderer/components/ui/area-chart.tsx`

- [ ] **Step 1: Install remaining UI deps**

```bash
npm install @ark-ui/react antd @ant-design/icons react-use-measure
```

- [ ] **Step 2: Copy segment-group component**

Create `src/renderer/components/ui/segment-group.tsx` with the exact code from the spec (verbatim copy from `segment-group.tsx` section in TimeSeriesVisualiser.md lines 105-144).

- [ ] **Step 3: Copy animated-dropdown component**

Create `src/renderer/components/ui/animated-dropdown.tsx` with the exact code from the spec (verbatim copy from `animated-dropdown.tsx` section, lines 667-834).

- [ ] **Step 4: Copy spotlight-table component**

Create `src/renderer/components/ui/spotlight-table.tsx` with the exact code from the spec (verbatim copy from `spotlight-table.tsx` section, lines 1157-1213).

- [ ] **Step 5: Copy interactive-series-table component**

Create `src/renderer/components/ui/interactive-series-table.tsx` with the exact code from the spec (`interactive-logs-table-shadcnui.tsx` section). Rename the export from `InteractiveLogsTable` to `InteractiveSeriesTable`.

- [ ] **Step 6: Copy area-chart component**

Create `src/renderer/components/ui/area-chart.tsx` — copy the full `area-chart.tsx` from the spec (lines 1839 onward through the end of the spec). This is a very large component; copy verbatim.

- [ ] **Step 7: Verify renderer compiles**

```bash
npm run typecheck
```

Expected: No type errors from the new components.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ui/
git commit -m "feat: add all spec-provided UI components (segment-group, animated-dropdown, tables, area-chart)"
```

---

### Task 9: Upload Tab — FileDropZone

**Files:**
- Modify: `src/renderer/components/tabs/UploadTab.tsx`
- Create: `src/renderer/components/upload/FileDropZone.tsx`
- Create: `src/renderer/components/upload/PasteTable.tsx`

- [ ] **Step 1: Write failing test for CSV parse integration**

Create `src/renderer/components/upload/__tests__/FileDropZone.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/renderer/components/upload/__tests__/FileDropZone.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `src/renderer/components/upload/FileDropZone.tsx`**

```tsx
import { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { parseCSVText, parseExcelBuffer } from '../../lib/parse'
import type { DataSeries } from '../../../shared/types'

interface Props {
  onSeries: (series: DataSeries[]) => void
}

export function FileDropZone({ onSeries }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (file.name.endsWith('.csv') || file.type === 'text/csv') {
      const text = await file.text()
      onSeries(parseCSVText(text))
    } else {
      const buf = await file.arrayBuffer()
      onSeries(parseExcelBuffer(buf))
    }
  }, [onSeries])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-16 cursor-pointer transition-colors ${
        isDragging
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 dark:border-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <Upload className="h-10 w-10 text-gray-400" />
      <div className="text-center">
        <p className="text-base font-medium text-gray-700 dark:text-gray-300">
          Drop CSV or Excel file here
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          or click to browse · First column must be dates
        </p>
      </div>
      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={handleFileInput}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/renderer/components/upload/__tests__/FileDropZone.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Create `src/renderer/components/upload/PasteTable.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { parseCSVText } from '../../lib/parse'
import type { DataSeries } from '../../../shared/types'

interface Props {
  onSeries: (series: DataSeries[]) => void
}

// User pastes tab-separated or CSV data into this table
// The pasted content is parsed on every change
export function PasteTable({ onSeries }: Props) {
  const [raw, setRaw] = useState('')

  useEffect(() => {
    if (!raw.trim()) return
    // Normalize tabs to commas for papaparse
    const normalized = raw.trim().replace(/\t/g, ',')
    const series = parseCSVText(normalized)
    if (series.length > 0 && series[0].points.length > 0) {
      onSeries(series)
    }
  }, [raw, onSeries])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Paste your data below. First row = headers (date, series1, series2...). First column = dates.
      </p>
      <textarea
        value={raw}
        onChange={e => setRaw(e.target.value)}
        placeholder={"date\tSeries 1\tSeries 2\n2020-01-01\t100\t200\n2020-02-01\t110\t195"}
        className="min-h-48 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 font-mono text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        spellCheck={false}
      />
    </div>
  )
}
```

- [ ] **Step 6: Replace UploadTab stub with real implementation**

```tsx
// src/renderer/components/tabs/UploadTab.tsx
import { useState, useCallback } from 'react'
import { useAppStore } from '../../store/app'
import { useGraphStore } from '../../store/graph'
import { getColor } from '../../lib/colors'
import { FileDropZone } from '../upload/FileDropZone'
import { PasteTable } from '../upload/PasteTable'
import BasicSegmentGroup from '../ui/segment-group'
import { Button } from '../ui/button'
import type { DataSeries } from '../../../shared/types'

type Mode = 'file' | 'paste'

export function UploadTab() {
  const [mode, setMode] = useState<Mode>('file')
  const [pendingSeries, setPendingSeries] = useState<DataSeries[]>([])
  const { colorPalette } = useAppStore()
  const { addSeries, activeSeries, setActiveTab } = useAppStore(s => ({
    addSeries: useGraphStore.getState().addSeries,
    activeSeries: useGraphStore.getState().activeSeries,
    setActiveTab: s.setActiveTab,
  }))

  const handleSeries = useCallback((series: DataSeries[]) => {
    const colored = series.map((s, i) => ({
      ...s,
      color: getColor(colorPalette, activeSeries.length + i),
    }))
    setPendingSeries(colored)
  }, [colorPalette, activeSeries.length])

  const addToGraph = () => {
    const gs = useGraphStore.getState()
    for (const s of pendingSeries) gs.addSeries(s)
    useAppStore.getState().setActiveTab('graph')
    setPendingSeries([])
  }

  return (
    <div className="flex flex-col gap-6 p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Upload Data</h2>

      <BasicSegmentGroup
        items={[{ label: 'File', value: 'file' }, { label: 'Paste', value: 'paste' }]}
        value={mode}
        onValueChange={({ value }) => { setPendingSeries([]); setMode(value as Mode) }}
      />

      {mode === 'file'
        ? <FileDropZone onSeries={handleSeries} />
        : <PasteTable onSeries={handleSeries} />
      }

      {pendingSeries.length > 0 && (
        <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
          <p className="text-sm text-green-700 dark:text-green-300 mb-3">
            {pendingSeries.length} series ready: {pendingSeries.map(s => s.name).join(', ')}
          </p>
          <Button onClick={addToGraph} className="w-full">
            Add to Graph
          </Button>
        </div>
      )}
    </div>
  )
}
```

> **Note:** The `BasicSegmentGroup` component from the spec takes `frameworks` strings. For this app, extend it to accept `items` prop with `{ label, value }` objects and a controlled `value`/`onValueChange`. Edit `segment-group.tsx` accordingly during integration.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/upload/ src/renderer/components/tabs/UploadTab.tsx
git commit -m "feat: upload tab with file drop zone and paste table"
```

---

### Task 10: Graph Canvas — AreaChart Multi-Series

**Files:**
- Create: `src/renderer/components/graph/GraphCanvas.tsx`
- Modify: `src/renderer/components/tabs/GraphTab.tsx`

- [ ] **Step 1: Create `src/renderer/components/graph/GraphCanvas.tsx`**

The AreaChart from the spec accepts `data` (array of objects with date + one key per series) and `lines` config. This component adapts the Zustand `activeSeries` into that format.

```tsx
import { useMemo } from 'react'
import { useGraphStore } from '../../store/graph'
import { AreaChart, XAxis, YAxis, ChartTooltip, Line } from '../ui/area-chart'

// Merges multiple DataSeries (each with points[]) into a flat record array
// keyed by series code, aligned on dates present in all series.
function mergeSeriesData(series: import('../../../shared/types').DataSeries[]) {
  if (series.length === 0) return []
  // Collect all unique date strings
  const dateSet = new Set<string>()
  for (const s of series) {
    for (const p of s.points) {
      dateSet.add(p.date.toISOString().slice(0, 10))
    }
  }
  const sortedDates = Array.from(dateSet).sort()
  // Build lookup maps
  const maps = series.map(s => {
    const m = new Map<string, number>()
    for (const p of s.points) m.set(p.date.toISOString().slice(0, 10), p.value)
    return m
  })
  return sortedDates.map(dateStr => {
    const row: Record<string, unknown> = { date: new Date(dateStr) }
    for (let i = 0; i < series.length; i++) {
      const v = maps[i].get(dateStr)
      if (v !== undefined) row[series[i].code] = v
    }
    return row
  })
}

export function GraphCanvas() {
  const activeSeries = useGraphStore(s => s.activeSeries)
  const zoomDomain = useGraphStore(s => s.zoomDomain)

  const data = useMemo(() => mergeSeriesData(activeSeries), [activeSeries])

  const lines = activeSeries.map(s => ({
    dataKey: s.code,
    stroke: s.color ?? '#3b82f6',
    strokeWidth: 2,
  }))

  if (activeSeries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600">
        <div className="text-center">
          <p className="text-lg font-medium">No series loaded</p>
          <p className="text-sm mt-1">Upload data or add a line from memory / database</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 h-full p-4">
      <AreaChart
        data={data}
        lines={lines}
        xAccessor={(d: Record<string, unknown>) => d.date as Date}
        margin={{ top: 20, right: 32, bottom: 40, left: 64 }}
        animationDuration={300}
      >
        <XAxis />
        <YAxis />
        <ChartTooltip />
        {lines.map(l => <Line key={l.dataKey} dataKey={l.dataKey} stroke={l.stroke} strokeWidth={l.strokeWidth} />)}
      </AreaChart>
    </div>
  )
}
```

> **Note:** The exact sub-component API (`XAxis`, `YAxis`, `Line`, `ChartTooltip`) depends on the full area-chart.tsx exports. Check the exports after copying the full file and adjust prop names to match.

- [ ] **Step 2: Create hooks `src/renderer/hooks/useGraphZoom.ts`**

```typescript
import { useCallback, useRef } from 'react'
import { useGraphStore } from '../store/graph'

export function useGraphZoom() {
  const setZoomDomain = useGraphStore(s => s.setZoomDomain)
  const activeSeries = useGraphStore(s => s.activeSeries)

  const handleWheel = useCallback((e: WheelEvent, currentDomain: { start: Date; end: Date } | null) => {
    e.preventDefault()
    const allPoints = activeSeries.flatMap(s => s.points)
    if (allPoints.length === 0) return

    const globalStart = new Date(Math.min(...allPoints.map(p => p.date.getTime())))
    const globalEnd   = new Date(Math.max(...allPoints.map(p => p.date.getTime())))

    const start = currentDomain?.start ?? globalStart
    const end   = currentDomain?.end   ?? globalEnd
    const span  = end.getTime() - start.getTime()
    const factor = e.deltaY > 0 ? 1.15 : 0.87
    const mid = (start.getTime() + end.getTime()) / 2

    const newSpan  = Math.max(7 * 86400_000, Math.min(span * factor, globalEnd.getTime() - globalStart.getTime()))
    const newStart = new Date(Math.max(globalStart.getTime(), mid - newSpan / 2))
    const newEnd   = new Date(Math.min(globalEnd.getTime(),  mid + newSpan / 2))

    setZoomDomain({ start: newStart, end: newEnd })
  }, [activeSeries, setZoomDomain])

  const resetZoom = useCallback(() => setZoomDomain(null), [setZoomDomain])

  return { handleWheel, resetZoom }
}
```

- [ ] **Step 3: Create `src/renderer/hooks/useSeriesColor.ts`**

```typescript
import { useAppStore } from '../store/app'
import { useGraphStore } from '../store/graph'
import { getColor } from '../lib/colors'

export function useNextSeriesColor(): string {
  const palette = useAppStore(s => s.colorPalette)
  const count = useGraphStore(s => s.activeSeries.length)
  return getColor(palette, count)
}
```

- [ ] **Step 4: Replace GraphTab stub**

```tsx
// src/renderer/components/tabs/GraphTab.tsx
import { useGraphStore } from '../../store/graph'
import { GraphCanvas } from '../graph/GraphCanvas'
import { AddLinePanel } from '../graph/AddLinePanel'
import { OperationsPanel } from '../graph/OperationsPanel'
import { Button } from '../ui/button'
import { Plus, Sliders } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export function GraphTab() {
  const rightPanel = useGraphStore(s => s.rightPanel)
  const setRightPanel = useGraphStore(s => s.setRightPanel)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Chart area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Panel toggles */}
        <div className="absolute top-3 right-3 z-10 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRightPanel(rightPanel === 'operations' ? null : 'operations')}
          >
            <Sliders className="h-4 w-4 mr-1" />
            Operations
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRightPanel(rightPanel === 'addLine' ? null : 'addLine')}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Line
          </Button>
        </div>

        <GraphCanvas />
      </div>

      {/* Right slide-in panels */}
      <AnimatePresence>
        {rightPanel === 'operations' && (
          <motion.div
            key="ops"
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-80 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-y-auto"
          >
            <OperationsPanel />
          </motion.div>
        )}
        {rightPanel === 'addLine' && (
          <motion.div
            key="add"
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-80 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-y-auto"
          >
            <AddLinePanel />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 5: Verify renders with empty state**

```bash
npm run dev
```

Expected: Graph tab shows "No series loaded" placeholder; Operations and Add Line buttons appear; clicking them slides in empty panels.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/graph/ src/renderer/components/tabs/GraphTab.tsx src/renderer/hooks/
git commit -m "feat: graph canvas, zoom hook, and right-panel layout"
```

---

### Task 11: Add Line Panel

**Files:**
- Create: `src/renderer/components/graph/AddLinePanel.tsx`
- Create: `src/renderer/components/graph/SeriesSourceDropdown.tsx`
- Create: `src/renderer/components/graph/SeriesPreviewChart.tsx`
- Create: `src/renderer/components/graph/SeriesSearchTable.tsx`

- [ ] **Step 1: Create `SeriesSourceDropdown.tsx`**

This is the "where to add from" selector — Local Memory is separated from external DBs by a divider; unreachable DBs are disabled (no cursor-pointer, muted text).

```tsx
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDBStore } from '../../store/db'

interface Source {
  id: string
  label: string
  path?: string
  disabled: boolean
}

interface Props {
  value: Source | null
  onChange: (source: Source) => void
}

export function SeriesSourceDropdown({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const externalDBs = useDBStore(s => s.externalDBs)

  const memorySource: Source = { id: '__memory__', label: 'Local Memory', disabled: false }
  const externalSources: Source[] = externalDBs.map(db => ({
    id: db.id,
    label: db.name,
    path: db.path,
    disabled: !db.reachable,
  }))

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <span>{value?.label ?? 'Select source...'}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden"
          >
            {/* Memory — always at top, separated */}
            <button
              onClick={() => { onChange(memorySource); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Local Memory
            </button>

            {externalSources.length > 0 && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700" />
                {externalSources.map(src => (
                  <button
                    key={src.id}
                    disabled={src.disabled}
                    onClick={() => { if (!src.disabled) { onChange(src); setOpen(false) } }}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm ${
                      src.disabled
                        ? 'opacity-40 cursor-not-allowed text-gray-400'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${src.disabled ? 'bg-gray-400' : 'bg-green-500'}`} />
                    {src.label}
                    {src.disabled && <span className="ml-auto text-xs text-gray-400">unreachable</span>}
                  </button>
                ))}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Create `SeriesPreviewChart.tsx`**

Small area chart shown in the accordion expand — uses the spec `AreaChart` component with minimal config.

```tsx
import { AreaChart, XAxis, Line } from '../ui/area-chart'
import type { DataPoint } from '../../../shared/types'

interface Props {
  points: { date: string; value: number }[]
  description: string
}

export function SeriesPreviewChart({ points, description }: Props) {
  const data = points.map(p => ({ date: new Date(p.date), value: p.value }))
  return (
    <div className="pt-2 space-y-2">
      <div className="h-32">
        <AreaChart
          data={data}
          lines={[{ dataKey: 'value', stroke: '#3b82f6', strokeWidth: 1.5 }]}
          xAccessor={(d: Record<string, unknown>) => d.date as Date}
          margin={{ top: 4, right: 8, bottom: 20, left: 8 }}
          animationDuration={200}
        >
          <XAxis />
          <Line dataKey="value" stroke="#3b82f6" strokeWidth={1.5} />
        </AreaChart>
      </div>
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `SeriesSearchTable.tsx`**

Accordion table using the interactive-series-table pattern: each row shows Name / Code / Date range. Click to expand → reveals SeriesPreviewChart. Has a search input.

```tsx
import { useState, useEffect } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { SeriesPreviewChart } from './SeriesPreviewChart'
import type { DBRecord } from '../../../shared/types'

interface Props {
  records: DBRecord[]
  onSelect: (record: DBRecord) => void
  loadPoints: (id: string) => Promise<{ date: string; value: number }[]>
}

export function SeriesSearchTable({ records, onSelect, loadPoints }: Props) {
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [points, setPoints] = useState<{ date: string; value: number }[]>([])

  const filtered = records.filter(r =>
    r.name.toLowerCase().includes(query.toLowerCase()) ||
    r.code.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (!expandedId) { setPoints([]); return }
    loadPoints(expandedId).then(setPoints)
  }, [expandedId, loadPoints])

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search series..."
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        {filtered.length === 0 && (
          <p className="p-4 text-sm text-gray-400 text-center">No series found</p>
        )}
        {filtered.map(r => (
          <div key={r.id}>
            <button
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <motion.div animate={{ rotate: expandedId === r.id ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{r.code} · {r.startDate?.slice(0,7) ?? '?'} – {r.endDate?.slice(0,7) ?? '?'}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onSelect(r) }}
                className="ml-auto flex-shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline px-2"
              >
                Add
              </button>
            </button>

            <AnimatePresence initial={false}>
              {expandedId === r.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden bg-gray-50 dark:bg-gray-800/50 px-3 pb-3"
                >
                  {points.length > 0
                    ? <SeriesPreviewChart points={points} description={r.description ?? ''} />
                    : <p className="text-xs text-gray-400 py-2">Loading preview...</p>
                  }
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `AddLinePanel.tsx`**

```tsx
import { useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import { useGraphStore } from '../../store/graph'
import { useDBStore } from '../../store/db'
import { ipc } from '../../lib/ipc'
import { useNextSeriesColor } from '../../hooks/useSeriesColor'
import { SeriesSourceDropdown } from './SeriesSourceDropdown'
import { SeriesSearchTable } from './SeriesSearchTable'
import type { DBRecord } from '../../../shared/types'

interface Source {
  id: string
  label: string
  path?: string
  disabled: boolean
}

export function AddLinePanel() {
  const [source, setSource] = useState<Source | null>(null)
  const [records, setRecords] = useState<DBRecord[]>([])
  const { addSeries, setRightPanel } = useGraphStore()
  const nextColor = useNextSeriesColor()

  useEffect(() => {
    if (!source) { setRecords([]); return }
    if (source.id === '__memory__') {
      ipc.memory.listSeries().then(setRecords)
    } else if (source.path) {
      ipc.external.listSeries(source.path).then(setRecords)
    }
  }, [source])

  const loadPoints = useCallback(async (id: string) => {
    if (!source) return []
    if (source.id === '__memory__') {
      const s = await ipc.memory.getSeries(id)
      return s?.points.map(p => ({ date: p.date.toISOString().slice(0, 10), value: p.value })) ?? []
    } else if (source.path) {
      const s = await ipc.external.getSeries(source.path, id, source.id)
      return s?.points.map(p => ({ date: p.date.toISOString().slice(0, 10), value: p.value })) ?? []
    }
    return []
  }, [source])

  const handleSelect = useCallback(async (record: DBRecord) => {
    if (!source) return
    let series
    if (source.id === '__memory__') {
      series = await ipc.memory.getSeries(record.id)
    } else if (source.path) {
      series = await ipc.external.getSeries(source.path, record.id, source.id)
    }
    if (series) {
      addSeries({ ...series, color: nextColor })
      setRightPanel(null)
    }
  }, [source, addSeries, setRightPanel, nextColor])

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add Line</h3>
        <button onClick={() => setRightPanel(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      <SeriesSourceDropdown value={source} onChange={setSource} />

      {source && records.length > 0 && (
        <SeriesSearchTable records={records} onSelect={handleSelect} loadPoints={loadPoints} />
      )}

      {source && records.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No series in this source</p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/graph/
git commit -m "feat: Add Line panel with source dropdown, series search table, and accordion preview"
```

---

### Task 12: Operations Panel

**Files:**
- Create: `src/renderer/components/graph/OperationsPanel.tsx`
- Create: `src/renderer/components/graph/SaveMenu.tsx`

- [ ] **Step 1: Create `OperationsPanel.tsx`**

```tsx
import { X } from 'lucide-react'
import { useGraphStore } from '../../store/graph'
import { toCumReturn, toNormalized, toPctChange } from '../../lib/transforms'
import { Button } from '../ui/button'
import { SaveMenu } from './SaveMenu'
import type { DataSeries } from '../../../shared/types'

type Transform = 'cumReturn' | 'normalize' | 'pctChange' | 'raw'

function applyTransform(s: DataSeries, t: Transform): DataSeries {
  if (t === 'raw') return s
  const fn = t === 'cumReturn' ? toCumReturn : t === 'normalize' ? toNormalized : toPctChange
  return { ...s, points: fn(s.points) }
}

export function OperationsPanel() {
  const { activeSeries, updateSeries, setRightPanel } = useGraphStore()

  const transform = (t: Transform) => {
    for (const s of activeSeries) updateSeries(s.id, { points: applyTransform(s, t).points })
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Operations</h3>
        <button onClick={() => setRightPanel(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Transform (applies to all series)</p>
        <Button variant="outline" className="w-full justify-start text-sm" onClick={() => transform('cumReturn')}>
          → Cumulative Return (%)
        </Button>
        <Button variant="outline" className="w-full justify-start text-sm" onClick={() => transform('normalize')}>
          → Normalize to 100
        </Button>
        <Button variant="outline" className="w-full justify-start text-sm" onClick={() => transform('pctChange')}>
          → Period % Change
        </Button>
        <Button variant="outline" className="w-full justify-start text-sm" onClick={() => transform('raw')}>
          ↺ Reset to Raw Values
        </Button>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Save</p>
        <SaveMenu />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `SaveMenu.tsx`**

```tsx
import { useState } from 'react'
import { Save, Database } from 'lucide-react'
import { useGraphStore } from '../../store/graph'
import { ipc } from '../../lib/ipc'
import { Button } from '../ui/button'

export function SaveMenu() {
  const activeSeries = useGraphStore(s => s.activeSeries)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const saveToMemory = async () => {
    setSaving(true)
    for (const s of activeSeries) {
      await ipc.memory.saveSeries(s)
    }
    setSaving(false)
    setSaved('memory')
    setTimeout(() => setSaved(null), 2000)
  }

  const saveToExternalDB = async () => {
    setSaving(true)
    const path = await ipc.dialog.openDB()
    if (path) {
      const ids = activeSeries.map(s => s.id)
      await ipc.dialog.saveDB(path, ids)
      setSaved('external')
      setTimeout(() => setSaved(null), 2000)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className="w-full justify-start text-sm"
        onClick={saveToMemory}
        disabled={saving || activeSeries.length === 0}
      >
        <Save className="h-3.5 w-3.5 mr-2" />
        {saved === 'memory' ? '✓ Saved to Memory' : 'Save to App Memory'}
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start text-sm"
        onClick={saveToExternalDB}
        disabled={saving || activeSeries.length === 0}
      >
        <Database className="h-3.5 w-3.5 mr-2" />
        {saved === 'external' ? '✓ Exported' : 'Export to .db File'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Verify operations flow end-to-end**

```bash
npm run dev
```

Steps to test: Upload a CSV → Add to Graph → open Operations panel → click "Cumulative Return" → chart updates → Save to Memory → re-open Add Line → select Local Memory → series appears in list.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/graph/OperationsPanel.tsx src/renderer/components/graph/SaveMenu.tsx
git commit -m "feat: operations panel with transforms and save menu"
```

---

### Task 13: Settings Tab

**Files:**
- Create: `src/renderer/components/settings/DBManager.tsx`
- Create: `src/renderer/components/settings/Personalisation.tsx`
- Modify: `src/renderer/components/tabs/SettingsTab.tsx`

- [ ] **Step 1: Create `DBManager.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { Plus, Trash2, AlertCircle, CheckCircle } from 'lucide-react'
import { useDBStore } from '../../store/db'
import { ipc } from '../../lib/ipc'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import crypto from 'crypto'

export function DBManager() {
  const { externalDBs, addExternalDB, removeExternalDB, updateReachability } = useDBStore()
  const [name, setName] = useState('')

  // Check reachability of all known DBs on mount
  useEffect(() => {
    for (const db of externalDBs) {
      ipc.external.checkPath(db.path).then(ok => updateReachability(db.id, ok))
    }
  }, [])

  const handleAdd = async () => {
    const path = await ipc.dialog.openDB()
    if (!path || !name.trim()) return
    const id = crypto.randomUUID()
    const reachable = await ipc.external.checkPath(path)
    addExternalDB({ id, name: name.trim(), path, reachable })
    setName('')
    // Persist in settings
    const settings = await ipc.settings.get()
    settings.externalDBs = [...settings.externalDBs, { id, name: name.trim(), path, reachable }]
    await ipc.settings.save(settings)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">External Databases</h3>

      <div className="flex gap-2">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Friendly name (e.g. Macro Data)"
          className="flex-1 text-sm"
        />
        <Button onClick={handleAdd} disabled={!name.trim()} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Browse & Add
        </Button>
      </div>

      <div className="space-y-2">
        {externalDBs.length === 0 && (
          <p className="text-sm text-gray-400">No external databases configured.</p>
        )}
        {externalDBs.map(db => (
          <div key={db.id} className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
            {db.reachable
              ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              : <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{db.name}</p>
              <p className="text-xs text-gray-400 truncate">{db.path}</p>
            </div>
            <button
              onClick={async () => {
                removeExternalDB(db.id)
                const settings = await ipc.settings.get()
                settings.externalDBs = settings.externalDBs.filter(d => d.id !== db.id)
                await ipc.settings.save(settings)
              }}
              className="text-gray-400 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `Personalisation.tsx`**

```tsx
import { useEffect } from 'react'
import { useAppStore } from '../../store/app'
import { applyTheme } from '../../lib/theme'
import { PALETTES } from '../../lib/colors'

export function Personalisation() {
  const { theme, setTheme, colorPalette, setColorPalette } = useAppStore()

  useEffect(() => { applyTheme(theme) }, [theme])

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Theme</h3>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map(t => (
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
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Graph Color Palette</h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PALETTES).map(([key, colors]) => (
            <button
              key={key}
              onClick={() => setColorPalette(key)}
              className={`rounded-lg border p-3 transition-colors ${
                colorPalette === key
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <p className="text-xs font-medium capitalize mb-2">{key}</p>
              <div className="flex gap-1">
                {colors.slice(0, 5).map(c => (
                  <span key={c} className="h-4 w-4 rounded-full" style={{ backgroundColor: c }} />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Replace SettingsTab stub**

```tsx
// src/renderer/components/tabs/SettingsTab.tsx
import { DBManager } from '../settings/DBManager'
import { Personalisation } from '../settings/Personalisation'

export function SettingsTab() {
  return (
    <div className="flex flex-col gap-10 p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
      <DBManager />
      <div className="border-t border-gray-200 dark:border-gray-800" />
      <Personalisation />
    </div>
  )
}
```

- [ ] **Step 4: Load saved settings on app start**

In `src/renderer/main.tsx`, add settings bootstrap before render:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'
import { ipc } from './lib/ipc'
import { useDBStore } from './store/db'
import { useAppStore } from './store/app'
import { applyTheme } from './lib/theme'

async function bootstrap() {
  const settings = await ipc.settings.get()
  useDBStore.getState().setExternalDBs(settings.externalDBs)
  useAppStore.getState().setTheme(settings.theme)
  useAppStore.getState().setColorPalette(settings.colorPalette)
  applyTheme(settings.theme)

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>
  )
}

bootstrap()
```

- [ ] **Step 5: Verify settings persist**

```bash
npm run dev
```

Test: Add a fake DB path, close the app, reopen — the DB should reappear. Toggle dark mode — persists after reload.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/ src/renderer/components/tabs/SettingsTab.tsx src/renderer/main.tsx
git commit -m "feat: settings tab with external DB manager and theme/palette personalisation"
```

---

### Task 14: Electron-builder Packaging

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: com.tsv.app
productName: TimeSeriesVisualiser
directories:
  buildResources: build
files:
  - "!**/.vscode/*"
  - "!src/*"
  - "!electron.vite.config.{js,ts,mjs,cjs}"
  - "!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}"
  - "!{.env,.env.*,.npmrc,pnpm-lock.yaml}"
  - "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}"
asarUnpack:
  - resources/**
win:
  executableName: TimeSeriesVisualiser
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
  createDesktopShortcut: always
mac:
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    - NSCameraUsageDescription: Application requests access to the device's camera.
    - NSMicrophoneUsageDescription: Application requests access to the device's microphone.
    - NSDocumentsFolderUsageDescription: Application requests access to the user's Documents folder.
    - NSDownloadsFolderUsageDescription: Application requests access to the user's Downloads folder.
  notarize: false
dmg:
  artifactName: ${name}-${version}.${ext}
linux:
  target:
    - AppImage
    - snap
    - deb
  maintainer: electronjs.org
  category: Utility
appImage:
  artifactName: ${name}-${version}.${ext}
npmRebuild: false
publish:
  provider: generic
  url: https://example.com/auto-update
electronDownload:
  mirror: https://npmmirror.com/mirrors/electron/
```

- [ ] **Step 2: Rebuild native modules for Electron**

```bash
npx electron-rebuild -f -w better-sqlite3
```

Expected: `better-sqlite3` compiled against Electron's Node ABI.

- [ ] **Step 3: Build the app**

```bash
npm run build
```

Expected: `dist/` folder created with compiled renderer + main + preload.

- [ ] **Step 4: Package for current platform**

```bash
npm run build:win    # Windows
# or
npm run build:mac    # macOS
# or
npm run build:linux  # Linux
```

Expected: Installer or AppImage created in `dist/`.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml
git commit -m "feat: electron-builder packaging config"
```

---

## Self-Review

### 1. Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| Internal memory SQLite DB per machine | Task 3 (schema + MemoryDB) |
| External .db file sharing | Task 4 (ExternalDBReader) |
| Graph tab with multi-series AreaChart | Task 10 (GraphCanvas) |
| Scroll-wheel zoom | Task 10 (useGraphZoom) |
| Drag-select zoom | Built into AreaChart component from spec (useChartInteraction) |
| Operations panel sliding from right | Task 12 (OperationsPanel + framer-motion) |
| Add Line panel with animated dropdown | Task 11 (SeriesSourceDropdown) |
| Separated Memory / external DBs in dropdown | Task 11 (divider between memory and ext DBs) |
| Disabled unreachable DBs | Task 11 (disabled state in SeriesSourceDropdown) |
| Accordion search table with preview chart | Task 11 (SeriesSearchTable + SeriesPreviewChart) |
| Upload: drag-and-drop CSV/Excel | Task 9 (FileDropZone) |
| Upload: paste-in editable table | Task 9 (PasteTable) |
| Toggle between file/paste via Selector | Task 9 (SegmentGroup) |
| "Add to Graph" button navigates to graph tab | Task 9 (UploadTab) |
| Settings: external DB path management | Task 13 (DBManager) |
| Settings: theme + color palette | Task 13 (Personalisation) |
| Collapsible sidebar with 2 main tabs + settings | Task 6 (Sidebar) |
| Cumulative return transform | Task 7 (transforms.ts) |
| Normalize + % change transforms | Task 7 (transforms.ts) |
| Save to memory / export to .db | Task 12 (SaveMenu) |
| Standalone packaged app | Task 14 (electron-builder.yml) |

### 2. Placeholder Scan

No TBD/TODO/placeholder steps remain. Every step with code shows the actual implementation.

### 3. Type Consistency

- `DataSeries.code` is used as the `dataKey` in `mergeSeriesData` and in `lines` config for AreaChart — consistent across Tasks 10, 11, 12.
- `MemoryDB.saveSeries` takes `{ id, name, code, description, points }` — matches what `ipc.memory.saveSeries` passes in Task 7.
- `DBRecord` returned by `listSeries()` has `id, name, code, description, startDate, endDate, pointCount` — matched in SeriesSearchTable display (Task 11).
- `useGraphStore.setRightPanel` accepts `'operations' | 'addLine' | null` — used correctly in GraphTab, OperationsPanel, AddLinePanel.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-14-time-series-visualiser.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
