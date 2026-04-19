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

/**
 * Geometric compounding index anchored at 100.
 * Treats each data point value as a period return in percentage terms
 * (e.g. 5.2 → +5.2%).  The first point is always pinned to 100; each
 * subsequent point is t_{i-1} × (1 + value_i / 100).
 */
export function toGeomIndex(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  let level = 100
  return pts.map((p, i) => {
    if (i > 0) level = level * (1 + p.value / 100)
    return { date: p.date, value: level }
  })
}

/**
 * Drawdown from running peak: ((value - peak) / peak) × 100.
 * Always <= 0. Zero when at a new all-time high.
 */
export function toDrawdown(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  let peak = -Infinity
  return pts.map(p => {
    if (p.value > peak) peak = p.value
    return { date: p.date, value: ((p.value - peak) / peak) * 100 }
  })
}

export function toPctChange(pts: DataPoint[]): DataPoint[] {
  return pts.map((p, i) => {
    if (i === 0) return { date: p.date, value: 0 }
    const prev = pts[i - 1].value
    return { date: p.date, value: ((p.value - prev) / Math.abs(prev)) * 100 }
  })
}
