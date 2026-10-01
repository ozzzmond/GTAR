/**
 * DropdownPortal - renders a floating dropdown anchored to an HTMLElement
 * via ReactDOM.createPortal into document.body. Escapes all ancestor
 * overflow:hidden / transform stacking contexts.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react'
import ReactDOM from 'react-dom'

interface DropdownPortalProps {
  /** Anchor element (button) used for positioning. Pass null when closed. */
  anchorEl: HTMLElement | null
  /** Whether the menu is currently open */
  open: boolean
  /** Called when a click outside or Escape is detected */
  onClose: () => void
  /** Horizontal alignment. Default: 'right' */
  align?: 'right' | 'left'
  /** Pixel gap below anchor. Default: 6 */
  gap?: number
  children: React.ReactNode
}

export const DropdownPortal: React.FC<DropdownPortalProps> = ({
  anchorEl,
  open,
  onClose,
  align = 'right',
  gap = 6,
  children,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!open || !anchorEl || !menu) return
    const position = () => {
      const rect = anchorEl.getBoundingClientRect()
      const margin = 8
      const width = document.documentElement.clientWidth || window.innerWidth
      const height = document.documentElement.clientHeight || window.innerHeight
      menu.style.maxWidth = `${Math.max(0, width - margin * 2)}px`
      menu.style.maxHeight = `${Math.max(0, height - margin * 2)}px`
      const bounds = menu.getBoundingClientRect()
      const left = align === 'right' ? rect.right - bounds.width : rect.left
      const below = rect.bottom + gap
      const top = below + bounds.height > height - margin
        ? rect.top - gap - bounds.height
        : below
      menu.style.left = `${Math.max(margin, Math.min(left, width - bounds.width - margin))}px`
      menu.style.top = `${Math.max(margin, Math.min(top, height - bounds.height - margin))}px`
    }
    position()
    // Dismiss on viewport/ancestor movement; scrolling inside the menu stays usable.
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return
      onClose()
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', onClose)
    window.visualViewport?.addEventListener('resize', onClose)
    window.visualViewport?.addEventListener('scroll', onClose)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', onClose)
      window.visualViewport?.removeEventListener('resize', onClose)
      window.visualViewport?.removeEventListener('scroll', onClose)
    }
  }, [open, anchorEl, align, gap, onClose])

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      const menu = menuRef.current
      if (
        menu && !menu.contains(e.target as Node) &&
        anchorEl && !anchorEl.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        anchorEl?.focus()
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('click', handleClickOutside, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('click', handleClickOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, anchorEl])

  if (!open || !anchorEl) return null

  const style: React.CSSProperties = {
    position: 'fixed',
    // Above cards (10/20), below the header (30) and drawers/modals (50+).
    zIndex: 25,
    overflow: 'auto',
  }

  return ReactDOM.createPortal(
    <div ref={menuRef} style={style} data-dropdown-portal="true">
      {children}
    </div>,
    document.body
  )
}
