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
