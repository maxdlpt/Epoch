import type { DBRecord, AppSettings, GraphSession, MultiGraphSession, RawSeries, SavedGraph, SavedGraphMeta } from '../shared/types'

export interface TsvAPI {
  memory: {
    listSeries: () => Promise<DBRecord[]>
    getSeries: (id: string) => Promise<RawSeries | null>
    saveSeries: (payload: RawSeries) => Promise<void>
    deleteSeries: (id: string) => Promise<void>
  }
  external: {
    listSeries: (path: string) => Promise<DBRecord[]>
    getSeries: (path: string, id: string) => Promise<RawSeries | null>
    checkPath: (path: string) => Promise<boolean>
    saveSeries: (path: string, payload: RawSeries) => Promise<void>
    deleteSeries: (path: string, id: string) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (s: AppSettings) => Promise<void>
  }
  dialog: {
    openDB: () => Promise<string | null>
    saveDB: (path: string, ids: string[]) => Promise<boolean>
    createDB: () => Promise<string | null>
    savePNG: (defaultName: string, pngData: Uint8Array) => Promise<boolean>
    saveCSV: (defaultName: string, csvText: string) => Promise<boolean>
  }
  session: {
    get: () => Promise<GraphSession | MultiGraphSession | null>
    save: (s: GraphSession | MultiGraphSession) => Promise<void>
  }
  graph: {
    save: (payload: SavedGraph, existingFilename?: string) => Promise<string>
    list: () => Promise<SavedGraphMeta[]>
    load: (filename: string) => Promise<SavedGraph | null>
    delete: (filename: string) => Promise<void>
    import: () => Promise<SavedGraph | null>
    export: (payload: SavedGraph) => Promise<boolean>
  }
  capture: {
    rect: (rect: { x: number; y: number; width: number; height: number }) => Promise<Uint8Array | null>
  }
}

declare global {
  interface Window {
    tsv: TsvAPI
  }
}
