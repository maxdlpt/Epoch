export interface DataPoint {
  date: Date
  value: number
}

export type DataFreq = 'daily' | 'monthly' | 'quarterly' | 'yearly'

/** Per-series transform — determines how originalPoints are mapped to display points. */
export type SeriesTransform = 'returns' | 'cumulative' | 'drawdown'

/** Data type classification: 'growth' for returns/indices; 'level' for prices/values (stored as growth rates). */
export type DataType = 'level' | 'growth'

/** Method for cumulative return calculation (only relevant when transform === 'cumulative'). */
export type CumMethod = 'geometric' | 'arithmetic'

/**
 * A moving-average overlay attached to a parent DataSeries.
 * Ephemeral — computed from the series' current display points and never
 * persisted to the DB.  Removed automatically when the parent series is
 * removed; not restored when it is re-added from the DB.
 */
export interface MAComponent {
  id: string
  type: 'centered' | 'rolling'
  window: number       // number of periods (days / months / quarters / years)
  color?: string
  visible?: boolean    // true when undefined
  hiddenWithParent?: boolean  // true when hidden because parent series was hidden; cleared on parent show
  lineStyle?: 'solid' | 'dashed' | 'dotted'  // defaults to 'dotted'
  lineWidth?: number   // stroke width in px; defaults to 1
  points: DataPoint[]  // computed; recomputed when a transform is applied
}


export interface DataSeries {
  id: string
  name: string
  code: string
  description: string
  data_freq?: DataFreq        // detected at parse/load time; omitted for single-point series
  points: DataPoint[]          // currently displayed values (= originalPoints when raw, transform output otherwise)
  originalPoints: DataPoint[]  // canonical raw values, immutable; transforms always read from this so they don't compound
  source: 'memory' | 'external'
  dbId?: string          // only when source === 'external'
  color?: string
  /** Palette slot index assigned when the series was first added to a graph.
   *  Used to reassign the correct palette colour on theme/palette change,
   *  independently of the series' current position in the array. */
  colorIndex?: number
  visible?: boolean      // true when undefined; false hides from chart without removing
  lineStyle?: 'solid' | 'dashed' | 'dotted'  // defaults to 'solid'
  lineWidth?: number     // stroke width in px; defaults to 2
  movingAverages?: MAComponent[]
  /** Shift the series N periods along the x-axis. Positive = forward (lag), negative = backward (lead). */
  timeShift?: number
  transform?: SeriesTransform    // per-series display transform; defaults to 'returns' (raw)
  cumMethod?: CumMethod          // only when transform === 'cumulative'; defaults to 'geometric'
  cumBaseInput?: string           // only when transform === 'cumulative'; '' = first date
  dataType?: DataType       // undefined treated as 'growth' for backward compat
  startingValue?: number    // only meaningful when dataType === 'level'
}

/**
 * Wire-format series as it crosses the IPC boundary: dates serialised as
 * ISO strings (YYYY-MM-DD), no renderer-only fields (source, dbId, color).
 * Consumers reshape into `DataSeries` in the renderer.
 */
export interface RawSeries {
  id: string
  name: string
  code: string
  description: string
  points: { date: string; value: number }[]
  dataType?: DataType
  startingValue?: number
}

export interface DBRecord {
  id: string
  name: string
  code: string
  description: string
  startDate: string   // ISO string
  endDate: string     // ISO string
  pointCount: number
  dataType?: DataType   // populated by listSeries(); undefined for legacy rows
}

export interface ExternalDB {
  id: string
  name: string
  path: string
  reachable: boolean
}

/**
 * A user-created colour palette with independent light-mode and dark-mode
 * colour arrays. The dark array is auto-generated from the light array on save
 * and cannot be edited separately.
 */
export interface CustomPaletteEntry {
  light: string[]
  dark: string[]
}

// ─── Graph session (persisted between launches) ───────────────────────────────

/** A moving-average overlay serialised for session storage (Date → ISO string). */
export interface SessionMA {
  id: string
  type: 'centered' | 'rolling'
  window: number
  color?: string
  visible?: boolean
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  lineWidth?: number
  points: { date: string; value: number }[]
}

/**
 * A DataSeries fully serialised for session storage.
 * Includes ALL display state — colour, transforms, MAs — so the chart is
 * pixel-identical on the next launch regardless of whether the series was
 * saved to the internal DB.
 */
export interface SessionSeries {
  id: string
  name: string
  code: string
  description: string
  data_freq?: DataFreq
  source: 'memory' | 'external'
  dbId?: string
  color?: string
  colorIndex?: number
  visible?: boolean
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  lineWidth?: number
  movingAverages?: SessionMA[]
  timeShift?: number
  transform?: SeriesTransform
  cumMethod?: CumMethod
  cumBaseInput?: string
  dataType?: DataType
  startingValue?: number
  points: { date: string; value: number }[]
  originalPoints: { date: string; value: number }[]
}

/** Complete graph state persisted between app launches. */
export interface GraphSession {
  series: SessionSeries[]
  zoomDomain: { start: string; end: string } | null
  chartMode?: 'returns' | 'cumulative' | 'drawdown'
  cumMethod?: 'geometric' | 'arithmetic'
  cumBaseInput?: string
  showGrid?: boolean
  graphTitle?: string
  savedFilename?: string      // filename in userData/graphs/ — tracks which file this graph was saved to
}

// ─── Multi-graph session (persisted between launches, version 2) ─────────────

/**
 * Envelope for persisting multiple open graphs across app restarts.
 * The `version: 2` discriminant lets the restore hook distinguish this from the
 * legacy single-graph `GraphSession` format (which has no `version` field).
 */
export interface MultiGraphSession {
  version: 2
  graphs: { id: string; session: GraphSession }[]
  activeGraphId: string | null
  graphsExpanded: boolean
}

// ─── Saved graph files (.tsv-graph) ─────────────────────────────────────────

/** Full self-contained graph snapshot — the content of a .tsv-graph JSON file. */
export interface SavedGraph {
  version: 1
  name: string
  savedAt: string          // ISO timestamp
  session: GraphSession
}

/** Lightweight metadata for listing saved graphs without loading full point data. */
export interface SavedGraphMeta {
  filename: string         // e.g. "abc123.tsv-graph"
  name: string
  savedAt: string
  seriesCount: number
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  uiTheme?: string       // UI colour theme key (e.g. 'gold', 'ocean'); absent = 'original'
  colorPalette: string   // palette key
  chartMaxWidth?: number // px; controlled by Ctrl+scroll in GraphTab; absent in pre-v2 saves
  customPalettes?: Record<string, CustomPaletteEntry>  // absent in pre-v2 saves
  externalDBs: ExternalDB[]
  /** When true, the chart only shows timestamps present in all visible series. Default false. */
  alwaysCommonDates?: boolean
}
