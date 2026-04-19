import type { DataSeries, DBRecord, AppSettings, GraphSession, MultiGraphSession, MAComponent, RawSeries, SavedGraph, SavedGraphMeta, SessionMA, SessionSeries } from '../../shared/types'
import { detectFrequency, snapToFrequency } from './freq'

function rawToDataSeries(
  raw: RawSeries,
  source: DataSeries['source'],
  dbId?: string,
): DataSeries {
  const points = raw.points.map((p) => ({ date: new Date(p.date), value: p.value }))
  const freq = detectFrequency(points)
  // Snap dates to canonical period-end (e.g. Apr 29 → Apr 30 for monthly)
  if (freq !== 'daily') {
    for (const p of points) p.date = snapToFrequency(p.date, freq)
  }
  return {
    ...raw,
    source,
    dbId,
    data_freq: freq,
    points,
    // Defensive per-element clone: 'Reset to Raw' must restore these exactly
    // even after an in-place mutation of any point's `value` or `date`.
    originalPoints: points.map((p) => ({ ...p })),
  }
}

// ─── Session serialisation helpers ────────────────────────────────────────────

function serializeMA(ma: MAComponent): SessionMA {
  return {
    id: ma.id,
    type: ma.type,
    window: ma.window,
    color: ma.color,
    visible: ma.visible,
    lineStyle: ma.lineStyle,
    lineWidth: ma.lineWidth,
    points: ma.points.map((p) => ({ date: p.date.toISOString().slice(0, 10), value: p.value })),
  }
}

function deserializeMA(ma: SessionMA): MAComponent {
  return {
    ...ma,
    points: ma.points.map((p) => ({ date: new Date(p.date), value: p.value })),
  }
}

export function serializeSeries(s: DataSeries): SessionSeries {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    description: s.description,
    data_freq: s.data_freq,
    source: s.source,
    dbId: s.dbId,
    color: s.color,
    visible: s.visible,
    lineStyle: s.lineStyle,
    lineWidth: s.lineWidth,
    movingAverages: s.movingAverages?.map(serializeMA),
    points: s.points.map((p) => ({ date: p.date.toISOString().slice(0, 10), value: p.value })),
    originalPoints: s.originalPoints.map((p) => ({ date: p.date.toISOString().slice(0, 10), value: p.value })),
  }
}

export function deserializeSeries(s: SessionSeries): DataSeries {
  const points = s.points.map((p) => ({ date: new Date(p.date), value: p.value }))
  const originalPoints = s.originalPoints.map((p) => ({ date: new Date(p.date), value: p.value }))
  return {
    ...s,
    points,
    originalPoints,
    movingAverages: s.movingAverages?.map(deserializeMA),
  }
}

export const ipc = {
  memory: {
    listSeries: (): Promise<DBRecord[]> => window.tsv.memory.listSeries(),
    getSeries: async (id: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.memory.getSeries(id)
      return raw ? rawToDataSeries(raw, 'memory') : null
    },
    saveSeries: (s: DataSeries): Promise<void> =>
      window.tsv.memory.saveSeries({
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        points: s.points.map((p) => ({
          date: p.date.toISOString().slice(0, 10),
          value: p.value,
        })),
      }),
    deleteSeries: (id: string): Promise<void> => window.tsv.memory.deleteSeries(id),
  },
  external: {
    listSeries: (path: string): Promise<DBRecord[]> => window.tsv.external.listSeries(path),
    getSeries: async (path: string, id: string, dbId: string): Promise<DataSeries | null> => {
      const raw = await window.tsv.external.getSeries(path, id)
      return raw ? rawToDataSeries(raw, 'external', dbId) : null
    },
    checkPath: (path: string): Promise<boolean> => window.tsv.external.checkPath(path),
    saveSeries: (path: string, s: DataSeries): Promise<void> =>
      window.tsv.external.saveSeries(path, {
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        points: s.points.map((p) => ({
          date: p.date.toISOString().slice(0, 10),
          value: p.value,
        })),
      }),
    deleteSeries: (path: string, id: string): Promise<void> =>
      window.tsv.external.deleteSeries(path, id),
  },
  settings: {
    get: (): Promise<AppSettings> => window.tsv.settings.get(),
    save: (s: AppSettings): Promise<void> => window.tsv.settings.save(s),
  },
  dialog: {
    openDB: (): Promise<string | null> => window.tsv.dialog.openDB(),
    saveDB: (path: string, ids: string[]): Promise<boolean> =>
      window.tsv.dialog.saveDB(path, ids),
    createDB: (): Promise<string | null> => window.tsv.dialog.createDB(),
    savePNG: (defaultName: string, pngData: Uint8Array): Promise<boolean> =>
      window.tsv.dialog.savePNG(defaultName, pngData),
    saveCSV: (defaultName: string, csvText: string): Promise<boolean> =>
      window.tsv.dialog.saveCSV(defaultName, csvText),
  },
  session: {
    get: (): Promise<GraphSession | MultiGraphSession | null> => window.tsv.session.get(),
    save: (s: GraphSession | MultiGraphSession): Promise<void> => window.tsv.session.save(s),
  },
  graph: {
    save: (payload: SavedGraph, existingFilename?: string): Promise<string> => window.tsv.graph.save(payload, existingFilename),
    list: (): Promise<SavedGraphMeta[]> => window.tsv.graph.list(),
    load: (filename: string): Promise<SavedGraph | null> => window.tsv.graph.load(filename),
    delete: (filename: string): Promise<void> => window.tsv.graph.delete(filename),
    import: (): Promise<SavedGraph | null> => window.tsv.graph.import(),
    export: (payload: SavedGraph): Promise<boolean> => window.tsv.graph.export(payload),
  },
  capture: {
    rect: (rect: { x: number; y: number; width: number; height: number }): Promise<Uint8Array | null> =>
      window.tsv.capture.rect(rect),
  },
}
