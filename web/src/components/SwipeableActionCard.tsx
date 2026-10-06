import React, { useState, useLayoutEffect, useRef, useEffect, useCallback } from 'react'

export interface SwipeActionConfig {
  icon: React.ReactNode
  label: string
  onAction: () => void
  isDestructive?: boolean
  testId?: string
  ariaLabel?: string
  disabled?: boolean
}

export interface SwipeableActionCardProps {
  id: string | number
  leftAction?: SwipeActionConfig // Revealed on swipe right (deltaX > 0)
  rightAction?: SwipeActionConfig // Revealed on swipe left (deltaX < 0)
  armThreshold?: number // Default: 75px
  maxSwipe?: number // Default: 110px
  disabled?: boolean
  className?: string
  cardClassName?: string
  dataTestId?: string
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
}

export function evaluateSwipeIntent(
  deltaX: number,
  deltaY: number,
  slop = 8
): 'undecided' | 'vertical' | 'horizontal' {
  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)
  if (absX < slop && absY < slop) return 'undecided'
  if (absY >= absX) return 'vertical'
  return 'horizontal'
}

export function computeSwipeOffset(
  deltaX: number,
  hasLeftAction: boolean,
  hasRightAction: boolean,
  armThreshold = 75,
  maxSwipe = 110
): { offset: number; isArmed: boolean } {
  let delta = deltaX
  if (delta > 0 && !hasLeftAction) delta = 0
  if (delta < 0 && !hasRightAction) delta = 0

  const absDelta = Math.abs(delta)
  const sign = Math.sign(delta)
  const isArmed = absDelta >= armThreshold

  if (absDelta <= armThreshold) {
    return { offset: delta, isArmed }
  }
  const extra = absDelta - armThreshold
  const dampened = armThreshold + extra * 0.35
  const offset = sign * Math.min(dampened, maxSwipe)
  return { offset, isArmed }
}

// Single-card active coordinator
type ResetCallback = () => void
const activeListeners = new Map<string | number, ResetCallback>()

function notifySwipeStart(activeId: string | number) {
  activeListeners.forEach((reset, id) => {
    if (id !== activeId) {
      reset()
    }
  })
}

export const SwipeableActionCard: React.FC<SwipeableActionCardProps> = ({
  id,
  leftAction,
  rightAction,
  armThreshold = 75,
  maxSwipe = 110,
  disabled = false,
  className = '',
  cardClassName = '',
  dataTestId,
  onClick,
  children,
}) => {
  const [offset, setOffset] = useState(0)
  const [isArmed, setIsArmed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const gestureIntent = useRef<'undecided' | 'vertical' | 'horizontal'>('undecided')
  const didMoveBeyondTap = useRef(false)
  const isArmedRef = useRef(false)
  const offsetRef = useRef(0)

  // Keep refs in sync for touch release evaluation
  // Publish committed values before input events; suspended renders cannot leak.
  useLayoutEffect(() => {
    isArmedRef.current = isArmed
    offsetRef.current = offset
  }, [isArmed, offset])

  const resetCard = useCallback(() => {
    setOffset(0)
    setIsArmed(false)
    setIsDragging(false)
    gestureIntent.current = 'undecided'
    isArmedRef.current = false
    offsetRef.current = 0
  }, [])

  // Register in active coordinator
  useEffect(() => {
    activeListeners.set(id, resetCard)
    return () => {
      activeListeners.delete(id)
    }
  }, [id, resetCard])

  // Reset if disabled changes
  useEffect(() => {
    if (disabled && (offset !== 0 || isArmed)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Disabling a card must clear its live gesture and coordinator state.
      resetCard()
    }
  }, [disabled, offset, isArmed, resetCard])

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return

    // Guard: ignore touch on interactive buttons or form controls
    const target = e.target as HTMLElement | null
    if (target?.closest('button, [role="button"], select, input, textarea, a')) {
      return
    }

    notifySwipeStart(id)

    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    gestureIntent.current = 'undecided'
    didMoveBeyondTap.current = false
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (disabled) return
    if (gestureIntent.current === 'vertical') return

    const clientX = e.touches[0].clientX
    const clientY = e.touches[0].clientY
    const deltaX = clientX - touchStartX.current
    const deltaY = clientY - touchStartY.current

    if (gestureIntent.current === 'undecided') {
      const intent = evaluateSwipeIntent(deltaX, deltaY, 8)
      gestureIntent.current = intent

      if (intent === 'vertical') {
        // Primary vertical scroll intent: leave offset at 0 and do not intercept
        return
      }
      if (intent === 'horizontal') {
        setIsDragging(true)
        didMoveBeyondTap.current = true
      } else {
        return
      }
    }

    if (gestureIntent.current === 'horizontal') {
      if (e.cancelable) {
        e.preventDefault()
      }

      const { offset: nextOffset, isArmed: nextArmed } = computeSwipeOffset(
        deltaX,
        Boolean(leftAction && !leftAction.disabled),
        Boolean(rightAction && !rightAction.disabled),
        armThreshold,
        maxSwipe
      )

      setOffset(nextOffset)
      setIsArmed(nextArmed)
    }
  }

  const handleTouchEnd = () => {
    if (disabled) return

    if (gestureIntent.current === 'horizontal') {
      const armed = isArmedRef.current
      const currentOffset = offsetRef.current

      if (armed) {
        if (currentOffset > 0 && leftAction && !leftAction.disabled) {
          leftAction.onAction()
        } else if (currentOffset < 0 && rightAction && !rightAction.disabled) {
          rightAction.onAction()
        }
      }
    }

    resetCard()
  }

  const handleTouchCancel = () => {
    resetCard()
    didMoveBeyondTap.current = false
  }

  const handleClick = (e: React.MouseEvent) => {
    // If a horizontal swipe gesture occurred, suppress click on the card surface
    if (didMoveBeyondTap.current) {
      e.preventDefault()
      e.stopPropagation()
      didMoveBeyondTap.current = false
      return
    }
    onClick?.(e)
  }

  const isSwipingLeft = offset < 0
  const isSwipingRight = offset > 0

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Background Action Underlayer: Left Action (Revealed on Swipe Right) */}
      {leftAction && isSwipingRight && (
        <div
          data-testid={leftAction.testId || `swipe-action-left-${id}`}
          data-armed={isArmed ? 'true' : 'false'}
          aria-label={leftAction.ariaLabel || leftAction.label}
          className={`absolute inset-y-0 left-0 flex items-center pl-3.5 sm:pl-4 pr-3 gap-2 transition-colors duration-150 z-0 rounded-xl ${
            isArmed
              ? leftAction.isDestructive
                ? 'bg-[#DC6E67] text-white shadow-inner font-bold'
                : 'bg-app-action text-app-on-action shadow-inner font-bold'
              : leftAction.isDestructive
                ? 'bg-[#DC6E67]/25 text-status-error'
                : 'bg-app-action/20 text-app-action'
          }`}
          style={{ width: `${Math.max(offset, 0)}px` }}
        >
          <div
            className={`flex items-center gap-1.5 transition-transform duration-150 shrink-0 ${
              isArmed ? 'scale-110 font-bold' : 'scale-100 opacity-90'
            }`}
          >
            {leftAction.icon}
            {offset >= 60 && (
              <span className="text-[11px] sm:text-xs font-mono font-bold tracking-tight select-none">
                {leftAction.label}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Background Action Underlayer: Right Action (Revealed on Swipe Left) */}
      {rightAction && isSwipingLeft && (
        <div
          data-testid={rightAction.testId || `swipe-action-right-${id}`}
          data-armed={isArmed ? 'true' : 'false'}
          aria-label={rightAction.ariaLabel || rightAction.label}
          className={`absolute inset-y-0 right-0 flex items-center justify-end pr-3.5 sm:pr-4 pl-3 gap-2 transition-colors duration-150 z-0 rounded-xl ${
            isArmed
              ? rightAction.isDestructive
                ? 'bg-[#DC6E67] text-white shadow-inner font-bold'
                : 'bg-app-action text-app-on-action shadow-inner font-bold'
              : rightAction.isDestructive
                ? 'bg-[#DC6E67]/25 text-status-error'
                : 'bg-app-action/20 text-app-action'
          }`}
          style={{ width: `${Math.max(-offset, 0)}px` }}
        >
          <div
            className={`flex items-center gap-1.5 transition-transform duration-150 shrink-0 ${
              isArmed ? 'scale-110 font-bold' : 'scale-100 opacity-90'
            }`}
          >
            {offset <= -60 && (
              <span className="text-[11px] sm:text-xs font-mono font-bold tracking-tight select-none">
                {rightAction.label}
              </span>
            )}
            {rightAction.icon}
          </div>
        </div>
      )}

      {/* Front Card Surface */}
      <div
        data-testid={dataTestId}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)',
          touchAction: 'pan-y',
        }}
        className={`relative z-10 ${cardClassName}`}
      >
        {children}
      </div>
    </div>
  )
}
