import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useDropdownKeyboard } from '../../hooks/useDropdownKeyboard'

function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export interface DropdownOption<V extends string = string> {
  label: string
  value: V
}

export interface AnimatedDropdownProps<V extends string = string> {
  items: DropdownOption<V>[]
  value?: V
  onSelect: (value: V) => void
  text?: string
  className?: string
}

export default function AnimatedDropdown<V extends string = string>({
  items,
  value,
  onSelect,
  text = 'Select Option',
  className,
}: AnimatedDropdownProps<V>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const closeDropdown = useCallback(() => setIsOpen(false), [])
  useDropdownKeyboard(wrapperRef, isOpen, closeDropdown)

  const selected = items.find((item) => item.value === value)
  const buttonLabel = selected?.label ?? text

  const handleSelect = (selectedValue: V): void => {
    onSelect(selectedValue)
    setIsOpen(false)
  }

  return (
    <div
      ref={wrapperRef}
      data-state={isOpen ? 'open' : 'closed'}
      className={cn('group relative inline-block', className)}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((o) => !o)}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium',
          'border border-input bg-background px-4 h-10',
          'hover:bg-accent hover:text-accent-foreground',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50'
        )}
      >
        <span>{buttonLabel}</span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <ChevronDown className="h-5 w-5" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={cn(
              'absolute top-[calc(100%+0.5rem)] left-1/2 z-50 w-fit min-w-full -translate-x-1/2',
              'overflow-hidden rounded-md',
              'bg-muted',
              'border-2 border-border',
              'shadow-lg'
            )}
          >
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                visible: {
                  transition: { staggerChildren: 0.03 },
                },
              }}
            >
              {items.map((item) => {
                const isSelected = item.value === value
                return (
                  <motion.button
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(item.value)}
                    variants={{
                      hidden: { opacity: 0, x: -20 },
                      visible: { opacity: 1, x: 0 },
                    }}
                    className={cn(
                      'block w-full px-3 py-2 text-sm text-left',
                      'border-b border-border last:border-b-0',
                      'bg-card hover:bg-accent',
                      'transition-colors duration-150',
                      'text-foreground',
                      isSelected && 'font-medium'
                    )}
                  >
                    {item.label}
                  </motion.button>
                )
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
