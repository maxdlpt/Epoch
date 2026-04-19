import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema'
import { MemoryDB } from '../db/memory'
import { ExternalDBReader, checkPathReachable } from '../db/external'
import { IPC } from '../../shared/ipc-channels'
import type { AppSettings, GraphSession, RawSeries, SavedGraph, SavedGraphMeta } from '../../shared/types'

export function registerHandlers(): void {
  // Singleton internal memory DB. Initialised here (not at module import time)
  // so `app.getPath('userData')` is only read after `app.whenReady()` has
  // resolved — the caller of registerHandlers is expected to do so.
  const dbPath = path.join(app.getPath('userData'), 'memory.db')
  const rawDb = new Database(dbPath)
  initSchema(rawDb)
  const memDB = new MemoryDB(rawDb)

  const getSettings = (): AppSettings => {
    const raw = rawDb.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
      | { value: string }
      | undefined
    if (!raw) return { theme: 'system', colorPalette: 'default', externalDBs: [] }
    return JSON.parse(raw.value)
  }

  const saveSettings = (s: AppSettings): void => {
    rawDb
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)")
      .run(JSON.stringify(s))
  }

  ipcMain.handle(IPC.MEMORY_LIST_SERIES, () => memDB.listSeries())
  ipcMain.handle(IPC.MEMORY_GET_SERIES, (_e, id: string) => memDB.getSeries(id))
  ipcMain.handle(IPC.MEMORY_SAVE_SERIES, (_e, payload: RawSeries) => {
    memDB.saveSeries(payload)
  })
  ipcMain.handle(IPC.MEMORY_DELETE_SERIES, (_e, id: string) => {
    memDB.deleteSeries(id)
  })

  // External DB reads: let errors propagate so the renderer's ipcRenderer.invoke
  // promise rejects. TsvSchemaError carries `code` + `missingTables` that the
  // renderer can inspect via err.message; swallowing here would throw that away.
  ipcMain.handle(IPC.EXTERNAL_LIST_SERIES, (_e, filePath: string) => {
    const reader = new ExternalDBReader(filePath)
    try {
      return reader.listSeries()
    } finally {
      reader.close()
    }
  })

  ipcMain.handle(IPC.EXTERNAL_GET_SERIES, (_e, filePath: string, id: string) => {
    const reader = new ExternalDBReader(filePath)
    try {
      return reader.getSeries(id)
    } finally {
      reader.close()
    }
  })

  ipcMain.handle(IPC.EXTERNAL_CHECK_PATH, (_e, filePath: string) => checkPathReachable(filePath))

  ipcMain.handle(IPC.EXTERNAL_SAVE_SERIES, (_e, filePath: string, payload: RawSeries) => {
    const extDb = new Database(filePath)
    initSchema(extDb)
    const extMem = new MemoryDB(extDb)
    try {
      extMem.saveSeries(payload)
    } finally {
      extDb.close()
    }
  })

  ipcMain.handle(IPC.EXTERNAL_DELETE_SERIES, (_e, filePath: string, id: string) => {
    const extDb = new Database(filePath)
    initSchema(extDb)
    const extMem = new MemoryDB(extDb)
    try {
      extMem.deleteSeries(id)
    } finally {
      extDb.close()
    }
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s: AppSettings) => {
    saveSettings(s)
  })

  const getSession = (): GraphSession | null => {
    const raw = rawDb
      .prepare("SELECT value FROM settings WHERE key = 'graph_session'")
      .get() as { value: string } | undefined
    if (!raw) return null
    try { return JSON.parse(raw.value) } catch { return null }
  }

  const saveSession = (s: GraphSession): void => {
    rawDb
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('graph_session', ?)")
      .run(JSON.stringify(s))
  }

  ipcMain.handle(IPC.SESSION_GET, () => getSession())
  ipcMain.handle(IPC.SESSION_SAVE, (_e, s: GraphSession) => {
    saveSession(s)
  })

  // ─── Saved graphs (.tsv-graph files) ──────────────────────────────────────
  const graphsDir = path.join(app.getPath('userData'), 'graphs')
  if (!fs.existsSync(graphsDir)) fs.mkdirSync(graphsDir, { recursive: true })

  ipcMain.handle(IPC.GRAPH_SAVE, (_e, payload: SavedGraph, existingFilename?: string) => {
    const filename = existingFilename ?? `${crypto.randomUUID()}.tsv-graph`
    fs.writeFileSync(path.join(graphsDir, filename), JSON.stringify(payload), 'utf-8')
    return filename
  })

  ipcMain.handle(IPC.GRAPH_LIST, (): SavedGraphMeta[] => {
    const files = fs.readdirSync(graphsDir).filter(f => f.endsWith('.tsv-graph'))
    const metas: SavedGraphMeta[] = []
    for (const filename of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(graphsDir, filename), 'utf-8')) as SavedGraph
        metas.push({
          filename,
          name: raw.name,
          savedAt: raw.savedAt,
          seriesCount: raw.session?.series?.length ?? 0,
        })
      } catch { /* skip corrupt files */ }
    }
    return metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  })

  ipcMain.handle(IPC.GRAPH_LOAD, (_e, filename: string): SavedGraph | null => {
    const filePath = path.join(graphsDir, filename)
    if (!fs.existsSync(filePath)) return null
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) } catch { return null }
  })

  ipcMain.handle(IPC.GRAPH_DELETE, (_e, filename: string) => {
    const filePath = path.join(graphsDir, filename)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  })

  ipcMain.handle(IPC.GRAPH_IMPORT, async (): Promise<SavedGraph | null> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'TSV Graph', extensions: ['tsv-graph'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    try { return JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8')) } catch { return null }
  })

  ipcMain.handle(IPC.GRAPH_EXPORT, async (_e, payload: SavedGraph) => {
    const safeName = payload.name.replace(/[^a-zA-Z0-9 _-]/g, '')
    const result = await dialog.showSaveDialog({
      defaultPath: `${safeName}.tsv-graph`,
      filters: [{ name: 'TSV Graph', extensions: ['tsv-graph'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, JSON.stringify(payload), 'utf-8')
    return true
  })

  ipcMain.handle(IPC.CAPTURE_RECT, async (_e, rect: { x: number; y: number; width: number; height: number }) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
    return image.toPNG()
  })

  ipcMain.handle(IPC.DIALOG_SAVE_PNG, async (_e, defaultName: string, pngData: Buffer) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, Buffer.from(pngData))
    return true
  })

  ipcMain.handle(IPC.DIALOG_SAVE_CSV, async (_e, defaultName: string, csvText: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'CSV File', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, csvText, 'utf-8')
    return true
  })

  ipcMain.handle(IPC.DIALOG_OPEN_DB, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Database', extensions: ['db'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_CREATE_DB, async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'New Database.db',
      filters: [{ name: 'Database', extensions: ['db'] }],
    })
    if (result.canceled || !result.filePath) return null
    const newDb = new Database(result.filePath)
    initSchema(newDb)
    newDb.close()
    return result.filePath
  })

  ipcMain.handle(IPC.DIALOG_SAVE_DB, async (_e, filePath: string, seriesIds: string[]) => {
    const result = await dialog.showSaveDialog({
      defaultPath: filePath,
      filters: [{ name: 'Database', extensions: ['db'] }],
    })
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
