# Epoch — CLAUDE.md

Electron desktop app for visualising, uploading, and sharing time-series data. FRED-inspired charting with SQLite storage. Built by Maximilien Delaporte.

> **Recovery note:** This file is detailed enough to recreate the entire application from scratch. Every type signature, algorithm, invariant, and non-obvious design choice is documented. If you are an agent rebuilding this app, follow this document section-by-section.

---

## Quick-start commands

```bash
npm run dev          # start Electron + Vite dev server (opens DevTools automatically)
npm run typecheck    # tsc check for both main (node) and renderer (web) tsconfigs
npm run test         # vitest run (single pass)
npm run test:watch   # vitest watch mode
npm run build        # typecheck + electron-vite build → out/
npm run build:win    # package for Windows via electron-builder
npm run build:mac    # package for macOS via electron-builder
npm run build:linux  # package for Linux via electron-builder
npm run rebuild      # electron-rebuild for better-sqlite3 (run after any Node version change)
```

---

## Publishing a release (auto-update)

The app uses **GitHub Releases** as its update server. When a new version is published, the app checks on next launch, downloads the update silently, and prompts the user to restart.

### When the user says "publish an update" or "release a new version":

**Step 1 — Commit any pending changes:**
```bash
git add <changed files>
git commit -m "feat/fix: description of changes"
```
Do not skip this step even if the working tree looks clean — confirm with `git status` first.

**Step 2 — Bump the version in `package.json`:**
```bash
# patch = bug fixes (1.0.0 → 1.0.1)
# minor = new features (1.0.0 → 1.1.0)
# major = breaking changes (1.0.0 → 2.0.0)
npm version patch   # or minor or major
```
This updates `package.json` and creates a version commit + git tag automatically.

**Step 3 — Push source code and tag to GitHub:**
```bash
git push && git push --tags
```
This must always run before the build so the repo reflects what version is in the wild.

**Step 4 — Build and publish:**
```bash
npm run build:win && npx electron-builder --publish always
```
This builds the Windows installer and uploads it (plus a `latest.yml` metadata file) to GitHub Releases.

**Step 5 — Confirm:**
Check that the release appeared at `https://github.com/maxdlpt/Epoch/releases`. The user's boss will receive the update automatically on next app launch.

### What each piece does:
- `electron-builder.yml` — `publish: provider: github` tells the builder where to upload
- `electron-updater` (in `src/main/index.ts`) — checks GitHub Releases on launch, downloads silently, prompts restart when ready
- `GH_TOKEN` — a GitHub personal access token with `repo` scope (or `public_repo` for public repos); set as an environment variable before publishing, never commit it

### The boss's experience:
He installs once from a link you send him. After that, every update downloads in the background while he works and prompts "Restart to apply update?" when ready. He never touches a terminal.

---

## Tech stack (exact versions)

| Layer | Library | Version | Notes |
|---|---|---|---|
| Desktop shell | Electron | 33 | |
| Build | electron-vite + Vite | 2.x / 5.x | |
| UI framework | React | 18.3.1 | **NOT 19** — peer-dep constraints with @ark-ui, @visx, framer-motion |
| Language | TypeScript | 5.5.2 | Strict mode enabled |
| SQLite | better-sqlite3 | 12.9.0 | Native module, requires `electron-rebuild` |
| State | Zustand | 5.0.12 | No middleware, vanilla stores |
| Chart | @visx/shape, @visx/scale, @visx/grid, @visx/curve, @visx/event, @visx/responsive | 3.12.0 | Raw SVG, no recharts |
| Styling | Tailwind CSS v4 + shadcn/ui (slate palette) | 4.2.2 | Inline config in globals.css, no tailwind.config.js |
| Animation | motion/react (framer-motion v12) | 12.38.0 | Spring config: stiffness 300, damping 30 |
| UI primitives | @ark-ui/react 5.36, @base-ui/react 1.4, lucide-react 1.8, @ant-design/icons 6.1, antd 6.3 | - | |
| CSV/Excel | papaparse 5.5.3, xlsx 0.18.5 | - | |
| Color math | d3-array 3.2.4 | - | Used for niceStep in Y-axis tick generation |
| Layout | react-use-measure 2.1.7 | - | Responsive chart container |
| Class utils | clsx 2.1.1, tailwind-merge 3.5.0, class-variance-authority 0.7.1 | - | |
| Tests | Vitest 4.1.4 + @testing-library/react 16.3 + jsdom 29 | - | |
| Packaging | electron-builder | 26.8.1 | |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process                              │
│  src/main/index.ts → ipc/handlers.ts               │
│  All SQLite access here. Never in the renderer.     │
│  DB path: app.getPath('userData')/memory.db         │
└─────────────────┬───────────────────────────────────┘
                  │ ipcMain.handle / ipcRenderer.invoke
┌─────────────────┴───────────────────────────────────┐
│  Preload Bridge                                     │
│  src/preload/index.ts                               │
│  contextBridge.exposeInMainWorld('tsv', {...})       │
│  Exposes: window.tsv.memory / external / settings   │
│           / dialog / session                        │
└─────────────────┬───────────────────────────────────┘
                  │ window.tsv.*
┌─────────────────┴───────────────────────────────────┐
│  React Renderer  src/renderer/                      │
│  lib/ipc.ts  ← typed wrappers, also does RawSeries  │
│              → DataSeries conversion here           │
│  store/{app,graph,db}.ts  ← Zustand stores          │
│  App.tsx  ← tab router: graph | upload | settings | db│
│  5 hooks orchestrate boot sequence                  │
└─────────────────────────────────────────────────────┘
```

### Key architectural rules

1. **SQLite only lives in Main.** `better-sqlite3` cannot run in the renderer. `handlers.ts` is the single entry point for all DB operations; do not add DB logic anywhere else.

2. **IPC boundary uses `RawSeries`, not `DataSeries`.** `DataSeries` has `Date` objects, `source`, `dbId`, `color`, `movingAverages` — none survive `structuredClone`. The wire type `RawSeries` uses ISO date strings only. Conversion happens in `src/renderer/lib/ipc.ts:rawToDataSeries()`.

3. **`ipc.ts` is the only place that calls `window.tsv.*`.** Components call `ipc.memory.*`, `ipc.external.*`, etc. Never call `window.tsv.*` directly in components.

4. **`registerHandlers()` is called after `app.whenReady()` but before window creation.** This is intentional — `app.getPath('userData')` is only valid after ready. The DB singleton is created inside `registerHandlers()`.

---

## Path aliases

Both `@/` and `@renderer/` resolve to `src/renderer/`. Configured in three places:
- `electron.vite.config.ts` → renderer build (Vite `resolve.alias`)
- `vitest.config.ts` → tests (`resolve.alias`)
- `tsconfig.web.json` → type-checking (`paths`)

Use `@/` or `@renderer/` for all renderer-internal imports.

---

## IPC channels (complete list)

Defined in `src/shared/ipc-channels.ts` as an `enum IPC`:

```
memory:list-series       → DBRecord[]
memory:get-series        → RawSeries | null      (param: id)
memory:save-series       → void                  (param: RawSeries)
memory:delete-series     → void                  (param: id)

external:list-series     → DBRecord[]            (param: filePath)
external:get-series      → RawSeries | null      (params: filePath, id)
external:check-path      → boolean               (param: filePath)
external:save-series     → void                  (params: filePath, RawSeries)
external:delete-series   → void                  (params: filePath, id)

settings:get             → AppSettings
settings:save            → void                  (param: AppSettings)

session:get              → GraphSession | null
session:save             → void                  (param: GraphSession)

dialog:open-db           → string | null         (async, shows file picker)
dialog:save-db           → boolean               (params: defaultPath, seriesIds[])
dialog:export-series     → (DEFINED BUT NOT IMPLEMENTED — deferred Task 15)
```

All IPC uses `ipcMain.handle` / `ipcRenderer.invoke` (request-response Promises), never fire-and-forget.

---

## Preload bridge (window.tsv)

Exposed via `contextBridge.exposeInMainWorld('tsv', {...})` in `src/preload/index.ts`.

```ts
interface TsvAPI {
  memory: {
    listSeries():                     Promise<DBRecord[]>
    getSeries(id: string):            Promise<RawSeries | null>
    saveSeries(payload: RawSeries):   Promise<void>
    deleteSeries(id: string):         Promise<void>
  }
  external: {
    listSeries(path: string):                        Promise<DBRecord[]>
    getSeries(path: string, id: string):             Promise<RawSeries | null>
    checkPath(path: string):                         Promise<boolean>
    saveSeries(path: string, payload: RawSeries):    Promise<void>
    deleteSeries(path: string, id: string):          Promise<void>
  }
  settings: {
    get():                            Promise<AppSettings>
    save(s: AppSettings):             Promise<void>
  }
  dialog: {
    openDB():                         Promise<string | null>
    saveDB(path: string, ids: string[]): Promise<boolean>
  }
  session: {
    get():                            Promise<GraphSession | null>
    save(s: GraphSession):            Promise<void>
  }
}
```

TypeScript declaration for `window.tsv` lives in `src/preload/index.d.ts`.

---

## Complete type definitions (`src/shared/types.ts`)

### DataPoint
```ts
interface DataPoint { date: Date; value: number }
```

### DataFreq
```ts
type DataFreq = 'daily' | 'monthly' | 'quarterly' | 'yearly'
```

### MAComponent (moving average overlay)
```ts
interface MAComponent {
  id: string                        // crypto.randomUUID()
  type: 'centered' | 'rolling'
  window: number                    // number of periods
  color?: string                    // hex override
  visible?: boolean                 // true when undefined
  hiddenWithParent?: boolean        // true when hidden because parent was hidden
  lineStyle?: 'solid' | 'dashed' | 'dotted'  // defaults to 'dotted'
  lineWidth?: number                // defaults to 1
  points: DataPoint[]               // computed from parent series' current points
}
```

MAs are **ephemeral** — never persisted to DB, only saved in session. Removed when parent series removed. Recomputed when transforms are applied.

### DataSeries (renderer runtime)
```ts
interface DataSeries {
  id: string                        // crypto.randomUUID()
  name: string                      // display name (from column header)
  code: string                      // UPPER_SNAKE_CASE, UNIQUE in schema
  description: string
  data_freq?: DataFreq              // detected at parse/load time
  points: DataPoint[]               // CURRENT display values (may be transformed)
  originalPoints: DataPoint[]       // IMMUTABLE raw values
  source: 'memory' | 'external'
  dbId?: string                     // only when source === 'external'
  color?: string
  visible?: boolean                 // true when undefined
  lineStyle?: 'solid' | 'dashed' | 'dotted'  // defaults to 'solid'
  lineWidth?: number                // defaults to 2
  movingAverages?: MAComponent[]
}
```

### RawSeries (IPC wire format)
```ts
interface RawSeries {
  id: string
  name: string
  code: string
  description: string
  points: { date: string; value: number }[]  // ISO YYYY-MM-DD strings
}
```

### DBRecord (list metadata)
```ts
interface DBRecord {
  id: string; name: string; code: string; description: string
  startDate: string; endDate: string; pointCount: number
}
```

### ExternalDB
```ts
interface ExternalDB {
  id: string; name: string; path: string; reachable: boolean
}
```

### CustomPaletteEntry
```ts
interface CustomPaletteEntry {
  light: string[]    // hex colors for light mode
  dark: string[]     // hex colors for dark mode (auto-generated via lightness inversion)
}
```

### AppSettings
```ts
interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  colorPalette: string                           // palette key
  chartMaxWidth?: number                         // px, absent in pre-v2 saves
  customPalettes?: Record<string, CustomPaletteEntry>  // absent in pre-v2 saves
  externalDBs: ExternalDB[]
}
```

### GraphSession (session persistence)
```ts
interface SessionMA {
  id: string; type: 'centered' | 'rolling'; window: number
  color?: string; visible?: boolean
  lineStyle?: 'solid' | 'dashed' | 'dotted'; lineWidth?: number
  points: { date: string; value: number }[]
}

interface SessionSeries {
  id: string; name: string; code: string; description: string
  data_freq?: DataFreq
  source: 'memory' | 'external'; dbId?: string
  color?: string; visible?: boolean
  lineStyle?: 'solid' | 'dashed' | 'dotted'; lineWidth?: number
  movingAverages?: SessionMA[]
  points: { date: string; value: number }[]
  originalPoints: { date: string; value: number }[]
}

interface GraphSession {
  series: SessionSeries[]
  zoomDomain: { start: string; end: string } | null
  chartMode?: 'returns' | 'cumulative'
  cumMethod?: 'geometric' | 'arithmetic'
  cumBaseInput?: string
  showGrid?: boolean
}
```

---

## Zustand stores

### `useAppStore` — `src/renderer/store/app.ts`

**State:**
```ts
{
  activeTab: 'graph' | 'upload' | 'settings' | 'db'  // default: 'graph'
  theme: 'light' | 'dark' | 'system'                 // default: 'system'
  colorPalette: string                                // default: 'default'
  chartMaxWidth: number                               // default: 1024 (CHART_DEFAULT_WIDTH)
  customPalettes: Record<string, CustomPaletteEntry>  // default: {}
  settingsHydrated: boolean                           // default: false (CRITICAL — gates downstream hooks)
}
```

**Actions:**
- `setActiveTab(tab)` — switch tabs
- `setTheme(theme)` — update theme preference
- `setColorPalette(key)` — switch active palette
- `setChartMaxWidth(w)` — resize chart (Ctrl+scroll in GraphTab)
- `setCustomPalettes(palettes)` — bulk replace (from useHydrateSettings)
- `addCustomPalette(name, colors[], isDark)` — add with auto-generated complement
- `updateCustomPalette(oldName, newName, colors[], isDark)` — rename + update; preserves active selection
- `removeCustomPalette(name)` — delete; resets to 'default' if removed palette was active
- `setSettingsHydrated()` — flipped LAST by useHydrateSettings

**`settingsHydrated` invariant:** Ephemeral flag, never persisted. **Do not read from `getState()`** — use the Zustand hook so effects re-fire when the flag flips from false to true.

### `useGraphStore` — `src/renderer/store/graph.ts`

**State:**
```ts
{
  activeSeries: DataSeries[]           // default: []
  zoomDomain: { start: Date; end: Date } | null  // default: null (full range)
  rightPanel: 'operations' | 'addLine' | null     // default: null
  chartMode: 'returns' | 'cumulative'             // default: 'returns'
  cumMethod: 'geometric' | 'arithmetic'           // default: 'geometric'
  cumBaseInput: string                             // default: ''
  showGrid: boolean                                // default: true
}
```

**Actions:**
- `addSeries(s)` — deduplicates by id (no-op if already present)
- `removeSeries(id)` — delete series by id
- `updateSeries(id, patch: Partial<DataSeries>)` — shallow-merge patch
- `reorderSeries(newOrder: DataSeries[])` — replace entire array (drag-reorder in legend)
- `toggleSeriesVisibility(id)` — complex: toggles visible AND manages MA `hiddenWithParent` state
  - **Hiding:** mark all visible MAs as `{ visible: false, hiddenWithParent: true }`
  - **Showing:** restore only MAs with `hiddenWithParent: true`; user-hidden MAs stay hidden
- `setZoomDomain(domain | null)` — set or clear zoom range
- `setRightPanel(panel | null)` — open/close side panels
- `setChartMode(mode)`, `setCumMethod(method)`, `setCumBaseInput(input)`, `setShowGrid(show)`

### `useDBStore` — `src/renderer/store/db.ts`

**State:**
```ts
{ externalDBs: ExternalDB[] }  // default: []
```

**Actions:**
- `setExternalDBs(dbs)` — bulk replace (from useHydrateSettings)
- `addExternalDB(db)` — add new
- `removeExternalDB(id)` — remove by id
- `updateReachability(id, reachable)` — update single DB's flag (from useStartupDBCheck probes)

---

## Startup hydration sequence (5 hooks)

All five hooks are called in the root `<App>` component. Boot order is enforced by the `settingsHydrated` gate.

```
main.tsx (SYNCHRONOUS, before React):
  → read localStorage('tsv-theme') → applyTheme()  [prevents white flash]

App mounts → all 5 hooks schedule effects:

① useHydrateSettings() — useEffect([], []) — mount-only
   → ipc.settings.get() (async IPC)
   → push theme, colorPalette, chartMaxWidth → useAppStore
   → migrate pre-v3 custom palettes if needed (Array → { light, dark })
   → push externalDBs → useDBStore
   → localStorage.setItem('tsv-theme', theme) [keep cache current]
   → setSettingsHydrated() [LAST — unblocks all gated hooks]
   → cancellation guard: cleanup sets cancelled=true, resolve checks before writing

② useStartupDBCheck() — useEffect([settingsHydrated])
   → early-return while settingsHydrated === false
   → snapshot before-state: { id, reachable } for each DB
   → Promise.all(ipc.external.checkPath(path)) — parallel probes
   → per-probe cancellation check
   → updateReachability() per probe result
   → diff before/after: only call ipc.settings.save() if any flag changed
   → cancellation guard: per-probe + post-sweep

③ useAutoSaveSettings() — useEffect([settingsHydrated, theme, colorPalette, chartMaxWidth, customPalettes, externalDBs])
   → early-return while settingsHydrated === false [CRITICAL: prevents saving defaults over real values]
   → debounced save (600ms) via clearTimeout/setTimeout
   → ipc.settings.save({ theme, colorPalette, chartMaxWidth, customPalettes, externalDBs })
   → best-effort: .catch(() => {})

④ useRestoreSession() — useEffect([settingsHydrated])
   → early-return while settingsHydrated === false
   → React 18 Strict Mode guard: hasRestoredRef.current (prevents double-add)
   → ipc.session.get() → GraphSession | null
   → deserializeSeries() for each: ISO strings → Date objects, recursive MA deserialization
   → addSeries() for each, restore zoomDomain/chartMode/cumMethod/cumBaseInput/showGrid

⑤ useSessionPersistence() — useEffect([activeSeries, zoomDomain, chartMode, cumMethod, cumBaseInput, showGrid])
   → debounced save (1500ms) via clearTimeout/setTimeout
   → serializeSeries() for each: Date → ISO strings (.toISOString().slice(0, 10))
   → ipc.session.save(fullGraphSession)
   → best-effort: .catch(() => {})
```

**Timeline (first launch):**
```
t=0ms:     applyTheme('system') from localStorage cache
t=0ms:     All 5 hooks mount; ②③④ early-return (settingsHydrated=false)
t=~100ms:  ① resolves → stores populated → settingsHydrated flips true
t=~105ms:  ② re-fires → parallel DB probes
           ③ gate unblocks (no changes yet, no-op)
           ④ re-fires → ipc.session.get() → restore series
t=~150ms:  Probes + session restore complete
t=~155ms:  App.tsx palette recolor effect fires (recolors all restored series)
t=1655ms:  ⑤ debounce fires → session saved with recolored state
```

---

## Main process details

### Entry point (`src/main/index.ts`)
- `createWindow()`: BrowserWindow 1280x800 initial, 900x600 minimum, `show: false` until ready, `sandbox: false` (required for native DB), `autoHideMenuBar: true`
- App model ID: `'com.tsv.app'` (Windows integration)
- Order: `app.whenReady()` → `registerHandlers()` → `createWindow()` → handle 'activate' (macOS)
- Quit on all windows closed except macOS (Darwin platform check)

### Schema (`src/main/db/schema.ts`)
```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS series (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS series_points (
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  value     REAL NOT NULL,
  PRIMARY KEY (series_id, date)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- Settings table stores two keys: `'app'` (AppSettings JSON) and `'graph_session'` (GraphSession JSON)
- `initSchema(db)` is idempotent (IF NOT EXISTS). Called on startup and when exporting to new `.db` files.

### MemoryDB class (`src/main/db/memory.ts`)
```ts
class MemoryDB {
  constructor(db: Database.Database)
  listSeries(): DBRecord[]       // LEFT JOIN for startDate/endDate/pointCount
  getSeries(id): { id, name, code, description, points[] } | null
  saveSeries(payload): void      // Transaction: INSERT OR REPLACE series → DELETE points → INSERT points
  deleteSeries(id): void         // CASCADE handles points cleanup
}
```

- `saveSeries` uses a **transaction**: upsert series metadata, delete all existing points, insert new points one-by-one
- `MemoryDB` wraps both internal and external DBs (same implementation)

### ExternalDBReader (`src/main/db/external.ts`)
```ts
class ExternalDBReader {
  constructor(filePath: string)    // Opens readonly + fileMustExist, validates schema, throws TsvSchemaError if missing tables
  listSeries(): DBRecord[]
  getSeries(id): { ... } | null
  close(): void                    // MUST be called to prevent resource leaks
}

class TsvSchemaError extends Error {
  readonly code: 'INVALID_SCHEMA'
  readonly missingTables: string[]
}

function checkPathReachable(filePath: string): boolean  // Opens, validates, returns true/false, silently swallows errors
```

- Required tables: `['series', 'series_points']`
- Schema validation queries `sqlite_master` for table names
- Constructor closes DB on schema error before throwing

### IPC handlers (`src/main/ipc/handlers.ts`)

All registered in `registerHandlers()`. Creates the memory DB singleton:
```ts
const dbPath = path.join(app.getPath('userData'), 'memory.db')
const rawDb = new Database(dbPath)
initSchema(rawDb)
const memDB = new MemoryDB(rawDb)
```

**Settings handlers:**
- `getSettings()`: `SELECT value FROM settings WHERE key = 'app'` → parse JSON, default: `{ theme: 'system', colorPalette: 'default', externalDBs: [] }`
- `saveSettings(s)`: `INSERT OR REPLACE INTO settings (key, value) VALUES ('app', JSON.stringify(s))`

**Session handlers:**
- `getSession()`: `SELECT value FROM settings WHERE key = 'graph_session'` → parse JSON, returns `null` on parse error (silent catch)
- `saveSession(s)`: `INSERT OR REPLACE` with JSON.stringify

**External DB write handlers:**
- `EXTERNAL_SAVE_SERIES`: Creates writable Database at path, initializes schema, wraps in MemoryDB, saves, closes
- `EXTERNAL_DELETE_SERIES`: Same pattern but calls deleteSeries

**Dialog handlers:**
- `DIALOG_OPEN_DB`: async `dialog.showOpenDialog({ filters: [{ name: 'Database', extensions: ['db'] }] })` → filePath or null
- `DIALOG_SAVE_DB`: async save dialog → creates new DB at path → iterates seriesIds → fetches each from memDB → saves to output DB → returns boolean

---

## Renderer lib utilities

### `ipc.ts` — IPC wrapper + serialization layer

**`rawToDataSeries(raw, source, dbId?)`**: Converts RawSeries to DataSeries.
- Maps `new Date(p.date)` for each point
- Calls `detectFrequency(points)` for data_freq
- Shallow-clones points into `originalPoints`
- Only includes `dbId` when source === 'external'

**`serializeSeries(s: DataSeries): SessionSeries`**: Date → `toISOString().slice(0, 10)` (YYYY-MM-DD). Includes all display state, MAs.

**`deserializeSeries(s: SessionSeries): DataSeries`**: `new Date(p.date)` for points, originalPoints, MA points.

**`serializeMA(ma)`** / **`deserializeMA(ma)`**: Same date conversion for MA points.

**`ipc` namespace**: Typed wrappers. `ipc.memory.getSeries(id)` calls `window.tsv.memory.getSeries(id)` then `rawToDataSeries(raw, 'memory')`. `ipc.external.getSeries(path, id, dbId)` calls `window.tsv.external.getSeries(path, id)` then `rawToDataSeries(raw, 'external', dbId)`.

### `colors.ts` — Palette system

**Built-in palettes (PALETTES constant):**
```ts
{
  default:  ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'],  // 8 colors
  pastel:   ['#93c5fd', '#fca5a5', '#86efac', '#fde68a', '#c4b5fd', '#67e8f9', '#fed7aa', '#f9a8d4'],
  muted:    ['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6'],
  mono:     ['#1d4ed8', '#1e40af', '#1e3a8a', '#172554', '#0f172a', '#334155', '#475569', '#64748b'],
  corporate: ['#0d1e38', '#74b2e2', '#c8ddf0', '#DCD8CB', '#FF5532', '#D9F05A', '#6e7c8a'],  // 7 colors
}
```

Built-in palettes are defined in **light mode**. Dark variants generated on-the-fly.

**`generateComplement(colors: string[]): string[]`**: HSL lightness inversion (L → 100 - L). Idempotent. Hue and saturation unchanged.

**`hexToHsl(hex)`** / **`hslToHex(h, s, l)`**: Full RGB↔HSL conversion. Hex format #RRGGBB (no shorthand).

**`getAllPalettes(customPalettes, isDark)`**: Merges built-in + custom. Built-in: applies `generateComplement` if isDark. Custom: uses `.dark` array if isDark, else `.light`. Custom overrides built-in on name collision.

**`getColor(palette, index, customPalettes?, isDark?)`**: `allPalettes[palette][index % length]`. Falls back to 'default' if palette key not found.

**Deprecated alias:** `generateDarkVariant = generateComplement`.

### `transforms.ts` — Time series transforms

All operate on `DataPoint[]`, return new arrays (no mutation). All read from `originalPoints`, never from `points`.

```
toCumReturn(pts):    ((value - base) / base) * 100       First point = 0
toNormalized(pts):   (value / base) * 100                First point = 100
toGeomIndex(pts):    level *= (1 + value/100)             First point = 100 (input = % returns)
toPctChange(pts):    ((value - prev) / |prev|) * 100     First point = 0
```

- `toCumReturn` base = first point value
- `toNormalized` base = first point value
- `toGeomIndex` assumes input values are period returns (e.g., 5.2 = +5.2% monthly)
- `toPctChange` uses `Math.abs(prev)` denominator for negative prices
- All return `[]` for empty input

### `parse.ts` — CSV/Excel parsing

**`makeId()`**: `crypto.randomUUID()`

**`utcDate(year, month, day)`**: `Date.UTC(year, month-1, day)`. If year < 100, adds 2000.

**`parseDateColumn(values: string[]): Date[]`**: Column-level DD/MM vs MM/DD disambiguation.
- Regex: `/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/`
- Detection order:
  1. Non-slash values → trust native `new Date(v)` parsing
  2. Any first component > 12 → DD/MM (unambiguous)
  3. Any second component > 12 → MM/DD (unambiguous)
  4. Fully ambiguous → compare `medianGapDays` of each interpretation, choose larger median (tiebreaker: larger total span)

**`parseCSVText(csvText: string): DataSeries[]`**:
1. Replace all tabs with commas (handles pasted TSV)
2. PapaParse with `header: true, skipEmptyLines: true`
3. First column = date column
4. Filter blank-named value columns (strip Papa's `_\d+` auto-rename suffix)
5. Parse dates via `parseDateColumn()` (whole-column disambiguation)
6. Disambiguate codes: same-name columns get `_2`, `_3` suffixes on code (not name)
7. Build DataSeries for each column: filter NaN dates/values, detect frequency, clone originalPoints

**`parseExcelBuffer(buffer: ArrayBuffer): DataSeries[]`**:
1. `XLSX.read(buffer, { type: 'array', cellDates: true })` — cells with date format get type 'd'
2. First sheet only
3. Custom row builder (not `sheet_to_csv`): first column date cells → `toISOString().slice(0, 10)`, other cells → `cell.w ?? String(cell.v)` (preserves formatted display strings)
4. Join as CSV text → delegate to `parseCSVText()`
5. Why custom: XLSX `sheet_to_csv` drops Date objects → "Nov-97" format → unparseable

### `freq.ts` — Frequency detection

**Thresholds (median consecutive gap in days):**
- ≤10 days → 'daily'
- ≤45 days → 'monthly'
- ≤150 days → 'quarterly'
- else → 'yearly'

Uses **median** (not mean) — robust to outlier gaps. Lower median for even-length gap arrays (conservative).

**`detectFrequency(points[])`**: points → timestamps → sort → median gap → classify

**`inferFreqFromRecord(pointCount, startDate, endDate)`**: Uses mean gap (not median). Less accurate but works from DBRecord metadata.

**`formatFreq(freq)`**: Capitalize first letter.

### `ma.ts` — Moving average computation

**`computeRollingMA(points, window)`**: Each output point = mean of current and preceding `window-1` values. Output length: `max(0, input - window + 1)`. First `window-1` points have no output.

**`computeCenteredMA(points, window)`**: `before = floor((window-1)/2)`, `after = window - 1 - before`.
- Odd window: symmetric (e.g., window=7 → ±3)
- Even window: forward-leaning (e.g., window=6 → before=2, after=3)

**`computeMA(points, type, window)`**: Dispatcher. Returns `[]` if `points.length < window`.

### `theme.ts`

**`isDarkTheme(theme)`**: Returns boolean. For 'system': queries `window.matchMedia('(prefers-color-scheme: dark)').matches`. Static (no reactive listener).

**`applyTheme(theme)`**: Toggles `.dark` class on `document.documentElement`.

### `utils.ts`

**`cn(...inputs)`**: `twMerge(clsx(inputs))` — merges CSS classes with Tailwind conflict resolution.

---

## Data model invariants

1. **`originalPoints` is immutable.** Transforms always read from `originalPoints`, output to `points`. This prevents compounding (e.g., pct-change of already-normalized values). "Reset to Raw" copies `originalPoints` to `points`.

2. **Moving averages are ephemeral.** Computed from parent's current `points` (which may be transformed). Never persisted to DB — only stored in session. Removed when parent removed. Recomputed when transform changes.

3. **Two-level MA visibility.** `hiddenWithParent` flag distinguishes "hidden because user clicked hide on MA" vs "hidden because parent series was hidden." Parent show restores only `hiddenWithParent: true` MAs; user-hidden MAs stay hidden.

4. **Date serialization at IPC boundary.** All dates cross IPC as `YYYY-MM-DD` ISO strings (`.toISOString().slice(0, 10)`). Conversion via `rawToDataSeries`/`serializeSeries`/`deserializeSeries` in `ipc.ts`.

5. **Unreachable DBs are kept.** `AddLinePanel` filters to `reachable === true` at render time. The "add-with-false + self-heal" model preserves config when network shares are temporarily offline.

6. **Code uniqueness.** Within a single CSV upload, duplicate column names get suffixed codes (`PRICE`, `PRICE_2`). Cross-upload collisions on the DB UNIQUE constraint are a known TODO.

---

## Upload flow

```
UploadTab (mode: 'file' | 'paste')
  → FileDropZone or PasteTable parse to DataSeries[]
  → stored in local pendingSeries state (NOT pushed to graph store yet)
  → colors assigned at buffer-in time using getColor(palette, activeSeriesCount + i)
  → SeriesReviewPanel: user can edit name/code/description/freq
    → code auto-sanitized: toUpperCase() + replace(/[^A-Z0-9_]/g, '_')
  → "Add to Graph": batch-adds to graphStore via addSeries(), navigates to graph tab, clears buffer
```

Why the buffer? Re-parsing on every PasteTable keystroke must not flood the graph store. The "Back" button cleanly discards without side effects.

---

## Chart rendering (`src/renderer/components/ui/area-chart.tsx`)

~1608 lines. Most complex component.

- Built on `@visx/shape`, `@visx/scale`, `@visx/grid` — raw SVG, no recharts
- Multiple series **pivoted** into `{ date: Date, [code]: value | null, __ma__<uuid>: value | null }[]` rows. Null values produce visible gaps.
- **Zoom interactions:**
  - Scroll wheel vertical = zoom Y-axis
  - Scroll wheel horizontal = pan
  - Ctrl+scroll = widen chart width (chartMaxWidth in appStore)
  - Uses rAF batching — burst wheel events collapse to one update per frame
- **Drag-select zoom:** left-click + drag selects a time range. Edge-pan on overflow.
- **Double-click:** resets zoom to full range
- **Right-click on data point:** sets cumulative base date
- **Keyboard:** 'g' key toggles grid
- **Series cap:** `MAX_DISPLAY_POINTS = 1000` (downsampled by stride)
- **Animation:** `key={animKey}` bumped on tab navigation or series addition, replaying clip-path draw animation

### Sub-components inside area-chart.tsx:
- **ChartContext**: React context providing data, scales, tooltip, selection, lines, animation duration
- **useChartInteraction hook**: Handles left-click pan, right-click drag-select with document-level listeners
- **DateTicker**: Dual-spring month/year scroller (month scrolls every step, year only on boundary)
- **Grid**: Origin-aligned Y-axis ticks using `originAlignedYTicks()` with `niceStep()` (d3-array)
- **XAxis**: Dynamic labels with fade-out near crosshair position
- **YAxis**: Smart tick generation anchored to origin, K/M auto-scaling for large values
- **ChartTooltip**: Smart positioning (flips left when past 60% chart width)
- **BaseLine / OriginLine**: Static horizontal reference lines

### GraphTab.tsx (~1424 lines)

Hosts the chart + legend + panels.

- **pivotSeries()**: Unions all timestamps, fills nulls, includes `__ma__<uuid>` keys for moving averages
- **applyCumulativeReturns()**: Geometric or arithmetic methods, intersection-filtered, MA recomputed post-transform
- **resolveBaseDate()**: Snaps user input to nearest intersection date
- **WindowDateTicker**: Dual-spring month/year scroller for header display
- **SpinDropdown**: Wheel-to-scroll date picker
- **BaseDatePicker**: Frequency-aware spinners (year always, quarter/month/day conditionally)
- **Legend**: HTML5 drag-drop for 2D reordering (custom implementation, not Framer Reorder)
- **Animation replay**: `animKey` bumped on tab navigation and series addition

---

## SQLite schema (`src/main/db/schema.ts`)

```sql
PRAGMA foreign_keys = ON;

series       (id TEXT PK, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))
series_points(series_id TEXT NOT NULL FK→series ON DELETE CASCADE, date TEXT NOT NULL, value REAL NOT NULL, PK(series_id, date))
settings     (key TEXT PK, value TEXT NOT NULL)
```

Settings table keys: `'app'` → JSON AppSettings, `'graph_session'` → JSON GraphSession.

Foreign keys ON + CASCADE DELETE. `initSchema` is idempotent (`CREATE TABLE IF NOT EXISTS`).

External `.db` files must have at minimum `series` and `series_points` tables. `TsvSchemaError` thrown on validation failure with `.code = 'INVALID_SCHEMA'` and `.missingTables[]`.

---

## Styling conventions

- **Tailwind v4** with `@tailwindcss/vite` plugin — config inline in `globals.css` using `@theme inline`
- **Dark mode**: class-based (`.dark` on `<html>`). `@custom-variant dark (&:where(.dark, .dark *))`.
- **Design tokens (HSL)**: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring` (all have foreground variants). `--radius: 0.5rem`.
- **Chart tokens (OKLch)**: Separate chart-specific tokens in `globals.css` for both light and dark modes. `--chart-background`, `--chart-foreground`, `--chart-crosshair`, `--chart-grid`, `--chart-tooltip-*`, `--chart-label`, etc.
- **Panel animations**: right-side panels slide in with motion spring (`stiffness: 300, damping: 30`, `x: '100%' → 0`). `AnimatePresence` wraps them.
- **Stagger animations**: `staggerChildren: 0.03` for dropdown lists.
- **Never hardcode colors** for themeable surfaces — use `bg-background`, `text-foreground`, `border-border`, etc.

### shadcn/ui configuration (`components.json`)
```json
{
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/renderer/styles/globals.css", "baseColor": "zinc", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
```

---

## Testing

- Vitest with **node** environment by default, jsdom for renderer component tests (per-file `@vitest-environment jsdom`)
- Test files: `src/**/__tests__/**/*.test.{ts,tsx}`
- Setup file: `src/test/setup.ts` — `@testing-library/jest-dom/vitest` matchers + `ResizeObserver` polyfill + `afterEach(cleanup)`
- `window.tsv` is mocked in renderer tests (`vi.mock('../../lib/ipc', ...)`)
- Do NOT mock SQLite in main-process tests — those run against a real in-memory DB (deliberate, catches schema issues)
- `globals: false` — explicit imports required (`import { describe, it, expect } from 'vitest'`)

---

## Build configuration

### electron.vite.config.ts
- Main: `externalizeDepsPlugin()` (don't bundle native modules)
- Preload: `externalizeDepsPlugin()`
- Renderer: React plugin + `@tailwindcss/vite` plugin, path aliases `@` and `@renderer` → `src/renderer`

### TypeScript configs
- `tsconfig.json`: project references to `tsconfig.node.json` + `tsconfig.web.json`
- `tsconfig.node.json`: extends `@electron-toolkit/tsconfig/tsconfig.node.json`, includes main + preload + shared
- `tsconfig.web.json`: extends `@electron-toolkit/tsconfig/tsconfig.web.json`, includes renderer + preload declarations + shared, paths: `@/*` and `@renderer/*` → `src/renderer/*`, types: `@testing-library/jest-dom`

### electron-builder.yml
- App ID: `com.tsv.app`
- ASAR unpack: `resources/**`, `**/*.node`, `**/node_modules/better-sqlite3/**`
- Windows: NSIS installer, desktop shortcut
- macOS: entitlements for camera/mic/documents/downloads, notarization disabled
- Linux: AppImage + snap + deb
- Auto-update: generic HTTP provider (placeholder URL)
- Electron mirror: npmmirror.com

---

## App component details

### SeriesEditPanel (`src/renderer/components/graph/SeriesEditPanel.tsx`, ~807 lines)
Three tabs: Format, Calculations, Save.
- **Format tab**: Line style selector (solid/dashed/dotted) with SVG preview lines, line weight selector, color picker from `getAllPalettes()`
- **Calculations tab**: Moving average management. Add rolling/centered MA, set window size with frequency-aware defaults (`defaultWindow(freq)` → 3 monthly, 4 quarterly), reorderable via Framer `Reorder.Item` + `useDragControls`, `usePressAndHold` hook for hold-to-repeat spinner buttons
- **Save tab**: Multi-select dropdown with save status animations

### AddLinePanel (`src/renderer/components/graph/AddLinePanel.tsx`)
- Source dropdown: memory + external DBs (filtered to `reachable === true`)
- SeriesRow: accordion items with lazy-loaded mini chart previews
- Animation: `initial={{ opacity: 0, y: -10, scale: 0.95 }}` → `{ opacity: 1, y: 0, scale: 1 }`

### DBTab (`src/renderer/components/tabs/DBTab.tsx`, ~455 lines)
Three inner tabs: list-series, data, settings.
- **TitleDropdown**: Database name with staggered children animations
- **SeriesDropdown**: Filters data by selected series
- **SeriesList**: Deletable series table with confirmation UX
- **DataTable** (`src/renderer/components/ui/data-table.tsx`): Editable data grid with canvas font measurement for column widths, pivot transformation (union all dates, null-fill), dirty tracking (blue text), unsaved changes indicator

### Sidebar (`src/renderer/components/ui/sidebar.tsx`)
- Collapsible: `w-56` (open) to `w-16` (closed) with smooth transition
- Option component: nav button with selected state
- Logo section with gradient background, settings at bottom with separator

### PasteTable (`src/renderer/components/upload/PasteTable.tsx`)
- Grid: 2D string array, editable per-cell
- Two-stage: empty state (click to paste) → editable grid with validation
- Re-parses on every keystroke via useEffect watching grid

### ErrorBoundary (`src/renderer/ErrorBoundary.tsx`)
- Class component, `getDerivedStateFromError`, shows error + stack trace in monospace, non-recoverable

---

## Known deferred work

- **Task 15: CSV Export** — deferred indefinitely. `DIALOG_EXPORT_SERIES` IPC channel defined but no handler registered, no UI.
- **Cross-upload code collision** — two uploads with "Price" column both produce code `PRICE`, will collide on UNIQUE constraint. Save layer needs detect-and-prompt logic.
- **`electron-builder.yml`** exists but packaging has not been end-to-end tested.
- **Theme system preference listener** — `applyTheme()` is static (no `matchMedia` change listener). OS theme changes while app is open only take effect on next `applyTheme()` call.

---

## File map (complete, post-implementation)

```
src/
  main/
    index.ts                   Electron entry, BrowserWindow, registerHandlers
    db/
      schema.ts                initSchema() — CREATE TABLE IF NOT EXISTS (3 tables)
      memory.ts                MemoryDB class — CRUD for internal DB
      external.ts              ExternalDBReader + checkPathReachable + TsvSchemaError
    ipc/
      handlers.ts              All ipcMain.handle() registrations (16 channels, single file)
  preload/
    index.ts                   contextBridge → window.tsv (5 namespaces)
    index.d.ts                 TypeScript declaration for window.tsv
  renderer/
    main.tsx                   ReactDOM.createRoot + synchronous theme cache
    App.tsx                    Tab router + all 5 boot hooks + palette recolor effect
    ErrorBoundary.tsx          Class component error boundary
    store/
      app.ts                   activeTab, theme, colorPalette, chartMaxWidth, customPalettes, settingsHydrated
      graph.ts                 activeSeries, zoomDomain, rightPanel, chartMode, cumMethod, cumBaseInput, showGrid
      db.ts                    externalDBs registry with reachability
    components/
      layout/
        AppLayout.tsx          Sidebar + <main> flex container
      tabs/
        GraphTab.tsx           Chart canvas, zoom, legend, panels, cumulative mode, pivot (~1424 lines)
        UploadTab.tsx          File/Paste toggle, pendingSeries buffer, SeriesReviewPanel gate
        SettingsTab.tsx        Theme, palette, chart width, custom palettes, external DB management
        DBTab.tsx              Database browser: series list, data grid, settings (~455 lines)
      graph/
        AddLinePanel.tsx       Right panel: source dropdown + accordion series list with lazy previews
        OperationsPanel.tsx    Right panel: transform buttons (cumReturn/normalize/pctChange/raw)
        SeriesEditPanel.tsx    Inline panel: format/calculations/save tabs (~807 lines)
      upload/
        FileDropZone.tsx       Drag-drop + browse for CSV/Excel
        PasteTable.tsx         Editable paste table with per-keystroke re-parse
        SeriesReviewPanel.tsx  Review/edit parsed series: name/code/description/freq
      ui/
        area-chart.tsx         @visx AreaChart — full interactive chart (~1608 lines)
        sidebar.tsx            Collapsible nav sidebar
        segment-group.tsx      @ark-ui SegmentGroup (Selector component)
        tabs.tsx               Base UI Tabs wrapper with indicator animation
        data-table.tsx         Editable data grid with canvas measurement + pivot
        series-list.tsx        Sortable series table with mini chart previews (~335 lines)
        button.tsx / input.tsx / badge.tsx  shadcn primitives
    hooks/
      useHydrateSettings.ts    Boot: load persisted settings → push to stores → set flag
      useStartupDBCheck.ts     Boot (gated on settingsHydrated): probe external DB paths
      useAutoSaveSettings.ts   Debounced (600ms) settings persistence
      useRestoreSession.ts     Boot (gated on settingsHydrated): restore graph state
      useSessionPersistence.ts Debounced (1500ms) graph session persistence
    lib/
      ipc.ts                   Typed wrappers for window.tsv + RawSeries↔DataSeries conversion
      colors.ts                PALETTES map, getColor(), generateComplement(), HSL conversion
      transforms.ts            toCumReturn, toNormalized, toGeomIndex, toPctChange
      parse.ts                 parseCSVText, parseExcelBuffer, parseDateColumn (DD/MM detection)
      freq.ts                  detectFrequency, inferFreqFromRecord, formatFreq
      theme.ts                 applyTheme(), isDarkTheme()
      utils.ts                 cn() (clsx + tailwind-merge)
      ma.ts                    computeRollingMA, computeCenteredMA, computeMA
    styles/
      globals.css              Tailwind v4 import + shadcn tokens (HSL) + chart tokens (OKLch)
  shared/
    types.ts                   All type definitions (DataSeries, DataPoint, RawSeries, DBRecord, ExternalDB, AppSettings, GraphSession, MAComponent, etc.)
    ipc-channels.ts            enum IPC with 17 channel constants
  test/
    setup.ts                   Vitest setup (jest-dom matchers + ResizeObserver polyfill + afterEach cleanup)
docs/
  superpowers/plans/
    2026-04-14-time-series-visualiser.md   Original implementation plan (Tasks 1–15)
  team-lead-fd-substitute.md   Team-lead / FD-substitute process doc
  team-lead-fd-substitute-log.md  Log of past consultations
```

---

## Plan document

The full implementation plan lives at `docs/superpowers/plans/2026-04-14-time-series-visualiser.md`. Tasks 1–14 are substantially complete. Task 15 (CSV Export) is deferred. Divergences from the plan are annotated inline.
