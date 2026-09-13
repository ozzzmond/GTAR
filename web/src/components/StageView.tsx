import { SETTINGS_KEYS, SETTINGS_CHANGED, readBackupSettings } from '../utils/backupSettings'
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  createFullscreenController,
  createWakeLockController,
  isIosDevice,
  isStandalonePwa,
} from '../utils/stagePerformance'
import {
  Play,
  Pause,
  Maximize2,
  Minimize2,
  ChevronDown,
  RotateCcw,
  Columns2,
  Square,
  Minus,
  Plus,
  SkipBack,
  SkipForward,
  Radio,
  Users,
  Wifi,
  ArrowLeft,
  Cast,
  MoreHorizontal,
  SlidersHorizontal,
} from 'lucide-react'
import { transposeKey, formatTransposeOffset } from '../utils/chordTransposer'
import { parseGtarSong, splitSongLinesForColumns } from '../utils/songParser'
import { metronome } from '../utils/metronome'
import { bandSync, type BandSyncState } from '../utils/bandSync'
import { stageCast } from '../utils/stageCast'
import { getChordVoicing, type ChordVoicing } from '../utils/chordDictionary'
import { SongLineRenderer } from './SongLineRenderer'
import { KeyPickerModal } from './KeyPickerModal'
import { FretboardDiagramModal } from './FretboardDiagramModal'
import { BandSyncModal } from './BandSyncModal'
import type { ActiveSongState } from '../types/gtar'

interface StageViewProps {
  song: ActiveSongState
  songs: ActiveSongState[]
  activeSongIndex: number
  onSelectSongIndex: (index: number) => void
  queueMode?: 'library' | 'setlist'
  onToggleQueueMode?: (mode: 'library' | 'setlist') => void
  isInSetlistMode?: boolean
  activeSetlistSongs?: ActiveSongState[]
  activeSetlistSongIndex?: number
  onSelectSetlistSongIndex?: (index: number) => void
  activeSetlistName?: string
  setlists?: Array<{ id: string | number; name: string; songs: any[] }>
  onSelectSetlist?: (setlistId: string | number) => void
  onOpenSetlistDrawer: () => void
  transposeOffset: number
  onTransposeChange: (offset: number) => void
  fontStyle?: 'mono' | 'sans' | 'serif'
  onSelectFontStyle?: (style: 'mono' | 'sans' | 'serif') => void
  isTwoColumn?: boolean
  onToggleTwoColumn?: (enabled: boolean) => void
  onOpenBandSync?: () => void
  onBack?: () => void
  /** Called whenever the stage enters or exits "performance mode" (fullscreen or focus). */
  onPerformanceModeChange?: (isActive: boolean) => void
}



export const StageView: React.FC<StageViewProps> = ({
  song,
  songs,
  activeSongIndex,
  onSelectSongIndex,
  queueMode = 'library',
  isInSetlistMode: propIsInSetlistMode = false,
  activeSetlistSongs = [],
  activeSetlistSongIndex = 0,
  onSelectSetlistSongIndex,
  onOpenSetlistDrawer,
  transposeOffset,
  onTransposeChange,
  fontStyle: externalFontStyle,
  onSelectFontStyle: externalOnSelectFontStyle,
  isTwoColumn: externalIsTwoColumn,
  onToggleTwoColumn: externalOnToggleTwoColumn,
  onOpenBandSync,
  onBack,
  onPerformanceModeChange,
}) => {
  const isInSetlistMode = propIsInSetlistMode || queueMode === 'setlist'
  // Stage view configuration & controls (matching Jetpack Compose SongViewerScreen.kt)
  const [isAutoScrolling, setIsAutoScrolling] = useState(false)
  const [scrollSpeed, setScrollSpeed] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SETTINGS_KEYS.scrollSpeed)
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 5 && val <= 180) return val
      }
    }
    return 35
  })
  const [fontSizePx, setFontSizePx] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SETTINGS_KEYS.fontSizePx)
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 12 && val <= 38) return val
      }
    }
    return 20
  })
  const [localFontStyle, setLocalFontStyle] = useState<'mono' | 'sans' | 'serif'>('mono')
  const [localIsTwoColumn, setLocalIsTwoColumn] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(SETTINGS_KEYS.isTwoColumn) === 'true'
    }
    return false
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  // iOS PWA distraction-free mode: collapses the top bar since requestFullscreen
  // is not supported on iOS. On iOS PWA the shell is already full-height.
  const [isDistractionFree, setIsDistractionFree] = useState(false)
  // Computed once — doesn't change between renders
  const iosPwa = useMemo(() => isIosDevice() && isStandalonePwa(), [])
  const iosOnly = useMemo(() => isIosDevice() && !isStandalonePwa(), [])
  // True whenever the stage is in any full-attention performance mode
  const isPerformanceMode = isFullscreen || isDistractionFree

  // Focus mode auto-hiding song title banner
  const [showFocusTitle, setShowFocusTitle] = useState(true)
  const titleHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollTopRef = useRef<number>(0)

  const triggerTitleShow = useCallback(() => {
    setShowFocusTitle(true)
    if (titleHideTimeoutRef.current) {
      clearTimeout(titleHideTimeoutRef.current)
    }
    titleHideTimeoutRef.current = setTimeout(() => {
      setShowFocusTitle(false)
    }, 3500)
  }, [])

  useEffect(() => {
    if (isPerformanceMode) {
      triggerTitleShow()
    } else {
      setShowFocusTitle(false)
      if (titleHideTimeoutRef.current) {
        clearTimeout(titleHideTimeoutRef.current)
        titleHideTimeoutRef.current = null
      }
    }
  }, [isPerformanceMode, song.id, song.title, triggerTitleShow])

  useEffect(() => {
    return () => {
      if (titleHideTimeoutRef.current) {
        clearTimeout(titleHideTimeoutRef.current)
      }
    }
  }, [])

  const fontStyle = externalFontStyle !== undefined ? externalFontStyle : localFontStyle
  const setFontStyle = externalOnSelectFontStyle || setLocalFontStyle

  const isTwoColumn = externalIsTwoColumn !== undefined ? externalIsTwoColumn : localIsTwoColumn
  const setIsTwoColumn = (enabled: boolean) => {
    if (externalOnToggleTwoColumn) {
      externalOnToggleTwoColumn(enabled)
    } else {
      setLocalIsTwoColumn(enabled)
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEYS.isTwoColumn, String(enabled))
    }
  }

  useEffect(() => {
    const reloadSettings = () => {
      const stage = readBackupSettings().stageSettings
      if (stage?.fontSizePx !== undefined) setFontSizePx(stage.fontSizePx)
      if (stage?.scrollSpeed !== undefined) setScrollSpeed(stage.scrollSpeed)
      if (stage?.fontStyle !== undefined) setLocalFontStyle(stage.fontStyle)
      if (stage?.isTwoColumn !== undefined) setLocalIsTwoColumn(stage.isTwoColumn)
    }
    window.addEventListener(SETTINGS_CHANGED, reloadSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED, reloadSettings)
  }, [])

  // Modals & Drawers
  const [isKeyPickerOpen, setIsKeyPickerOpen] = useState(false)
  const [selectedVoicing, setSelectedVoicing] = useState<ChordVoicing | null>(null)
  const [isSpeedPromptOpen, setIsSpeedPromptOpen] = useState(false)
  const [speedInputText, setSpeedInputText] = useState('35')
  const [isBandSyncModalOpen, setIsBandSyncModalOpen] = useState(false)
  // Stage floating options menu (replaces top HUD)
  const [isStageMenuOpen, setIsStageMenuOpen] = useState(false)

  // Band Sync State
  const [syncState, setSyncState] = useState<BandSyncState>(() => bandSync.getState())

  // Stage Cast Active Presentation State
  const [isCastActive, setIsCastActive] = useState(() => stageCast.isPresentationActive())

  useEffect(() => {
    const unsubscribe = stageCast.subscribeSessionState((active) => {
      setIsCastActive(active)
    })
    return unsubscribe
  }, [])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollAnimRef = useRef<number | null>(null)
  // Sub-pixel accumulator: iOS Safari rounds scrollTop to integers, so we accumulate
  // fractional pixels here and only commit whole-pixel increments.
  const accumulatedScrollRef = useRef<number>(0)
  // Timestamp of the last autoscroll activation, used to guard against touch-cancel
  // events firing immediately after the FAB is tapped on iOS.
  const autoScrollStartedAtRef = useRef<number>(0)

  // Parse song with native v1.0.42 parser and active transpose offset
  const parsedSong = parseGtarSong(song.rawContent, transposeOffset)

  // Band Sync subscriptions
  useEffect(() => {
    const unsub = bandSync.subscribe((st) => setSyncState(st))
    return unsub
  }, [])

  // Listen to incoming messages for Band Member (Client)
  useEffect(() => {
    const unsubMsg = bandSync.onMessage((msg) => {
      if (syncState.role === 'CLIENT') {
        if (msg.type === 'SONG_SYNC' && msg.payload) {
          if (typeof msg.payload.transposeOffset === 'number') {
            onTransposeChange(msg.payload.transposeOffset)
          }
          if (typeof msg.payload.scrollProgress === 'number') {
            const fraction = msg.payload.scrollProgress
            const container = scrollContainerRef.current
            if (container) {
              const maxScroll = container.scrollHeight - container.clientHeight
              if (maxScroll > 0) {
                container.scrollTo({
                  top: fraction * maxScroll,
                  behavior: 'smooth',
                })
              }
            }
            if (typeof window !== 'undefined') {
              const winMax = document.documentElement.scrollHeight - window.innerHeight
              if (winMax > 0) {
                window.scrollTo({ top: fraction * winMax, behavior: 'smooth' })
              }
            }
          }
        } else if (msg.type === 'SCROLL_SYNC' && msg.payload) {
          const fraction =
            typeof msg.payload.scrollFraction === 'number'
              ? msg.payload.scrollFraction
              : typeof msg.payload.scrollProgress === 'number'
              ? msg.payload.scrollProgress
              : typeof msg.payload.scroll === 'number'
              ? msg.payload.scroll
              : 0

          const container = scrollContainerRef.current
          if (container) {
            const maxScroll = container.scrollHeight - container.clientHeight
            if (maxScroll > 0) {
              const targetTop =
                msg.payload.scrollTop !== undefined && msg.payload.scrollTop > 0
                  ? msg.payload.scrollTop
                  : fraction * maxScroll
              container.scrollTo({ top: targetTop, behavior: 'smooth' })
            }
          }
          if (typeof window !== 'undefined') {
            const winMax = document.documentElement.scrollHeight - window.innerHeight
            if (winMax > 0) {
              window.scrollTo({ top: fraction * winMax, behavior: 'smooth' })
            }
          }
        } else if (msg.type === 'AUTOSCROLL_SYNC' && msg.payload) {
          setIsAutoScrolling(Boolean(msg.payload.isAutoScrolling))
          if (msg.payload.scrollSpeed) {
            setScrollSpeed(msg.payload.scrollSpeed)
          }
        }
      }
    })
    return unsubMsg
  }, [syncState.role, onTransposeChange])

  // Broadcast song change when role is HOST
  useEffect(() => {
    if (syncState.role === 'HOST') {
      const container = scrollContainerRef.current
      const maxScroll = container ? container.scrollHeight - container.clientHeight : 1
      const progress = container && maxScroll > 0 ? container.scrollTop / maxScroll : 0
      bandSync.broadcastSong(
        isInSetlistMode ? activeSetlistSongIndex : activeSongIndex,
        song.title,
        transposeOffset,
        {
          artist: song.artist,
          queueType: isInSetlistMode ? 'SETLIST' : 'LIBRARY',
          scrollProgress: progress,
          rawContent: song.rawContent,
          key: song.key,
          capo: song.capo,
        }
      )
    }
  }, [
    activeSongIndex,
    activeSetlistSongIndex,
    isInSetlistMode,
    song.title,
    song.artist,
    song.rawContent,
    song.key,
    song.capo,
    transposeOffset,
    syncState.role,
  ])

  // Metronome sync with song BPM
  useEffect(() => {
    const songBpmNum = parseInt(song.bpm, 10)
    if (!isNaN(songBpmNum) && songBpmNum >= 30 && songBpmNum <= 300) {
      metronome.setBpm(songBpmNum)
    }
  }, [song.bpm])

  // ---------------------------------------------------------------------------
  // Continuous smooth auto-scroll loop
  // ---------------------------------------------------------------------------
  // iOS Safari rounds scrollTop assignments to integers, which means small
  // fractional increments (e.g. 35px/s @ 60fps → 0.58px/frame) are silently
  // discarded and the loop appears frozen. We fix this with a float accumulator
  // ref that tracks uncommitted sub-pixel progress and only writes integer-valued
  // increments to scrollTop.
  //
  // We also clamp elapsed to ≤100ms to prevent a large first-frame jump when
  // the loop is torn down and rebuilt (e.g. after a speed change).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isAutoScrolling) {
      if (scrollAnimRef.current) {
        cancelAnimationFrame(scrollAnimRef.current)
        scrollAnimRef.current = null
      }
      return
    }

    const container = scrollContainerRef.current
    if (!container) return

    // Reset accumulator each time the loop (re)starts so stale sub-pixels
    // from a previous session don't cause an erroneous first-frame jump.
    accumulatedScrollRef.current = container.scrollTop

    let lastTimestamp = performance.now()

    const scrollStep = (currentTimestamp: number) => {
      // Clamp elapsed to 100ms to absorb tab-switch / background pauses
      const elapsed = Math.min((currentTimestamp - lastTimestamp) / 1000, 0.1)
      lastTimestamp = currentTimestamp

      const cont = scrollContainerRef.current
      if (!cont) return

      const maxScroll = cont.scrollHeight - cont.clientHeight
      if (maxScroll <= 0) {
        setIsAutoScrolling(false)
        return
      }

      // Deceleration zone: last 15% of total scrollable content
      const decelerationZoneStart = maxScroll * 0.85
      const remaining = maxScroll - cont.scrollTop

      let effectiveSpeed = scrollSpeed
      if (cont.scrollTop >= decelerationZoneStart) {
        // Linear ramp from scrollSpeed down to 0 over the deceleration zone
        const decelerationRange = maxScroll - decelerationZoneStart
        const progress = Math.min(1, remaining / decelerationRange)
        effectiveSpeed = scrollSpeed * Math.max(0, progress)
      }

      // Stop cleanly when at the bottom or speed is negligible
      if (remaining <= 2 || effectiveSpeed < 0.5) {
        cont.scrollTop = maxScroll
        setIsAutoScrolling(false)
        return
      }

      // Accumulate sub-pixel progress and only write whole pixels to scrollTop.
      // This is the critical fix for iOS Safari, which ignores fractional
      // scrollTop assignments and rounds them to the nearest integer pixel.
      accumulatedScrollRef.current += effectiveSpeed * elapsed
      const nextScrollTop = Math.floor(accumulatedScrollRef.current)
      if (nextScrollTop !== cont.scrollTop) {
        cont.scrollTop = nextScrollTop
      }

      scrollAnimRef.current = requestAnimationFrame(scrollStep)
    }

    scrollAnimRef.current = requestAnimationFrame(scrollStep)

    return () => {
      if (scrollAnimRef.current) {
        cancelAnimationFrame(scrollAnimRef.current)
      }
    }
  }, [isAutoScrolling, scrollSpeed])

  // Broadcast scroll position to Stage Cast teleprompter & BandSync when HOST.
  // Also keeps the sub-pixel accumulator in sync after a user manually drags
  // the scroll position (e.g. touch-scroll during autoscroll pause).
  const handleContainerScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const currentTop = target.scrollTop
    const isScrollingDown = currentTop > lastScrollTopRef.current + 5
    const isAtTop = currentTop <= 20

    if (inPerformanceMode) {
      if (isScrollingDown && currentTop > 30) {
        // Immediately fades/hides when the user scrolls down
        setShowFocusTitle(false)
        if (titleHideTimeoutRef.current) {
          clearTimeout(titleHideTimeoutRef.current)
          titleHideTimeoutRef.current = null
        }
      } else if (isAtTop) {
        // Re-appears momentarily when scrolling back to the top
        triggerTitleShow()
      }
    }
    lastScrollTopRef.current = currentTop

    const maxScroll = target.scrollHeight - target.clientHeight
    const fraction = maxScroll > 0 ? target.scrollTop / maxScroll : 0

    // Keep accumulator in sync so the next autoscroll loop starts from the
    // correct position after a manual scroll.
    if (!isAutoScrolling) {
      accumulatedScrollRef.current = target.scrollTop
    }

    // Mirror to Stage Cast teleprompter screen in real time
    stageCast.broadcastScroll(target.scrollTop, fraction)

    if (syncState.role === 'HOST') {
      if (maxScroll > 0) {
        bandSync.broadcastScroll(fraction, target.scrollTop)
      }
    }
  }

  // Touch-cancel guard: stop autoscroll when the user deliberately drags the
  // content, but NOT when the event is the touch-end bleed from tapping the FAB.
  // We ignore touch events within 400ms of the last autoscroll activation.
  const handleContainerTouchStart = () => {
    if (!isAutoScrolling) return
    const msSinceStart = performance.now() - autoScrollStartedAtRef.current
    if (msSinceStart > 400) {
      setIsAutoScrolling(false)
    }
  }

  // Toggle autoscroll and broadcast if HOST
  const handleToggleAutoScroll = () => {
    const nextVal = !isAutoScrolling
    setIsAutoScrolling(nextVal)
    if (nextVal) {
      // Record activation time so the touch-cancel guard knows not to kill this
      // immediately when the FAB touch-end event propagates to the scroll container.
      autoScrollStartedAtRef.current = performance.now()
    }
    if (syncState.role === 'HOST') {
      bandSync.broadcastAutoScroll(nextVal, scrollSpeed)
    }
  }

  // Adjust scroll speed and broadcast if HOST
  const handleAdjustSpeed = (newSpeed: number) => {
    const clamped = Math.max(10, Math.min(150, newSpeed))
    setScrollSpeed(clamped)
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEYS.scrollSpeed, String(clamped))
    }
    if (syncState.role === 'HOST') {
      bandSync.broadcastAutoScroll(isAutoScrolling, clamped)
    }
  }

  const executePrevSong = useCallback(() => {
    if (isInSetlistMode && onSelectSetlistSongIndex) {
      if (activeSetlistSongIndex > 0) {
        onSelectSetlistSongIndex(activeSetlistSongIndex - 1)
      }
    } else if (activeSongIndex > 0) {
      onSelectSongIndex(activeSongIndex - 1)
    }
  }, [isInSetlistMode, onSelectSetlistSongIndex, activeSetlistSongIndex, activeSongIndex, onSelectSongIndex])

  const executeNextSong = useCallback(() => {
    if (isInSetlistMode && onSelectSetlistSongIndex) {
      if (activeSetlistSongIndex < activeSetlistSongs.length - 1) {
        onSelectSetlistSongIndex(activeSetlistSongIndex + 1)
      }
    } else if (activeSongIndex < songs.length - 1) {
      onSelectSongIndex(activeSongIndex + 1)
    }
  }, [isInSetlistMode, onSelectSetlistSongIndex, activeSetlistSongIndex, activeSetlistSongs.length, activeSongIndex, songs.length, onSelectSongIndex])

  const executePrevSongRef = useRef(executePrevSong)
  executePrevSongRef.current = executePrevSong
  const executeNextSongRef = useRef(executeNextSong)
  executeNextSongRef.current = executeNextSong

  const canPrev = isInSetlistMode
    ? activeSetlistSongIndex > 0
    : activeSongIndex > 0
  const canNext = isInSetlistMode
    ? activeSetlistSongIndex < activeSetlistSongs.length - 1
    : activeSongIndex < songs.length - 1

  const canPrevRef = useRef(canPrev)
  canPrevRef.current = canPrev
  const canNextRef = useRef(canNext)
  canNextRef.current = canNext

  const fontSizePxRef = useRef(fontSizePx)
  fontSizePxRef.current = fontSizePx

  const slideContentRef = useRef<HTMLDivElement>(null)
  const isAnimatingRef = useRef(false)
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerSongSlide = useCallback((direction: 'next' | 'prev') => {
    const slideEl = slideContentRef.current
    const container = scrollContainerRef.current
    if (!slideEl || isAnimatingRef.current) {
      if (direction === 'next') executeNextSongRef.current()
      else executePrevSongRef.current()
      return
    }

    if (direction === 'next' && !canNextRef.current) return
    if (direction === 'prev' && !canPrevRef.current) return

    isAnimatingRef.current = true
    const slideOutDuration = 200
    const slideInDuration = 240
    const outX = direction === 'next' ? '-100%' : '100%'
    const inX = direction === 'next' ? '100%' : '-100%'

    slideEl.style.transition = `transform ${slideOutDuration}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${slideOutDuration}ms ease-out`
    slideEl.style.transform = `translateX(${outX})`
    slideEl.style.opacity = '0.15'

    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)

    transitionTimeoutRef.current = setTimeout(() => {
      if (direction === 'next') executeNextSongRef.current()
      else executePrevSongRef.current()
      if (container) container.scrollTop = 0

      slideEl.style.transition = 'none'
      slideEl.style.transform = `translateX(${inX})`
      slideEl.style.opacity = '0.15'
      void slideEl.offsetWidth

      requestAnimationFrame(() => {
        slideEl.style.transition = `transform ${slideInDuration}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${slideInDuration}ms ease-out`
        slideEl.style.transform = 'translateX(0)'
        slideEl.style.opacity = '1'

        transitionTimeoutRef.current = setTimeout(() => {
          slideEl.style.transform = ''
          slideEl.style.transition = ''
          slideEl.style.opacity = ''
          isAnimatingRef.current = false
        }, slideInDuration + 30)
      })
    }, slideOutDuration)
  }, [])

  const handlePrevSong = useCallback(() => triggerSongSlide('prev'), [triggerSongSlide])
  const handleNextSong = useCallback(() => triggerSongSlide('next'), [triggerSongSlide])

  // Pinch-to-Zoom & Interactive Touch Drag Physics Gesture Listener
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let initialPinchDist = 0
    let initialPinchFontSize = fontSizePxRef.current
    let lastPinchSize = fontSizePxRef.current
    let isPinching = false

    let touchStartX = 0
    let touchStartY = 0
    let touchStartTime = 0
    let gestureDirection: 'undecided' | 'horizontal' | 'vertical' | 'pinch' = 'undecided'
    let currentDragX = 0

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        gestureDirection = 'pinch'
        isPinching = true
        initialPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        initialPinchFontSize = fontSizePxRef.current
        lastPinchSize = fontSizePxRef.current

        const slideEl = slideContentRef.current
        if (slideEl && !isAnimatingRef.current) {
          slideEl.style.transform = ''
          slideEl.style.transition = ''
          slideEl.style.opacity = ''
        }
      } else if (e.touches.length === 1 && !isAnimatingRef.current) {
        isPinching = false
        initialPinchDist = 0
        touchStartX = e.touches[0].clientX
        touchStartY = e.touches[0].clientY
        touchStartTime = Date.now()
        gestureDirection = 'undecided'
        currentDragX = 0

        const slideEl = slideContentRef.current
        if (slideEl) {
          slideEl.style.transition = 'none'
        }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialPinchDist > 0) {
        if (e.cancelable) e.preventDefault()
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        const scale = currentDist / initialPinchDist
        const targetSize = Math.round(initialPinchFontSize * scale)
        const clamped = Math.max(12, Math.min(38, targetSize))
        if (clamped !== lastPinchSize) {
          lastPinchSize = clamped
          setFontSizePx(clamped)
        }
        return
      }

      if (e.touches.length === 1 && !isPinching && !isAnimatingRef.current) {
        const currentX = e.touches[0].clientX
        const currentY = e.touches[0].clientY
        const deltaX = currentX - touchStartX
        const deltaY = currentY - touchStartY
        const absX = Math.abs(deltaX)
        const absY = Math.abs(deltaY)

        // Decide gesture direction once threshold is crossed
        if (gestureDirection === 'undecided') {
          if (Math.hypot(deltaX, deltaY) >= 8) {
            if (absX >= absY * 1.25 && absX >= 8) {
              gestureDirection = 'horizontal'
            } else if (absY > absX) {
              gestureDirection = 'vertical'
            }
          }
        }

        if (gestureDirection === 'horizontal') {
          // Lock scrolling: prevent native browser horizontal navigation & vertical scroll
          if (e.cancelable) e.preventDefault()

          const canPrevNow = canPrevRef.current
          const canNextNow = canNextRef.current

          // Rubber-band resistance dampening when dragging past boundaries
          let effectiveDeltaX = deltaX
          if (deltaX > 0 && !canPrevNow) {
            effectiveDeltaX = Math.min(50, Math.pow(deltaX, 0.7))
          } else if (deltaX < 0 && !canNextNow) {
            effectiveDeltaX = -Math.min(50, Math.pow(-deltaX, 0.7))
          }

          currentDragX = effectiveDeltaX
          const slideEl = slideContentRef.current
          if (slideEl) {
            slideEl.style.transform = `translateX(${effectiveDeltaX}px)`
            const fadeOpacity = Math.max(0.75, 1 - Math.abs(effectiveDeltaX) / 1200)
            slideEl.style.opacity = String(fadeOpacity)
          }
        }
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (isPinching) {
        if (e.touches.length < 2) {
          isPinching = false
          initialPinchDist = 0
          if (typeof window !== 'undefined') {
            localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(lastPinchSize))
          }
        }
        return
      }

      if (gestureDirection === 'horizontal' && !isAnimatingRef.current) {
        const slideEl = slideContentRef.current
        const touchEndX = e.changedTouches[0]?.clientX ?? (touchStartX + currentDragX)
        const deltaX = touchEndX - touchStartX
        const elapsed = Math.max(1, Date.now() - touchStartTime)
        const velocity = Math.abs(deltaX) / elapsed
        const canPrevNow = canPrevRef.current
        const canNextNow = canNextRef.current

        // Release threshold: ~60px distance OR >=30px with high velocity flick (>0.45 px/ms)
        const isNext = (deltaX <= -60 || (deltaX <= -30 && velocity >= 0.45)) && canNextNow
        const isPrev = (deltaX >= 60 || (deltaX >= 30 && velocity >= 0.45)) && canPrevNow

        if (slideEl) {
          if (isNext) {
            isAnimatingRef.current = true
            const slideOutDuration = 200
            const slideInDuration = 240
            slideEl.style.transition = `transform ${slideOutDuration}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${slideOutDuration}ms ease-out`
            slideEl.style.transform = 'translateX(-100%)'
            slideEl.style.opacity = '0.15'

            if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)

            transitionTimeoutRef.current = setTimeout(() => {
              executeNextSongRef.current()
              if (container) container.scrollTop = 0

              slideEl.style.transition = 'none'
              slideEl.style.transform = 'translateX(100%)'
              slideEl.style.opacity = '0.15'
              void slideEl.offsetWidth

              requestAnimationFrame(() => {
                slideEl.style.transition = `transform ${slideInDuration}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${slideInDuration}ms ease-out`
                slideEl.style.transform = 'translateX(0)'
                slideEl.style.opacity = '1'

                transitionTimeoutRef.current = setTimeout(() => {
                  slideEl.style.transform = ''
                  slideEl.style.transition = ''
                  slideEl.style.opacity = ''
                  isAnimatingRef.current = false
                }, slideInDuration + 30)
              })
            }, slideOutDuration)
          } else if (isPrev) {
            isAnimatingRef.current = true
            const slideOutDuration = 200
            const slideInDuration = 240
            slideEl.style.transition = `transform ${slideOutDuration}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${slideOutDuration}ms ease-out`
            slideEl.style.transform = 'translateX(100%)'
            slideEl.style.opacity = '0.15'

            if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)

            transitionTimeoutRef.current = setTimeout(() => {
              executePrevSongRef.current()
              if (container) container.scrollTop = 0

              slideEl.style.transition = 'none'
              slideEl.style.transform = 'translateX(-100%)'
              slideEl.style.opacity = '0.15'
              void slideEl.offsetWidth

              requestAnimationFrame(() => {
                slideEl.style.transition = `transform ${slideInDuration}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${slideInDuration}ms ease-out`
                slideEl.style.transform = 'translateX(0)'
                slideEl.style.opacity = '1'

                transitionTimeoutRef.current = setTimeout(() => {
                  slideEl.style.transform = ''
                  slideEl.style.transition = ''
                  slideEl.style.opacity = ''
                  isAnimatingRef.current = false
                }, slideInDuration + 30)
              })
            }, slideOutDuration)
          } else {
            // Cancel / Snap back to center
            isAnimatingRef.current = true
            slideEl.style.transition = 'transform 240ms cubic-bezier(0.25, 1, 0.5, 1), opacity 240ms ease-out'
            slideEl.style.transform = 'translateX(0)'
            slideEl.style.opacity = '1'

            if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)

            transitionTimeoutRef.current = setTimeout(() => {
              slideEl.style.transform = ''
              slideEl.style.transition = ''
              slideEl.style.opacity = ''
              isAnimatingRef.current = false
            }, 250)
          }
        }
        gestureDirection = 'undecided'
      }
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    container.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current)
      }
    }
  }, [])

  // Keyboard stage controls:
  // - Spacebar: Toggle Auto-Scroll (Play / Pause)
  // - ArrowRight or 'n': Next song in setlist
  // - ArrowLeft or 'p': Previous song in setlist
  // - ArrowUp / ArrowDown: Manually nudge scroll (or Shift + Arrow to adjust scroll speed)
  // - '+' / '-': Adjust font size
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }

      // Spacebar: Toggle Auto-Scroll (Play / Pause)
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        handleToggleAutoScroll()
        return
      }

      // ArrowRight or 'n': Next song in setlist or library
      if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        handleNextSong()
        return
      }

      // ArrowLeft or 'p': Previous song in setlist or library
      if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        handlePrevSong()
        return
      }

      // ArrowUp: Manually nudge scroll up or adjust scroll speed (with Shift)
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (e.shiftKey) {
          handleAdjustSpeed(Math.min(180, scrollSpeed + 5))
        } else if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollBy({ top: -80, behavior: 'smooth' })
        }
        return
      }

      // ArrowDown: Manually nudge scroll down or adjust scroll speed (with Shift)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (e.shiftKey) {
          handleAdjustSpeed(Math.max(5, scrollSpeed - 5))
        } else if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollBy({ top: 80, behavior: 'smooth' })
        }
        return
      }

      // Font size steppers
      if (e.key === '+' || e.key === '=') {
        setFontSizePx((prev) => Math.min(36, prev + 1))
      } else if (e.key === '-') {
        setFontSizePx((prev) => Math.max(13, prev - 1))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeSongIndex,
    songs.length,
    onSelectSongIndex,
    isInSetlistMode,
    activeSetlistSongIndex,
    activeSetlistSongs.length,
    onSelectSetlistSongIndex,
    isAutoScrolling,
    scrollSpeed,
    syncState.role,
    handleNextSong,
    handlePrevSong,
  ])

  // ---------------------------------------------------------------------------
  // Fullscreen controller — created once, cleaned up on unmount
  // ---------------------------------------------------------------------------
  const fullscreenCtrl = useMemo(() => createFullscreenController(), [])

  // Keep isFullscreen in sync with browser-driven exits (e.g. user presses Escape)
  useEffect(() => {
    const unsub = fullscreenCtrl.onChange((state) => setIsFullscreen(state))
    return () => {
      unsub()
      fullscreenCtrl.cleanup()
    }
  }, [fullscreenCtrl])

  const toggleFullscreen = () => {
    // iOS device (Safari or PWA): native fullscreen is not supported.
    // Fall back to a distraction-free toolbar-collapse mode instead.
    if (iosPwa || iosOnly || !fullscreenCtrl.isSupported) {
      setIsDistractionFree((prev) => !prev)
      return
    }
    fullscreenCtrl.toggle()
  }

  // ---------------------------------------------------------------------------
  // Screen Wake Lock — acquire on mount, re-acquire on tab return, release on unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const wakeLock = createWakeLockController()
    wakeLock.acquire()
    return () => {
      wakeLock.cleanup()
    }
  }, [])

  const effectiveKey = song.key ? transposeKey(song.key, transposeOffset) : ''
  const offsetStr = formatTransposeOffset(transposeOffset)

  // Two-column split calculation matching splitSongLinesForColumns in Android SongViewerScreen.kt
  const [col1Lines, col2Lines] = isTwoColumn
    ? splitSongLinesForColumns(parsedSong.lines)
    : [parsedSong.lines, []]

  // Mirror stage state to secondary screen / Cast Presentation window in real-time
  useEffect(() => {
    stageCast.broadcastState({
      song,
      effectiveKey,
      transposeOffset,
      fontSizePx,
      fontStyle,
      isTwoColumn,
    })
  }, [song, effectiveKey, transposeOffset, fontSizePx, fontStyle, isTwoColumn])

  useEffect(() => {
    // Listen for REQUEST_STATE from external teleprompter window
    return stageCast.subscribe(
      () => {},
      () => {},
      () => {
        stageCast.broadcastState({
          song,
          effectiveKey,
          transposeOffset,
          fontSizePx,
          fontStyle,
          isTwoColumn,
        })
      }
    )
  }, [song, effectiveKey, transposeOffset, fontSizePx, fontStyle, isTwoColumn])

  const handleChordClick = (chordName: string) => {
    const voicing = getChordVoicing(chordName)
    if (voicing) {
      setSelectedVoicing(voicing)
    }
  }

  // Notify parent whenever performance mode changes (so App can hide global Header)
  useEffect(() => {
    onPerformanceModeChange?.(isPerformanceMode)
  }, [isPerformanceMode, onPerformanceModeChange])

  const handleCustomSpeedSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const val = parseInt(speedInputText, 10)
    if (!isNaN(val) && val >= 5 && val <= 180) {
      handleAdjustSpeed(val)
    }
    setIsSpeedPromptOpen(false)
  }

  const inPerformanceMode = isPerformanceMode

  return (
    <div className="flex-1 flex flex-col bg-[#002B36] select-none relative overflow-hidden"
      style={{ height: inPerformanceMode ? '100vh' : 'calc(100vh - 4rem)' }}
    >
      {/* =================================================================== */}
      {/* PERFORMANCE MODE — Focus Mode Auto-Hiding Song Title Banner        */}
      {/* =================================================================== */}
      {inPerformanceMode && (
        <div
          onClick={triggerTitleShow}
          className={`absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-4 sm:px-6 py-2.5
                      bg-[#073642]/95 backdrop-blur-md border-b border-[#1A4A55] shadow-xl
                      transition-all duration-300 ease-in-out transform ${
                        showFocusTitle
                          ? 'opacity-100 translate-y-0 pointer-events-auto'
                          : 'opacity-0 -translate-y-full pointer-events-none'
                      }`}
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        >
          <div className="min-w-0 flex-1 pr-3">
            <h1 className="text-base sm:text-lg font-extrabold text-[#EEE8D5] tracking-tight leading-tight truncate">
              {song.title || 'Untitled Song'}
            </h1>
            {song.artist && (
              <p className="text-[11px] sm:text-xs text-[#2AA198] font-semibold truncate leading-none mt-0.5">
                {song.artist}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {effectiveKey && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#002B36] text-[#B58900] border border-[#B58900]/40">
                {effectiveKey}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isFullscreen && fullscreenCtrl.isSupported) fullscreenCtrl.toggle()
                else setIsDistractionFree(false)
              }}
              className="px-2.5 py-1 rounded-lg bg-[#002B36] hover:bg-[#1A4A55] text-[#EEE8D5] text-xs font-semibold
                         flex items-center gap-1 border border-[#1A4A55] transition-colors cursor-pointer"
              title="Exit focus mode"
              aria-label="Exit focus mode"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">Exit</span>
            </button>
          </div>
        </div>
      )}

      {/* Top area tap zone to reveal the banner when hidden */}
      {inPerformanceMode && !showFocusTitle && (
        <div
          onClick={triggerTitleShow}
          className="absolute top-0 left-0 right-0 h-14 z-30 cursor-pointer pointer-events-auto"
          style={{ top: 'env(safe-area-inset-top, 0px)' }}
          aria-label="Reveal song title banner"
          title="Tap to show song title"
        />
      )}

      {/* =================================================================== */}
      {/* 1. TOP APP BAR (Exact 1:1 Jetpack Compose SongViewerScreen.kt)       */}
      {/*    Hidden entirely in performance mode — replaced by floating HUD.  */}
      {/* =================================================================== */}
      <div
        className={`border-b border-[#1A4A55] bg-[#073642] px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 z-20 shadow-md transition-all duration-300 ${
          inPerformanceMode ? 'opacity-0 pointer-events-none h-0 py-0 overflow-hidden border-0' : 'opacity-100'
        }`}
      >
        {/* Left Side: Back Navigation Button + Song Title & Artist */}
        <div className="flex items-center gap-2 sm:gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer text-[#EEE8D5] hover:text-[#2AA198] flex items-center justify-center -ml-1 select-none active:scale-95"
              title="Back to Songbook Library"
              aria-label="Back to Songbook Library"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-extrabold text-[#EEE8D5] tracking-tight leading-tight truncate max-w-[240px] sm:max-w-xs md:max-w-md">
              {song.title || 'Untitled Song'}
            </h1>
            {song.artist && (
              <p className="text-[11px] sm:text-xs text-[#2AA198] font-semibold truncate leading-none mt-0.5">
                {song.artist}
              </p>
            )}
          </div>
        </div>

        {/* Right Side: Font Family, Font Size A-/A+, Column Reflow, Transpose Stepper, Band Sync, Stage Tools, Fullscreen */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
          {/* Font Family Selector (Mono / Sans / Serif matching Android SongFontStyle) */}
          <div className="flex items-center bg-[#002B36] rounded-lg border border-[#1A4A55] p-0.5 text-xs font-semibold">
            {(
              [
                { id: 'mono', label: 'Mono', title: 'Monospace (Recommended for stage chord alignment)' },
                { id: 'sans', label: 'Sans', title: 'Sans-Serif (Clean modern look)' },
                { id: 'serif', label: 'Serif', title: 'Stage Serif (High contrast bold stage style)' },
              ] as const
            ).map(({ id, label, title }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFontStyle(id)}
                className={`px-2 py-1 rounded transition-all cursor-pointer select-none ${
                  fontStyle === id
                    ? 'bg-[#2AA198] text-[#002B36] font-extrabold shadow-sm'
                    : 'text-[#EEE8D5] hover:text-[#2AA198]'
                }`}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>

          {/* A- / A+ Font Size Stepper (matching Compose onAdjustFontSize) */}
          <div className="flex items-center bg-[#002B36] rounded-lg border border-[#1A4A55] p-0.5">
            <button
              type="button"
              onClick={() => {
                const next = Math.max(12, fontSizePx - 1)
                setFontSizePx(next)
                if (typeof window !== 'undefined') {
                  localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(next))
                }
              }}
              className="px-2 py-1 text-xs font-extrabold text-[#EEE8D5] hover:text-[#2AA198] rounded cursor-pointer select-none"
              title="Decrease Font Size (A-)"
            >
              A-
            </button>
            <span className="text-[11px] font-mono text-[#93A1A1] px-1 font-semibold">
              {fontSizePx}
            </span>
            <button
              type="button"
              onClick={() => {
                const next = Math.min(38, fontSizePx + 1)
                setFontSizePx(next)
                if (typeof window !== 'undefined') {
                  localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(next))
                }
              }}
              className="px-2 py-1 text-xs font-extrabold text-[#EEE8D5] hover:text-[#2AA198] rounded cursor-pointer select-none"
              title="Increase Font Size (A+)"
            >
              A+
            </button>
          </div>

          {/* Two-Column Reflow Toggle (Compose ViewStream vs ViewColumn) */}
          <button
            type="button"
            onClick={() => setIsTwoColumn(!isTwoColumn)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all cursor-pointer ${
              isTwoColumn
                ? 'bg-[#B58900]/20 text-[#B58900] border-[#B58900] font-bold shadow-sm'
                : 'bg-[#002B36] text-[#EEE8D5] border-[#1A4A55] hover:text-[#2AA198]'
            }`}
            title={isTwoColumn ? 'Switch to 1 Column' : 'Switch to 2 Columns'}
          >
            {isTwoColumn ? <Columns2 className="w-3.5 h-3.5 text-[#B58900]" /> : <Square className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isTwoColumn ? '2-Col' : '1-Col'}</span>
          </button>

          {/* Standard Transpose Stepper: [ - ] Key: G (+1) [ + ] (Compose lines 523-589) */}
          <div
            className={`flex items-center rounded-lg border transition-colors p-0.5 ${
              transposeOffset !== 0
                ? 'bg-[#B58900]/15 border-[#B58900]'
                : 'bg-[#002B36] border-[#1A4A55]'
            }`}
          >
            <button
              type="button"
              onClick={() => onTransposeChange(transposeOffset - 1)}
              className="p-1 text-[#EEE8D5] hover:text-[#2AA198] rounded cursor-pointer"
              title="Transpose Down (-1)"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setIsKeyPickerOpen(true)}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-mono font-extrabold rounded cursor-pointer transition-colors ${
                transposeOffset !== 0 ? 'text-[#B58900]' : 'text-[#EEE8D5] hover:bg-[#073642]'
              }`}
              title="Select Target Key"
            >
              <span>
                {transposeOffset !== 0
                  ? `Key: ${effectiveKey} (${offsetStr})`
                  : `Key: ${effectiveKey || 'Orig'}`}
              </span>
              <ChevronDown className="w-3 h-3 opacity-75" />
            </button>

            {transposeOffset !== 0 && (
              <button
                type="button"
                onClick={() => onTransposeChange(0)}
                className="p-1 text-[#93A1A1] hover:text-[#DC6E67] cursor-pointer"
                title="Reset Transposition to Original Key"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onTransposeChange(transposeOffset + 1)}
              className="p-1 text-[#EEE8D5] hover:text-[#2AA198] rounded cursor-pointer"
              title="Transpose Up (+1)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Band Sync Status Indicator & Modal Trigger */}
          <button
            type="button"
            onClick={onOpenBandSync || (() => setIsBandSyncModalOpen(true))}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer shadow-sm ${
              syncState.role === 'HOST'
                ? 'bg-[#10B981]/20 border-[#10B981] text-[#10B981]'
                : syncState.role === 'CLIENT'
                ? 'bg-[#2AA198]/20 border-[#2AA198] text-[#2AA198]'
                : 'bg-[#002B36] border-[#1A4A55] text-[#93A1A1] hover:text-[#EEE8D5]'
            }`}
            title={
              syncState.role === 'HOST'
                ? `Band Leader (Active) • ${syncState.connectedPeers} member(s) connected`
                : syncState.role === 'CLIENT'
                ? 'Band Member (Synced to Leader)'
                : 'Band Sync (Click to connect devices)'
            }
          >
            {syncState.role === 'HOST' ? (
              <>
                <Radio className="w-3.5 h-3.5 animate-pulse text-[#10B981]" />
                <span className="hidden md:inline">LEADER</span>
                <span className="text-[10px] px-1 py-0.2 rounded bg-[#10B981]/30">
                  {syncState.connectedPeers}
                </span>
              </>
            ) : syncState.role === 'CLIENT' ? (
              <>
                <Users className="w-3.5 h-3.5 animate-pulse text-[#2AA198]" />
                <span className="hidden md:inline">SYNCED</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Sync</span>
              </>
            )}
          </button>
          {/* Cast / Pop-out Screen (Mirror distraction-free stage teleprompter to external display) */}
          <button
            type="button"
            onClick={() => {
              if (isCastActive) {
                stageCast.stopPresentation()
              } else {
                const container = scrollContainerRef.current
                if (container) {
                  const maxScroll = container.scrollHeight - container.clientHeight
                  const fraction = maxScroll > 0 ? container.scrollTop / maxScroll : 0
                  stageCast.broadcastScroll(container.scrollTop, fraction)
                }
                stageCast.broadcastState({
                  song,
                  effectiveKey,
                  transposeOffset,
                  fontSizePx,
                  fontStyle,
                  isTwoColumn,
                })
                stageCast.openPresentationWindow()
              }
            }}
            className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
              isCastActive
                ? 'bg-[#DC6E67]/20 border-[#DC6E67] text-[#DC6E67] hover:bg-[#DC6E67]/30 shadow-sm animate-pulse'
                : 'bg-[#002B36] border-[#1A4A55] text-[#EEE8D5] hover:text-[#2AA198] hover:border-[#2AA198]'
            }`}
            title={
              isCastActive
                ? 'Disconnect / Stop Presenting (Session Active - click to terminate)'
                : 'Cast / Pop-out Screen (Open distraction-free fullscreen teleprompter on secondary monitor or TV)'
            }
          >
            <Cast className="w-4 h-4" />
            {isCastActive && (
              <span className="hidden xl:inline text-[10px] font-mono font-bold uppercase tracking-wider">
                Stop
              </span>
            )}
          </button>

          {/* Stage Focus Mode (Fullscreen / Distraction-Free) */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              isDistractionFree
                ? 'bg-[#2AA198]/20 border-[#2AA198] text-[#2AA198] hover:bg-[#2AA198]/30'
                : 'bg-[#002B36] border-[#1A4A55] text-[#EEE8D5] hover:text-[#2AA198]'
            }`}
            title={
              iosPwa || iosOnly
                ? isDistractionFree
                  ? 'Exit Focus Mode (show toolbar)'
                  : 'Focus Mode — collapse toolbar for distraction-free stage'
                : isFullscreen
                ? 'Exit Fullscreen'
                : 'Enter Fullscreen'
            }
            aria-label={
              iosPwa || iosOnly
                ? isDistractionFree
                  ? 'Exit distraction-free focus mode'
                  : 'Enter distraction-free focus mode'
                : isFullscreen
                ? 'Exit fullscreen'
                : 'Enter fullscreen'
            }
          >
            {isFullscreen || isDistractionFree ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 2. MAIN SCROLLING CANVAS (Exact SongLinesColumn from Compose)        */}
      {/* =================================================================== */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContainerScroll}
        onTouchStart={handleContainerTouchStart}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6 md:px-8 py-4 select-text"
      >
        <div
          ref={slideContentRef}
          className={`mx-auto transition-[max-width] duration-300 ${isTwoColumn ? 'max-w-[95vw]' : 'max-w-4xl'}`}
          style={{ willChange: 'transform' }}
        >

          {/* Song Lines Rendering: 1 Column or 2 Columns */}
          {song.isMissing ? (
            <div role="alert" className="rounded-xl border border-amber-500 p-6 text-center">
              <h2 className="text-xl font-bold">Missing song: {song.title}</h2>
              <p className="mt-2">This setlist entry is unavailable. Restore the song from Trash or a backup, or remove this entry from the setlist.</p>
            </div>
          ) : isTwoColumn && col2Lines.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10 items-start">
              <div className="min-w-0">
                <SongLineRenderer
                  lines={col1Lines}
                  fontSizePx={fontSizePx}
                  fontFamily={fontStyle}
                  onChordClick={handleChordClick}
                />
              </div>

              <div className="min-w-0 md:border-l md:border-[#1A4A55]/60 md:pl-6 lg:pl-10">
                <SongLineRenderer
                  lines={col2Lines}
                  fontSizePx={fontSizePx}
                  fontFamily={fontStyle}
                  onChordClick={handleChordClick}
                />
              </div>
            </div>
          ) : (
            <SongLineRenderer
              lines={parsedSong.lines}
              fontSizePx={fontSizePx}
              fontFamily={fontStyle}
              onChordClick={handleChordClick}
            />
          )}

          {/* Bottom Padding for scroll clearance (Spacer(height = 140.dp)) */}
          <div className="h-44 flex items-center justify-center text-xs font-mono text-[#1A4A55] select-none">
            — End of Song —
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 3. BOTTOM DOCK — Android-style FABs + bottom-center setlist strip    */}
      {/* =================================================================== */}

      {/* --- Bottom-center setlist navigator pill --- */}
      {((isInSetlistMode && activeSetlistSongs.length > 1) ||
        (!isInSetlistMode && songs.length > 1)) && (
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0 pointer-events-auto
                     bg-[#073642]/90 backdrop-blur-md rounded-t-2xl border-x border-t shadow-xl text-xs font-mono select-none"
          style={{
            borderColor: isInSetlistMode ? 'rgba(181,137,0,0.35)' : 'rgba(42,161,152,0.35)',
            paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
          }}
        >
          <button
            type="button"
            disabled={isInSetlistMode ? activeSetlistSongIndex <= 0 : activeSongIndex <= 0}
            onClick={handlePrevSong}
            className={`px-3 py-2 transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${
              isInSetlistMode ? 'text-[#B58900] hover:text-white' : 'text-[#2AA198] hover:text-white'
            }`}
            title="Previous Song"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenSetlistDrawer}
            className={`px-3 py-2 font-extrabold text-[11px] transition-colors cursor-pointer ${
              isInSetlistMode ? 'text-[#B58900] hover:text-white' : 'text-[#2AA198] hover:text-white'
            }`}
            title="Open setlist / library"
          >
            {isInSetlistMode
              ? `${activeSetlistSongIndex + 1} / ${activeSetlistSongs.length}`
              : `${activeSongIndex + 1} / ${songs.length}`}
          </button>

          <button
            type="button"
            disabled={isInSetlistMode ? activeSetlistSongIndex >= activeSetlistSongs.length - 1 : activeSongIndex >= songs.length - 1}
            onClick={handleNextSong}
            className={`px-3 py-2 transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${
              isInSetlistMode ? 'text-[#B58900] hover:text-white' : 'text-[#2AA198] hover:text-white'
            }`}
            title="Next Song"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* --- Bottom-right FAB stack (autoscroll + options) --- */}
      <div
        className="absolute bottom-0 right-0 z-30 flex flex-col items-end gap-3 pointer-events-none"
        style={{
          paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          paddingRight: 'max(16px, env(safe-area-inset-right, 16px))',
        }}
      >
        {/* ··· Stage Options FAB */}
        <button
          type="button"
          onClick={() => setIsStageMenuOpen(true)}
          className="pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center
                     bg-[#073642]/90 backdrop-blur-md border border-[#1A4A55] shadow-xl
                     text-[#93A1A1] hover:text-[#EEE8D5] hover:border-[#2AA198]
                     transition-all active:scale-90 cursor-pointer"
          title="Stage options (transpose, font, speed, exit)"
          aria-label="Open stage options"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>

        {/* Autoscroll FAB — circular, Android yellow/red */}
        <button
          type="button"
          onClick={handleToggleAutoScroll}
          className={`pointer-events-auto w-14 h-14 rounded-full flex items-center justify-center
                     shadow-2xl transition-all active:scale-90 cursor-pointer select-none
                     border-2 ${
            isAutoScrolling
              ? 'bg-[#EF4444] border-[#EF4444]/60 text-white hover:bg-[#DC2626] shadow-red-900/50'
              : 'bg-[#B58900] border-[#B58900]/60 text-black hover:bg-[#C89600] shadow-amber-900/40'
          }`}
          title={isAutoScrolling ? 'Pause autoscroll (Space)' : 'Start autoscroll (Space)'}
          aria-label={isAutoScrolling ? 'Pause autoscroll' : 'Start autoscroll'}
        >
          {isAutoScrolling
            ? <Pause className="w-6 h-6 fill-current" />
            : <Play className="w-6 h-6 fill-current" />}
        </button>
      </div>

      {/* Speed input popup */}
      {isSpeedPromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setIsSpeedPromptOpen(false)}
        >
          <form
            onSubmit={handleCustomSpeedSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl bg-[#073642] border border-[#1A4A55] p-5 shadow-2xl text-[#EEE8D5]"
          >
            <h3 className="text-base font-bold text-[#B58900] mb-2">Set Scroll Speed</h3>
            <p className="text-xs text-[#93A1A1] mb-4">Enter scroll speed in dp/s (5–180):</p>
            <input
              type="number"
              min="5"
              max="180"
              autoFocus
              value={speedInputText}
              onChange={(e) => setSpeedInputText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#002B36] border border-[#1A4A55] text-center text-lg font-mono font-bold text-[#B58900] focus:outline-none focus:border-[#2AA198]"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button type="button" onClick={() => setIsSpeedPromptOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#93A1A1] hover:text-[#EEE8D5]">
                Cancel
              </button>
              <button type="submit"
                className="px-4 py-1.5 rounded-lg bg-[#2AA198] text-[#002B36] text-xs font-bold hover:bg-[#35B8AD]">
                Apply
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================================================================== */}
      {/* Stage Options Bottom Sheet                                         */}
      {/* ================================================================== */}
      {isStageMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={() => setIsStageMenuOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Sheet */}
          <div
            className="relative z-10 rounded-t-3xl bg-[#073642] border-t border-x border-[#1A4A55] shadow-2xl px-5 pt-3"
            style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-[#1A4A55] rounded-full mx-auto mb-4" />

            <h2 className="text-sm font-extrabold text-[#EEE8D5] tracking-wide uppercase mb-4 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#2AA198]" /> Stage Options
            </h2>

            {/* --- Transpose row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Transpose</span>
              <div className={`flex items-center rounded-xl border p-0.5 flex-1 ${
                transposeOffset !== 0 ? 'bg-[#B58900]/10 border-[#B58900]' : 'bg-[#002B36] border-[#1A4A55]'
              }`}>
                <button type="button" onClick={() => onTransposeChange(transposeOffset - 1)}
                  className="p-2 text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer">
                  <Minus className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setIsKeyPickerOpen(true)}
                  className={`flex-1 text-center text-sm font-mono font-extrabold cursor-pointer ${
                    transposeOffset !== 0 ? 'text-[#B58900]' : 'text-[#EEE8D5]'
                  }`}>
                  {transposeOffset !== 0 ? `${effectiveKey} (${offsetStr})` : `Key: ${effectiveKey || 'Orig'}`}
                </button>
                {transposeOffset !== 0 && (
                  <button type="button" onClick={() => onTransposeChange(0)}
                    className="p-2 text-[#93A1A1] hover:text-[#DC6E67] cursor-pointer">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => onTransposeChange(transposeOffset + 1)}
                  className="p-2 text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* --- Font size row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Font Size</span>
              <div className="flex items-center bg-[#002B36] rounded-xl border border-[#1A4A55] flex-1">
                <button type="button"
                  onClick={() => { const n = Math.max(12, fontSizePx - 1); setFontSizePx(n); localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(n)) }}
                  className="px-4 py-2 text-sm font-extrabold text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer">
                  A-
                </button>
                <span className="flex-1 text-center text-sm font-mono font-bold text-[#B58900]">{fontSizePx}px</span>
                <button type="button"
                  onClick={() => { const n = Math.min(38, fontSizePx + 1); setFontSizePx(n); localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(n)) }}
                  className="px-4 py-2 text-sm font-extrabold text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer">
                  A+
                </button>
              </div>
            </div>

            {/* --- Autoscroll speed row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Speed</span>
              <div className="flex items-center bg-[#002B36] rounded-xl border border-[#1A4A55] flex-1">
                <button type="button"
                  onClick={() => handleAdjustSpeed(Math.max(5, scrollSpeed - 5))}
                  className="px-4 py-2 text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer">
                  <Minus className="w-4 h-4" />
                </button>
                <button type="button"
                  onClick={() => { setSpeedInputText(scrollSpeed.toString()); setIsStageMenuOpen(false); setIsSpeedPromptOpen(true) }}
                  className="flex-1 text-center text-sm font-mono font-bold text-[#B58900] cursor-pointer py-2">
                  {scrollSpeed} dp/s
                </button>
                <button type="button"
                  onClick={() => handleAdjustSpeed(Math.min(150, scrollSpeed + 5))}
                  className="px-4 py-2 text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* --- Column toggle + Font style row --- */}
            <div className="flex items-center gap-2 mb-5">
              <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Layout</span>
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <button type="button"
                  onClick={() => setIsTwoColumn(!isTwoColumn)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold cursor-pointer transition-all ${
                    isTwoColumn ? 'bg-[#B58900]/20 border-[#B58900] text-[#B58900]' : 'bg-[#002B36] border-[#1A4A55] text-[#EEE8D5]'
                  }`}>
                  {isTwoColumn ? <Columns2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  {isTwoColumn ? '2-Col' : '1-Col'}
                </button>
                {(['mono','sans','serif'] as const).map((fs) => (
                  <button key={fs} type="button" onClick={() => setFontStyle(fs)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                      fontStyle === fs ? 'bg-[#2AA198] border-[#2AA198] text-[#002B36] font-extrabold' : 'bg-[#002B36] border-[#1A4A55] text-[#EEE8D5]'
                    }`}>
                    {fs.charAt(0).toUpperCase() + fs.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Exit performance mode --- */}
            {inPerformanceMode && (
              <button
                type="button"
                onClick={() => {
                  setIsStageMenuOpen(false)
                  if (isFullscreen && fullscreenCtrl.isSupported) fullscreenCtrl.toggle()
                  else setIsDistractionFree(false)
                }}
                className="w-full py-3 rounded-2xl bg-[#002B36] border border-[#1A4A55]
                           text-sm font-bold text-[#EEE8D5] hover:border-[#DC6E67] hover:text-[#DC6E67]
                           transition-colors cursor-pointer flex items-center justify-center gap-2 mb-2"
              >
                <Minimize2 className="w-4 h-4" />
                {isFullscreen ? 'Exit Fullscreen' : 'Exit Focus Mode'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Fretboard Diagram Modal (1:1 Android FretboardDiagramDialog.kt) */}
      <FretboardDiagramModal
        voicing={selectedVoicing}
        onClose={() => setSelectedVoicing(null)}
      />

      {/* Key & Transpose Picker Modal */}
      <KeyPickerModal
        isOpen={isKeyPickerOpen}
        onClose={() => setIsKeyPickerOpen(false)}
        originalKey={song.key}
        currentOffset={transposeOffset}
        capoText={song.capo}
        onSelectOffset={onTransposeChange}
        onReset={() => onTransposeChange(0)}
      />

      {/* Stage Tools & Band Sync Modal */}
      <BandSyncModal
        isOpen={isBandSyncModalOpen}
        onClose={() => setIsBandSyncModalOpen(false)}
        initialTab="sync"
      />
    </div>
  )
}
