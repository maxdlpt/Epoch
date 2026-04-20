import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scaleTime } from '@visx/scale'
import { AreaClosed, LinePath } from '@visx/shape'
import { bisector } from 'd3-array'
import { animate, type MotionValue, motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// ─── Utils ────────────────────────────────────────────────────────────────────

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Types ────────────────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: d3 curve factory
type CurveFactory = any

type ScaleTime = ReturnType<typeof scaleTime<number>>
type ScaleLinear = ReturnType<typeof scaleLinear<number>>

export interface Margin {
  top: number
  right: number
  bottom: number
  left: number
}

export interface LineConfig {
  dataKey: string
  stroke: string
  strokeWidth: number
  yAxis?: 'left' | 'right'
}

export interface ChartSelection {
  startX: number
  endX: number
  startIndex: number
  endIndex: number
  active: boolean
  /** Original right-click position (inner-chart px) — does not change as mouse moves. */
  anchorX: number
  /** Data index nearest to anchorX — used by the anchor DateTicker. */
  anchorIndex: number
  /**
   * The date of the anchor data point. Stored so the Crosshair can re-project it
   * through the current xScale each render, keeping the anchor crosshair pinned to
   * the original data point even when the chart pans (which changes xScale).
   */
  anchorDate?: Date
}

export interface TooltipData {
  point: Record<string, unknown>
  index: number
  x: number
  yPositions: Record<string, number>
}

export interface ChartContextValue {
  data: Record<string, unknown>[]
  xScale: ScaleTime
  yScale: ScaleLinear
  /** Secondary (right) Y-axis scale. Null when there is no right axis. */
  yScaleRight: ScaleLinear | null
  width: number
  height: number
  innerWidth: number
  innerHeight: number
  margin: Margin
  columnWidth: number
  tooltipData: TooltipData | null
  setTooltipData: Dispatch<SetStateAction<TooltipData | null>>
  containerRef: RefObject<HTMLDivElement | null>
  lines: LineConfig[]
  isLoaded: boolean
  animationDuration: number
  xAccessor: (d: Record<string, unknown>) => Date
  dateLabels: string[]
  selection: ChartSelection | null
  clearSelection: () => void
  showTooltip: boolean
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ChartContext = createContext<ChartContextValue | null>(null)

function useChart(): ChartContextValue {
  const ctx = useContext(ChartContext)
  if (!ctx) throw new Error('useChart must be used within <AreaChart>')
  return ctx
}

// ─── useChartInteraction ──────────────────────────────────────────────────────
// Handlers are typed for HTMLDivElement because we mount them on a transparent
// div overlay, NOT on the SVG. This keeps the SVG pointer-events:none so it
// never intercepts clicks on buttons or panels positioned above it.

function useChartInteraction({
  xScale,
  data,
  lines,
  xAccessor,
  bisectDate,
  yScale,
  yScaleRight,
  canInteract,
  onSelectionComplete,
  onPanDelta,
  onRightClickPoint,
  freezeTooltip,
}: {
  xScale: ScaleTime
  yScale: ScaleLinear
  yScaleRight?: ScaleLinear | null
  data: Record<string, unknown>[]
  lines: LineConfig[]
  xAccessor: (d: Record<string, unknown>) => Date
  bisectDate: (data: Record<string, unknown>[], date: Date, lo: number) => number
  canInteract: boolean
  onSelectionComplete?: (startDate: Date, endDate: Date) => void
  onPanDelta?: (timeDelta: number) => void
  onRightClickPoint?: (date: Date, clientX: number, clientY: number) => void
  freezeTooltip?: boolean
}) {
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null)
  const [selection, setSelection] = useState<ChartSelection | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartIndexRef = useRef(0)
  const isPanningRef = useRef(false)
  const prevPanXRef = useRef(0)
  // Store right-click screen coordinates at mousedown so the context-menu
  // callback can position itself even though handleMouseUp has no event ref.
  const rightClickClientRef = useRef<{ x: number; y: number } | null>(null)
  // Synchronous freeze guard: set in handleContextMenu before React re-renders
  // with the freezeTooltip prop.  Cleared when freezeTooltip goes false.
  const rightClickFreezeRef = useRef(false)
  // Tracks the last known cursor position so we can re-resolve the tooltip
  // whenever xScale or data change (e.g. after a scroll-wheel zoom). Without
  // this, tooltipData.index holds a stale value from the pre-zoom dataset and
  // the DateTicker either goes out-of-bounds or scrolls past all content.
  const lastCursorXRef = useRef<number | null>(null)

  // The interaction div is positioned at (margin.left, margin.top) so
  // offsetX is already in inner-chart-space — no margin adjustment needed.

  const resolveTooltipFromX = useCallback(
    (pixelX: number): TooltipData | null => {
      const x0 = xScale.invert(pixelX)
      const index = bisectDate(data, x0, 1)
      const d0 = data[index - 1]
      const d1 = data[index]
      if (!d0) return null
      let d = d0
      let finalIndex = index - 1
      if (d1) {
        const d0t = xAccessor(d0).getTime()
        const d1t = xAccessor(d1).getTime()
        if (x0.getTime() - d0t > d1t - x0.getTime()) {
          d = d1
          finalIndex = index
        }
      }
      const yPositions: Record<string, number> = {}
      for (const line of lines) {
        const value = d[line.dataKey]
        if (typeof value === 'number') {
          const scale = (line.yAxis === 'right' && yScaleRight) ? yScaleRight : yScale
          yPositions[line.dataKey] = scale(value) ?? 0
        }
      }
      return { point: d, index: finalIndex, x: xScale(xAccessor(d)) ?? 0, yPositions }
    },
    [xScale, yScale, yScaleRight, data, lines, xAccessor, bisectDate],
  )

  const resolveIndexFromX = useCallback(
    (pixelX: number): number => {
      const x0 = xScale.invert(pixelX)
      const index = bisectDate(data, x0, 1)
      const d0 = data[index - 1]
      const d1 = data[index]
      if (!d0) return 0
      if (d1) {
        const d0t = xAccessor(d0).getTime()
        const d1t = xAccessor(d1).getTime()
        if (x0.getTime() - d0t > d1t - x0.getTime()) return index
      }
      return index - 1
    },
    [xScale, data, xAccessor, bisectDate],
  )

  // ── Edge-pan during right-click drag ─────────────────────────────────────────
  // All callbacks below are assigned to refs so they always read the latest state
  // without stale closures — same pattern as stateRef in GraphTab.
  const onPanDeltaRef            = useRef(onPanDelta)
  onPanDeltaRef.current          = onPanDelta
  const onSelectionCompleteRef   = useRef(onSelectionComplete)
  onSelectionCompleteRef.current = onSelectionComplete
  const onRightClickPointRef     = useRef(onRightClickPoint)
  onRightClickPointRef.current   = onRightClickPoint
  const chartStateRef            = useRef({ xScale, resolveTooltipFromX, resolveIndexFromX, data, xAccessor })
  chartStateRef.current          = { xScale, resolveTooltipFromX, resolveIndexFromX, data, xAccessor }
  const interactionDivRef        = useRef<HTMLDivElement>(null)
  const panRafRef                = useRef<number | null>(null)
  const edgeOverflowRef          = useRef<{ side: 'left' | 'right'; amount: number } | null>(null)
  // Stable wrappers — identity never changes so add/removeEventListener match.
  const docMouseMoveCb           = useRef<(e: MouseEvent) => void>()
  const docMouseUpCb             = useRef<(e: MouseEvent) => void>()
  // Mutable impls — reassigned every render to capture the latest ref values.
  const edgePanTickImplRef       = useRef<() => void>(() => {})
  const docMouseMoveImplRef      = useRef<(e: MouseEvent) => void>(() => {})
  const docMouseUpImplRef        = useRef<() => void>(() => {})

  edgePanTickImplRef.current = () => {
    if (!isDraggingRef.current || !edgeOverflowRef.current) { panRafRef.current = null; return }
    const { xScale: sc, resolveTooltipFromX: res, resolveIndexFromX: resIdx } = chartStateRef.current
    const panDelta = onPanDeltaRef.current
    if (!panDelta) { panRafRef.current = null; return }
    const { side, amount } = edgeOverflowRef.current
    const innerW     = sc.range()[1] as number
    const [d0, d1]   = sc.domain() as [Date, Date]
    const tPerPx     = (d1.getTime() - d0.getTime()) / innerW
    const pxPerFrame = Math.min(amount * 0.15, 30)
    panDelta(side === 'right' ? -pxPerFrame * tPerPx : pxPerFrame * tPerPx)
    const edgeX      = side === 'right' ? innerW : 0
    const edgeTip    = res(edgeX)
    const snappedX   = edgeTip?.x ?? edgeX
    const snappedIdx = edgeTip?.index ?? resIdx(edgeX)
    setSelection((cur) => ({
      startX: Math.min(dragStartXRef.current, snappedX),
      endX:   Math.max(dragStartXRef.current, snappedX),
      startIndex: Math.min(dragStartIndexRef.current, snappedIdx),
      endIndex:   Math.max(dragStartIndexRef.current, snappedIdx),
      active: true,
      anchorX:     dragStartXRef.current,
      anchorIndex: dragStartIndexRef.current,
      anchorDate:  cur?.anchorDate,
    }))
    panRafRef.current = requestAnimationFrame(() => edgePanTickImplRef.current())
  }

  docMouseMoveImplRef.current = (e: MouseEvent) => {
    if (!isDraggingRef.current) return
    const rect = interactionDivRef.current?.getBoundingClientRect()
    if (!rect) return
    const { xScale: sc, resolveTooltipFromX: res, resolveIndexFromX: resIdx } = chartStateRef.current
    const innerW     = sc.range()[1] as number
    const chartX     = e.clientX - rect.left
    const clampedX   = Math.max(0, Math.min(innerW, chartX))
    const tooltip    = res(clampedX)
    const snappedX   = tooltip?.x ?? clampedX
    const snappedIdx = tooltip?.index ?? resIdx(clampedX)
    setSelection((cur) => ({
      startX: Math.min(dragStartXRef.current, snappedX),
      endX:   Math.max(dragStartXRef.current, snappedX),
      startIndex: Math.min(dragStartIndexRef.current, snappedIdx),
      endIndex:   Math.max(dragStartIndexRef.current, snappedIdx),
      active: true,
      anchorX:     dragStartXRef.current,
      anchorIndex: dragStartIndexRef.current,
      anchorDate:  cur?.anchorDate,
    }))
    lastCursorXRef.current = clampedX
    if (tooltip) setTooltipData(tooltip)
    if (chartX < 0) {
      edgeOverflowRef.current = { side: 'left', amount: -chartX }
      if (panRafRef.current === null) panRafRef.current = requestAnimationFrame(() => edgePanTickImplRef.current())
    } else if (chartX > innerW) {
      edgeOverflowRef.current = { side: 'right', amount: chartX - innerW }
      if (panRafRef.current === null) panRafRef.current = requestAnimationFrame(() => edgePanTickImplRef.current())
    } else {
      if (panRafRef.current !== null) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null }
      edgeOverflowRef.current = null
    }
  }

  docMouseUpImplRef.current = () => {
    if (docMouseMoveCb.current) document.removeEventListener('mousemove', docMouseMoveCb.current)
    if (docMouseUpCb.current)   document.removeEventListener('mouseup',   docMouseUpCb.current)
    if (panRafRef.current !== null) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null }
    edgeOverflowRef.current = null
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    // Right-click context menu is handled by handleContextMenu (fires after
    // mouseup).  This handler only processes drag-select zoom (distance > 5px).
    setSelection((cur) => {
      if (!cur?.active) return null
      if (cur.endX - cur.startX <= 5) return null   // click, not drag — contextmenu handles it
      if (onSelectionCompleteRef.current) {
        const sc = chartStateRef.current.xScale
        const startDate = (cur.anchorDate && cur.startX === cur.anchorX)
          ? cur.anchorDate
          : sc.invert(cur.startX)
        const endDate = (cur.anchorDate && cur.endX === cur.anchorX)
          ? cur.anchorDate
          : sc.invert(cur.endX)
        onSelectionCompleteRef.current(startDate, endDate)
      }
      return null
    })
  }

  const freezeTooltipRef = useRef(freezeTooltip)
  freezeTooltipRef.current = freezeTooltip
  // When the parent signals the menu is closed, also clear the synchronous guard.
  if (!freezeTooltip) rightClickFreezeRef.current = false

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (freezeTooltipRef.current || rightClickFreezeRef.current) return
      const chartX = event.nativeEvent.offsetX
      if (isPanningRef.current) {
        // Keep cursor tracked so the crosshair follows during pan.
        // lastCursorXRef also ensures the stabilization effect re-resolves
        // against the new scale after each pan step.
        lastCursorXRef.current = chartX
        const panTooltip = resolveTooltipFromX(chartX)
        if (panTooltip) setTooltipData(panTooltip)
        const dx = chartX - prevPanXRef.current
        prevPanXRef.current = chartX
        if (dx !== 0 && onPanDelta) {
          // xScale.range() = [0, innerWidth], so range()[1] = innerWidth
          const innerWidth = xScale.range()[1] as number
          const [d0, d1] = xScale.domain() as [Date, Date]
          const timePerPixel = (d1.getTime() - d0.getTime()) / innerWidth
          onPanDelta(dx * timePerPixel)
        }
        return
      }
      if (isDraggingRef.current) {
        // Snap the moving edge to the nearest data point so the blue area
        // aligns with the black crosshair rather than following raw pixels.
        const tooltip = resolveTooltipFromX(chartX)
        const snappedX = tooltip?.x ?? chartX
        const snappedIndex = tooltip?.index ?? resolveIndexFromX(chartX)
        const anchorX = dragStartXRef.current
        const startX = Math.min(anchorX, snappedX)
        const endX = Math.max(anchorX, snappedX)
        setSelection((cur) => ({
          startX,
          endX,
          startIndex: Math.min(dragStartIndexRef.current, snappedIndex),
          endIndex: Math.max(dragStartIndexRef.current, snappedIndex),
          active: true,
          anchorX,
          anchorIndex: dragStartIndexRef.current,
          anchorDate: cur?.anchorDate,
        }))
        // Keep the moving crosshair visible during drag
        lastCursorXRef.current = chartX
        if (tooltip) setTooltipData(tooltip)
        return
      }
      lastCursorXRef.current = chartX
      const tooltip = resolveTooltipFromX(chartX)
      if (tooltip) setTooltipData(tooltip)
    },
    [resolveTooltipFromX, resolveIndexFromX, xScale, onPanDelta],
  )

  // Re-resolve tooltip when xScale/data change (e.g. scroll-wheel zoom).
  // resolveTooltipFromX gets a new reference on every zoom, so this effect
  // fires exactly when needed — no polling, no manual dep list on zoom state.
  useEffect(() => {
    const x = lastCursorXRef.current
    if (x === null) return
    const tooltip = resolveTooltipFromX(x)
    setTooltipData(tooltip ?? null)
  }, [resolveTooltipFromX])

  // Wire stable wrappers once; they delegate to the mutable impl refs so the
  // identity passed to addEventListener never changes — ensuring removeEventListener
  // can always find and detach the same listener.
  useEffect(() => {
    docMouseMoveCb.current = (e: MouseEvent) => docMouseMoveImplRef.current(e)
    docMouseUpCb.current   = () => docMouseUpImplRef.current()
    return () => {
      if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current)
      if (docMouseMoveCb.current) document.removeEventListener('mousemove', docMouseMoveCb.current)
      if (docMouseUpCb.current)   document.removeEventListener('mouseup',   docMouseUpCb.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (freezeTooltipRef.current || rightClickFreezeRef.current) return
    lastCursorXRef.current = null
    setTooltipData(null)
    // Don't cancel a right-click drag — document-level handlers take over and
    // continue tracking the cursor (including edge-pan) outside the chart bounds.
    if (!isDraggingRef.current && isPanningRef.current) {
      isPanningRef.current = false
      setIsPanning(false)
    }
  }, [])

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      // Left-click: pan — keep tooltip alive so crosshair follows during drag
      isPanningRef.current = true
      prevPanXRef.current = event.nativeEvent.offsetX
      setIsPanning(true)
    } else if (event.button === 2) {
      // Right-click: drag-select zoom (or context menu if no drag occurs).
      // Store client position now — handleMouseUp has no event ref.
      rightClickClientRef.current = { x: event.clientX, y: event.clientY }
      // Pre-position all springs at anchorX immediately (before any mousemove)
      // by setting tooltipData + selection to the anchor position right here.
      // This prevents the Crosshair spring and SegmentLine springs from animating
      // from their stale previous/zero positions at the start of the drag.
      isDraggingRef.current = true
      const anchor = resolveTooltipFromX(event.nativeEvent.offsetX)
      const anchorX = anchor?.x ?? event.nativeEvent.offsetX
      const anchorIndex = anchor?.index ?? resolveIndexFromX(event.nativeEvent.offsetX)
      dragStartXRef.current = anchorX
      dragStartIndexRef.current = anchorIndex
      const anchorDate = anchor ? xAccessor(anchor.point) : xScale.invert(anchorX)
      setTooltipData(anchor ?? null)
      setSelection({
        startX: anchorX, endX: anchorX,
        startIndex: anchorIndex, endIndex: anchorIndex,
        active: true, anchorX, anchorIndex, anchorDate,
      })
      // Attach document-level handlers so the drag continues when the cursor
      // moves outside the chart boundary (enabling edge-pan).
      if (docMouseMoveCb.current) document.addEventListener('mousemove', docMouseMoveCb.current)
      if (docMouseUpCb.current)   document.addEventListener('mouseup',   docMouseUpCb.current)
    }
  }, [resolveTooltipFromX, resolveIndexFromX])

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    // contextmenu fires reliably on every right-click release.  Compare with the
    // mousedown position to distinguish a click (≤5 px) from a drag-select.
    const down = rightClickClientRef.current
    if (!down || !onRightClickPointRef.current) return
    const dx = event.clientX - down.x
    const dy = event.clientY - down.y
    if (dx * dx + dy * dy > 25) return          // was a drag, not a click
    const chartX = event.nativeEvent.offsetX
    const date = chartStateRef.current.xScale.invert(chartX)
    rightClickFreezeRef.current = true
    onRightClickPointRef.current(date, event.clientX, event.clientY)
  }, [])

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      setIsPanning(false)
      return
    }
    // Right-click drag completion is handled exclusively by the document mouseup
    // handler (docMouseUpImplRef) so it fires whether the cursor is on- or off-chart.
    if (isDraggingRef.current) return
    setSelection(null)
  }, [])

  const clearSelection = useCallback(() => setSelection(null), [])

  const interactionHandlers = canInteract
    ? {
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
        onMouseDown: handleMouseDown,
        onMouseUp: handleMouseUp,
        onContextMenu: handleContextMenu,
      }
    : {}

  return { tooltipData, setTooltipData, selection, clearSelection, interactionHandlers, isPanning, interactionDivRef }
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

// ─── Shared Y-axis tick helpers ───────────────────────────────────────────────

/**
 * Round a raw step to the nearest "nice" value (1, 2, 5, or 10 × magnitude).
 * Uses nearest-neighbour rounding so tick density stays close to the requested
 * numTicks even when the domain range doesn't divide cleanly.
 */
function niceStep(rawStep: number): number {
  if (rawStep <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / mag
  // Partition at midpoints between candidates: 1, 2, 5, 10
  if (norm < 1.5) return 1 * mag
  if (norm < 3.5) return 2 * mag
  if (norm < 7)   return 5 * mag
  return 10 * mag
}

/**
 * Generate Y-axis tick values anchored to `origin` (0 for returns, 100 for
 * cumulative).  Ticks are spaced by a nice step derived from the domain range
 * and `numTicks`, so `origin` is always one of the grid lines regardless of
 * where it falls in the domain.
 *
 * Values outside `domain` are excluded; floating-point rounding is suppressed
 * so label strings like "99.99999…" never appear.
 */
function originAlignedYTicks(domain: [number, number], origin: number, numTicks: number): number[] {
  const [min, max] = domain
  if (max === min) return [origin]
  const step = niceStep((max - min) / Math.max(numTicks, 1))
  const eps   = step * 0.001
  // First integer multiple of step (relative to origin) that lands at or above min
  const n0    = Math.ceil((min - origin) / step)
  const ticks: number[] = []
  for (let n = n0; ; n++) {
    const v = origin + n * step
    if (v > max + eps) break
    // Suppress float drift: snap to step-scale precision
    ticks.push(Math.round(v / eps) * eps)
  }
  return ticks
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

export interface GridProps {
  horizontal?: boolean
  /** Number of grid lines (approximate — rounded to a nice step). */
  numTicksRows?: number
  /**
   * Y value that must always fall on a grid line — 0 for returns, 100 for
   * cumulative.  Grid lines spread outward from this anchor.
   */
  origin?: number
  stroke?: string
  strokeOpacity?: number
  strokeWidth?: number
  strokeDasharray?: string
}

export function Grid({
  horizontal = true,
  numTicksRows = 4,
  origin = 0,
  stroke = 'var(--chart-grid)',
  strokeOpacity = 1,
  strokeWidth = 1,
  strokeDasharray = '4,4',
}: GridProps) {
  const { yScale, innerWidth } = useChart()
  if (!horizontal) return null
  const tickValues = originAlignedYTicks(yScale.domain() as [number, number], origin, numTicksRows)
  return (
    <GridRows
      tickValues={tickValues}
      scale={yScale}
      stroke={stroke}
      strokeDasharray={strokeDasharray}
      strokeOpacity={strokeOpacity}
      strokeWidth={strokeWidth}
      width={innerWidth}
    />
  )
}

Grid.displayName = 'Grid'

// ─── XAxis ────────────────────────────────────────────────────────────────────

// Fades out when the Crosshair pill is overlapping. `tickerHalfWidth` should
// match the half-width of the DateTicker pill so labels vanish cleanly under it.

function XAxisTickLabel({
  label,
  x,
  crosshairX,
  isHovering,
  tickerHalfWidth,
}: {
  label: string
  x: number
  crosshairX: number | null
  isHovering: boolean
  tickerHalfWidth: number
}) {
  const fadeBuffer = 20
  let opacity = 1
  if (isHovering && crosshairX !== null) {
    const dist = Math.abs(x - crosshairX)
    if (dist < tickerHalfWidth) opacity = 0
    else if (dist < tickerHalfWidth + fadeBuffer) opacity = (dist - tickerHalfWidth) / fadeBuffer
  }
  return (
    <div
      className="absolute"
      style={{ left: x, bottom: 8, width: 0, display: 'flex', justifyContent: 'center' }}
    >
      <motion.span
        animate={{ opacity }}
        className="whitespace-nowrap text-xs tabular-nums"
        style={{ color: 'var(--chart-label)' }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      >
        {label}
      </motion.span>
    </div>
  )
}

export interface XAxisProps {
  numTicks?: number
  /** Half-width of the Crosshair date pill in px — labels inside this radius fade out. */
  tickerHalfWidth?: number
}

export function XAxis({ numTicks = 5, tickerHalfWidth = 45 }: XAxisProps) {
  const { xScale, margin, containerRef, tooltipData, data, xAccessor } = useChart()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const ticks = useMemo(() => {
    const n = data.length
    if (n === 0) return []
    // Step in data-point indices: at least 1 point between labels,
    // at most numTicks labels across the visible window.
    const step = Math.max(1, Math.ceil(n / numTicks))
    // Anchor at the centre data point so the tick pattern is symmetric.
    // phase = centerIdx % step ensures centerIdx is always one of the ticks.
    const centerIdx = Math.floor((n - 1) / 2)
    const phase = centerIdx % step
    const result: { x: number; label: string }[] = []
    for (let i = phase; i < n; i += step) {
      const date = xAccessor(data[i])
      result.push({
        x: (xScale(date) ?? 0) + margin.left,
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      })
    }
    return result
  }, [xScale, data, xAccessor, margin.left, numTicks])

  const isHovering = tooltipData !== null
  const crosshairX = tooltipData ? tooltipData.x + margin.left : null

  const container = containerRef.current
  if (!mounted || !container) return null

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {ticks.map((tick) => (
        <XAxisTickLabel
          crosshairX={crosshairX}
          isHovering={isHovering}
          key={`${tick.label}-${tick.x}`}
          label={tick.label}
          tickerHalfWidth={tickerHalfWidth}
          x={tick.x}
        />
      ))}
    </div>,
    container,
  )
}

XAxis.displayName = 'XAxis'

// ─── YAxis ────────────────────────────────────────────────────────────────────

export interface YAxisProps {
  numTicks?: number
  /**
   * Y value that must always have a label — 0 for returns, 100 for cumulative.
   * Must match the `origin` prop passed to `<Grid>` so labels sit on grid lines.
   */
  origin?: number
  formatValue?: (value: number) => string
}

export function YAxis({ numTicks = 4, origin = 0, formatValue }: YAxisProps) {
  const { yScale, margin, containerRef } = useChart()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setContainer(containerRef.current)
  }, [containerRef])

  const ticks = useMemo(() => {
    const domain = yScale.domain() as [number, number]
    return originAlignedYTicks(domain, origin, numTicks).map((value) => {
      const label = formatValue
        ? formatValue(value)
        : value >= 1_000_000
          ? `${(value / 1_000_000).toFixed(1)}M`
          : value >= 1_000
            ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`
            : value.toLocaleString()
      return { value, y: (yScale(value) ?? 0) + margin.top, label }
    })
  }, [yScale, margin.top, numTicks, origin, formatValue])

  if (!container) return null

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {ticks.map((tick) => (
        <div
          key={tick.value}
          className="absolute flex justify-end"
          style={{ left: 0, top: tick.y, width: margin.left - 8, transform: 'translateY(-50%)' }}
        >
          <span className="whitespace-nowrap text-xs tabular-nums" style={{ color: 'var(--chart-label)' }}>
            {tick.label}
          </span>
        </div>
      ))}
    </div>,
    container,
  )
}

YAxis.displayName = 'YAxis'

// ─── YAxisRight ───────────────────────────────────────────────────────────────

export interface YAxisRightProps {
  numTicks?: number
  /**
   * Y value that must always have a label — 0 for returns, 0 for drawdown.
   * Must match the `origin` passed to the scale so it's always rendered.
   */
  origin?: number
  formatValue?: (value: number) => string
}

export function YAxisRight({ numTicks = 4, origin = 0, formatValue }: YAxisRightProps) {
  const { yScaleRight, margin, innerWidth, containerRef } = useChart()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useEffect(() => { setContainer(containerRef.current) }, [containerRef])

  const ticks = useMemo(() => {
    if (!yScaleRight) return []
    const domain = yScaleRight.domain() as [number, number]
    return originAlignedYTicks(domain, origin, numTicks).map((value) => {
      const label = formatValue
        ? formatValue(value)
        : value >= 1_000_000
          ? `${(value / 1_000_000).toFixed(1)}M`
          : value >= 1_000
            ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`
            : value.toLocaleString()
      return { value, y: (yScaleRight(value) ?? 0) + margin.top, label }
    })
  }, [yScaleRight, margin.top, numTicks, origin, formatValue])

  if (!container || !yScaleRight) return null

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {ticks.map((tick) => (
        <div
          key={tick.value}
          className="absolute flex justify-start"
          style={{ left: margin.left + innerWidth + 8, top: tick.y, transform: 'translateY(-50%)' }}
        >
          <span className="whitespace-nowrap text-xs tabular-nums" style={{ color: 'var(--chart-label)' }}>
            {tick.label}
          </span>
        </div>
      ))}
    </div>,
    container,
  )
}

YAxisRight.displayName = 'YAxisRight'

// ─── Crosshair ────────────────────────────────────────────────────────────────

// Internal scrolling date pill shown at the crosshair's x position.
//
// Two-column design: month (left) scrolls on every step; year (right) only
// moves when the calendar year actually changes.  Both use independent springs
// so the year column freezes in place when Jan→Feb but flows when Dec→Jan.
const TICKER_ITEM_HEIGHT = 24

function DateTicker({
  currentIndex,
  labels,
  visible,
  skipAnimation = false,
}: {
  currentIndex: number
  labels: string[]
  visible: boolean
  skipAnimation?: boolean
}) {
  // Split "Jan 2000" → { month: "Jan", year: "2000" }
  const parts = useMemo(
    () =>
      labels.map((l) => {
        const sp = l.lastIndexOf(' ')
        return sp === -1 ? { month: l, year: '' } : { month: l.slice(0, sp), year: l.slice(sp + 1) }
      }),
    [labels],
  )

  // Unique years in order — the year column only has as many slots as there are
  // distinct years, so its spring position only advances on year boundaries.
  const uniqueYears = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const p of parts) {
      if (!seen.has(p.year)) { seen.add(p.year); result.push(p.year) }
    }
    return result
  }, [parts])

  const currentYearIndex = useMemo(() => {
    const year = parts[currentIndex]?.year ?? ''
    const idx = uniqueYears.indexOf(year)
    return idx === -1 ? 0 : idx
  }, [currentIndex, parts, uniqueYears])

  const monthMV = useMotionValue(0)
  const yearMV  = useMotionValue(0)

  useEffect(() => {
    const c = animate(monthMV, -currentIndex * TICKER_ITEM_HEIGHT,
      skipAnimation ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' })
    return () => c.stop()
  }, [currentIndex, monthMV, skipAnimation])

  useEffect(() => {
    const c = animate(yearMV, -currentYearIndex * TICKER_ITEM_HEIGHT,
      skipAnimation ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' })
    return () => c.stop()
  }, [currentYearIndex, yearMV, skipAnimation])

  if (!visible || labels.length === 0) return null

  const hasYear = parts.some((p) => p.year !== '')

  return (
    <div className="overflow-hidden rounded-full bg-zinc-900 px-3 py-1 text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
      <div className="flex h-6 items-center gap-1">
        {/* Month column — one slot per data point, scrolls every hover step */}
        <div className="relative h-6 overflow-hidden">
          <motion.div className="flex flex-col" style={{ y: monthMV }}>
            {parts.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
              <div className="flex h-6 shrink-0 items-center" key={i}>
                <span className="whitespace-nowrap font-medium text-sm">{p.month}</span>
              </div>
            ))}
          </motion.div>
        </div>
        {/* Year column — one slot per unique year; freezes when year unchanged */}
        {hasYear && (
          <div className="relative h-6 overflow-hidden">
            <motion.div className="flex flex-col" style={{ y: yearMV }}>
              {uniqueYears.map((year) => (
                <div className="flex h-6 shrink-0 items-center" key={year}>
                  <span className="whitespace-nowrap font-medium text-sm">{year}</span>
                </div>
              ))}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SeriesDot ────────────────────────────────────────────────────────────────
// Spring-animated circle at the crosshair intersection for one series.
// Each dot is its own component so it can legally own its own useMotionValue —
// avoids calling hooks inside a loop in the parent.

interface SeriesDotProps {
  dataKey: string
  stroke: string
  margin: Margin
  tooltipData: TooltipData | null
  /** Container-relative x MotionValue (shared from Crosshair). */
  animatedX: MotionValue<number>
  radius?: number
}

function SeriesDot({ dataKey, stroke, margin, tooltipData, animatedX, radius = 4 }: SeriesDotProps) {
  const innerY = tooltipData?.yPositions[dataKey] ?? 0
  const containerY = innerY + margin.top
  const animatedY = useMotionValue(containerY)

  useEffect(() => {
    animatedY.set(containerY)
  }, [containerY, animatedY])

  if (!tooltipData || tooltipData.yPositions[dataKey] === undefined) return null

  return (
    <motion.circle
      cx={animatedX}
      cy={animatedY}
      r={radius}
      fill={stroke}
      stroke="var(--chart-background)"
      strokeWidth={2.5}
    />
  )
}

// ─── Crosshair ────────────────────────────────────────────────────────────────

export interface CrosshairProps {
  color?: string
  opacity?: number
  /** When true the crosshair jumps instantly instead of spring-animating.
   *  Pass true while the user is zooming so the line doesn't lag behind. */
  skipAnimation?: boolean
}

/**
 * Spring-animated vertical crosshair line + date ticker pill.
 * Drop inside <AreaChart> alongside <Grid />, <XAxis />, <Area />.
 *
 * Two modes:
 *   Hover   — follows cursor with spring animation; DateTicker shows current date.
 *   Anchor  — during right-click drag-select, a static grayed crosshair stays at
 *             the point where the drag started so the user can see the start date.
 */
export function Crosshair({ color = 'var(--chart-crosshair)', opacity = 0.55, skipAnimation = false }: CrosshairProps) {
  const { tooltipData, selection, margin, innerHeight, innerWidth, containerRef, dateLabels, xScale, lines, showTooltip } = useChart()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    setContainer(containerRef.current)
  }, [containerRef])

  // ── Hover crosshair ───────────────────────────────────────────────────────
  const visible = tooltipData !== null && showTooltip
  const innerX = tooltipData?.x ?? 0

  // Instant motion values for the crosshair bar + dots — no lag.
  const animatedInnerX = useMotionValue(innerX)
  const animatedContainerX = useMotionValue(innerX + margin.left)
  // Spring-animated value for the date label pill — smooth slide between points.
  const springCfg = { stiffness: 300, damping: 30 }
  const springContainerX = useSpring(innerX + margin.left, springCfg)

  useEffect(() => {
    animatedInnerX.set(innerX)
    animatedContainerX.set(innerX + margin.left)
    springContainerX.set(innerX + margin.left)
  }, [innerX, margin.left, animatedInnerX, animatedContainerX, springContainerX])

  // ── Anchor crosshair + selection overlays (drag-select) ──────────────────
  const isSelecting = selection?.active === true
  // Re-project anchorDate through the live xScale so the crosshair stays glued
  // to the data point as the chart pans, then clamp to [0, innerWidth] so it
  // remains visible at the chart edge if the data point scrolls off-screen.
  const rawAnchorInnerX = selection?.anchorDate
    ? (xScale(selection.anchorDate) ?? selection.anchorX)
    : (selection?.anchorX ?? 0)
  const anchorInnerX    = Math.max(0, Math.min(innerWidth, rawAnchorInnerX))
  const anchorContainerX = anchorInnerX + margin.left
  const anchorIndex = selection?.anchorIndex ?? 0
  // Format the anchor date label directly from anchorDate so it never goes stale
  // when displayedData (and therefore dateLabels / anchorIndex) changes after a pan.
  const anchorLabel = selection?.anchorDate
    ? selection.anchorDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : (dateLabels[anchorIndex] ?? '')

  // Use a ref so the useTransform callbacks always read the latest anchorInnerX
  // without needing to recreate the derived MotionValues on every render.
  const anchorInnerXRef = useRef(anchorInnerX)
  anchorInnerXRef.current = anchorInnerX

  // Derive background rect position and width from the cursor spring so the
  // blue area and the black cursor animate in perfect lock-step (same source).
  const selBgX = useTransform(animatedInnerX, (x) => Math.min(anchorInnerXRef.current, x))
  const selBgW = useTransform(animatedInnerX, (x) => Math.abs(x - anchorInnerXRef.current))

  if (!container) return null

  return createPortal(
    <>
      {/* ── Selection background + lines — share animatedInnerX with black cursor ── */}
      {isSelecting && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0" height="100%" width="100%">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* Filled area between anchor and cursor */}
            <motion.rect
              fill="var(--chart-line-primary)"
              fillOpacity={0.12}
              height={innerHeight}
              rx={2}
              width={selBgW}
              x={selBgX}
              y={0}
            />
            {/* Anchor edge — static dashed line */}
            <line
              stroke="var(--chart-line-primary)"
              strokeDasharray="4,3"
              strokeOpacity={0.7}
              strokeWidth={1.5}
              x1={anchorInnerX}
              x2={anchorInnerX}
              y1={0}
              y2={innerHeight}
            />
            {/* Cursor edge — same spring as the black crosshair, always in sync */}
            <motion.line
              stroke="var(--chart-line-primary)"
              strokeDasharray="4,3"
              strokeOpacity={0.7}
              strokeWidth={1.5}
              x1={animatedInnerX}
              x2={animatedInnerX}
              y1={0}
              y2={innerHeight}
            />
          </g>
        </svg>
      )}

      {/* ── Hover crosshair — spring-animated, visible on mouse-over ── */}
      {visible && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0" height="100%" width="100%">
          <g transform={`translate(${margin.left},${margin.top})`}>
            <motion.rect fill={color} height={innerHeight} opacity={opacity} width={1} x={animatedInnerX} y={0} />
          </g>
          {/* Dots at series intersections — rendered in container coords (no <g> offset) */}
          {lines.map(line => (
            <SeriesDot
              key={line.dataKey}
              dataKey={line.dataKey}
              stroke={line.stroke}
              margin={margin}
              tooltipData={tooltipData}
              animatedX={animatedContainerX}
            />
          ))}
        </svg>
      )}
      {visible && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute z-50"
          style={{ left: springContainerX, x: '-50%', bottom: 4 }}
        >
          <DateTicker currentIndex={tooltipData?.index ?? 0} labels={dateLabels} visible={visible} skipAnimation={skipAnimation} />
        </motion.div>
      )}

      {/* ── Anchor crosshair — static, grayed, shown during drag-select ── */}
      {isSelecting && (
        <motion.svg
          aria-hidden="true"
          animate={{ opacity: 0.35 }}
          className="pointer-events-none absolute inset-0"
          height="100%"
          initial={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          width="100%"
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            <rect fill={color} height={innerHeight} width={1} x={anchorInnerX} y={0} />
          </g>
        </motion.svg>
      )}
      {isSelecting && (
        <motion.div
          aria-hidden="true"
          animate={{ opacity: 0.45 }}
          className="pointer-events-none absolute z-50"
          initial={{ opacity: 0 }}
          style={{ left: anchorContainerX, x: '-50%', bottom: 4 }}
          transition={{ duration: 0.12 }}
        >
          <DateTicker currentIndex={0} labels={[anchorLabel]} visible={true} />
        </motion.div>
      )}
    </>,
    container,
  )
}

Crosshair.displayName = 'Crosshair'

// ─── ChartTooltip ─────────────────────────────────────────────────────────────
// Floating value-readout panel that tracks the crosshair.
// Renders each series' color swatch + label + current value.
// Auto-flips to the left side when the crosshair is past 60 % of the chart width.

export interface ChartTooltipProps {
  /**
   * Custom row renderer. Return null to suppress a row.
   * When omitted a default "swatch + dataKey + value" row is used.
   */
  rows?: (dataKey: string, color: string, value: number | null) => ReactNode
  /** Value formatter. Defaults to two decimal places. */
  formatValue?: (value: number | null) => string
  /**
   * Explicit display order for dataKeys. The tooltip renders lines in this
   * order; any key not listed is appended at the end. Use this to group MA
   * lines below their parent series and match legend order.
   */
  order?: string[]
  /** Vertical anchor. 'top' (default) pins near the top axis; 'bottom' pins near the bottom. */
  anchor?: 'top' | 'bottom'
}

export function ChartTooltip({ rows, formatValue, order, anchor = 'top' }: ChartTooltipProps) {
  const { tooltipData, lines, margin, innerWidth, containerRef, showTooltip } = useChart()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    setContainer(containerRef.current)
  }, [containerRef])

  const visible = tooltipData !== null && showTooltip
  const innerX  = tooltipData?.x ?? 0
  const containerX = innerX + margin.left

  const animatedX = useSpring(containerX, { stiffness: 300, damping: 30 })
  useEffect(() => { animatedX.set(containerX) }, [containerX, animatedX])

  // Sort lines by the caller-supplied order (legend order + MA grouping).
  const orderedLines = useMemo(() => {
    if (!order || order.length === 0) return lines
    const rank = new Map(order.map((k, i) => [k, i]))
    return [...lines].sort(
      (a, b) => (rank.get(a.dataKey) ?? order.length) - (rank.get(b.dataKey) ?? order.length),
    )
  }, [lines, order])

  if (!container || !visible) return null

  // Flip the tooltip to the left of the crosshair when it's past 60 % of the
  // inner chart width so the box never runs off the right edge.
  const showLeft = containerX > margin.left + innerWidth * 0.6

  const fmt = formatValue ?? ((v: number | null) => v !== null ? v.toFixed(2) : '–')

  const posStyle = anchor === 'bottom'
    ? { left: animatedX, bottom: margin.bottom + 8 }
    : { left: animatedX, top: margin.top + 8 }

  return createPortal(
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute z-50"
      style={posStyle}
      animate={{ x: showLeft ? 'calc(-100% - 16px)' : '16px' }}
      transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
    >
      <div className="rounded-lg border border-border bg-popover/5 backdrop-blur-xs px-3 py-2 shadow-lg w-max">
        {orderedLines.map(line => {
          const raw = tooltipData?.point[line.dataKey]
          const numValue = typeof raw === 'number' ? raw : null
          if (rows) {
            const node = rows(line.dataKey, line.stroke, numValue)
            if (node == null) return null
            return <div key={line.dataKey}>{node}</div>
          }
          return (
            <div key={line.dataKey} className="flex items-center gap-2 py-0.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: line.stroke }} />
              <span className="flex-1 truncate text-xs text-popover-foreground/60">{line.dataKey}</span>
              <span className="tabular-nums text-xs font-medium text-popover-foreground">{fmt(numValue)}</span>
            </div>
          )
        })}
      </div>
    </motion.div>,
    container,
  )
}

ChartTooltip.displayName = 'ChartTooltip'

// ─── Area ─────────────────────────────────────────────────────────────────────

export interface AreaProps {
  dataKey: string
  fill?: string
  fillOpacity?: number
  stroke?: string
  strokeWidth?: number
  strokeDasharray?: string
  curve?: CurveFactory
  animate?: boolean
  /** Which Y-axis this line should be plotted against. Defaults to 'left'. */
  yAxis?: 'left' | 'right'
}

export function Area({
  dataKey,
  fill = 'var(--chart-line-primary)',
  fillOpacity = 0,
  stroke,
  strokeWidth = 2,
  strokeDasharray,
  curve = curveMonotoneX,
  animate = true,
  yAxis = 'left',
}: AreaProps) {
  const {
    data,
    xScale,
    yScale,
    yScaleRight,
    innerHeight,
    innerWidth,
    isLoaded,
    animationDuration,
    xAccessor,
    selection,
  } = useChart()

  const activeYScale = (yAxis === 'right' && yScaleRight) ? yScaleRight : yScale

  const rawId = useId()
  const idSuffix = rawId.replace(/:/g, '')
  const gradientId = `ag-${idSuffix}`
  const clipId = `ac-${idSuffix}`

  const [clipWidth, setClipWidth] = useState(0)
  const resolvedStroke = stroke ?? fill

  useEffect(() => {
    if (animate && !isLoaded) {
      requestAnimationFrame(() => setClipWidth(innerWidth))
    }
  }, [animate, innerWidth, isLoaded])

  const getY = useCallback(
    (d: Record<string, unknown>): number => {
      const v = d[dataKey]
      return typeof v === 'number' ? (activeYScale(v) ?? 0) : innerHeight
    },
    [dataKey, activeYScale, innerHeight],
  )

  const isDefined = useCallback(
    (d: Record<string, unknown>): boolean => {
      const v = d[dataKey]
      return v !== null && v !== undefined
    },
    [dataKey],
  )

  const isSelecting = selection?.active === true

  return (
    <>
      {fillOpacity > 0 && (
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: fill, stopOpacity: fillOpacity }} />
            <stop offset="100%" style={{ stopColor: fill, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
      )}

      {animate && (
        <defs>
          <clipPath id={clipId}>
            <rect
              height={innerHeight + 20}
              width={isLoaded ? innerWidth : clipWidth}
              x={0}
              y={0}
              style={{
                transition:
                  !isLoaded && clipWidth > 0
                    ? `width ${animationDuration}ms cubic-bezier(0.85, 0, 0.15, 1)`
                    : 'none',
              }}
            />
          </clipPath>
        </defs>
      )}

      <g
        clipPath={animate ? `url(#${clipId})` : undefined}
        style={{ opacity: isSelecting ? 0.35 : 1, transition: 'opacity 0.2s ease' }}
      >
        {fillOpacity > 0 && (
          <AreaClosed
            curve={curve}
            data={data}
            defined={isDefined}
            fill={`url(#${gradientId})`}
            x={(d) => xScale(xAccessor(d)) ?? 0}
            y={getY}
            yScale={activeYScale}
          />
        )}
        <LinePath
          curve={curve}
          data={data}
          defined={isDefined}
          stroke={resolvedStroke}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          x={(d) => xScale(xAccessor(d)) ?? 0}
          y={getY}
        />
      </g>
    </>
  )
}

Area.displayName = 'Area'

// ─── Selection Overlays ───────────────────────────────────────────────────────
// Selection visuals (background, anchor line, cursor line) are now rendered
// inside Crosshair so they share animatedInnerX — the same spring as the black
// cursor.  These components are kept as no-ops so existing JSX in GraphTab
// compiles without changes.

export function SegmentBackground() { return null }
SegmentBackground.displayName = 'SegmentBackground'

export function SegmentLineFrom() { return null }
SegmentLineFrom.displayName = 'SegmentLineFrom'

export function SegmentLineTo() { return null }
SegmentLineTo.displayName = 'SegmentLineTo'

// ─── OriginLine ───────────────────────────────────────────────────────────────
// Horizontal reference line at a fixed y-value (0 for returns, 100 for
// cumulative returns). Only rendered when `value` is within the visible domain.

export interface OriginLineProps {
  /** The y-axis value at which to draw the line (e.g. 0 or 100). */
  value?: number
  stroke?: string
  strokeWidth?: number
  strokeOpacity?: number
}

export function OriginLine({
  value = 0,
  stroke = 'var(--chart-label)',
  strokeWidth = 1,
  strokeOpacity = 0.45,
}: OriginLineProps) {
  const { yScale, innerWidth } = useChart()
  const [domainMin, domainMax] = yScale.domain() as [number, number]
  if (value < domainMin || value > domainMax) return null
  const y = yScale(value) ?? 0
  return (
    <line
      x1={0} y1={y} x2={innerWidth} y2={y}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeOpacity={strokeOpacity}
    />
  )
}
OriginLine.displayName = 'OriginLine'

// ─── BaseLine ─────────────────────────────────────────────────────────────────
// Vertical reference line at the cumulative-return base date.
// Styled to match OriginLine — solid, same colour and opacity.
// Only rendered when `date` is non-null and within the visible x-range.

export interface BaseLineProps {
  /** The date at which to draw the vertical reference line. */
  date: Date | null
  stroke?: string
  strokeWidth?: number
  strokeOpacity?: number
}

export function BaseLine({
  date,
  stroke = 'var(--chart-label)',
  strokeWidth = 1,
  strokeOpacity = 0.45,
}: BaseLineProps) {
  const { xScale, innerHeight } = useChart()
  if (!date) return null
  const [rangeMin, rangeMax] = xScale.range() as [number, number]
  const x = xScale(date) ?? 0
  if (x < rangeMin || x > rangeMax) return null
  return (
    <line
      x1={x} y1={0} x2={x} y2={innerHeight}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeOpacity={strokeOpacity}
    />
  )
}
BaseLine.displayName = 'BaseLine'

// ─── extractAreaConfigs ───────────────────────────────────────────────────────

function extractAreaConfigs(children: ReactNode): LineConfig[] {
  const configs: LineConfig[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const type = child.type as { displayName?: string }
    if (type.displayName !== 'Area' && child.type !== Area) return
    const props = child.props as AreaProps
    if (!props.dataKey) return
    configs.push({
      dataKey: props.dataKey,
      stroke: props.stroke ?? props.fill ?? 'var(--chart-line-primary)',
      strokeWidth: props.strokeWidth ?? 2,
      yAxis: props.yAxis,
    })
  })
  return configs
}

// ─── ChartInner ───────────────────────────────────────────────────────────────

interface ChartInnerProps {
  width: number
  height: number
  data: Record<string, unknown>[]
  xDataKey: string
  margin: Margin
  animationDuration: number
  children: ReactNode
  containerRef: RefObject<HTMLDivElement | null>
  onSelectionComplete?: (startDate: Date, endDate: Date) => void
  onPanDelta?: (timeDelta: number) => void
  onRightClickPoint?: (date: Date, clientX: number, clientY: number) => void
  freezeTooltip?: boolean
  showTooltip: boolean
  yPadTop?: number
  yClampMax?: number
  /** Explicit domain override for the left (primary) Y-axis. When provided, auto-computation from data is skipped. */
  yDomainLeft?: [number, number]
  /** Domain for the right (secondary) Y-axis. When provided, a second scale is created. */
  yDomainRight?: [number, number]
  /**
   * Pixel fraction of innerHeight used for the right axis range.
   * 1.0 (default) = full chart height; 0.3 = right axis occupies only the top 30%.
   */
  yRightPixelFraction?: number
}

function ChartInner({
  width,
  height,
  data,
  xDataKey,
  margin,
  animationDuration,
  children,
  containerRef,
  onSelectionComplete,
  onPanDelta,
  onRightClickPoint,
  freezeTooltip,
  showTooltip,
  yPadTop,
  yClampMax,
  yDomainLeft,
  yDomainRight,
  yRightPixelFraction = 1,
}: ChartInnerProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const lines = useMemo(() => extractAreaConfigs(children), [children])

  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const xAccessor = useCallback(
    (d: Record<string, unknown>): Date => {
      const v = d[xDataKey]
      return v instanceof Date ? v : new Date(v as string | number)
    },
    [xDataKey],
  )

  const bisectDate = useMemo(
    () => bisector<Record<string, unknown>, Date>((d) => xAccessor(d)).left,
    [xAccessor],
  )

  const xScale = useMemo(() => {
    const dates = data.map((d) => xAccessor(d))
    const minTime = Math.min(...dates.map((d) => d.getTime()))
    const maxTime = Math.max(...dates.map((d) => d.getTime()))
    return scaleTime({ range: [0, innerWidth], domain: [minTime, maxTime] })
  }, [innerWidth, data, xAccessor])

  const columnWidth = useMemo(
    () => (data.length < 2 ? 0 : innerWidth / (data.length - 1)),
    [innerWidth, data.length],
  )

  const yScale = useMemo(() => {
    // When an explicit left domain is provided, skip auto-computation.
    if (yDomainLeft) {
      return scaleLinear({ range: [innerHeight, 0], domain: yDomainLeft, nice: false })
    }
    // Auto-compute from left-axis lines only (exclude right-axis lines so their
    // data range doesn't inflate or compress the left scale).
    const leftLines = lines.filter(l => l.yAxis !== 'right')
    let minValue = Infinity
    let maxValue = -Infinity
    for (const line of leftLines) {
      for (const d of data) {
        const v = d[line.dataKey]
        if (typeof v === 'number') {
          if (v < minValue) minValue = v
          if (v > maxValue) maxValue = v
        }
      }
    }
    // Fallback when data is empty or all non-numeric
    if (!isFinite(minValue)) { minValue = 0; maxValue = 100 }
    // Pad 10% of the value range on each side so lines don't kiss the axes.
    // yPadTop overrides the top padding (useful for drawdown charts where all
    // values are ≤ 0 and the origin would otherwise hug the top edge).
    const span = maxValue - minValue || Math.abs(maxValue) || 100
    const topPad = yPadTop ?? 0.1
    let domainMax = maxValue + span * topPad
    if (yClampMax !== undefined) domainMax = Math.min(domainMax, yClampMax)
    return scaleLinear({
      range: [innerHeight, 0],
      domain: [minValue - span * 0.1, domainMax],
      nice: true,
    })
  }, [innerHeight, data, lines, yPadTop, yClampMax, yDomainLeft])

  const yScaleRight = useMemo(() => {
    if (!yDomainRight) return null
    // The right axis pixel range: full height by default, or a top fraction for drawdown.
    const pixelBottom = innerHeight * yRightPixelFraction
    return scaleLinear({ range: [pixelBottom, 0], domain: yDomainRight, nice: false })
  }, [innerHeight, yDomainRight, yRightPixelFraction])

  // "Jan 2000" format — used by the Crosshair DateTicker pill.
  // month+year is more informative than month+day for financial time-series.
  const dateLabels = useMemo(
    () =>
      data.map((d) => {
        const date = xAccessor(d)
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      }),
    [data, xAccessor],
  )

  useEffect(() => {
    const t = setTimeout(() => setIsLoaded(true), animationDuration)
    return () => clearTimeout(t)
  }, [animationDuration])

  const { tooltipData, setTooltipData, selection, clearSelection, interactionHandlers, isPanning, interactionDivRef } =
    useChartInteraction({
      xScale,
      yScale,
      yScaleRight,
      data,
      lines,
      xAccessor,
      bisectDate,
      canInteract: isLoaded,
      onSelectionComplete,
      onPanDelta,
      onRightClickPoint,
      freezeTooltip,
    })

  if (width < 10 || height < 10) return null

  const contextValue: ChartContextValue = {
    data,
    xScale,
    yScale,
    yScaleRight,
    width,
    height,
    innerWidth,
    innerHeight,
    margin,
    columnWidth,
    tooltipData,
    setTooltipData,
    containerRef,
    lines,
    isLoaded,
    animationDuration,
    xAccessor,
    dateLabels,
    selection,
    clearSelection,
    showTooltip,
  }

  return (
    <ChartContext.Provider value={contextValue}>
      {/* SVG is purely for rendering — pointer-events:none ensures it never
          intercepts clicks meant for buttons or panels rendered above it. */}
      <svg
        aria-hidden="true"
        height={height}
        width={width}
        style={{ display: 'block', pointerEvents: 'none' }}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {Children.map(children, (child) => (isValidElement(child) ? child : null))}
        </g>
      </svg>

      {/* Transparent HTML div overlay for pointer events.
          Explicit pointerEvents: 'auto' re-enables events here because the
          AreaChart outer container sets pointerEvents: 'none' (to prevent the
          container itself from intercepting clicks on overlaid buttons). */}
      <div
        ref={interactionDivRef}
        {...interactionHandlers}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: margin.left,
          top: margin.top,
          width: innerWidth,
          height: innerHeight,
          cursor: !showTooltip ? 'default' : isLoaded ? (isPanning ? 'grabbing' : 'crosshair') : 'default',
          userSelect: 'none',
          pointerEvents: 'auto',
        }}
      />
    </ChartContext.Provider>
  )
}

// ─── AreaChart ────────────────────────────────────────────────────────────────

const DEFAULT_MARGIN: Margin = { top: 24, right: 24, bottom: 40, left: 56 }

export interface AreaChartProps {
  data: Record<string, unknown>[]
  xDataKey?: string
  margin?: Partial<Margin>
  animationDuration?: number
  aspectRatio?: string
  className?: string
  children: ReactNode
  onSelectionComplete?: (startDate: Date, endDate: Date) => void
  onPanDelta?: (timeDelta: number) => void
  onRightClickPoint?: (date: Date, clientX: number, clientY: number) => void
  freezeTooltip?: boolean
  showTooltip?: boolean
  /** Override top Y-axis padding as a fraction of the value range (default 0.1 = 10%). */
  yPadTop?: number
  /** Hard upper bound for the Y-axis domain (e.g. 0 for drawdown charts). */
  yClampMax?: number
  /** Explicit domain override for the left (primary) Y-axis. */
  yDomainLeft?: [number, number]
  /** Domain for the right (secondary) Y-axis. When provided, a second scale and axis are available. */
  yDomainRight?: [number, number]
  /**
   * Pixel fraction of chart height used for the right axis.
   * 1.0 = full height (default); 0.3 = right axis occupies only the top 30%.
   */
  yRightPixelFraction?: number
}

export function AreaChart({
  data,
  xDataKey = 'date',
  margin: marginProp,
  animationDuration = 800,
  aspectRatio = '2 / 1',
  className = '',
  children,
  onSelectionComplete,
  onPanDelta,
  onRightClickPoint,
  freezeTooltip,
  showTooltip = true,
  yPadTop,
  yClampMax,
  yDomainLeft,
  yDomainRight,
  yRightPixelFraction,
}: AreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const margin = { ...DEFAULT_MARGIN, ...marginProp }

  return (
    <div
      className={cn('relative w-full', className)}
      ref={containerRef}
      style={{ aspectRatio, touchAction: 'none', pointerEvents: 'none' }}
    >
      <ParentSize debounceTime={10}>
        {({ width, height }) => (
          <ChartInner
            animationDuration={animationDuration}
            containerRef={containerRef}
            data={data}
            height={height}
            margin={margin}
            onSelectionComplete={onSelectionComplete}
            onPanDelta={onPanDelta}
            onRightClickPoint={onRightClickPoint}
            freezeTooltip={freezeTooltip}
            showTooltip={showTooltip}
            width={width}
            xDataKey={xDataKey}
            yPadTop={yPadTop}
            yClampMax={yClampMax}
            yDomainLeft={yDomainLeft}
            yDomainRight={yDomainRight}
            yRightPixelFraction={yRightPixelFraction}
          >
            {children}
          </ChartInner>
        )}
      </ParentSize>
    </div>
  )
}

export default AreaChart
