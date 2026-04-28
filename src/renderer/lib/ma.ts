import type { DataFreq, DataPoint } from '../../shared/types'

/**
 * Rolling (trailing) MA: each output point is the mean of the preceding
 * `window` points including itself.  The first `window - 1` input points
 * have no output (not enough history).
 *
 * Output dates are identical to input dates — always a subset of the
 * parent series' timestamps, so the chart pivot never grows wider.
 */
export function computeRollingMA(points: DataPoint[], window: number): DataPoint[] {
  const result: DataPoint[] = []
  for (let i = window - 1; i < points.length; i++) {
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += points[j].value
    result.push({ date: points[i].date, value: sum / window })
  }
  return result
}

/**
 * Centered MA: each output point averages `floor((W-1)/2)` points before
 * and `ceil((W-1)/2)` points after itself.  Edge points where the full
 * window doesn't fit are excluded (gaps at both ends of the series).
 *
 * For odd W (e.g. 7): symmetric ±3 points.
 * For even W (e.g. 6): 2 before + current + 3 after (slightly forward-leaning).
 */
export function computeCenteredMA(points: DataPoint[], window: number): DataPoint[] {
  const before = Math.floor((window - 1) / 2)
  const after  = window - 1 - before
  const result: DataPoint[] = []
  for (let i = before; i <= points.length - 1 - after; i++) {
    let sum = 0
    for (let j = i - before; j <= i + after; j++) sum += points[j].value
    result.push({ date: points[i].date, value: sum / window })
  }
  return result
}

/**
 * Add N calendar periods to a UTC date, respecting the series frequency.
 * Monthly/quarterly/yearly use setUTCMonth/setUTCFullYear so months with
 * different lengths don't drift.  Daily adds calendar days.
 * When freq is unknown, falls back to the median inter-point gap.
 */
function shiftDate(date: Date, n: number, freq: DataFreq | undefined): Date {
  const d = new Date(date)
  switch (freq) {
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + n)
      break
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + n * 3)
      break
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + n)
      break
    case 'daily':
      d.setUTCDate(d.getUTCDate() + n)
      break
    default:
      // Unknown freq: use median inter-point gap as one "period"
      break
  }
  return d
}

/**
 * Time-shift a series by N periods along the x-axis.
 *
 * Every date is moved forward (positive N) or backward (negative N) by
 * N calendar periods, determined by the series frequency.  All values are
 * preserved and the series length stays the same — both the start date and
 * the end date shift by the same amount.
 */
export function computeTimeShift(points: DataPoint[], n: number, freq?: DataFreq): DataPoint[] {
  if (points.length === 0 || n === 0) return points.map(p => ({ ...p }))
  return points.map(p => ({ date: shiftDate(p.date, n, freq), value: p.value }))
}

/**
 * Compute a moving average over a points array.
 * Returns an empty array if the window is larger than the available data.
 */
export function computeMA(
  points: DataPoint[],
  type: 'centered' | 'rolling',
  window: number,
): DataPoint[] {
  if (points.length < window) return []
  return type === 'rolling'
    ? computeRollingMA(points, window)
    : computeCenteredMA(points, window)
}
