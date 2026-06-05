import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  AlertCircle, CheckCircle, ChevronDown, Database, Eye,
  FolderOpen, MonitorCog, MoonStar, Palette, Pencil, Plus, RotateCcw, Sun, Trash2, X,
} from 'lucide-react'
import { useAppStore, DEFAULT_KEYBINDINGS } from '../../store/app'
import { useDBStore } from '../../store/db'
import { BUILT_IN_PALETTE_KEYS, getAllPalettes, generateComplement } from '../../lib/colors'
import { isDarkTheme, UI_THEMES } from '../../lib/theme'
import { ipc } from '../../lib/ipc'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'
import { useDropdownKeyboard } from '../../hooks/useDropdownKeyboard'
import type { Keybindings } from '../../../shared/types'

type Theme = 'light' | 'dark' | 'system'

type SettingsSection = 'accessibility' | 'databases' | 'themes'

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Eye }[] = [
  { id: 'accessibility', label: 'Accessibility', icon: Eye },
  { id: 'databases',     label: 'Databases',     icon: Database },
  { id: 'themes',        label: 'Themes',        icon: Palette },
]

// Default colors for a brand-new palette
const NEW_PALETTE_DEFAULTS = [
  '#e11d48', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

function deriveDBName(path: string): string {
  const basename = path.split(/[\\/]/).pop() ?? ''
  return basename.replace(/\.db$/i, '') || 'external'
}

// ─── Palette editor ───────────────────────────────────────────────────────────

interface EditorState {
  originalName: string | null
  name: string
  colors: string[]
  isDark: boolean
}

interface PaletteEditorProps {
  editor: EditorState
  existingNames: string[]
  onChange: (e: EditorState) => void
  onSave: () => void
  onCancel: () => void
}

function PaletteEditor({ editor, existingNames, onChange, onSave, onCancel }: PaletteEditorProps) {
  const { isDark } = editor
  const trimmedName = editor.name.trim()

  const isBuiltIn = (BUILT_IN_PALETTE_KEYS as readonly string[]).includes(trimmedName.toLowerCase())
  const isDuplicate =
    trimmedName !== editor.originalName &&
    existingNames.some((n) => n === trimmedName)
  const isInvalid = trimmedName === '' || isBuiltIn || isDuplicate

  function setColor(i: number, hex: string) {
    const next = [...editor.colors]
    next[i] = hex
    onChange({ ...editor, colors: next })
  }

  function addColor() {
    onChange({ ...editor, colors: [...editor.colors, '#6366f1'] })
  }

  function removeColor(i: number) {
    onChange({ ...editor, colors: editor.colors.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/50 p-4 space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="palette-name">
          Name
        </label>
        <Input
          id="palette-name"
          placeholder="e.g. Ocean"
          value={editor.name}
          onChange={(e) => onChange({ ...editor, name: e.target.value })}
          className={cn(isBuiltIn || isDuplicate ? 'border-destructive' : '')}
        />
        {isBuiltIn && (
          <p className="text-xs text-destructive">This name conflicts with a built-in palette.</p>
        )}
        {isDuplicate && (
          <p className="text-xs text-destructive">A custom palette with this name already exists.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {isDark ? 'Dark colours' : 'Light colours'}{' '}
          <span className="font-normal text-muted-foreground/60">({editor.colors.length})</span>
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {editor.colors.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered index
            <div key={i} className="relative group/swatch">
              <label
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full ring-2 ring-offset-2 ring-border hover:ring-foreground/60 transition-all"
                style={{ backgroundColor: c }}
                title={c}
              >
                <input
                  type="color"
                  value={c}
                  onChange={(e) => setColor(i, e.target.value)}
                  className="sr-only"
                />
              </label>
              {editor.colors.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeColor(i)}
                  className="absolute -top-1 -right-1 hidden group-hover/swatch:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                  aria-label="Remove colour"
                >
                  <X className="h-2 w-2" />
                </button>
              )}
            </div>
          ))}
          {editor.colors.length < 12 && (
            <button
              type="button"
              onClick={addColor}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
              aria-label="Add colour"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {isDark ? 'Light preview' : 'Dark preview'}{' '}
          <span className="font-normal text-muted-foreground/60">auto-generated</span>
        </p>
        <div className={cn(
          'flex flex-wrap gap-2 items-center rounded-md px-3 py-2',
          isDark ? 'bg-gray-100' : 'bg-gray-900',
        )}>
          {generateComplement(editor.colors).map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable display index
            <span key={i} className="h-5 w-5 rounded-full" style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={isInvalid} onClick={onSave}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ─── Shortcut display helpers ─────────────────────────────────────────────────

import { eventToBinding, displayBinding } from '../../lib/keybindings'

const SHORTCUT_LABELS: Record<keyof Keybindings, { label: string; description: string }> = {
  toggleGrid:    { label: 'Toggle gridlines',  description: 'Show or hide the chart grid overlay' },
  toggleTooltip: { label: 'Toggle tooltip',     description: 'Show or hide the price label on hover' },
  setAllReturns: { label: 'All to returns',     description: 'Set every series to raw returns view' },
  setAllIndex:   { label: 'All to index',       description: 'Set every series to cumulative index (base 100)' },
  setAllDrawdown:{ label: 'All to drawdown',    description: 'Set every series to drawdown view' },
  saveGraph:     { label: 'Save graph',         description: 'Save the current graph (opens menu if already saved)' },
  addSeries:     { label: 'Add series',         description: 'Open the Add Line panel to add a series to the chart' },
  openSettings:  { label: 'Open settings',      description: 'Toggle the settings modal' },
  exportGraph:   { label: 'Export graph',       description: 'Open the export dropdown (PNG, CSV)' },
}

// ─── ShortcutRow ──────────────────────────────────────────────────────────────

function ShortcutRow({ action, currentKey, defaultKey, onRebind }: {
  action: keyof Keybindings
  currentKey: string
  defaultKey: string
  onRebind: (action: keyof Keybindings, newKey: string) => void
}) {
  const [listening, setListening] = useState(false)
  const [liveCombo, setLiveCombo] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const comboRef = useRef('')      // latest combo seen during this recording
  const heldKeys = useRef(new Set<string>())

  useEffect(() => {
    if (!listening) return

    comboRef.current = ''
    heldKeys.current.clear()
    setLiveCombo('')

    const onDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Escape with nothing else held → cancel
      if (e.key === 'Escape' && heldKeys.current.size === 0) {
        setListening(false)
        return
      }
      heldKeys.current.add(e.key)
      const combo = eventToBinding(e)
      comboRef.current = combo
      setLiveCombo(combo)
    }

    const onUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      heldKeys.current.delete(e.key)
      // Commit once every key is released
      if (heldKeys.current.size === 0 && comboRef.current) {
        onRebind(action, comboRef.current)
        setListening(false)
      }
    }

    // Also commit if the window loses focus while keys are held
    const onBlur = () => {
      if (comboRef.current) {
        onRebind(action, comboRef.current)
      }
      setListening(false)
    }

    document.addEventListener('keydown', onDown, true)
    document.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onDown, true)
      document.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [listening, action, onRebind])

  useEffect(() => {
    if (!listening) btnRef.current?.blur()
  }, [listening])

  const { label, description } = SHORTCUT_LABELS[action]
  const isModified = currentKey !== defaultKey

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isModified && !listening && (
          <button
            type="button"
            onClick={() => onRebind(action, defaultKey)}
            className="p-1 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
            aria-label={`Reset ${label} to default`}
            title={`Reset to ${displayBinding(defaultKey)}`}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <button
          ref={btnRef}
          type="button"
          onClick={() => setListening(true)}
          className={cn(
            'min-w-[56px] px-3 py-1.5 rounded-md border text-sm font-medium transition-all text-center',
            listening
              ? 'border-primary bg-primary/10 text-primary animate-pulse'
              : currentKey
                ? 'border-border bg-muted text-foreground hover:border-foreground/30'
                : 'border-border bg-muted text-muted-foreground/40 hover:border-foreground/30',
          )}
        >
          {listening
            ? (liveCombo ? displayBinding(liveCombo) : '...')
            : currentKey ? displayBinding(currentKey) : 'None'}
        </button>
        {currentKey && !listening && (
          <button
            type="button"
            onClick={() => onRebind(action, '')}
            className="p-1 rounded text-muted-foreground/30 hover:text-destructive transition-colors"
            aria-label={`Remove ${label} shortcut`}
            title="Remove shortcut"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Section: Accessibility ───────────────────────────────────────────────────

function AccessibilitySection() {
  const { alwaysCommonDates, setAlwaysCommonDates, keybindings, setKeybinding } = useAppStore()

  const handleRebind = useCallback((action: keyof Keybindings, newKey: string) => {
    // If another action already uses this binding, clear it first
    if (newKey) {
      const conflict = (Object.entries(keybindings) as [keyof Keybindings, string][])
        .find(([k, v]) => k !== action && v === newKey)
      if (conflict) setKeybinding(conflict[0], '')
    }
    setKeybinding(action, newKey)
  }, [setKeybinding, keybindings])

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold text-foreground">Accessibility</h3>
        <p className="text-sm text-muted-foreground mt-1">Graph behaviour, display preferences, and keyboard shortcuts.</p>
      </div>

      {/* Graph functionalities */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-foreground">Graph functionalities</h4>
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative flex-shrink-0 mt-0.5">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={alwaysCommonDates}
              onChange={e => setAlwaysCommonDates(e.target.checked)}
            />
            <div className="w-9 h-5 rounded-full bg-input peer-checked:bg-primary transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground leading-snug">Always sync date windows</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When on, the chart only shows dates where every visible series has data. Off by default.
            </p>
          </div>
        </label>
      </div>

      <div className="border-t border-border" />

      {/* Shortcuts */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">Shortcuts</h4>
        <p className="text-xs text-muted-foreground">Click a shortcut key then press a new key to rebind it.</p>
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {(Object.keys(SHORTCUT_LABELS) as (keyof Keybindings)[]).map(action => (
            <div key={action} className="px-4">
              <ShortcutRow
                action={action}
                currentKey={keybindings[action]}
                defaultKey={DEFAULT_KEYBINDINGS[action]}
                onRebind={handleRebind}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Section: Databases ───────────────────────────────────────────────────────

function DatabasesSection() {
  const { externalDBs, addExternalDB, removeExternalDB } = useDBStore()

  async function handleBrowseForDB(): Promise<void> {
    const path = await ipc.dialog.openDB()
    if (!path) return
    const reachable = await ipc.external.checkPath(path)
    addExternalDB({ id: crypto.randomUUID(), name: deriveDBName(path), path, reachable })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">Databases</h3>
        <p className="text-sm text-muted-foreground mt-1">Connect external .db files to browse and chart their series.</p>
      </div>

      <div className="flex">
        <Button variant="outline" size="sm" onClick={handleBrowseForDB}>
          <FolderOpen className="h-4 w-4 mr-2" /> Browse for DB file
        </Button>
      </div>

      <div className="space-y-2">
        {externalDBs.length === 0 && (
          <p className="text-sm text-muted-foreground">No external databases configured.</p>
        )}
        {externalDBs.map(db => (
          <div
            key={db.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            {db.reachable
              ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              : <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{db.name}</p>
              <p className="text-xs text-muted-foreground truncate">{db.path}</p>
              {!db.reachable && (
                <p className="text-xs text-red-400 dark:text-red-400">
                  unreachable — re-checked on next startup
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label={`Remove ${db.name}`}
              onClick={() => removeExternalDB(db.id)}
              className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Section: Themes ──────────────────────────────────────────────────────────

function ThemesSection() {
  const { theme, setTheme, uiTheme, setUiTheme, colorPalette, setColorPalette, customPalettes, addCustomPalette, updateCustomPalette, removeCustomPalette } = useAppStore()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [uiThemeOpen, setUiThemeOpen] = useState(false)
  const uiThemeRef = useRef<HTMLDivElement>(null)
  const closeUiTheme = useCallback(() => setUiThemeOpen(false), [])
  useDropdownKeyboard(uiThemeRef, uiThemeOpen, closeUiTheme)

  const isDark = isDarkTheme(theme)
  const customPaletteEntries = Object.entries(customPalettes)
  const selectedUiTheme = UI_THEMES.find(t => t.id === uiTheme) ?? UI_THEMES[0]

  function openNewEditor() {
    setEditor({ originalName: null, name: '', colors: [...NEW_PALETTE_DEFAULTS], isDark })
  }

  function openEditEditor(name: string, entry: { light: string[], dark: string[] }) {
    setEditor({ originalName: name, name, colors: isDark ? [...entry.dark] : [...entry.light], isDark })
  }

  function handleSave() {
    if (!editor) return
    const name = editor.name.trim()
    if (editor.originalName === null) {
      addCustomPalette(name, editor.colors, editor.isDark)
      setColorPalette(name)
    } else {
      updateCustomPalette(editor.originalName, name, editor.colors, editor.isDark)
    }
    setEditor(null)
  }

  function handleDelete(name: string) {
    removeCustomPalette(name)
    if (editor?.originalName === name) setEditor(null)
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold text-foreground">Themes</h3>
        <p className="text-sm text-muted-foreground mt-1">Customise the look and feel of the application.</p>
      </div>

      {/* Appearance — mode toggle + theme dropdown on one line */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">Appearance</h4>

        <div className="flex items-center gap-3">
          {/* Theme dropdown */}
          <div ref={uiThemeRef} className="relative flex-1">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={uiThemeOpen}
              onClick={() => setUiThemeOpen(o => !o)}
              className={cn(
                'w-full inline-flex items-center justify-between gap-2 rounded-md text-sm font-medium',
                'border border-input bg-background px-3 h-9',
                'hover:bg-accent hover:text-accent-foreground',
                'transition-colors',
              )}
            >
              <span>{selectedUiTheme.label}</span>
              <motion.span
                animate={{ rotate: uiThemeOpen ? 180 : 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="shrink-0"
              >
                <ChevronDown className="h-4 w-4" />
              </motion.span>
            </button>
            <AnimatePresence>
              {uiThemeOpen && (
                <motion.div
                  role="listbox"
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className={cn(
                    'absolute top-[calc(100%+0.35rem)] left-0 right-0 z-50',
                    'overflow-hidden rounded-md',
                    'bg-muted',
                    'border-2 border-border',
                    'shadow-lg',
                  )}
                >
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
                  >
                    {UI_THEMES.map(t => (
                      <motion.button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={uiTheme === t.id}
                        onClick={() => { setUiTheme(t.id); setUiThemeOpen(false) }}
                        variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }}
                        className={cn(
                          'w-full flex items-center px-3 py-2 text-sm text-left',
                          'bg-card hover:bg-accent',
                          'transition-colors duration-150',
                          uiTheme === t.id && 'font-medium',
                        )}
                      >
                        {t.label}
                      </motion.button>
                    ))}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mode toggle */}
          <div
            className="inline-flex items-center overflow-hidden rounded-md border border-border bg-muted/80"
            role="radiogroup"
          >
            {([
              { icon: Sun,        value: 'light' as Theme },
              { icon: MoonStar,   value: 'dark' as Theme },
              { icon: MonitorCog, value: 'system' as Theme },
            ]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={theme === opt.value}
                aria-label={`Switch to ${opt.value} mode`}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  'relative flex size-8 cursor-pointer items-center justify-center rounded-md transition-all',
                  theme === opt.value
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {theme === opt.value && (
                  <motion.div
                    layoutId="theme-mode-indicator"
                    transition={{ type: 'spring', bounce: 0.1, duration: 0.75 }}
                    className="absolute inset-0 rounded-md border border-muted-foreground/50"
                  />
                )}
                <opt.icon className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Graph Palettes */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">Graph Palettes</h4>

        {/* Built-in */}
        <div className="grid grid-cols-2 gap-2">
          {BUILT_IN_PALETTE_KEYS.map((key) => {
            const allPalettes = getAllPalettes({}, isDark, uiTheme)
            const displayColors = (allPalettes[key] ?? []).slice(0, 5)
            return (
              <button
                key={key}
                type="button"
                aria-label={`palette-${key}`}
                onClick={() => { setColorPalette(key); setEditor(null) }}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  colorPalette === key
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <p className="text-xs font-medium capitalize mb-2 text-foreground">{key}</p>
                <div className="flex gap-1">
                  {displayColors.map(c => (
                    <span key={c} className="h-4 w-4 rounded-full" style={{ backgroundColor: c }} />
                  ))}
                </div>
              </button>
            )
          })}
        </div>

        {/* Custom palettes */}
        {customPaletteEntries.length > 0 && (
          <>
            <p className="text-xs font-medium text-muted-foreground/60 pt-1">Custom</p>
            <div className="grid grid-cols-2 gap-2">
              {customPaletteEntries.map(([name, entry]) => {
                const displayColors = (isDark ? entry.dark : entry.light).slice(0, 5)
                return (
                  <div key={name} className="relative group/card">
                    <button
                      type="button"
                      aria-label={`palette-${name}`}
                      onClick={() => { setColorPalette(name); setEditor(null) }}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors pr-14',
                        colorPalette === name
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-accent',
                      )}
                    >
                      <p className="text-xs font-medium mb-2 text-foreground truncate">{name}</p>
                      <div className="flex gap-1 flex-wrap">
                        {displayColors.map((c, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: stable display order
                          <span key={i} className="h-4 w-4 rounded-full" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </button>
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                      <button
                        type="button"
                        aria-label={`Edit ${name}`}
                        onClick={() => openEditEditor(name, entry)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${name}`}
                        onClick={() => handleDelete(name)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Editor / New-palette button */}
        {editor ? (
          <PaletteEditor
            editor={editor}
            existingNames={Object.keys(customPalettes).filter(n => n !== editor.originalName)}
            onChange={setEditor}
            onSave={handleSave}
            onCancel={() => setEditor(null)}
          />
        ) : (
          <button
            type="button"
            onClick={openNewEditor}
            className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-4 w-4" />
            New palette
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

export function SettingsModal() {
  const settingsOpen = useAppStore(s => s.settingsOpen)
  const closeSettings = useAppStore(s => s.closeSettings)
  const [activeSection, setActiveSection] = useState<SettingsSection>('accessibility')

  // Close on Escape + PageUp/PageDown to cycle subtabs
  useEffect(() => {
    if (!settingsOpen) return
    const sectionIds = SECTIONS.map(s => s.id)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeSettings(); return }
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        setActiveSection(prev => {
          const idx = sectionIds.indexOf(prev)
          const next = e.key === 'PageDown'
            ? sectionIds[(idx + 1) % sectionIds.length]
            : sectionIds[(idx - 1 + sectionIds.length) % sectionIds.length]
          return next
        })
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, closeSettings])

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeSettings()
  }, [closeSettings])

  return createPortal(
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleBackdropClick}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="flex w-[75vw] max-w-[1100px] h-[75vh] max-h-[780px] rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
          >
            {/* Internal sidebar */}
            <div className="w-48 shrink-0 border-r border-border bg-muted/50 flex flex-col">
              <div className="px-5 pt-5 pb-4">
                <h2 className="text-base font-semibold text-foreground">Settings</h2>
              </div>
              <nav className="flex-1 px-2 space-y-0.5">
                {SECTIONS.map(s => {
                  const Icon = s.icon
                  const isActive = activeSection === s.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setActiveSection(s.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {s.label}
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* Content area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header with close button */}
              <div className="flex items-center justify-end px-5 pt-4 pb-0">
                <button
                  type="button"
                  onClick={closeSettings}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Close settings"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
                {activeSection === 'accessibility' && <AccessibilitySection />}
                {activeSection === 'databases' && <DatabasesSection />}
                {activeSection === 'themes' && <ThemesSection />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
