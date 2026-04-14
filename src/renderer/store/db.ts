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
