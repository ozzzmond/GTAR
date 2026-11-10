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
  secondaryRightAction?: SwipeActionConfig // Revealed on swipe left alongside rightAction (e.g. Rename)
  armThreshold?: number // Default: 75px
  maxSwipe?: number // Default: 110px
  disabled?: boolean
  className?: string
  cardClassName?: string
  dragSongIds?: Array<string | number>
  dragSetlistId?: string | number
  ariaLabel?: string
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
  secondaryRightAction,
  armThreshold: userArmThreshold,
  maxSwipe,
  disabled = false,
  className = '',
  cardClassName = '',
  dataTestId,
  dragSongIds,
  dragSetlistId,
  ariaLabel,
  onClick,
  children,
}) => {
  const [offset, setOffset] = useState(0)
  const [isArmed, setIsArmed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const cardContainerRef = useRef<HTMLDivElement>(null)

  const hasSecondary = Boolean(secondaryRightAction && !secondaryRightAction.disabled)
  const panelWidth = 140
  const openThreshold = 40
  const armThreshold = userArmThreshold ?? (hasSecondary ? 160 : 75)
  const effectiveMaxSwipe = maxSwipe ?? (hasSecondary ? 200 : 110)

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const gestureIntent = useRef<'undecided' | 'vertical' | 'horizontal'>('undecided')
  const didMoveBeyondTap = useRef(false)
  const isArmedRef = useRef(false)
  const offsetRef = useRef(0)
  const isOpenRef = useRef(false)

  // Keep refs in sync for touch release evaluation
  // Publish committed values before input events; suspended renders cannot leak.
  useLayoutEffect(() => {
    isArmedRef.current = isArmed
    offsetRef.current = offset
    isOpenRef.current = isOpen
  }, [isArmed, offset, isOpen])

  const resetCard = useCallback(() => {
    setOffset(0)
    setIsArmed(false)
    setIsDragging(false)
    setIsOpen(false)
    gestureIntent.current = 'undecided'
    isArmedRef.current = false
    offsetRef.current = 0
    isOpenRef.current = false
  }, [])

  // Register in active coordinator
  useEffect(() => {
    activeListeners.set(id, resetCard)
    return () => {
      activeListeners.delete(id)
    }
  }, [id, resetCard])

  // Global listeners when card settles OPEN
  useEffect(() => {
    if (!isOpen) return

    const handleGlobalPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null
      if (cardContainerRef.current && !cardContainerRef.current.contains(target)) {
        resetCard()
      }
    }

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetCard()
      }
    }

    document.addEventListener('pointerdown', handleGlobalPointerDown, true)
    document.addEventListener('keydown', handleGlobalKeyDown, true)

    return () => {
      document.removeEventListener('pointerdown', handleGlobalPointerDown, true)
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [isOpen, resetCard])

  // Reset if disabled changes
  useEffect(() => {
    if (disabled && (offset !== 0 || isArmed || isOpen)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Disabling a card must clear its live gesture and coordinator state.
      resetCard()
    }
  }, [disabled, offset, isArmed, isOpen, resetCard])

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return

    // Guard: ignore touch on interactive buttons or form controls
    const target = e.target as HTMLElement | null
    const control = target?.closest('button, [role="button"], select, input, textarea, a')
    if (control && control !== e.currentTarget) {
      gestureIntent.current = 'vertical'
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
    const rawDeltaX = clientX - touchStartX.current
    const deltaY = clientY - touchStartY.current

    // If card was already open at -panelWidth, offset begins from -panelWidth
    const baseOffset = isOpenRef.current ? -panelWidth : 0
    const totalDeltaX = baseOffset + rawDeltaX

    if (gestureIntent.current === 'undecided') {
      const intent = evaluateSwipeIntent(rawDeltaX, deltaY, 8)
      gestureIntent.current = intent

      if (intent === 'vertical') {
        // Primary vertical scroll intent: leave offset as is and do not intercept
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

      const activeArmThreshold = totalDeltaX < 0
        ? (userArmThreshold ?? (hasSecondary ? 160 : 75))
        : (userArmThreshold ?? 75)
      const activeMaxSwipe = totalDeltaX < 0
        ? (maxSwipe ?? (hasSecondary ? 200 : 110))
        : (maxSwipe ?? 110)

      const { offset: nextOffset, isArmed: nextArmed } = computeSwipeOffset(
        totalDeltaX,
        Boolean(leftAction && !leftAction.disabled),
        Boolean((rightAction && !rightAction.disabled) || (secondaryRightAction && !secondaryRightAction.disabled)),
        activeArmThreshold,
        activeMaxSwipe
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
          resetCard()
          return
        } else if (currentOffset < 0 && rightAction && !rightAction.disabled) {
          rightAction.onAction()
          resetCard()
          return
        }
      }

      // If card has secondaryRightAction and left swipe reached openThreshold
      if (hasSecondary && currentOffset < 0) {
        if (Math.abs(currentOffset) >= openThreshold) {
          // Settle OPEN
          setOffset(-panelWidth)
          setIsArmed(false)
          setIsDragging(false)
          setIsOpen(true)
          offsetRef.current = -panelWidth
          isOpenRef.current = true
          gestureIntent.current = 'undecided'
          return
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
    // If card was open, clicking front card closes it instead of navigating
    if (isOpen) {
      e.preventDefault()
      e.stopPropagation()
      resetCard()
      return
    }

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
    <div ref={cardContainerRef} className={`relative overflow-hidden ${className}`}>
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

      {/* Background Action Underlayer: Right Action(s) (Revealed on Swipe Left) */}
      {(rightAction || secondaryRightAction) && isSwipingLeft && (
        <div
          className="absolute inset-y-0 right-0 flex items-stretch justify-end z-0 rounded-xl overflow-hidden"
          style={{ width: `${Math.max(-offset, 0)}px` }}
        >
          {secondaryRightAction && (
            <button
              type="button"
              data-testid={secondaryRightAction.testId || `swipe-action-rename-${id}`}
              aria-label={secondaryRightAction.ariaLabel || secondaryRightAction.label}
              onClick={(e) => {
                e.stopPropagation()
                secondaryRightAction.onAction()
                resetCard()
              }}
              className="flex-1 min-w-[50px] flex items-center justify-center gap-1.5 bg-app-action text-app-on-action px-2 transition-transform duration-150 cursor-pointer"
            >
              {secondaryRightAction.icon}
              {offset <= -70 && (
                <span className="text-[11px] sm:text-xs font-mono font-bold tracking-tight select-none">
                  {secondaryRightAction.label}
                </span>
              )}
            </button>
          )}
          {rightAction && (
            <div
              data-testid={rightAction.testId || `swipe-action-right-${id}`}
              data-armed={isArmed ? 'true' : 'false'}
              aria-label={rightAction.ariaLabel || rightAction.label}
              onClick={(e) => {
                e.stopPropagation()
                rightAction.onAction()
                resetCard()
              }}
              className={`flex items-center justify-end pr-3.5 sm:pr-4 pl-3 gap-2 transition-colors duration-150 cursor-pointer ${
                secondaryRightAction ? 'flex-1 min-w-[60px]' : 'w-full'
              } ${
                isArmed
                  ? rightAction.isDestructive
                    ? 'bg-[#DC6E67] text-white shadow-inner font-bold'
                    : 'bg-app-action text-app-on-action shadow-inner font-bold'
                  : rightAction.isDestructive
                    ? 'bg-[#DC6E67]/25 text-status-error'
                    : 'bg-app-action/20 text-app-action'
              }`}
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
        </div>
      )}

      {/* Front Card Surface */}
      <div
        data-testid={dataTestId}
        role={ariaLabel ? 'button' : undefined}
        tabIndex={ariaLabel ? 0 : undefined}
        aria-label={ariaLabel}
        onKeyDown={e => {
          if (ariaLabel && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            e.currentTarget.click()
          }
        }}
        draggable={!!dragSongIds?.length || dragSetlistId !== undefined}
        data-explorer-drag-songs={dragSongIds?.length ? JSON.stringify(dragSongIds) : undefined}
        data-explorer-drag-setlist={dragSetlistId === undefined ? undefined : String(dragSetlistId)}
        data-explorer-drop-setlist={dragSetlistId === undefined ? undefined : String(dragSetlistId)}
        onDragStart={e => {
          if (gestureIntent.current === 'horizontal') {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          resetCard()
          didMoveBeyondTap.current = true
        }}
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
