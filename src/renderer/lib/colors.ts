import type { CustomPaletteEntry } from '../../shared/types'

export const PALETTES: Record<string, string[]> = {
  default:  ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'],
  pastel:   ['#93c5fd', '#fca5a5', '#86efac', '#fde68a', '#c4b5fd', '#67e8f9', '#fed7aa', '#f9a8d4'],
  muted:    ['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6'],
  mono:     ['#1d4ed8', '#1e40af', '#1e3a8a', '#172554', '#0f172a', '#334155', '#475569', '#64748b'],
  // Asset-class palette — Private Equity, Public Equity, Fixed Income, Hedge Funds,
  // Cash, Real Assets, Other (blue-grey).  Dark variant auto-generated via generateComplement.
  corporate: ['#0d1e38', '#74b2e2', '#c8ddf0', '#D9F05A', '#FF5532', '#DCD8CB', '#6e7c8a'],
}

// ─── HSL conversion helpers ───────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
    case g: h = ((b - r) / d + 2) / 6; break
    case b: h = ((r - g) / d + 4) / 6; break
  }
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  const hN = h / 360, sN = s / 100, lN = l / 100
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 0.5)   return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r: number, g: number, b: number
  if (sN === 0) {
    r = g = b = lN
  } else {
    const q = lN < 0.5 ? lN * (1 + sN) : lN + sN - lN * sN
    const p = 2 * lN - q
    r = hue2rgb(p, q, hN + 1 / 3)
    g = hue2rgb(p, q, hN)
    b = hue2rgb(p, q, hN - 1 / 3)
  }
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// ─── Complement generation ────────────────────────────────────────────────────

/**
 * Generate the complementary-theme variant of a palette by inverting HSL
 * lightness: `L → 100 − L`.  A dark colour (L = 30 %) becomes light (L = 70 %)
 * and vice-versa.  Hue and saturation are untouched so colours stay
 * recognisably the same.  The operation is its own inverse — running it twice
 * returns the original palette exactly.
 */
export function generateComplement(colors: string[]): string[] {
  return colors.map((hex) => {
    const [h, s, l] = hexToHsl(hex)
    return hslToHex(h, s, 100 - l)
  })
}

/** @deprecated Use generateComplement */
export const generateDarkVariant = generateComplement

// ─── Palette resolution ───────────────────────────────────────────────────────

/**
 * Merge built-in palettes with user-created ones, selecting the appropriate
 * theme variant for each.  Built-in palettes are defined in light-mode colors;
 * their dark variant is derived on-the-fly via `generateComplement` (same
 * algorithm used for custom palettes).
 */
export function getAllPalettes(
  customPalettes: Record<string, CustomPaletteEntry>,
  isDark = false,
): Record<string, string[]> {
  const builtIn: Record<string, string[]> = {}
  for (const [name, colors] of Object.entries(PALETTES)) {
    builtIn[name] = isDark ? generateComplement(colors) : colors
  }
  const custom: Record<string, string[]> = {}
  for (const [name, entry] of Object.entries(customPalettes)) {
    custom[name] = isDark ? entry.dark : entry.light
  }
  return { ...builtIn, ...custom }
}

export function getColor(
  palette: string,
  index: number,
  customPalettes: Record<string, CustomPaletteEntry> = {},
  isDark = false,
): string {
  const all = getAllPalettes(customPalettes, isDark)
  const colors = all[palette] ?? PALETTES.default
  return colors[index % colors.length]
}
