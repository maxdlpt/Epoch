import type { CustomPaletteEntry } from '../../shared/types'

// ─── Built-in static palettes (light-mode colors) ────────────────────────────
// Mono is NOT listed here — it is generated dynamically from the active UI
// theme's primary color via generateMonoPalette() at render time.

/** Light-mode-only built-in palettes. Dark variants are auto-generated via
 *  `generateComplement()`.  For palettes that need hand-picked dark colours,
 *  use `DUAL_PALETTES` instead. */
export const PALETTES: Record<string, string[]> = {
  // Asset-class palette — Private Equity, Public Equity, Fixed Income, Hedge Funds,
  // Cash, Real Assets, Other (blue-grey).
  corporate: ['#0d1e38', '#74b2e2', '#c8ddf0', '#D9F05A', '#FF5532', '#DCD8CB', '#6e7c8a'],
}

/** Built-in palettes with explicit light AND dark variants (not auto-generated). */
export const DUAL_PALETTES: Record<string, { light: string[]; dark: string[] }> = {
  vibrant: {
    light: ['#e21e49', '#e96306', '#f7c015', '#3add76', '#2bdbf9', '#0950c4', '#3809a3', '#b71364'],
    dark:  ['#e11d48', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'],
  },
}

/** Ordered list of all built-in palette keys, including the dynamic `mono`. */
export const BUILT_IN_PALETTE_KEYS = ['mono', 'corporate', 'vibrant'] as const

// ─── UI-theme primary colors ──────────────────────────────────────────────────
// Light-mode primary hex for each UI theme. Used to derive the Mono palette's
// hue and saturation regardless of whether dark mode is active.

const THEME_PRIMARIES: Record<string, string> = {
  original: '#0f172a',
  gold:     '#b45309',
  ocean:    '#375bc8',
  forest:   '#15803d',
  rose:     '#be185d',
  midnight: '#4f46e5',
  dracula:  '#7d514f',
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

// ─── Dynamic Mono palette ─────────────────────────────────────────────────────

/**
 * Generate a 7-shade monochromatic palette anchored to the current UI theme's
 * primary color.  The hue and saturation are taken from the theme's light-mode
 * primary (so the palette stays recognisably "amber" for Gold, "blue" for Ocean,
 * etc.) while lightness steps are chosen for legibility against the current
 * background: dark shades for light mode, light shades for dark mode.
 */
function generateMonoPalette(uiTheme: string, isDark: boolean): string[] {
  const primary = THEME_PRIMARIES[uiTheme] ?? THEME_PRIMARIES.original
  const [h, s] = hexToHsl(primary)
  const sat = Math.min(s, 75) // cap saturation so steps don't over-saturate
  const steps = isDark
    ? [85, 75, 65, 55, 45, 35, 25]   // light → medium: visible on dark bg
    : [15, 23, 31, 39, 47, 55, 63]   // dark → medium: visible on white bg
  return steps.map(l => hslToHex(h, sat, l))
}

// ─── Palette resolution ───────────────────────────────────────────────────────

/**
 * Merge built-in palettes with user-created ones, selecting the appropriate
 * theme variant for each.  The dynamic Mono palette is generated from the
 * current UI theme's primary color.  Static built-ins use generateComplement
 * for dark mode.  Custom palettes use their explicit `.dark` / `.light` arrays.
 */
export function getAllPalettes(
  customPalettes: Record<string, CustomPaletteEntry>,
  isDark = false,
  uiTheme = 'original',
): Record<string, string[]> {
  const builtIn: Record<string, string[]> = {
    mono: generateMonoPalette(uiTheme, isDark),
  }
  for (const [name, colors] of Object.entries(PALETTES)) {
    builtIn[name] = isDark ? generateComplement(colors) : colors
  }
  for (const [name, entry] of Object.entries(DUAL_PALETTES)) {
    builtIn[name] = isDark ? entry.dark : entry.light
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
  uiTheme = 'original',
): string {
  const all = getAllPalettes(customPalettes, isDark, uiTheme)
  const colors = all[palette] ?? all.mono
  return colors[index % colors.length]
}
