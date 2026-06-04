import type { DataPoint } from '../../shared/types'

export function toCumReturn(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  const base = pts[0].value
  return pts.map(p => ({ date: p.date, value: (p.value - base) / base }))
}

export function toNormalized(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  const base = pts[0].value
  return pts.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
}

/**
 * Geometric compounding index anchored at 100.
 * Treats each data point value as a period return in decimal form
 * (e.g. 0.052 → +5.2%).  The first point is always pinned to 100; each
 * subsequent point is t_{i-1} × (1 + value_i).
 */
export function toGeomIndex(pts: DataPoint[]): DataPoint[] {
  if (pts.length === 0) return []
  let level = 100
  return pts.map((p, i) => {
    if (i > 0) level = level * (1 + p.value)
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
    return { date: p.date, value: (p.value - peak) / peak }
  })
}

/**
 * Inverse of toGrowthRates: reconstruct absolute price levels from stored
 * growth-rate points and the original first price (startingValue).
 *
 * points[0] is the 0-sentinel → value₀ = startingValue
 * points[i] carries a decimal return  → valueᵢ = (1 + gᵢ) × valueᵢ₋₁
 */
export function reconstructLevels(pts: DataPoint[], startingValue: number): DataPoint[] {
  if (pts.length === 0) return []
  let level = startingValue
  return pts.map((p, i) => {
    if (i > 0) level = level * (1 + p.value)
    return { date: p.date, value: level }
  })
}

/**
 * Normalise a level series to 100 at the given base date.
 * The base date is snapped to the nearest point (the closest timestamp wins).
 * If baseDate is null/undefined, normalises to the first point.
 *
 * Used by GraphTab's applyLevelIndex when multiple Level series are active:
 * all series are pinned to 100 at their earliest common date (or cumBaseInput).
 */
export function toLevelIndex(pts: DataPoint[], baseDate?: Date | null): DataPoint[] {
  if (pts.length === 0) return []
  let baseIdx = 0
  if (baseDate != null) {
    const targetMs = baseDate.getTime()
    let minDiff = Infinity
    for (let i = 0; i < pts.length; i++) {
      const diff = Math.abs(pts[i].date.getTime() - targetMs)
      if (diff < minDiff) { minDiff = diff; baseIdx = i }
    }
  }
  const base = pts[baseIdx].value
  if (base === 0) return pts.map(p => ({ date: p.date, value: 0 }))
  return pts.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
}

export function toPctChange(pts: DataPoint[]): DataPoint[] {
  return pts.map((p, i) => {
    if (i === 0) return { date: p.date, value: 0 }
    const prev = pts[i - 1].value
    return { date: p.date, value: (p.value - prev) / Math.abs(prev) }
  })
}
