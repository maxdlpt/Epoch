import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { AppSettings, GraphSession, RawSeries, SavedGraph } from '../shared/types'

contextBridge.exposeInMainWorld('tsv', {
  memory: {
    listSeries: () => ipcRenderer.invoke(IPC.MEMORY_LIST_SERIES),
    getSeries: (id: string) => ipcRenderer.invoke(IPC.MEMORY_GET_SERIES, id),
    saveSeries: (payload: RawSeries) => ipcRenderer.invoke(IPC.MEMORY_SAVE_SERIES, payload),
    deleteSeries: (id: string) => ipcRenderer.invoke(IPC.MEMORY_DELETE_SERIES, id),
  },
  external: {
    listSeries: (path: string) => ipcRenderer.invoke(IPC.EXTERNAL_LIST_SERIES, path),
    getSeries: (path: string, id: string) =>
      ipcRenderer.invoke(IPC.EXTERNAL_GET_SERIES, path, id),
    checkPath: (path: string) => ipcRenderer.invoke(IPC.EXTERNAL_CHECK_PATH, path),
    saveSeries: (path: string, payload: RawSeries) =>
      ipcRenderer.invoke(IPC.EXTERNAL_SAVE_SERIES, path, payload),
    deleteSeries: (path: string, id: string) =>
      ipcRenderer.invoke(IPC.EXTERNAL_DELETE_SERIES, path, id),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    save: (s: AppSettings) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, s),
  },
  dialog: {
    openDB: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_DB),
    saveDB: (path: string, ids: string[]) => ipcRenderer.invoke(IPC.DIALOG_SAVE_DB, path, ids),
    createDB: () => ipcRenderer.invoke(IPC.DIALOG_CREATE_DB),
    savePNG: (defaultName: string, pngData: Uint8Array) =>
      ipcRenderer.invoke(IPC.DIALOG_SAVE_PNG, defaultName, pngData),
    saveCSV: (defaultName: string, csvText: string) =>
      ipcRenderer.invoke(IPC.DIALOG_SAVE_CSV, defaultName, csvText),
  },
  session: {
    get: () => ipcRenderer.invoke(IPC.SESSION_GET),
    save: (s: GraphSession) => ipcRenderer.invoke(IPC.SESSION_SAVE, s),
  },
  graph: {
    save: (payload: SavedGraph, existingFilename?: string) => ipcRenderer.invoke(IPC.GRAPH_SAVE, payload, existingFilename),
    list: () => ipcRenderer.invoke(IPC.GRAPH_LIST),
    load: (filename: string) => ipcRenderer.invoke(IPC.GRAPH_LOAD, filename),
    delete: (filename: string) => ipcRenderer.invoke(IPC.GRAPH_DELETE, filename),
    import: () => ipcRenderer.invoke(IPC.GRAPH_IMPORT),
    export: (payload: SavedGraph) => ipcRenderer.invoke(IPC.GRAPH_EXPORT, payload),
  },
  capture: {
    rect: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC.CAPTURE_RECT, rect),
  },
})
