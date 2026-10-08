import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { evaluateEdgeSwipeIntent } from '../utils/edgeSwipe'

interface EdgeSwipePanelCoordinatorProps {
  enabled: boolean
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  children: (props: {
    drawerStyle: React.CSSProperties
    backdropStyle: React.CSSProperties
    drawerTouchHandlers: {
      onTouchStart: (e: React.TouchEvent) => void
      onTouchMove: (e: React.TouchEvent) => void
      onTouchEnd: (e: React.TouchEvent) => void
      onTouchCancel: (e: React.TouchEvent) => void
    }
  }) => React.ReactNode
}

/**
 * EdgeSwipePanelCoordinator manages the opt-in edge swipe gesture
 * for the SetlistDrawer side panel with safe iOS/Safari and PWA behavior.
 */
export const EdgeSwipePanelCoordinator: React.FC<EdgeSwipePanelCoordinatorProps> = ({
  enabled,
  isOpen,
  onOpen,
  onClose,
  children,
}) => {
  const [dragProgress, setDragProgress] = useState<number | null>(null) // null = not dragging; 0..1 = dragging progress
  const [isReducedMotion, setIsReducedMotion] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    return false
  })

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const lastTouchX = useRef(0)
  const lastTouchTime = useRef(0)
  const gestureIntent = useRef<'undecided' | 'vertical' | 'horizontal'>('undecided')
  const dragMode = useRef<'opening' | 'closing' | null>(null)
  const [drawerWidth, setDrawerWidth] = useState(320)

  // Listen for prefers-reduced-motion changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches)
    mediaQuery.addEventListener?.('change', handler)
    return () => mediaQuery.removeEventListener?.('change', handler)
  }, [])

  // Handle escape key accessibility
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Update drawer width based on viewport on mount / resize / open
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const updateWidth = () => {
        const estimatedWidth = Math.min(window.innerWidth * 0.88, window.innerWidth >= 640 ? 384 : 320)
        setDrawerWidth(estimatedWidth)
      }
      updateWidth()
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }
  }, [isOpen])

  // ----------------------------------------------------------------
  // Gesture Handlers for the Edge Handle (Opening Gesture)
  // ----------------------------------------------------------------
  const handleEdgeTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || isOpen) return
      if (e.touches.length > 1) return // multi-touch rejection

      const touch = e.touches[0]
      touchStartX.current = touch.clientX
      touchStartY.current = touch.clientY
      touchStartTime.current = Date.now()
      lastTouchX.current = touch.clientX
      lastTouchTime.current = Date.now()
      gestureIntent.current = 'undecided'
      dragMode.current = 'opening'
    },
    [enabled, isOpen]
  )

  const handleEdgeTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || isOpen || dragMode.current !== 'opening') return
      if (e.touches.length > 1) {
        // Multi-touch cancel
        setDragProgress(null)
        dragMode.current = null
        return
      }

      const touch = e.touches[0]
      const deltaX = touch.clientX - touchStartX.current
      const deltaY = touch.clientY - touchStartY.current

      if (gestureIntent.current === 'undecided') {
        const intent = evaluateEdgeSwipeIntent(deltaX, deltaY, 8)
        gestureIntent.current = intent

        if (intent === 'vertical') {
          // Vertical scroll wins
          dragMode.current = null
          setDragProgress(null)
          return
        }
        if (intent === 'horizontal') {
          if (deltaX <= 0) {
            // Dragging left from left edge is invalid for opening
            dragMode.current = null
            setDragProgress(null)
            return
          }
        } else {
          return
        }
      }

      if (gestureIntent.current === 'horizontal' && deltaX > 0) {
        if (e.cancelable) e.preventDefault()
        lastTouchX.current = touch.clientX
        lastTouchTime.current = Date.now()

        const progress = Math.max(0, Math.min(1, deltaX / drawerWidth))
        setDragProgress(progress)
      }
    },
    [enabled, isOpen, drawerWidth]
  )

  const handleEdgeTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || isOpen || dragMode.current !== 'opening') {
        setDragProgress(null)
        dragMode.current = null
        return
      }

      const touch = e.changedTouches[0]
      const deltaX = touch.clientX - touchStartX.current
      const totalTime = Math.max(1, Date.now() - touchStartTime.current)
      const velocity = deltaX / totalTime // px/ms

      const progress = Math.max(0, Math.min(1, deltaX / drawerWidth))

      // Settle open if progress > 0.35 OR velocity > 0.45 px/ms
      if (progress >= 0.35 || velocity >= 0.45) {
        onOpen()
      }
      setDragProgress(null)
      dragMode.current = null
    },
    [enabled, isOpen, onOpen, drawerWidth]
  )

  const handleEdgeTouchCancel = useCallback(() => {
    setDragProgress(null)
    dragMode.current = null
    gestureIntent.current = 'undecided'
  }, [])

  // ----------------------------------------------------------------
  // Gesture Handlers for Open Drawer Surface (Closing Gesture)
  // ----------------------------------------------------------------
  const handleDrawerTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !isOpen) return
      if (e.touches.length > 1) return

      // Don't intercept touches originating on buttons, inputs, links, or specific controls
      const target = e.target as HTMLElement | null
      if (target?.closest('button, [role="button"], select, input, textarea, a, [data-swipe-ignore]')) {
        return
      }

      const touch = e.touches[0]
      touchStartX.current = touch.clientX
      touchStartY.current = touch.clientY
      touchStartTime.current = Date.now()
      lastTouchX.current = touch.clientX
      lastTouchTime.current = Date.now()
      gestureIntent.current = 'undecided'
      dragMode.current = 'closing'
    },
    [enabled, isOpen]
  )

  const handleDrawerTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !isOpen || dragMode.current !== 'closing') return
      if (e.touches.length > 1) {
        setDragProgress(null)
        dragMode.current = null
        return
      }

      const touch = e.touches[0]
      const deltaX = touch.clientX - touchStartX.current
      const deltaY = touch.clientY - touchStartY.current

      if (gestureIntent.current === 'undecided') {
        const intent = evaluateEdgeSwipeIntent(deltaX, deltaY, 8)
        gestureIntent.current = intent

        if (intent === 'vertical') {
          // Vertical list scrolling wins
          dragMode.current = null
          setDragProgress(null)
          return
        }
        if (intent === 'horizontal') {
          if (deltaX >= 0) {
            // Dragging right while already open has nowhere to go
            dragMode.current = null
            setDragProgress(null)
            return
          }
        } else {
          return
        }
      }

      if (gestureIntent.current === 'horizontal' && deltaX < 0) {
        if (e.cancelable) e.preventDefault()
        lastTouchX.current = touch.clientX
        lastTouchTime.current = Date.now()

        // deltaX is negative. Progress goes from 1 down to 0
        const progress = Math.max(0, Math.min(1, 1 + deltaX / drawerWidth))
        setDragProgress(progress)
      }
    },
    [enabled, isOpen, drawerWidth]
  )

  const handleDrawerTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || !isOpen || dragMode.current !== 'closing') {
        setDragProgress(null)
        dragMode.current = null
        return
      }

      const touch = e.changedTouches[0]
      const deltaX = touch.clientX - touchStartX.current // negative
      const totalTime = Math.max(1, Date.now() - touchStartTime.current)
      const velocity = deltaX / totalTime // negative px/ms

      const progress = Math.max(0, Math.min(1, 1 + deltaX / drawerWidth))

      // Settle closed if progress < 0.65 OR velocity < -0.45 px/ms
      if (progress <= 0.65 || velocity <= -0.45) {
        onClose()
      }
      setDragProgress(null)
      dragMode.current = null
    },
    [enabled, isOpen, onClose, drawerWidth]
  )

  const handleDrawerTouchCancel = useCallback(() => {
    setDragProgress(null)
    dragMode.current = null
    gestureIntent.current = 'undecided'
  }, [])

  // ----------------------------------------------------------------
  // Compute Dynamic Inline Styles for Drawer & Backdrop
  // ----------------------------------------------------------------
  const isDragging = dragProgress !== null

  let drawerTranslateX = '0%'
  let backdropOpacity = 1

  if (isDragging) {
    // When dragging: 0 => -100%, 1 => 0%
    const pct = (1 - dragProgress) * -100
    drawerTranslateX = `${pct}%`
    backdropOpacity = dragProgress
  } else if (!isOpen) {
    drawerTranslateX = '-100%'
    backdropOpacity = 0
  }

  const transitionStyle = isDragging
    ? 'none'
    : isReducedMotion
    ? 'none'
    : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms ease-out'

  const drawerStyle: React.CSSProperties = {
    transform: `translateX(${drawerTranslateX})`,
    transition: transitionStyle,
    willChange: isDragging ? 'transform' : 'auto',
  }

  const backdropStyle: React.CSSProperties = {
    opacity: backdropOpacity,
    transition: transitionStyle,
    willChange: isDragging ? 'opacity' : 'auto',
    pointerEvents: (isOpen || isDragging) ? 'auto' : 'none',
  }

  const drawerTouchHandlers = useMemo(
    () => ({
      onTouchStart: handleDrawerTouchStart,
      onTouchMove: handleDrawerTouchMove,
      onTouchEnd: handleDrawerTouchEnd,
      onTouchCancel: handleDrawerTouchCancel,
    }),
    [handleDrawerTouchStart, handleDrawerTouchMove, handleDrawerTouchEnd, handleDrawerTouchCancel]
  )

  return (
    <>
      {/* Edge Handle: Visible ONLY when enabled and panel is closed */}
      {enabled && !isOpen && (
        <div
          data-testid="edge-swipe-handle"
          role="button"
          tabIndex={0}
          aria-label="Edge Swipe Panel Handle"
          title="Swipe right to open Side Panel"
          className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-start pl-1 pr-1.5 py-4 cursor-pointer select-none group touch-none"
          style={{
            touchAction: 'none',
          }}
          onClick={onOpen}
          onTouchStart={handleEdgeTouchStart}
          onTouchMove={handleEdgeTouchMove}
          onTouchEnd={handleEdgeTouchEnd}
          onTouchCancel={handleEdgeTouchCancel}
        >
          {/* Subtle Samsung Edge-inspired tactile pill handle */}
          <div className="w-1.5 sm:w-2 h-14 rounded-r-full bg-app-action/60 group-hover:bg-app-action group-active:bg-app-action shadow-md border-r border-y border-app-border backdrop-blur-xs transition-all transform group-hover:scale-y-110 group-active:scale-125" />
        </div>
      )}

      {/* Render children (drawer + backdrop) when open or actively dragging */}
      {(isOpen || isDragging) &&
        // eslint-disable-next-line react-hooks/refs -- Event handlers memoized in drawerTouchHandlers reference mutable touch coordinates for gesture tracking
        children({
          drawerStyle,
          backdropStyle,
          drawerTouchHandlers,
        })}
    </>
  )
}
