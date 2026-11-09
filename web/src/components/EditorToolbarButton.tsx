import React, { useState, useRef, useEffect, useCallback } from 'react'
import { DropdownPortal } from './DropdownPortal'

export interface EditorToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  description?: string
  shortcut?: string
  align?: 'right' | 'left'
  children: React.ReactNode
}

export const EditorToolbarButton: React.FC<EditorToolbarButtonProps> = ({
  label,
  description,
  shortcut,
  align = 'left',
  children,
  onClick,
  className = '',
  disabled,
  'aria-label': ariaLabel,
  ...rest
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [clearTimer])

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    clearTimer()
    setAnchorEl(e.currentTarget)
    timerRef.current = setTimeout(() => {
      setIsOpen(true)
    }, 400)
  }

  const handleMouseLeave = () => {
    clearTimer()
    setIsOpen(false)
  }

  const handleFocus = (e: React.FocusEvent<HTMLButtonElement>) => {
    clearTimer()
    setAnchorEl(e.currentTarget)
    setIsOpen(true)
  }

  const handleBlur = () => {
    clearTimer()
    setIsOpen(false)
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    clearTimer()
    setIsOpen(false)
    onClick?.(e)
  }

  return (
    <>
      <button
        ref={setAnchorEl}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-keyshortcuts={shortcut}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </button>

      {isOpen && anchorEl && (
        <DropdownPortal anchorEl={anchorEl} open={isOpen} onClose={() => setIsOpen(false)} align={align}>
          <div
            role="tooltip"
            data-testid="editor-toolbar-tooltip"
            className="z-50 max-w-xs px-2.5 py-1.5 rounded-lg border border-app-border bg-app-surface text-app-heading text-[11px] shadow-xl pointer-events-none animate-fade-in"
          >
            <div className="flex items-center justify-between gap-2 font-semibold">
              <span>{label}</span>
              {shortcut && (
                <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                  {shortcut}
                </span>
              )}
            </div>
            {description && <p className="text-[10px] text-app-muted mt-0.5 font-normal leading-tight">{description}</p>}
          </div>
        </DropdownPortal>
      )}
    </>
  )
}
