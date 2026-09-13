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
  Sparkles,
} from 'lucide-react'
import { transposeKey, formatTransposeOffset } from '../utils/chordTransposer'
import { parseGtarSong, splitSongLinesForColumns } from '../utils/songParser'
import { metronome } from '../utils/metronome'
import { bandSync, type BandSyncState } from '../utils/bandSync'
import { stageCast } from '../utils/stageCast'
import { getChordVoicing, type ChordVoicing } from '../utils/chordDictionary'
import {
  SongLineRenderer,
  getMaxStageFontSize,
  type StageChordScale,
  type StageFontWeight,
  type StageLineSpacing,
} from './SongLineRenderer'
export { getMaxStageFontSize }
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

export const STAGE_SIZE_PRESETS = {
  S: 16,
  M: 20,
  L: 24, // Stage default
  XL: 30,
} as const

export const CHORD_SCALE_OPTIONS: { value: StageChordScale; label: string }[] = [
  { value: 1.0, label: '100%' },
  { value: 1.1, label: '110%' },
  { value: 1.2, label: '120%' },
  { value: 1.3, label: '130%' },
]

export const FONT_WEIGHT_OPTIONS: { value: StageFontWeight; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'medium', label: 'Medium' },
  { value: 'bold', label: 'Bold' },
]

export const LINE_SPACING_OPTIONS: { value: StageLineSpacing; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
]

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
  // Viewport width tracking for responsive typography bounds
  const [viewportWidth, setViewportWidth] = useState<number>(() => {
    return typeof window !== 'undefined' ? window.innerWidth : 1024
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize, { passive: true })
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const maxFontSize = useMemo(() => getMaxStageFontSize(viewportWidth), [viewportWidth])

  const [fontSizePx, setFontSizePx] = useState<number>(() => {
    const currentMax = typeof window !== 'undefined' ? getMaxStageFontSize(window.innerWidth) : 34
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SETTINGS_KEYS.fontSizePx)
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 12) return Math.min(val, currentMax)
      }
    }
    return 20
  })

  // Debounced persistence for font size changes to eliminate layout micro-stutters during rapid taps/hold
  const saveFontSizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSaveFontSize = useCallback((size: number) => {
    if (typeof window === 'undefined') return
    if (saveFontSizeTimeoutRef.current) {
      clearTimeout(saveFontSizeTimeoutRef.current)
    }
    saveFontSizeTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(size))
      } catch {
        // Ignore quota/storage errors
      }
      saveFontSizeTimeoutRef.current = null
    }, 250)
  }, [])

  // Auto-clamp if viewport shrinks below current font size
  useEffect(() => {
    setFontSizePx((prev) => {
      if (prev > maxFontSize) {
        debouncedSaveFontSize(maxFontSize)
        return maxFontSize
      }
      return prev
    })
  }, [maxFontSize, debouncedSaveFontSize])

  useEffect(() => {
    return () => {
      if (saveFontSizeTimeoutRef.current) {
        clearTimeout(saveFontSizeTimeoutRef.current)
      }
    }
  }, [])

  // Device-level persistent Stage Typography preferences
  const [chordScale, setChordScaleState] = useState<StageChordScale>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gtar_stage_chord_scale')
      if (saved) {
        const val = parseFloat(saved)
        if ([1.0, 1.1, 1.2, 1.3].includes(val)) return val as StageChordScale
      }
    }
    return 1.0
  })

  const [fontWeight, setFontWeightState] = useState<StageFontWeight>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gtar_stage_font_weight')
      if (saved && ['regular', 'medium', 'bold'].includes(saved)) {
        return saved as StageFontWeight
      }
    }
    return 'regular'
  })

  const [lineSpacing, setLineSpacingState] = useState<StageLineSpacing>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gtar_stage_line_spacing')
      if (saved && ['compact', 'normal', 'relaxed'].includes(saved)) {
        return saved as StageLineSpacing
      }
    }
    return 'normal'
  })

  const setChordScale = useCallback((scale: StageChordScale) => {
    setChordScaleState(scale)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_stage_chord_scale', String(scale))
    }
  }, [])

  const setFontWeight = useCallback((weight: StageFontWeight) => {
    setFontWeightState(weight)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_stage_font_weight', weight)
    }
  }, [])

  const setLineSpacing = useCallback((spacing: StageLineSpacing) => {
    setLineSpacingState(spacing)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_stage_line_spacing', spacing)
    }
  }, [])

  const setStageFontSize = useCallback((size: number) => {
    const currentMax = getMaxStageFontSize(typeof window !== 'undefined' ? window.innerWidth : 1024)
    const clamped = Math.max(12, Math.min(currentMax, size))
    setFontSizePx(clamped)
    debouncedSaveFontSize(clamped)
  }, [debouncedSaveFontSize])

  // Double tap detection on numeric font size display to reset to Stage default (L / 24px)
  const lastNumericTapRef = useRef<number>(0)
  const handleNumericDoubleTap = useCallback(() => {
    const now = Date.now()
    if (now - lastNumericTapRef.current < 320) {
      setStageFontSize(STAGE_SIZE_PRESETS.L)
      lastNumericTapRef.current = 0
    } else {
      lastNumericTapRef.current = now
    }
  }, [setStageFontSize])

  // Continuous hold on A- / A+ stepper with debounced storage save and bounded scaling
  const holdStep = useCallback((delta: number) => {
    const currentMax = getMaxStageFontSize(typeof window !== 'undefined' ? window.innerWidth : 1024)
    setFontSizePx((prev) => {
      const next = Math.max(12, Math.min(currentMax, prev + delta))
      debouncedSaveFontSize(next)
      return next
    })
  }, [debouncedSaveFontSize])

  const createHoldHandlers = useCallback((delta: number) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let interval: ReturnType<typeof setInterval> | null = null

    const clear = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    }

    const onPointerDown = (e: React.PointerEvent) => {
      if (e.button !== 0) return
      holdStep(delta)
      timer = setTimeout(() => {
        interval = setInterval(() => {
          holdStep(delta)
        }, 110)
      }, 320)
    }

    return {
      onPointerDown,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    }
  }, [holdStep])

  // 1-Tap Stage Distance (1–2m) Master Preset
  const isStageDistanceActive =
    fontSizePx >= 24 &&
    chordScale === 1.2 &&
    fontWeight === 'bold' &&
    lineSpacing === 'relaxed'

  const handleToggleStageDistance = useCallback(() => {
    if (isStageDistanceActive) {
      setStageFontSize(STAGE_SIZE_PRESETS.M)
      setChordScale(1.0)
      setFontWeight('regular')
      setLineSpacing('normal')
    } else {
      setStageFontSize(STAGE_SIZE_PRESETS.L)
      setChordScale(1.2)
      setFontWeight('bold')
      setLineSpacing('relaxed')
    }
  }, [isStageDistanceActive, setStageFontSize, setChordScale, setFontWeight, setLineSpacing])
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
  const inPerformanceMode = isPerformanceMode

  // Focus mode unified auto-hiding overlays (top header + bottom controls)
  const [showStageOverlays, setShowStageOverlays] = useState(true)
  const overlaysHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollTopRef = useRef<number>(0)

  const triggerOverlaysShow = useCallback(() => {
    setShowStageOverlays(true)
    if (overlaysHideTimeoutRef.current) {
      clearTimeout(overlaysHideTimeoutRef.current)
    }
    overlaysHideTimeoutRef.current = setTimeout(() => {
      setShowStageOverlays(false)
    }, 3500)
  }, [])

  useEffect(() => {
    if (isPerformanceMode) {
      triggerOverlaysShow()
    } else {
      setShowStageOverlays(true)
      if (overlaysHideTimeoutRef.current) {
        clearTimeout(overlaysHideTimeoutRef.current)
        overlaysHideTimeoutRef.current = null
      }
    }
  }, [isPerformanceMode, song.id, song.title, triggerOverlaysShow])

  useEffect(() => {
    return () => {
      if (overlaysHideTimeoutRef.current) {
        clearTimeout(overlaysHideTimeoutRef.current)
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
        // Immediately fades/hides overlays when the user scrolls down
        setShowStageOverlays(false)
        if (overlaysHideTimeoutRef.current) {
          clearTimeout(overlaysHideTimeoutRef.current)
          overlaysHideTimeoutRef.current = null
        }
      } else if (isAtTop) {
        // Re-appears smoothly when scrolling back to the top
        triggerOverlaysShow()
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
    if (inPerformanceMode) {
      triggerOverlaysShow()
    }
    if (!isAutoScrolling) return
    const msSinceStart = performance.now() - autoScrollStartedAtRef.current
    if (msSinceStart > 400) {
      setIsAutoScrolling(false)
    }
  }

  const handleContainerClick = () => {
    if (inPerformanceMode) {
      triggerOverlaysShow()
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

  const isPerformanceModeRef = useRef(inPerformanceMode)
  isPerformanceModeRef.current = inPerformanceMode
  const triggerOverlaysShowRef = useRef(triggerOverlaysShow)
  triggerOverlaysShowRef.current = triggerOverlaysShow

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
      if (isPerformanceModeRef.current) {
        triggerOverlaysShowRef.current()
      }
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
      chordScale,
      fontWeight,
      lineSpacing,
    })
  }, [song, effectiveKey, transposeOffset, fontSizePx, fontStyle, isTwoColumn, chordScale, fontWeight, lineSpacing])

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
          chordScale,
          fontWeight,
          lineSpacing,
        })
      }
    )
  }, [song, effectiveKey, transposeOffset, fontSizePx, fontStyle, isTwoColumn, chordScale, fontWeight, lineSpacing])

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

  return (
    <div className="flex-1 flex flex-col bg-[#002B36] select-none relative overflow-hidden"
      style={{ height: inPerformanceMode ? '100vh' : 'calc(100vh - 4rem)' }}
    >
      {/* =================================================================== */}
      {/* PERFORMANCE MODE — Focus Mode Auto-Hiding Song Title Banner        */}
      {/* =================================================================== */}
      {inPerformanceMode && (
        <div
          onClick={triggerOverlaysShow}
          className={`absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-3 sm:px-6 py-2
                      bg-[#073642]/95 backdrop-blur-md border-b border-[#1A4A55] shadow-xl
                      transition-all duration-300 ease-in-out transform ${
                        showStageOverlays
                          ? 'opacity-100 translate-y-0 pointer-events-auto'
                          : 'opacity-0 -translate-y-full pointer-events-none'
                      }`}
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        >
          <div className="min-w-0 flex-1 pr-2 sm:pr-4">
            <h1 className="text-sm sm:text-base md:text-lg font-extrabold text-[#EEE8D5] tracking-tight leading-tight truncate">
              {song.title || 'Untitled Song'}
            </h1>
            {song.artist && (
              <p className="text-[10px] sm:text-xs text-[#2AA198] font-semibold truncate leading-none mt-0.5">
                {song.artist}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Transpose [- Key +] Control */}
            <div
              className="flex items-center bg-[#002B36] rounded-lg border border-[#1A4A55] px-1 py-0.5 shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onTransposeChange(transposeOffset - 1)
                  triggerOverlaysShow()
                }}
                className="w-7 h-7 flex items-center justify-center text-[#EEE8D5] hover:text-[#2AA198] hover:bg-[#073642] active:scale-90 rounded transition-all cursor-pointer"
                title="Transpose Down (-1)"
                aria-label="Transpose Down (-1 semitone)"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsKeyPickerOpen(true)
                  triggerOverlaysShow()
                }}
                className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 text-xs font-mono font-extrabold rounded hover:bg-[#073642] transition-colors cursor-pointer ${
                  transposeOffset !== 0 ? 'text-[#B58900]' : 'text-[#EEE8D5]'
                }`}
                title="Choose Target Key"
                aria-label={`Current Key: ${effectiveKey || 'Orig'}, Tap to choose key`}
              >
                <span>{effectiveKey || 'Orig'}</span>
                {transposeOffset !== 0 && (
                  <span className="text-[10px] font-bold text-[#B58900]/90">
                    {offsetStr}
                  </span>
                )}
                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onTransposeChange(transposeOffset + 1)
                  triggerOverlaysShow()
                }}
                className="w-7 h-7 flex items-center justify-center text-[#EEE8D5] hover:text-[#2AA198] hover:bg-[#073642] active:scale-90 rounded transition-all cursor-pointer"
                title="Transpose Up (+1)"
                aria-label="Transpose Up (+1 semitone)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Exit Focus Mode Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isFullscreen && fullscreenCtrl.isSupported) fullscreenCtrl.toggle()
                else setIsDistractionFree(false)
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#002B36] hover:bg-[#1A4A55] text-[#EEE8D5] text-xs font-semibold
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

      {/* Top area tap zone to reveal overlays when hidden */}
      {inPerformanceMode && !showStageOverlays && (
        <div
          onClick={triggerOverlaysShow}
          className="absolute top-0 left-0 right-0 h-14 z-30 cursor-pointer pointer-events-auto"
          style={{ top: 'env(safe-area-inset-top, 0px)' }}
          aria-label="Reveal stage controls"
          title="Tap to show stage controls"
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
              {...createHoldHandlers(-1)}
              className={`px-2 py-1 text-xs font-extrabold rounded select-none transition-all ${
                fontSizePx <= 12
                  ? 'text-[#586E75] opacity-40 cursor-not-allowed'
                  : 'text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer active:scale-95'
              }`}
              title={
                fontSizePx <= 12
                  ? 'Minimum font size reached (12px)'
                  : 'Decrease Font Size (Hold for smooth resizing)'
              }
            >
              A-
            </button>
            <span
              onDoubleClick={() => setStageFontSize(STAGE_SIZE_PRESETS.L)}
              onTouchStart={handleNumericDoubleTap}
              className="text-[11px] font-mono text-[#93A1A1] px-1 font-semibold cursor-pointer select-none"
              title="Double-tap to reset to Stage default (L / 24px)"
            >
              {fontSizePx}
            </span>
            <button
              type="button"
              {...createHoldHandlers(1)}
              className={`px-2 py-1 text-xs font-extrabold rounded select-none transition-all ${
                fontSizePx >= maxFontSize
                  ? 'text-[#586E75] opacity-40 cursor-not-allowed'
                  : 'text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer active:scale-95'
              }`}
              title={
                fontSizePx >= maxFontSize
                  ? `Maximum font size reached for this screen (${maxFontSize}px)`
                  : 'Increase Font Size (Hold for smooth resizing)'
              }
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
        onClick={handleContainerClick}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6 md:px-8 py-4 select-text"
        style={{
          contain: 'layout style',
          overflowAnchor: 'none',
        }}
      >
        <div
          ref={slideContentRef}
          className={`mx-auto transition-[max-width] duration-300 ${isTwoColumn ? 'max-w-[95vw]' : 'max-w-4xl'}`}
          style={{
            willChange: 'transform',
            contain: 'layout style',
            overflowAnchor: 'none',
          }}
        >

          {/* Song Lines Rendering: 1 Column or 2 Columns */}
          {song.isMissing ? (
            <div role="alert" className="rounded-xl border border-amber-500 p-6 text-center">
              <h2 className="text-xl font-bold">Missing song: {song.title}</h2>
              <p className="mt-2">This setlist entry is unavailable. Restore the song from Trash or a backup, or remove this entry from the setlist.</p>
            </div>
          ) : isTwoColumn && col2Lines.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10 items-start" style={{ contain: 'layout style', overflowAnchor: 'none' }}>
              <div className="min-w-0" style={{ contain: 'layout style', overflowAnchor: 'none' }}>
                <SongLineRenderer
                  lines={col1Lines}
                  fontSizePx={fontSizePx}
                  fontFamily={fontStyle}
                  onChordClick={handleChordClick}
                  chordScale={chordScale}
                  fontWeight={fontWeight}
                  lineSpacing={lineSpacing}
                />
              </div>

              <div className="min-w-0 md:border-l md:border-[#1A4A55]/60 md:pl-6 lg:pl-10" style={{ contain: 'layout style', overflowAnchor: 'none' }}>
                <SongLineRenderer
                  lines={col2Lines}
                  fontSizePx={fontSizePx}
                  fontFamily={fontStyle}
                  onChordClick={handleChordClick}
                  chordScale={chordScale}
                  fontWeight={fontWeight}
                  lineSpacing={lineSpacing}
                />
              </div>
            </div>
          ) : (
            <SongLineRenderer
              lines={parsedSong.lines}
              fontSizePx={fontSizePx}
              fontFamily={fontStyle}
              onChordClick={handleChordClick}
              chordScale={chordScale}
              fontWeight={fontWeight}
              lineSpacing={lineSpacing}
            />
          )}

          {/* Bottom Padding for scroll clearance: ensures floating controls never occlude the final lines */}
          <div
            className="flex items-center justify-center text-xs font-mono text-[#1A4A55] select-none"
            style={{
              height: 'max(240px, calc(180px + env(safe-area-inset-bottom, 24px)))',
              paddingBottom: 'env(safe-area-inset-bottom, 24px)',
            }}
          >
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
          className={`absolute bottom-0 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0
                     bg-[#073642]/90 backdrop-blur-md rounded-t-2xl border-x border-t shadow-xl text-xs font-mono select-none
                     transition-all duration-300 ease-in-out transform ${
                       inPerformanceMode
                         ? showStageOverlays
                           ? 'opacity-100 translate-y-0 pointer-events-auto'
                           : 'opacity-0 translate-y-16 pointer-events-none'
                         : 'opacity-100 translate-y-0 pointer-events-auto'
                     }`}
          style={{
            borderColor: isInSetlistMode ? 'rgba(181,137,0,0.35)' : 'rgba(42,161,152,0.35)',
            paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
          }}
        >
          <button
            type="button"
            disabled={isInSetlistMode ? activeSetlistSongIndex <= 0 : activeSongIndex <= 0}
            onClick={(e) => {
              e.stopPropagation()
              handlePrevSong()
              triggerOverlaysShow()
            }}
            className={`px-3 py-2 transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${
              isInSetlistMode ? 'text-[#B58900] hover:text-white' : 'text-[#2AA198] hover:text-white'
            }`}
            title="Previous Song"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenSetlistDrawer()
              triggerOverlaysShow()
            }}
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
            onClick={(e) => {
              e.stopPropagation()
              handleNextSong()
              triggerOverlaysShow()
            }}
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
        className={`absolute bottom-0 right-0 z-30 flex flex-col items-end gap-3 pointer-events-none
                   transition-all duration-300 ease-in-out transform ${
                     inPerformanceMode
                       ? showStageOverlays
                         ? 'opacity-100 translate-y-0'
                         : 'opacity-0 translate-y-20'
                       : 'opacity-100 translate-y-0'
                   }`}
        style={{
          paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          paddingRight: 'max(16px, env(safe-area-inset-right, 16px))',
        }}
      >
        {/* ··· Stage Options FAB */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setIsStageMenuOpen(true)
            triggerOverlaysShow()
          }}
          className={`w-11 h-11 rounded-full flex items-center justify-center
                     bg-[#073642]/90 backdrop-blur-md border border-[#1A4A55] shadow-xl
                     text-[#93A1A1] hover:text-[#EEE8D5] hover:border-[#2AA198]
                     transition-all active:scale-90 cursor-pointer ${
                       inPerformanceMode && !showStageOverlays ? 'pointer-events-none' : 'pointer-events-auto'
                     }`}
          title="Stage options (transpose, font, speed, exit)"
          aria-label="Open stage options"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>

        {/* Autoscroll FAB — circular, Android yellow/red */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleToggleAutoScroll()
            triggerOverlaysShow()
          }}
          className={`w-14 h-14 rounded-full flex items-center justify-center
                     shadow-2xl transition-all active:scale-90 cursor-pointer select-none
                     border-2 ${
                       inPerformanceMode && !showStageOverlays ? 'pointer-events-none' : 'pointer-events-auto'
                     } ${
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
            className="relative z-10 rounded-t-3xl bg-[#073642] border-t border-x border-[#1A4A55] shadow-2xl px-5 pt-3 max-h-[85vh] overflow-y-auto"
            style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-[#1A4A55] rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-extrabold text-[#EEE8D5] tracking-wide uppercase flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[#2AA198]" /> Stage Options
              </h2>
              {isStageDistanceActive && (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  1–2m Stage Distance
                </span>
              )}
            </div>

            {/* --- One-Tap Stage Distance (1–2m) Master Preset --- */}
            <div className="mb-4">
              <button
                type="button"
                onClick={handleToggleStageDistance}
                className={`w-full py-2.5 px-3 rounded-2xl border flex items-center justify-between text-xs font-semibold transition-all cursor-pointer ${
                  isStageDistanceActive
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md ring-1 ring-amber-500/40'
                    : 'bg-[#002B36] border-[#1A4A55] text-[#EEE8D5] hover:border-[#2AA198]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    isStageDistanceActive ? 'bg-amber-500 text-black' : 'bg-[#073642] text-amber-400'
                  }`}>
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-xs">Stage Distance (1–2m)</span>
                    <span className="text-[10px] text-[#93A1A1] font-mono">24px (L) • 120% Bold Chords • Relaxed</span>
                  </div>
                </div>
                <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-lg font-bold ${
                  isStageDistanceActive ? 'bg-amber-500 text-black' : 'bg-[#073642] text-[#93A1A1] border border-[#1A4A55]'
                }`}>
                  {isStageDistanceActive ? 'ACTIVE' : 'APPLY'}
                </span>
              </button>
            </div>

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

            {/* --- Font size row & Presets --- */}
            <div className="mb-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Font Size</span>
                <div className="flex items-center bg-[#002B36] rounded-xl border border-[#1A4A55] flex-1">
                  <button
                    type="button"
                    {...createHoldHandlers(-1)}
                    className={`px-4 py-2 text-sm font-extrabold select-none transition-all ${
                      fontSizePx <= 12
                        ? 'text-[#586E75] opacity-40 cursor-not-allowed'
                        : 'text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer active:scale-95'
                    }`}
                    title={
                      fontSizePx <= 12
                        ? 'Minimum font size reached (12px)'
                        : 'Decrease font size (Hold to adjust)'
                    }
                  >
                    A-
                  </button>
                  <span
                    onDoubleClick={() => setStageFontSize(STAGE_SIZE_PRESETS.L)}
                    onTouchStart={handleNumericDoubleTap}
                    className="flex-1 text-center text-sm font-mono font-bold text-[#B58900] cursor-pointer select-none py-1"
                    title="Double-tap to reset to Stage default (L / 24px)"
                  >
                    {fontSizePx}px
                  </span>
                  <button
                    type="button"
                    {...createHoldHandlers(1)}
                    className={`px-4 py-2 text-sm font-extrabold select-none transition-all ${
                      fontSizePx >= maxFontSize
                        ? 'text-[#586E75] opacity-40 cursor-not-allowed'
                        : 'text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer active:scale-95'
                    }`}
                    title={
                      fontSizePx >= maxFontSize
                        ? `Maximum font size reached for this screen (${maxFontSize}px)`
                        : 'Increase font size (Hold to adjust)'
                    }
                  >
                    A+
                  </button>
                </div>
              </div>

              {/* Quick Stage Size Presets [ S | M | L | XL ] */}
              <div className="flex items-center gap-1.5 pl-[88px]">
                {(['S', 'M', 'L', 'XL'] as const).map((key) => {
                  const presetTarget = STAGE_SIZE_PRESETS[key]
                  const effectiveTarget = Math.min(presetTarget, maxFontSize)
                  const isSelected = fontSizePx === effectiveTarget
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStageFontSize(presetTarget)}
                      className={`flex-1 py-1 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer text-center ${
                        isSelected
                          ? 'bg-[#B58900] text-black border-[#B58900] shadow-sm'
                          : 'bg-[#002B36] text-[#EEE8D5] border-[#1A4A55] hover:border-[#2AA198]'
                      }`}
                      title={
                        effectiveTarget < presetTarget
                          ? `${key} (${effectiveTarget}px - clamped for screen)`
                          : `${key} (${presetTarget}px)`
                      }
                    >
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* --- Chord Scaling Ratio --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Chord Size</span>
              <div className="grid grid-cols-4 gap-1.5 flex-1">
                {CHORD_SCALE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setChordScale(value)}
                    className={`py-1.5 rounded-xl border text-xs font-mono font-bold text-center transition-all cursor-pointer ${
                      chordScale === value
                        ? 'bg-[#2AA198] text-[#002B36] border-[#2AA198] shadow-sm'
                        : 'bg-[#002B36] text-[#EEE8D5] border-[#1A4A55] hover:border-[#2AA198]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Font Weight --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Weight</span>
              <div className="grid grid-cols-3 gap-1.5 flex-1">
                {FONT_WEIGHT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFontWeight(value)}
                    className={`py-1.5 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                      fontWeight === value
                        ? 'bg-[#2AA198] text-[#002B36] border-[#2AA198] font-bold shadow-sm'
                        : 'bg-[#002B36] text-[#EEE8D5] border-[#1A4A55] hover:border-[#2AA198]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Line Spacing --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-[#93A1A1] w-20 shrink-0">Spacing</span>
              <div className="grid grid-cols-3 gap-1.5 flex-1">
                {LINE_SPACING_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLineSpacing(value)}
                    className={`py-1.5 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                      lineSpacing === value
                        ? 'bg-[#2AA198] text-[#002B36] border-[#2AA198] font-bold shadow-sm'
                        : 'bg-[#002B36] text-[#EEE8D5] border-[#1A4A55] hover:border-[#2AA198]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
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
