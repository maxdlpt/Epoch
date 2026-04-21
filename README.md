# TimeSeriesVisualiser

A FRED-inspired Electron desktop application for visualising, uploading, and managing time-series data with SQLite storage. Built for financial data analysis with multi-source database support.

---

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Architecture Deep Dive](#architecture-deep-dive)
- [The Boot Sequence (and why it matters)](#the-boot-sequence-and-why-it-matters)
- [Data Model](#data-model)
- [Parsing Engine](#parsing-engine)
- [Chart System](#chart-system)
- [Transform Pipeline](#transform-pipeline)
- [Moving Averages](#moving-averages)
- [Color Palette System](#color-palette-system)
- [Session Persistence](#session-persistence)
- [External Database Support](#external-database-support)
- [Styling and Theming](#styling-and-theming)
- [Testing](#testing)
- [Build and Packaging](#build-and-packaging)
- [Gotchas, Quirks, and Non-Obvious Behaviors](#gotchas-quirks-and-non-obvious-behaviors)
- [Known Limitations](#known-limitations)
- [File Map](#file-map)

---

## Overview

TimeSeriesVisualiser is an Electron app with a React renderer that lets you:

1. **Upload** time-series data from CSV, Excel, or clipboard paste
2. **Visualise** multiple series on an interactive chart with zoom, pan, and crosshair
3. **Transform** data (cumulative returns, normalisation, percentage change, geometric index)
4. **Overlay** rolling and centered moving averages on any series
5. **Save** series to an internal SQLite database or export to external `.db` files
6. **Connect** to external SQLite databases (e.g., on network shares) as read/write data sources
7. **Persist** the full graph state (series, zoom, transforms, MAs, colors) between sessions

The UI has four tabs: **Graph** (main workspace), **Upload** (file/paste import), **DB** (database browser/editor), and **Settings** (theme, palettes, external DBs).

---

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- npm

### Installation

```bash
npm install
```

This automatically runs `electron-rebuild -f -w better-sqlite3` via the `postinstall` script. If you change Node versions, run `npm run rebuild` manually.

### Development

```bash
npm run dev
```

This starts the Electron app with Vite HMR for the renderer. DevTools open automatically.

### Type checking

```bash
npm run typecheck          # both main (node) and renderer (web)
npm run typecheck:node     # just main + preload + shared
npm run typecheck:web      # just renderer + shared
```

### Testing

```bash
npm run test               # single pass
npm run test:watch         # watch mode
```

### Building

```bash
npm run build              # typecheck + electron-vite build
npm run build:win          # package for Windows (NSIS installer)
npm run build:mac          # package for macOS
npm run build:linux        # package for Linux (AppImage + snap + deb)
```

---

## Architecture Deep Dive

The app follows Electron's process separation model strictly. Here's what lives where and why.

### Main Process (`src/main/`)

**Owns all SQLite access.** `better-sqlite3` is a native C++ module that cannot run in the renderer's sandboxed environment. All database operations go through IPC.

- **`index.ts`**: Creates the BrowserWindow (1280x800 initial, 900x600 minimum), calls `registerHandlers()` after `app.whenReady()`, then creates the window. Order matters: `app.getPath('userData')` is only valid after ready.
- **`db/schema.ts`**: Three tables: `series`, `series_points`, `settings`. Foreign keys enabled. CASCADE DELETE on points. `initSchema()` is idempotent (CREATE TABLE IF NOT EXISTS).
- **`db/memory.ts`**: `MemoryDB` class wrapping a `better-sqlite3` database. CRUD operations. `saveSeries()` uses a transaction: upsert series → delete all points → insert new points.
- **`db/external.ts`**: `ExternalDBReader` opens `.db` files read-only, validates they have the required tables (`series`, `series_points`), throws `TsvSchemaError` with `.missingTables[]` if not.
- **`ipc/handlers.ts`**: Single file registering all 16 IPC handlers. Creates the memory DB singleton at startup.

### Preload Bridge (`src/preload/`)

Exposes `window.tsv` via `contextBridge.exposeInMainWorld()`. Five namespaces: `memory`, `external`, `settings`, `dialog`, `session`. All methods return Promises via `ipcRenderer.invoke()`.

**Why not expose ipcRenderer directly?** Security. The preload bridge only exposes specific, typed methods — the renderer can't invoke arbitrary IPC channels.

### Renderer (`src/renderer/`)

React 18 app with Zustand state management. Three stores (app, graph, db), five boot hooks, and a library layer (`lib/`) that wraps all IPC calls and handles type conversion.

**Key rule: `lib/ipc.ts` is the only file that touches `window.tsv`.** Components import from `ipc.ts`, never call `window.tsv.*` directly.

---

## The Boot Sequence (and why it matters)

This is the trickiest part of the app. Five hooks must execute in a specific order, and the coordination mechanism is a single boolean flag: `settingsHydrated`.

### The Problem

On startup, the app needs to:
1. Load saved settings from SQLite (async — takes ~100ms)
2. Probe external databases for reachability (async — takes ~50ms each)
3. Restore the last graph session (async — depends on settings)
4. Start auto-saving settings and session state (must NOT run before loading completes)

If auto-save fires before hydration, it overwrites your real settings with empty defaults. If session restore fires before the external DB list is populated, external-source series can't be resolved.

### The Solution: `settingsHydrated` Gate

```
① useHydrateSettings     — loads settings from DB, populates stores, flips settingsHydrated LAST
② useStartupDBCheck      — gates on settingsHydrated, probes all external DBs in parallel
③ useAutoSaveSettings    — gates on settingsHydrated, debounced (600ms) settings persistence
④ useRestoreSession      — gates on settingsHydrated, restores graph state from DB
⑤ useSessionPersistence  — no gate needed (activeSeries is empty until ④ completes), debounced (1500ms)
```

**Critical design choice:** `settingsHydrated` must be read via the Zustand hook (reactive subscription), NOT via `getState()`. Effects that gate on this flag need to **re-fire** when it flips from false to true — `getState()` would only check once on mount and miss the flip.

### Theme Flash Prevention

IPC is async, so the theme from SQLite isn't available before the first render. Solution: `main.tsx` synchronously reads `localStorage('tsv-theme')` and calls `applyTheme()` before React renders. `useHydrateSettings` keeps this localStorage cache current after every settings load.

### React 18 Strict Mode Guard

`useRestoreSession` has a `hasRestoredRef.current` guard because Strict Mode double-mounts components in development. Without it, series would be added twice.

### Cancellation Guards

All async hooks use a `cancelled` flag in their cleanup function. If the component unmounts before the IPC promise resolves, the `.then()` callback checks `cancelled` before writing to stores. `useStartupDBCheck` goes further with per-probe cancellation — each individual probe checks the flag independently.

---

## Data Model

### The Two Representations of a Series

The app juggles two representations of the same data:

| | **DataSeries** (renderer runtime) | **RawSeries** (IPC wire format) |
|---|---|---|
| Dates | `Date` objects | ISO `YYYY-MM-DD` strings |
| Extra fields | source, dbId, color, visible, lineStyle, lineWidth, movingAverages, originalPoints, data_freq | None |
| Where it lives | Zustand stores, component props | IPC messages, SQLite |

Conversion happens in `src/renderer/lib/ipc.ts`:
- `rawToDataSeries()`: RawSeries → DataSeries (on load)
- `serializeSeries()` / `deserializeSeries()`: DataSeries ↔ SessionSeries (on session save/restore)

### `originalPoints` Invariant

Every DataSeries has two point arrays:
- `points`: What's currently displayed. May be transformed.
- `originalPoints`: The immutable raw data. Transforms always read from here.

This prevents compounding — applying "% change" to already-normalized data would produce nonsense. "Reset to Raw" simply copies `originalPoints` to `points`.

### Series Identity

- `id`: UUID from `crypto.randomUUID()`
- `code`: UPPER_SNAKE_CASE, auto-sanitized from column name. UNIQUE constraint in SQLite schema.
- `name`: Display label, may be duplicated (two series can both be named "Price" but must have codes `PRICE` and `PRICE_2`)

### DataPoint

```ts
{ date: Date, value: number }
```

Dates are always UTC (constructed via `Date.UTC()` in parsing) to avoid timezone offset issues.

---

## Parsing Engine

### CSV Parsing (`parseCSVText`)

1. **Tab normalization**: All tabs → commas (handles pasted TSV data from Excel)
2. **PapaParse**: `header: true, skipEmptyLines: true`
3. **Column detection**: First column = dates, remaining = value series
4. **Blank column filter**: Strips PapaParse's auto-rename suffix (`_\d+`), excludes empty-named columns (trailing Excel columns)
5. **Date disambiguation**: See below
6. **Code deduplication**: Same-name columns get suffixed codes: `PRICE`, `PRICE_2`, `PRICE_3`
7. **NaN filtering**: Points with invalid dates or non-numeric values are silently dropped

### Excel Parsing (`parseExcelBuffer`)

1. **XLSX read**: `{ type: 'array', cellDates: true }` — cells with date formatting get type `'d'` with real Date objects
2. **Custom row builder**: First column date cells → `.toISOString().slice(0, 10)`. Other cells → `cell.w ?? String(cell.v)` (preserves formatted display like "1.39%")
3. **Delegate to parseCSVText**: After building CSV text

**Why not use XLSX `sheet_to_csv()`?** It drops Date objects, producing formatted strings like "Nov-97" that can't be re-parsed reliably.

### Date Disambiguation (DD/MM vs MM/DD)

This is resolved at the **column level**, not row-by-row. The algorithm in `parseDateColumn()`:

1. If any value isn't in `DD/MM/YYYY` or `MM/DD/YYYY` format → trust native `new Date()` parsing
2. If any first component > 12 → unambiguously DD/MM (there's no 13th month)
3. If any second component > 12 → unambiguously MM/DD (there's no 32nd day)
4. **Fully ambiguous** (all components ≤ 12, e.g., first-of-month data):
   - Parse all dates as DD/MM, compute median consecutive gap
   - Parse all dates as MM/DD, compute median consecutive gap
   - **Choose the interpretation with the larger median gap**
   - Tiebreaker: choose the interpretation spanning more total time

**Why this works:** If the data is monthly and you incorrectly parse "01/MM/YYYY" as "January 1st through January 12th," the median gap collapses to ~1 day. The correct interpretation (1st of each month) produces a ~30-day median. The wrong interpretation always produces a smaller gap.

**Why median, not mean?** Robust to outlier gaps. A single 2-year gap in otherwise monthly data would skew the mean but not the median.

---

## Chart System

### Rendering (`area-chart.tsx`, ~1608 lines)

The chart is built entirely on `@visx` primitives (raw SVG), not on a charting library like recharts. This gives us full control over interactions.

**Data pivot**: Before rendering, all active series are merged into a single array of `{ date: Date, [code]: value | null }` rows. One row per unique date across all series. Missing values are `null`, producing visible gaps (important for financial data where series may start/end on different dates).

**Moving average keys**: MAs appear as `__ma__<uuid>` keys in the pivoted data.

### Interactions

| Input | Action |
|---|---|
| Scroll wheel (vertical) | Zoom Y-axis |
| Scroll wheel (horizontal) | Pan time axis |
| Ctrl + scroll wheel | Resize chart width |
| Left-click + drag | Drag-select time range zoom |
| Double-click | Reset zoom to full range |
| Right-click on point | Set cumulative base date |
| 'g' key | Toggle grid |

**rAF batching**: Scroll wheel events are collapsed via `requestAnimationFrame` — burst events from a single scroll gesture produce one update per frame, not one per event.

**Document-level drag handlers**: The `useChartInteraction` hook attaches `mousemove`/`mouseup` listeners to `document` (not the chart element) so drag-select continues working when the cursor leaves the chart area.

### Performance

Series are capped at `MAX_DISPLAY_POINTS = 1000` via stride-based downsampling. A 10,000-point series renders every 10th point. This keeps SVG rendering fast.

**Animation**: The chart replays its clip-path draw animation (width 0 → full) whenever `animKey` changes. This key is bumped when navigating to the graph tab or adding a new series.

### Y-Axis Ticks

Uses `originAlignedYTicks()` with `niceStep()` (from `d3-array`) to generate ticks that always include zero when the data crosses zero. This prevents the common charting issue where small positive and negative values get awkward tick positions.

### Tooltip

`ChartTooltip` uses smart positioning — it flips from right-of-cursor to left-of-cursor when past 60% of the chart width, preventing overflow.

---

## Transform Pipeline

Four transforms, all operating on `originalPoints` (never on `points`):

| Transform | Formula | First Point | Use Case |
|---|---|---|---|
| `toCumReturn` | `((v - base) / base) * 100` | 0 | Compare total return of assets starting at different prices |
| `toNormalized` | `(v / base) * 100` | 100 | Index multiple series to 100 for visual comparison |
| `toGeomIndex` | `level *= (1 + v/100)` | 100 | Compound period returns into a NAV-style index |
| `toPctChange` | `((v - prev) / |prev|) * 100` | 0 | Show period-over-period changes |

**`toGeomIndex`** is special: it assumes input values are already period returns (e.g., 5.2 = +5.2%). This is common for fund-of-funds data where you receive monthly return percentages, not NAV levels.

**After any transform**, all moving averages are recomputed from the new `points` so they stay on the same Y-axis scale.

### Cumulative Mode

GraphTab also supports a **cumulative mode** that applies geometric or arithmetic compounding across series. This is a chart-level transform (applied in `applyCumulativeReturns()` in GraphTab), not a series-level transform:
- **Geometric**: `level *= (1 + return/100)` — standard compound returns
- **Arithmetic**: `level += return` — simple additive
- A **base date** can be set (right-click on chart) to rebase all series from that point

---

## Moving Averages

### Computation (`ma.ts`)

Two types:

**Rolling (trailing)**: Mean of current point and preceding `window-1` points. Lagging — each value represents history through the current date.

**Centered**: Mean of `floor((W-1)/2)` points before and `ceil((W-1)/2)` points after. Zero lag for odd windows. Even windows are slightly forward-leaning (more future points than past).

**Window defaults** are frequency-aware: 3 for monthly, 4 for quarterly, etc.

### Lifecycle

MAs are **ephemeral overlays** attached to a parent DataSeries:
- Created in `SeriesEditPanel` → Calculations tab
- Stored as `movingAverages: MAComponent[]` on the parent DataSeries
- **Never persisted to SQLite** — only saved in the session (GraphSession)
- Automatically removed when the parent series is removed
- Recomputed whenever a transform is applied to the parent
- NOT restored when a series is re-added from the database

### Two-Level Visibility

When you hide a parent series, you expect its MAs to hide too. When you show it again, you expect them to reappear. But if you explicitly hid one MA, it should stay hidden.

This is managed via `hiddenWithParent`:
- **Hide parent**: All visible MAs get `{ visible: false, hiddenWithParent: true }`
- **Show parent**: Only MAs with `hiddenWithParent: true` get restored. User-hidden MAs (no `hiddenWithParent` flag) stay hidden.

---

## Color Palette System

### Built-in Palettes

Five built-in palettes defined in **light mode**: `default` (8 vibrant colors), `pastel` (8 soft), `muted` (8 medium), `mono` (8 blue-to-grey), `corporate` (7 corporate colors for asset class charts).

### Dark Mode Colors

Dark variants are generated on-the-fly via **HSL lightness inversion**:

```
hex → [H, S, L] → [H, S, 100-L] → hex
```

A color with 30% lightness becomes 70% lightness. Hue and saturation stay the same. This is idempotent (inverting twice returns the original).

### Custom Palettes

Users can create custom palettes. Each stores both light and dark variants:
```ts
{ light: string[], dark: string[] }
```

The dark array is auto-generated from the light array (or vice versa) using the lightness inversion. Cannot be edited separately.

**Pre-v3 migration**: Old format stored palettes as plain `string[]`. On load, `useHydrateSettings` detects this and wraps them: `{ light: oldArray, dark: generateComplement(oldArray) }`.

### Color Assignment

`getColor(palette, index, customPalettes, isDark)` returns `colors[index % colors.length]`. This means:
- Series always get consistent colors based on their position
- Colors wrap around when you have more series than palette entries
- Changing palette recolors all series (handled by App.tsx effect)

---

## Session Persistence

The app saves and restores your exact workspace between launches.

### What's Saved

Everything needed to reproduce the chart pixel-identically:
- All series (points, originalPoints, color, visible, lineStyle, lineWidth)
- Moving averages (type, window, color, visibility, computed points)
- Zoom domain (start/end dates)
- Chart mode (returns vs cumulative, method, base input)
- Grid visibility

### How It Works

`useSessionPersistence` subscribes to all graph store properties. On any change, it debounces (1500ms) then serializes the entire state and writes it to SQLite via `ipc.session.save()`.

On next launch, `useRestoreSession` reads it back and deserializes (ISO date strings → Date objects, recursive MA deserialization).

### Serialization Format

All dates become `YYYY-MM-DD` strings (`.toISOString().slice(0, 10)`). Everything else is JSON-serializable as-is.

---

## External Database Support

### Concept

External databases are `.db` files (SQLite) that follow the same schema as the internal database. They can live on local disk or network shares.

### Registration

Users add external DBs in Settings tab. Each gets an `ExternalDB` entry:
```ts
{ id: string, name: string, path: string, reachable: boolean }
```

### Reachability Self-Healing

On every startup, `useStartupDBCheck` probes each external DB:
1. Tries to open the file as a SQLite database
2. Validates the schema (must have `series` and `series_points` tables)
3. Updates the `reachable` flag

**Unreachable DBs are kept, not removed.** If your network share is temporarily offline, you don't lose the configuration. `AddLinePanel` simply filters unreachable DBs from the source dropdown.

### Reading and Writing

- **Read operations** (list, get): Open read-only, read, close. Always close in `finally` block.
- **Write operations** (save, delete): Open writable, `initSchema()` (creates tables if new file), write, close.
- The main process creates a fresh connection for each external operation (not a persistent connection).

---

## Styling and Theming

### Tailwind CSS v4

Configuration is inline in `globals.css` using `@theme inline` — no `tailwind.config.js`.

### Dark Mode

Class-based: `.dark` on `<html>`. Toggled by `applyTheme()` in `lib/theme.ts`. Three modes: light, dark, system (queries `prefers-color-scheme`).

### Design Tokens

Two token sets in `globals.css`:

**UI tokens (HSL)**: Standard shadcn/ui tokens — `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`. All have foreground variants. Exposed to Tailwind as `bg-background`, `text-foreground`, etc.

**Chart tokens (OKLch)**: Separate chart-specific tokens for perceptually uniform colors — `--chart-background`, `--chart-foreground`, `--chart-crosshair`, `--chart-grid`, `--chart-tooltip-*`, `--chart-label`. Both light and dark variants.

### Animation Conventions

- **Spring config**: `stiffness: 300, damping: 30` used consistently across all panels
- **Panel slides**: `x: '100%' → 0` with `AnimatePresence` wrapping
- **Stagger**: `staggerChildren: 0.03` for dropdown lists
- **Clip-path animation**: Chart draw animation from width 0 → full width

---

## Testing

### Setup

- **Framework**: Vitest 4.x with `@testing-library/react`
- **Environment**: `node` by default. Renderer component tests use `@vitest-environment jsdom` per-file.
- **Globals**: Disabled — explicit imports required (`import { describe, it, expect } from 'vitest'`)

### Key Testing Decisions

1. **Main process tests use a REAL SQLite database** (in-memory, not mocked). This is deliberate — mock-based DB tests once passed while a real migration failed in production. Never mock SQLite for schema/migration tests.

2. **Renderer tests mock the IPC layer**, not `window.tsv` directly. Mock target: `vi.mock('../../lib/ipc', ...)`.

3. **ResizeObserver polyfill** in `src/test/setup.ts` — needed because `@visx/responsive` and `react-use-measure` depend on it, but jsdom doesn't provide it.

### Test File Location

```
src/**/__tests__/**/*.test.{ts,tsx}
```

---

## Build and Packaging

### electron-builder Configuration

- **App ID**: `com.tsv.app`
- **Native module handling**: `better-sqlite3` is unpacked from ASAR (`asarUnpack: **/node_modules/better-sqlite3/**`). This is required because native `.node` binaries can't be loaded from inside ASAR archives.
- **Windows**: NSIS installer with desktop shortcut
- **macOS**: Entitlements for camera/mic/documents/downloads access. Notarization disabled.
- **Linux**: AppImage + snap + deb targets
- **Electron mirror**: Uses npmmirror.com (configurable)

### TypeScript Configuration

Three tsconfig files using project references:
- `tsconfig.json`: Root, references the other two
- `tsconfig.node.json`: Main + preload + shared. Extends `@electron-toolkit/tsconfig/tsconfig.node.json`.
- `tsconfig.web.json`: Renderer + preload declarations + shared. Path aliases: `@/*` and `@renderer/*` → `src/renderer/*`.

---

## Gotchas, Quirks, and Non-Obvious Behaviors

### 1. settingsHydrated Must Be Read Via Hook

```ts
// WRONG — effect won't re-fire when flag flips:
const hydrated = useAppStore.getState().settingsHydrated

// RIGHT — effect re-fires when flag changes:
const hydrated = useAppStore(s => s.settingsHydrated)
```

This is the single most important invariant in the boot sequence. Getting this wrong causes settings to be overwritten with defaults on startup.

### 2. getSession Returns Null on JSON Parse Errors (Silently)

`getSettings()` throws on invalid JSON. `getSession()` returns `null`. Different error handling because corrupted session data is recoverable (start fresh), but corrupted settings aren't.

### 3. External DB Write Creates Schema

When saving to an external `.db` file, the handler calls `initSchema()` first. This means saving to a brand-new file works (it creates the tables). But it also means you can save to a file that had a different schema — `initSchema` is additive (CREATE TABLE IF NOT EXISTS), so pre-existing tables with different columns won't be detected.

### 4. saveSeries Deletes All Points Then Re-inserts

Not a diff. Not an upsert per point. The entire points array is replaced every time. This is simpler and avoids issues with changed dates, but means saving a 10,000-point series does 10,001 SQL operations (1 delete + 10,000 inserts, inside a transaction).

### 5. DIALOG_SAVE_DB Iterates Series Without a Transaction

Each series is saved individually when exporting to a `.db` file. If the app crashes mid-export, you get a partially exported file. This hasn't been a problem in practice because exports are fast.

### 6. Excel Date Cells Require Custom Row Building

XLSX's `sheet_to_csv()` formats date cells as display strings ("Nov-97"), which can't be reliably re-parsed. The custom row builder in `parseExcelBuffer` extracts the raw Date object and converts it to ISO format directly.

### 7. Tab Key Is 'graph' | 'upload' | 'settings' | 'db'

The original plan only had three tabs. `'db'` was added later. Check for this fourth tab value in any switch/if statements.

### 8. Custom Palette Migration

Pre-v3 palettes were stored as plain `string[]` arrays. v3+ uses `{ light: string[], dark: string[] }`. `useHydrateSettings` detects the old format via `Array.isArray(entry)` and auto-migrates.

### 9. Theme System Preference Is Not Reactive

`applyTheme('system')` checks `matchMedia` once when called. It does NOT add a listener for OS theme changes. If the user switches from light to dark mode in Windows settings while the app is open, the app won't update until the next `applyTheme()` call.

### 10. Date Serialization Truncates to Date-Only

`.toISOString().slice(0, 10)` produces `YYYY-MM-DD`. Time information is discarded. All data points are effectively at midnight UTC.

### 11. MAs Are Recomputed After Transforms

When you apply a transform (e.g., normalize), MAs are recomputed from the transformed `points`, not from `originalPoints`. This is correct — you want the MA to smooth the data you're looking at.

### 12. Code Deduplication Is Per-Upload, Not Global

Two separate uploads with "Price" columns both produce code `PRICE`. This will collide on the SQLite UNIQUE constraint if both are saved. Known limitation, not yet addressed.

### 13. Empty Series Are Valid

A series with zero points (all NaN values filtered out during parsing) is valid and can be added to the graph. It just renders nothing.

### 14. Chart Pivot Includes MA Keys

The pivoted data for the chart includes `__ma__<uuid>` keys alongside regular series codes. Components that process pivoted data must be aware of this convention.

### 15. Debounce Timers Differ

Settings auto-save: **600ms**. Session auto-save: **1500ms**. Settings changes are less frequent and should feel responsive. Session changes (zoom, series add/remove) are bursty and benefit from a longer debounce.

### 16. MemoryDB Wraps Both Internal and External

The `MemoryDB` class is used for both the internal database and external databases. For external writes, a temporary `MemoryDB` is created around the external file's Database instance, used once, then the connection is closed.

### 17. Per-Probe Cancellation in useStartupDBCheck

Each external DB probe independently checks the `cancelled` flag. A slow probe that resolves after unmount won't corrupt the store, but earlier probes that already completed will have their results committed.

### 18. Pre-Render Theme Cache

`main.tsx` reads `localStorage('tsv-theme')` before React renders to prevent a white flash. This runs synchronously. The cache is updated by `useHydrateSettings` after every settings load.

### 19. Legend Uses HTML5 Drag-Drop, Not Framer Reorder

The chart legend uses native HTML5 drag-and-drop for 2D reordering. This was chosen over Framer's `Reorder` component because the legend layout is a 2D grid, not a 1D list.

### 20. Frequency Detection Uses Lower Median for Even-Length Gap Arrays

`medianGapDays` takes `gaps[Math.floor(gaps.length/2)]` for even-length arrays (the lower of the two middle values). This is conservative — it avoids false upgrades to a lower frequency classification.

---

## Known Limitations

1. **CSV Export (Task 15)**: The `DIALOG_EXPORT_SERIES` IPC channel is defined but has no handler and no UI. Deferred indefinitely.

2. **Cross-upload code collision**: Two separate uploads with a "Price" column both produce `code: 'PRICE'` and will collide on the schema's UNIQUE constraint.

3. **Electron-builder packaging**: Configuration exists (`electron-builder.yml`) but end-to-end packaging has not been tested on all platforms.

4. **No reactive theme listener**: OS theme preference changes while the app is open aren't detected until the next `applyTheme()` call.

5. **Single-sheet Excel support**: Only the first sheet of an Excel workbook is parsed.

6. **No undo/redo**: There is no undo system for chart operations (adding/removing series, applying transforms).

---

## File Map

```
/
  package.json                 Dependencies, scripts, app metadata
  electron.vite.config.ts      Vite config: main/preload/renderer builds + path aliases
  tsconfig.json                Root project references
  tsconfig.node.json           Main + preload + shared TypeScript config
  tsconfig.web.json            Renderer + shared TypeScript config + path aliases
  vitest.config.ts             Test runner config
  electron-builder.yml         Packaging config for all platforms
  components.json              shadcn/ui configuration
  CLAUDE.md                    Comprehensive agent-facing documentation
  README.md                    This file

src/
  main/
    index.ts                   Electron entry, BrowserWindow (1280x800), registerHandlers
    db/
      schema.ts                initSchema() — 3 tables, foreign keys, CASCADE DELETE
      memory.ts                MemoryDB class — CRUD for series + settings
      external.ts              ExternalDBReader (read-only) + TsvSchemaError + checkPathReachable
    ipc/
      handlers.ts              16 ipcMain.handle() registrations (single file, DB singleton)

  preload/
    index.ts                   contextBridge → window.tsv (5 namespaces, all Promise-based)
    index.d.ts                 TypeScript declaration for window.tsv

  renderer/
    main.tsx                   ReactDOM.createRoot + synchronous theme cache from localStorage
    App.tsx                    Tab router + 5 boot hooks + palette recolor effect
    ErrorBoundary.tsx          Class component error boundary (non-recoverable)

    store/
      app.ts                   UI state: activeTab, theme, colorPalette, chartMaxWidth, customPalettes, settingsHydrated
      graph.ts                 Chart state: activeSeries, zoomDomain, rightPanel, chartMode, cumMethod, cumBaseInput, showGrid
      db.ts                    External DB registry: externalDBs with reachability flags

    components/
      layout/
        AppLayout.tsx          Sidebar + <main> flex layout

      tabs/
        GraphTab.tsx           Main chart workspace: pivot, cumulative mode, zoom, legend, panels (~1424 lines)
        UploadTab.tsx          File/paste import with pendingSeries buffer
        SettingsTab.tsx        Theme, palettes, custom palettes, chart width, external DB management
        DBTab.tsx              Database browser: series list, editable data grid, DB settings (~455 lines)

      graph/
        AddLinePanel.tsx       Right slide-in: source dropdown + accordion series list with lazy previews
        OperationsPanel.tsx    Right slide-in: transform buttons (cumReturn/normalize/pctChange/raw)
        SeriesEditPanel.tsx    Inline panel: format/calculations/save tabs, MA management (~807 lines)

      upload/
        FileDropZone.tsx       Drag-drop + browse for CSV/Excel files
        PasteTable.tsx         Editable paste grid with per-keystroke re-parse
        SeriesReviewPanel.tsx  Metadata editor: name/code/description/freq before committing

      ui/
        area-chart.tsx         Full interactive @visx chart (~1608 lines, most complex component)
        sidebar.tsx            Collapsible nav (w-56 ↔ w-16)
        segment-group.tsx      @ark-ui SegmentGroup wrapper
        tabs.tsx               Base UI Tabs with animated indicator
        data-table.tsx         Editable data grid with canvas font measurement
        series-list.tsx        Sortable series table with mini chart previews (~335 lines)
        button.tsx / input.tsx / badge.tsx  shadcn primitives

    hooks/
      useHydrateSettings.ts    ① Load settings → populate stores → set flag
      useStartupDBCheck.ts     ② Probe external DBs → update reachability → save if changed
      useAutoSaveSettings.ts   ③ Debounced (600ms) settings persistence (gated)
      useRestoreSession.ts     ④ Restore graph state from session (gated, Strict Mode guard)
      useSessionPersistence.ts ⑤ Debounced (1500ms) graph session auto-save

    lib/
      ipc.ts                   Typed IPC wrappers + RawSeries↔DataSeries conversion + serialization
      colors.ts                5 palettes, getColor(), generateComplement(), HSL↔hex conversion
      transforms.ts            toCumReturn, toNormalized, toGeomIndex, toPctChange
      parse.ts                 parseCSVText, parseExcelBuffer, parseDateColumn (DD/MM disambiguation)
      freq.ts                  detectFrequency (median gap), inferFreqFromRecord, classify, formatFreq
      theme.ts                 applyTheme() (toggle .dark class), isDarkTheme()
      utils.ts                 cn() (clsx + tailwind-merge)
      ma.ts                    computeRollingMA, computeCenteredMA, computeMA

    styles/
      globals.css              Tailwind v4 + shadcn tokens (HSL) + chart tokens (OKLch) + dark mode

  shared/
    types.ts                   All type definitions (18+ interfaces/types)
    ipc-channels.ts            enum IPC with 17 channel constants

  test/
    setup.ts                   jest-dom matchers + ResizeObserver polyfill + afterEach cleanup

docs/
  superpowers/plans/
    2026-04-14-time-series-visualiser.md   Implementation plan (Tasks 1–15)
```

---

## License

MIT
