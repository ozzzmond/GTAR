import React, { useState } from 'react'
import { DropdownPortal } from './DropdownPortal'

export interface SongStatusBadgeProps {
  testId: string
  role?: string
  ariaLabel: string
  title?: string
  className?: string
  icon: React.ReactNode
  popoverContent: React.ReactNode
  align?: 'left' | 'right'
  zIndex?: number
}

/**
 * Accessible status badge with mobile tap-to-open, tap-to-dismiss,
 * desktop hover, keyboard focus, and Escape dismissal.
 * Prevents accidental song selection or menu activation via event stopPropagation.
 */
export const SongStatusBadge: React.FC<SongStatusBadgeProps> = ({
  testId,
  role = 'status',
  ariaLabel,
  title,
  className = '',
  icon,
  popoverContent,
  align = 'left',
  zIndex = 25,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const isVisible = isOpen || isHovered

  const handleClose = () => {
    setIsOpen(false)
    setIsHovered(false)
  }

  return (
    <>
      <button
        type="button"
        role={role}
        data-testid={testId}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        aria-expanded={isVisible}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setAnchorEl(e.currentTarget)
          setIsOpen((prev) => !prev)
        }}
        onMouseDown={(e) => {
          e.stopPropagation()
          setAnchorEl(e.currentTarget)
        }}
        onTouchStart={(e) => {
          e.stopPropagation()
          setAnchorEl(e.currentTarget)
        }}
        onMouseEnter={(e) => {
          setAnchorEl(e.currentTarget)
          setIsHovered(true)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
        }}
        onFocus={(e) => {
          setAnchorEl(e.currentTarget)
          setIsHovered(true)
        }}
        onBlur={() => {
          setIsHovered(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            handleClose()
          }
        }}
        className={`cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-app-action/50 ${className}`}
      >
        {icon}
      </button>

      <DropdownPortal
        anchorEl={anchorEl}
        open={isVisible}
        onClose={handleClose}
        align={align}
        gap={4}
        zIndex={zIndex}
      >
        <div
          role="tooltip"
          data-testid={`${testId}-tooltip`}
          className="bg-app-surface/95 backdrop-blur-md border border-app-border shadow-2xl rounded-lg p-2.5 text-xs font-sans text-app-text min-w-[190px] max-w-[280px] pointer-events-auto select-none"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {popoverContent}
        </div>
      </DropdownPortal>
    </>
  )
}
