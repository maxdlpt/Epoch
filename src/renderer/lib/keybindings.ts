/**
 * Keybinding utilities — encoding, decoding, and matching keyboard combos.
 *
 * Binding format: modifiers in fixed order + key, joined by '+'.
 * Examples: "g", "ctrl+g", "ctrl+shift+f", "alt+1"
 * Modifier order: ctrl, alt, shift, meta (alphabetical, deterministic).
 */

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

/** Build a normalised binding string from a KeyboardEvent. */
export function eventToBinding(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey)  parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  // Don't duplicate the modifier as the main key
  if (!MODIFIER_KEYS.has(e.key)) parts.push(e.key.toLowerCase())
  return parts.join('+')
}

/** Check whether a KeyboardEvent matches a stored binding string. Empty bindings never match. */
export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  if (!binding) return false
  return eventToBinding(e) === binding
}

/** True if the key string is a modifier-only name. */
export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

const DISPLAY_MAP: Record<string, string> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta',
  ' ': 'Space', arrowup: 'Up', arrowdown: 'Down',
  arrowleft: 'Left', arrowright: 'Right',
  escape: 'Esc', enter: 'Enter', backspace: 'Bksp',
  delete: 'Del', tab: 'Tab', '+': '+',
}

/** Split a binding string into its parts, handling the '+' key edge case. */
function splitBinding(binding: string): string[] {
  const parts: string[] = []
  const modifiers = ['ctrl', 'alt', 'shift', 'meta']
  let rest = binding
  for (const mod of modifiers) {
    if (rest.startsWith(mod + '+')) {
      parts.push(mod)
      rest = rest.slice(mod.length + 1)
    }
  }
  if (rest) parts.push(rest)
  return parts
}

/** Pretty-print a binding string for the UI (e.g. "ctrl+g" → "Ctrl + G"). */
export function displayBinding(binding: string): string {
  return splitBinding(binding)
    .map(part => DISPLAY_MAP[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(' + ')
}
