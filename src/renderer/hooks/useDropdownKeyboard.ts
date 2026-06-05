import { useEffect } from 'react'

/**
 * Adds keyboard navigation to any open dropdown menu.
 *
 * When `open` is true, the hook:
 * - Focuses the first focusable button inside `containerRef`
 * - Arrow Up/Down and Tab/Shift+Tab cycle focus between buttons
 * - Enter activates the focused button (default browser behaviour)
 * - Escape calls `onClose`
 *
 * Usage:
 *   useDropdownKeyboard(menuRef, isOpen, () => setIsOpen(false))
 */
export function useDropdownKeyboard(
  containerRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open || !containerRef.current) return

    // Auto-focus the first button after a microtask so the DOM has rendered
    queueMicrotask(() => {
      const first = containerRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
      first?.focus()
    })

    const handler = (e: KeyboardEvent) => {
      if (!containerRef.current) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        const items = Array.from(
          containerRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
        )
        if (items.length === 0) return
        const idx = items.indexOf(document.activeElement as HTMLButtonElement)
        const forward = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)
        const nextIdx = forward
          ? (idx + 1) % items.length
          : (idx - 1 + items.length) % items.length
        items[nextIdx]?.focus()
      }
    }

    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, onClose, containerRef])
}
