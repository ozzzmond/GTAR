import { SETTINGS_KEYS, SETTINGS_CHANGED, readBackupSettings } from '../utils/backupSettings'
import React, { useState, useLayoutEffect, useEffect, useRef, useMemo, useCallback } from 'react'
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
  ArrowLeft,
  Cast,
  Tv,
  SlidersHorizontal,
} from 'lucide-react'
import { StageControlDock } from './StageControlDock'
import { STAGE_CONTROLS_AUTO_HIDE_KEY } from '../utils/syncJournal'
import { transposeKey, formatTransposeOffset } from '../utils/chordTransposer'
import {
  type StageNotationMode,
  NOTATION_STORAGE_KEY,
  isValidMusicalKey,
} from '../utils/nashvilleNotation'
import { parseGtarSong, splitSongLinesForColumns, detectSongKey } from '../utils/songParser'
import { metronome } from '../utils/metronome'
import { bandSync, type BandSyncState } from '../utils/bandSync'
import { stageCast } from '../utils/stageCast'
import { getChordVoicing, type ChordVoicing } from '../utils/chordDictionary'
import {
  SongLineRenderer,
  type StageChordScale,
  type StageFontWeight,
  type StageLineSpacing,
} from './SongLineRenderer'
import { KeyPickerModal } from './KeyPickerModal'
import { FretboardDiagramModal } from './FretboardDiagramModal'
import { BandSyncModal } from './BandSyncModal'
import { TvPresentationModal } from './TvPresentationModal'
import type { ActiveSongState, WebSetlist } from '../types/gtar'

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
  setlists?: WebSetlist[]
  onSelectSetlist?: (setlistId: string | number) => void
  onOpenSetlistDrawer: () => void
  isSetlistDrawerOpen?: boolean
  isStageSettingsModalOpen?: boolean
  isAnyModalOpen?: boolean
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
  isSetlistDrawerOpen = false,
  isStageSettingsModalOpen = false,
  isAnyModalOpen = false,
  transposeOffset,
  onTransposeChange,
  fontStyle: externalFontStyle,
  onSelectFontStyle: externalOnSelectFontStyle,
  isTwoColumn: externalIsTwoColumn,
  onToggleTwoColumn: externalOnToggleTwoColumn,
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

  // Device-level persistent Stage Notation preference (Default: 'chords')
  const [notation, setNotationState] = useState<StageNotationMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(NOTATION_STORAGE_KEY)
      if (saved === 'numbers' || saved === 'chords') {
        return saved
      }
    }
    return 'chords'
  })

  const setNotation = useCallback((val: StageNotationMode) => {
    setNotationState(val)
    if (typeof window !== 'undefined') {
      localStorage.setItem(NOTATION_STORAGE_KEY, val)
    }
  }, [])


  const setLineSpacing = useCallback((spacing: StageLineSpacing) => {
    setLineSpacingState(spacing)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_stage_line_spacing', spacing)
    }
  }, [])

  // Device-level persistent Stage Controls Auto-Hide preference (Default: ON / true)
  const [controlsAutoHide, setControlsAutoHideState] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STAGE_CONTROLS_AUTO_HIDE_KEY)
      if (saved !== null) {
        return saved !== 'false'
      }
    }
    return true
  })

  const setControlsAutoHide = useCallback((autoHide: boolean) => {
    setControlsAutoHideState(autoHide)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STAGE_CONTROLS_AUTO_HIDE_KEY, String(autoHide))
    }
  }, [])

  const setStageFontSize = useCallback((size: number) => {
    const clamped = Math.max(12, Math.min(38, size))
    setFontSizePx(clamped)
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(clamped))
    }
  }, [])

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

  // Continuous hold on A- / A+ stepper
  const holdStep = useCallback((delta: number) => {
    setFontSizePx((prev) => {
      const next = Math.max(12, Math.min(38, prev + delta))
      if (typeof window !== 'undefined') {
        localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(next))
      }
      return next
    })
  }, [])

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
        }, 70)
      }, 320)
    }

    return {
      onPointerDown,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    }
  }, [holdStep])

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- A committed song or mode transition starts the existing overlay visibility timer.
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
  const [selectedChordName, setSelectedChordName] = useState<string | null>(null)
  const [isSpeedPromptOpen, setIsSpeedPromptOpen] = useState(false)
  const [speedInputText, setSpeedInputText] = useState('35')
  const [isBandSyncModalOpen, setIsBandSyncModalOpen] = useState(false)
  const [isTvPresentationModalOpen, setIsTvPresentationModalOpen] = useState(false)
  // Stage floating options menu (replaces top HUD)
  const [isStageMenuOpen, setIsStageMenuOpen] = useState(false)

  // Track whether any modal, drawer, or dialog overlay is active
  const isAnyOverlayActive = Boolean(
    isKeyPickerOpen ||
    selectedVoicing ||
    selectedChordName ||
    isBandSyncModalOpen ||
    isTvPresentationModalOpen ||
    isStageMenuOpen ||
    isSpeedPromptOpen ||
    isSetlistDrawerOpen ||
    isStageSettingsModalOpen ||
    isAnyModalOpen
  )

  // Band Sync State
  const [syncState, setSyncState] = useState<BandSyncState>(() => bandSync.getState())

  // Stage Cast Active Presentation State
  const [isCastActive, setIsCastActive] = useState(() => stageCast.isPresentationActive())
  const [canPrevSection, setCanPrevSection] = useState(false)
  const [canNextSection, setCanNextSection] = useState(true)

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

    setCanPrevSection(currentTop > 10)
    setCanNextSection(currentTop < maxScroll - 10)

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
  const handleToggleAutoScroll = useCallback(() => {
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
  }, [isAutoScrolling, syncState.role, scrollSpeed])

  // Adjust scroll speed and broadcast if HOST
  const handleAdjustSpeed = useCallback((newSpeed: number) => {
    const clamped = Math.max(10, Math.min(150, newSpeed))
    setScrollSpeed(clamped)
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEYS.scrollSpeed, String(clamped))
    }
    if (syncState.role === 'HOST') {
      bandSync.broadcastAutoScroll(isAutoScrolling, clamped)
    }
  }, [isAutoScrolling, syncState.role])

  // Structural sections in document order matching Android SongParser.kt
  const sectionHeaders = useMemo(() => {
    return parsedSong.lines.filter((l) => l.type === 'SECTION_HEADER')
  }, [parsedSong.lines])

  const handlePrevSection = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const sectionEls = Array.from(
      container.querySelectorAll<HTMLElement>('[data-stage-section="true"]')
    )
    if (sectionEls.length === 0) return

    const containerRect = container.getBoundingClientRect()
    const currentScrollTop = container.scrollTop
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    const headerOffset = inPerformanceMode ? (showStageOverlays ? 56 : 24) : 16

    const targets = sectionEls.map((el) => {
      const elRect = el.getBoundingClientRect()
      const distanceFromTop = elRect.top - containerRect.top
      const targetScrollTop = Math.round(currentScrollTop + distanceFromTop - headerOffset)
      return { el, targetScrollTop }
    })

    const pastSections = targets.filter((s) => s.targetScrollTop <= currentScrollTop + 12)

    let targetTop = 0
    if (pastSections.length > 0) {
      const currentSection = pastSections[pastSections.length - 1]
      const clampedCurrent = Math.max(0, Math.min(maxScroll, currentSection.targetScrollTop))

      // If viewport has scrolled past current section start, jump back to section start
      // (ensuring the clamped jump moves upward and avoids collapsing at maxScroll)
      if (currentScrollTop > currentSection.targetScrollTop + 24 && clampedCurrent < currentScrollTop - 4) {
        targetTop = clampedCurrent
      } else {
        // Look backwards through pastSections for closest preceding target that scrolls upward
        let found = false
        for (let i = pastSections.length - 2; i >= 0; i--) {
          const clampedPreceding = Math.max(0, Math.min(maxScroll, pastSections[i].targetScrollTop))
          if (clampedPreceding < currentScrollTop - 4) {
            targetTop = clampedPreceding
            found = true
            break
          }
        }
        if (!found) {
          targetTop = 0
        }
      }
    } else {
      targetTop = 0
    }

    accumulatedScrollRef.current = targetTop
    setIsAutoScrolling(false)
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
    triggerOverlaysShow()
  }, [inPerformanceMode, showStageOverlays, triggerOverlaysShow])

  const handleNextSection = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const sectionEls = Array.from(
      container.querySelectorAll<HTMLElement>('[data-stage-section="true"]')
    )
    if (sectionEls.length === 0) return

    const containerRect = container.getBoundingClientRect()
    const currentScrollTop = container.scrollTop
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    const headerOffset = inPerformanceMode ? (showStageOverlays ? 56 : 24) : 16

    const targets = sectionEls.map((el) => {
      const elRect = el.getBoundingClientRect()
      const distanceFromTop = elRect.top - containerRect.top
      const targetScrollTop = Math.round(currentScrollTop + distanceFromTop - headerOffset)
      return { el, targetScrollTop }
    })

    const nextSection = targets.find((s) => s.targetScrollTop > currentScrollTop + 12)
    if (!nextSection) return

    const clampedNext = Math.max(0, Math.min(maxScroll, nextSection.targetScrollTop))
    if (clampedNext <= currentScrollTop + 4 && currentScrollTop >= maxScroll - 4) return

    const targetTop = clampedNext
    accumulatedScrollRef.current = targetTop
    setIsAutoScrolling(false)
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
    triggerOverlaysShow()
  }, [inPerformanceMode, showStageOverlays, triggerOverlaysShow])

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
  const executeNextSongRef = useRef(executeNextSong)

  const canPrev = isInSetlistMode
    ? activeSetlistSongIndex > 0
    : activeSongIndex > 0
  const canNext = isInSetlistMode
    ? activeSetlistSongIndex < activeSetlistSongs.length - 1
    : activeSongIndex < songs.length - 1

  const canPrevRef = useRef(canPrev)
  const canNextRef = useRef(canNext)

  const fontSizePxRef = useRef(fontSizePx)

  const isPerformanceModeRef = useRef(inPerformanceMode)
  const triggerOverlaysShowRef = useRef(triggerOverlaysShow)
  // Publish committed values before input events; suspended renders cannot leak.
  useLayoutEffect(() => {
    executePrevSongRef.current = executePrevSong
    executeNextSongRef.current = executeNextSong
    canPrevRef.current = canPrev
    canNextRef.current = canNext
    fontSizePxRef.current = fontSizePx
    isPerformanceModeRef.current = inPerformanceMode
    triggerOverlaysShowRef.current = triggerOverlaysShow
  }, [executePrevSong, executeNextSong, canPrev, canNext, fontSizePx, inPerformanceMode, triggerOverlaysShow])

  const slideContentRef = useRef<HTMLDivElement>(null)
  const isAnimatingRef = useRef(false)
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNavigationTimeRef = useRef<number>(0)

  // ACTION_1: Reset stage scroll + pause autoscroll on active song transition
  const currentSongKey = song.id !== undefined && song.id !== ''
    ? String(song.id)
    : `${song.title}__${isInSetlistMode ? activeSetlistSongIndex : activeSongIndex}`
  const previousSongKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (previousSongKeyRef.current !== null && previousSongKeyRef.current !== currentSongKey) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0
      }
      lastScrollTopRef.current = 0
      setIsAutoScrolling(false)
      accumulatedScrollRef.current = 0
      if (scrollAnimRef.current) {
        cancelAnimationFrame(scrollAnimRef.current)
        scrollAnimRef.current = null
      }
      if (slideContentRef.current) {
        slideContentRef.current.style.transform = ''
        slideContentRef.current.style.transition = ''
        slideContentRef.current.style.opacity = ''
      }
      isAnimatingRef.current = false
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current)
        transitionTimeoutRef.current = null
      }
      stageCast.broadcastScroll(0, 0)
    }
    previousSongKeyRef.current = currentSongKey
  }, [currentSongKey])

  const triggerSongSlide = useCallback((direction: 'next' | 'prev') => {
    const slideEl = slideContentRef.current
    const container = scrollContainerRef.current

    // ACTION_2: Do not bypass animation lock during active transition
    if (isAnimatingRef.current) {
      return
    }

    // Bounded debounce: ignore rapid repeat navigation until safe (250ms)
    const now = Date.now()
    if (now - lastNavigationTimeRef.current < 250) {
      return
    }
    lastNavigationTimeRef.current = now

    if (direction === 'next' && !canNextRef.current) return
    if (direction === 'prev' && !canPrevRef.current) return

    // Pause autoscroll immediately on navigation
    setIsAutoScrolling(false)
    accumulatedScrollRef.current = 0
    if (scrollAnimRef.current) {
      cancelAnimationFrame(scrollAnimRef.current)
      scrollAnimRef.current = null
    }

    if (!slideEl) {
      isAnimatingRef.current = true
      if (direction === 'next') executeNextSongRef.current()
      else executePrevSongRef.current()
      if (container) container.scrollTop = 0
      setTimeout(() => {
        isAnimatingRef.current = false
      }, 250)
      return
    }

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
  // - PageUp / PageDown: Section navigation (Previous / Next section)
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

      // ACTION_3: Suppress stage global shortcuts while any overlay / modal / drawer is active
      if (isAnyOverlayActive) {
        return
      }

      // ACTION_2: Ignore rapid repeated keydown events caused by holding down navigation keys
      if (
        e.repeat &&
        (e.key === 'ArrowRight' ||
          e.key === 'n' ||
          e.key === 'N' ||
          e.key === 'ArrowLeft' ||
          e.key === 'p' ||
          e.key === 'P' ||
          e.key === 'PageDown' ||
          e.key === 'PageUp')
      ) {
        e.preventDefault()
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

      // PageUp / PageDown: Navigate structural sections; prevents browser default scroll
      if (e.key === 'PageDown') {
        e.preventDefault()
        handleNextSection()
        return
      }

      if (e.key === 'PageUp') {
        e.preventDefault()
        handlePrevSection()
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
    handleNextSection,
    handlePrevSection,
    handleToggleAutoScroll,
    handleAdjustSpeed,
    isAnyOverlayActive,
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

  // Single source of truth for base reference key:
  // Explicit song key, parsed directive, detected tonic chord progression, or manual key override
  const detectedKey = detectSongKey(song.rawContent || '')
  const effectiveBaseKey =
    (isValidMusicalKey(song.key) ? song.key : null) ||
    (isValidMusicalKey(parsedSong.key) ? parsedSong.key : null) ||
    (isValidMusicalKey(detectedKey) ? detectedKey : null) ||
    ''
  const effectivePerformanceKey = effectiveBaseKey ? transposeKey(effectiveBaseKey, transposeOffset) : ''
  const effectiveKey = effectivePerformanceKey
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
      notation,
    })
  }, [song, effectiveKey, transposeOffset, fontSizePx, fontStyle, isTwoColumn, chordScale, fontWeight, lineSpacing, notation])

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
          notation,
        })
      }
    )
  }, [song, effectiveKey, transposeOffset, fontSizePx, fontStyle, isTwoColumn, chordScale, fontWeight, lineSpacing, notation])

  const handleTogglePresentation = useCallback(async () => {
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
        chordScale,
        fontWeight,
        lineSpacing,
      })

      const caps = stageCast.getPresentationCapabilities()
      if (caps.recommendedMode === 'tv_pairing' || !caps.canDirectPresent) {
        setIsTvPresentationModalOpen(true)
      } else {
        const res = await stageCast.requestPresentation()
        if (res.mode === 'tv_pairing') {
          setIsTvPresentationModalOpen(true)
        }
      }
    }
  }, [
    isCastActive,
    song,
    effectiveKey,
    transposeOffset,
    fontSizePx,
    fontStyle,
    isTwoColumn,
    chordScale,
    fontWeight,
    lineSpacing,
  ])

  const handleChordClick = (chordName: string) => {
    setSelectedChordName(chordName)
    const voicing = getChordVoicing(chordName)
    setSelectedVoicing(voicing)
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
    <div className="flex-1 flex flex-col bg-app-base select-none relative overflow-hidden"
      style={{ height: inPerformanceMode ? '100vh' : 'calc(100vh - 4rem)' }}
    >
      {/* =================================================================== */}
      {/* PERFORMANCE MODE — Focus Mode Auto-Hiding Song Title Banner        */}
      {/* =================================================================== */}
      {inPerformanceMode && (
        <div
          onClick={triggerOverlaysShow}
          className={`absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-3 sm:px-6 py-2
                      bg-app-surface/95 backdrop-blur-md border-b border-app-border shadow-xl
                      transition-all duration-300 ease-in-out transform ${
                        showStageOverlays
                          ? 'opacity-100 translate-y-0 pointer-events-auto'
                          : 'opacity-0 -translate-y-full pointer-events-none'
                      }`}
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        >
          <div className="min-w-0 flex-1 pr-2 sm:pr-4">
            <h1 className="text-sm sm:text-base md:text-lg font-extrabold text-app-text tracking-tight leading-tight truncate">
              {song.title || 'Untitled Song'}
            </h1>
            {song.artist && (
              <p className="text-[10px] sm:text-xs text-app-action font-semibold truncate leading-none mt-0.5">
                {song.artist}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {notation === 'numbers' ? (
              /* Quick Key Control [- Key +] for Numbers Mode */
              <div
                className="flex items-center bg-app-base rounded-lg border border-app-border px-1 py-0.5 shadow-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  disabled={!effectivePerformanceKey}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTransposeChange(transposeOffset - 1)
                    triggerOverlaysShow()
                  }}
                  className="w-7 h-7 flex items-center justify-center text-app-text hover:text-app-action hover:bg-app-surface active:scale-90 rounded transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                  title="Step Key Down (-1 semitone)"
                  aria-label="Step Key Down (-1 semitone)"
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
                  className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 text-xs font-mono font-extrabold rounded hover:bg-app-surface transition-colors cursor-pointer ${
                    effectivePerformanceKey ? 'text-app-accent' : 'text-status-error'
                  }`}
                  title="Choose Performance Key"
                  aria-label={`Key: ${effectivePerformanceKey || 'Not Set'}, Tap to choose key`}
                >
                  <span>Key: {effectivePerformanceKey || 'Not Set'}</span>
                  <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                </button>

                <button
                  type="button"
                  disabled={!effectivePerformanceKey}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTransposeChange(transposeOffset + 1)
                    triggerOverlaysShow()
                  }}
                  className="w-7 h-7 flex items-center justify-center text-app-text hover:text-app-action hover:bg-app-surface active:scale-90 rounded transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                  title="Step Key Up (+1 semitone)"
                  aria-label="Step Key Up (+1 semitone)"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              /* Quick Transpose [- Key +] Control */
              <div
                className="flex items-center bg-app-base rounded-lg border border-app-border px-1 py-0.5 shadow-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTransposeChange(transposeOffset - 1)
                    triggerOverlaysShow()
                  }}
                  className="w-7 h-7 flex items-center justify-center text-app-text hover:text-app-action hover:bg-app-surface active:scale-90 rounded transition-all cursor-pointer"
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
                  className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 text-xs font-mono font-extrabold rounded hover:bg-app-surface transition-colors cursor-pointer ${
                    transposeOffset !== 0 ? 'text-app-accent' : 'text-app-text'
                  }`}
                  title="Choose Target Key"
                  aria-label={`Transpose: ${offsetStr}, Tap to choose key`}
                >
                  <span>Transpose: {offsetStr}</span>
                  <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTransposeChange(transposeOffset + 1)
                    triggerOverlaysShow()
                  }}
                  className="w-7 h-7 flex items-center justify-center text-app-text hover:text-app-action hover:bg-app-surface active:scale-90 rounded transition-all cursor-pointer"
                  title="Transpose Up (+1)"
                  aria-label="Transpose Up (+1 semitone)"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Exit Focus Mode Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isFullscreen && fullscreenCtrl.isSupported) fullscreenCtrl.toggle()
                else setIsDistractionFree(false)
              }}
              className="px-2.5 py-1.5 rounded-lg bg-app-base hover:bg-app-border text-app-text text-xs font-semibold
                         flex items-center gap-1 border border-app-border transition-colors cursor-pointer"
              title="Exit focus mode"
              aria-label="Exit focus mode"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">Exit</span>
            </button>
          </div>
        </div>
      )}

      {/* PERFORMANCE MODE — Minimal Title Retention when HUD/Overlays Hide */}
      {inPerformanceMode && !showStageOverlays && (
        <div
          data-testid="stage-fullscreen-title-container"
          onClick={triggerOverlaysShow}
          className="absolute top-0 left-0 right-0 z-30 flex items-center justify-center px-4 py-1.5 pointer-events-auto cursor-pointer select-none transition-opacity duration-300"
          style={{ paddingTop: 'max(6px, env(safe-area-inset-top, 6px))' }}
          title="Tap to reveal stage controls"
          aria-label={`${song.title || 'Untitled Song'} • Tap to reveal stage controls`}
        >
          <div className="max-w-[85vw] sm:max-w-lg md:max-w-xl px-4 py-1 rounded-full bg-app-surface/85 backdrop-blur-md border border-app-border/70 shadow-md flex items-center justify-center">
            <span
              data-testid="stage-fullscreen-title"
              className="text-xs sm:text-base md:text-lg font-bold text-app-text truncate tracking-wide text-center"
            >
              {song.title || 'Untitled Song'}
            </span>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 1. TOP APP BAR (Exact 1:1 Jetpack Compose SongViewerScreen.kt)       */}
      {/*    Hidden entirely in performance mode — replaced by floating HUD.  */}
      {/* =================================================================== */}
      <div
        className={`border-b border-app-border bg-app-surface px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 z-20 shadow-md transition-all duration-300 ${
          inPerformanceMode ? 'opacity-0 pointer-events-none h-0 py-0 overflow-hidden border-0' : 'opacity-100'
        }`}
      >
        {/* Left Side: Back Navigation Button + Song Title & Artist */}
        <div className="flex items-center gap-2 sm:gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-2 hover:bg-app-accent/50 rounded-full transition-colors cursor-pointer text-app-text hover:text-app-action flex items-center justify-center -ml-1 select-none active:scale-95"
              title="Back to Songbook Library"
              aria-label="Back to Songbook Library"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-extrabold text-app-text tracking-tight leading-tight truncate max-w-[240px] sm:max-w-xs md:max-w-md">
              {song.title || 'Untitled Song'}
            </h1>
            {song.artist && (
              <p className="text-[11px] sm:text-xs text-app-action font-semibold truncate leading-none mt-0.5">
                {song.artist}
              </p>
            )}
          </div>
        </div>

        {/* Right Side: Font Family, Font Size A-/A+, Column Reflow, Transpose Stepper, Band Sync, Stage Tools, Fullscreen */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
          {/* Font Family Selector (Mono / Sans / Serif matching Android SongFontStyle) */}
          <div className="flex items-center bg-app-base rounded-lg border border-app-border p-0.5 text-xs font-semibold">
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
                    ? 'bg-app-action text-app-on-action font-extrabold shadow-sm'
                    : 'text-app-text hover:text-app-action'
                }`}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>

          {/* A- / A+ Font Size Stepper (matching Compose onAdjustFontSize) */}
          <div className="flex items-center bg-app-base rounded-lg border border-app-border p-0.5">
            <button
              type="button"
              {...createHoldHandlers(-1)}
              className="px-2 py-1 text-xs font-extrabold text-app-text hover:text-app-action rounded cursor-pointer select-none active:scale-95 transition-transform"
              title="Decrease Font Size (Hold for smooth resizing)"
            >
              A-
            </button>
            <span
              onDoubleClick={() => setStageFontSize(STAGE_SIZE_PRESETS.L)}
              onTouchStart={handleNumericDoubleTap}
              className="text-[11px] font-mono text-app-muted px-1 font-semibold cursor-pointer select-none"
              title="Double-tap to reset to Stage default (L / 24px)"
            >
              {fontSizePx}
            </span>
            <button
              type="button"
              {...createHoldHandlers(1)}
              className="px-2 py-1 text-xs font-extrabold text-app-text hover:text-app-action rounded cursor-pointer select-none active:scale-95 transition-transform"
              title="Increase Font Size (Hold for smooth resizing)"
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
                ? 'bg-app-accent/20 text-app-accent border-app-accent font-bold shadow-sm'
                : 'bg-app-base text-app-text border-app-border hover:text-app-action'
            }`}
            title={isTwoColumn ? 'Switch to 1 Column' : 'Switch to 2 Columns'}
          >
            {isTwoColumn ? <Columns2 className="w-3.5 h-3.5 text-app-accent" /> : <Square className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isTwoColumn ? '2-Col' : '1-Col'}</span>
          </button>

          {notation === 'numbers' ? (
            /* Key Stepper for Numbers Mode: [ - ] Key: G [ + ] */
            <div className="flex items-center rounded-lg border bg-app-base border-app-border p-0.5">
              <button
                type="button"
                disabled={!effectivePerformanceKey}
                onClick={() => onTransposeChange(transposeOffset - 1)}
                className="p-1 text-app-text hover:text-app-action rounded cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                title="Step Key Down (-1 semitone)"
                aria-label="Step Key Down (-1 semitone)"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsKeyPickerOpen(true)}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-mono font-extrabold rounded cursor-pointer transition-colors ${
                  effectivePerformanceKey ? 'text-app-accent hover:bg-app-surface' : 'text-status-error hover:bg-app-surface'
                }`}
                title="Select Performance Key"
                aria-label={`Key: ${effectivePerformanceKey || 'Not Set'}`}
              >
                <span>Key: {effectivePerformanceKey || 'Not Set'}</span>
                <ChevronDown className="w-3 h-3 opacity-75" />
              </button>

              {transposeOffset !== 0 && effectivePerformanceKey && (
                <button
                  type="button"
                  onClick={() => onTransposeChange(0)}
                  className="p-1 text-app-muted hover:text-status-error cursor-pointer"
                  title="Reset Key to Original Key"
                  aria-label="Reset Key to Original Key"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}

              <button
                type="button"
                disabled={!effectivePerformanceKey}
                onClick={() => onTransposeChange(transposeOffset + 1)}
                className="p-1 text-app-text hover:text-app-action rounded cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                title="Step Key Up (+1 semitone)"
                aria-label="Step Key Up (+1 semitone)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            /* Standard Transpose Stepper: [ - ] Key: G (+1) [ + ] (Compose lines 523-589) */
            <div
              className={`flex items-center rounded-lg border transition-colors p-0.5 ${
                transposeOffset !== 0
                  ? 'bg-app-accent/15 border-app-accent'
                  : 'bg-app-base border-app-border'
              }`}
            >
              <button
                type="button"
                onClick={() => onTransposeChange(transposeOffset - 1)}
                className="p-1 text-app-text hover:text-app-action rounded cursor-pointer"
                title="Transpose Down (-1)"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsKeyPickerOpen(true)}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-mono font-extrabold rounded cursor-pointer transition-colors ${
                  transposeOffset !== 0 ? 'text-app-accent' : 'text-app-text hover:bg-app-surface'
                }`}
                title="Select Target Key"
              >
                <span>
                  Transpose: {offsetStr}
                </span>
                <ChevronDown className="w-3 h-3 opacity-75" />
              </button>

              {transposeOffset !== 0 && (
                <button
                  type="button"
                  onClick={() => onTransposeChange(0)}
                  className="p-1 text-app-muted hover:text-status-error cursor-pointer"
                  title="Reset Transposition to Original Key"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}

              <button
                type="button"
                onClick={() => onTransposeChange(transposeOffset + 1)}
                className="p-1 text-app-text hover:text-app-action rounded cursor-pointer"
                title="Transpose Up (+1)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Stage Top Bar Quick Autoscroll Action Button */}
          <button
            type="button"
            onClick={handleToggleAutoScroll}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer shadow-sm ${
              isAutoScrolling
                ? 'bg-[#EF4444]/20 border-[#EF4444] text-status-error hover:bg-[#EF4444]/30 animate-pulse'
                : 'bg-app-accent/15 border-app-accent/40 text-app-accent hover:bg-app-accent/25 hover:border-app-accent'
            }`}
            title={isAutoScrolling ? 'Pause autoscroll (Space)' : 'Start autoscroll (Space)'}
            aria-label={isAutoScrolling ? 'Pause autoscroll' : 'Start autoscroll'}
          >
            {isAutoScrolling ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span className="hidden sm:inline">{isAutoScrolling ? 'SCROLLING' : 'SCROLL'}</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-black/20 font-mono">
              {scrollSpeed}
            </span>
          </button>
          {/* Cast / Pop-out Screen (Mirror distraction-free stage teleprompter to external display) */}
          <button
            type="button"
            onClick={handleTogglePresentation}
            className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
              isCastActive
                ? 'bg-[#DC6E67]/20 border-[#DC6E67] text-status-error hover:bg-[#DC6E67]/30 shadow-sm animate-pulse'
                : 'bg-app-base border-app-border text-app-text hover:text-app-action hover:border-app-action'
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
                ? 'bg-app-action/20 border-app-action text-app-action hover:bg-app-action/30'
                : 'bg-app-base border-app-border text-app-text hover:text-app-action'
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
      >
        <div
          ref={slideContentRef}
          className={`mx-auto transition-[max-width] duration-300 ${inPerformanceMode || isTwoColumn ? 'w-full' : 'max-w-4xl'}`}
          style={{ willChange: 'transform' }}
        >

          {inPerformanceMode && (
            <header data-testid="stage-expanded-header" className="pt-10 pb-4 mb-5 border-b border-app-border flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-app-heading break-words">{song.title || 'Untitled Song'}</h1>
                <p className="text-xs sm:text-sm text-app-muted mt-1">
                  {song.artist || 'Unknown Artist'}
                  {effectivePerformanceKey ? ` • Key: ${effectivePerformanceKey}` : ''}
                  {song.bpm ? ` • ${song.bpm.replace(/\s*bpm$/i, '')} BPM` : ''}
                  {song.time ? ` • ${song.time}` : ''}
                </p>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-app-action px-2 py-1 rounded bg-app-surface border border-app-border">Stage</span>
            </header>
          )}

          {/* Missing / Invalid Key fail-safe notification for Numbers Mode */}
          {notation === 'numbers' && !effectivePerformanceKey && !song.isMissing && (
            <div
              data-testid="stage-numbers-key-missing"
              className="mb-4 mx-auto max-w-xl p-3.5 rounded-xl bg-app-surface border border-app-accent/40 flex items-center justify-between gap-3 text-xs shadow-md select-none"
            >
              <div className="flex items-center gap-2 text-app-text">
                <span className="font-extrabold text-app-accent">Numbers Mode:</span>
                <span>Reference key required to display numbers notation.</span>
              </div>
              <button
                type="button"
                onClick={() => setIsKeyPickerOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-app-action text-app-on-action font-extrabold text-xs hover:bg-app-action cursor-pointer shrink-0 transition-colors shadow-sm"
              >
                Choose Key
              </button>
            </div>
          )}

          {/* Song Lines Rendering: 1 Column or 2 Columns */}
          {song.isMissing ? (
            <div role="alert" className="rounded-xl border border-app-accent p-6 text-center">
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
                  chordScale={chordScale}
                  fontWeight={fontWeight}
                  lineSpacing={lineSpacing}
                  notation={notation}
                  referenceKey={notation === 'numbers' ? effectivePerformanceKey : undefined}
                />
              </div>

              <div className="min-w-0 md:border-l md:border-app-border/60 md:pl-6 lg:pl-10">
                <SongLineRenderer
                  lines={col2Lines}
                  fontSizePx={fontSizePx}
                  fontFamily={fontStyle}
                  onChordClick={handleChordClick}
                  chordScale={chordScale}
                  fontWeight={fontWeight}
                  lineSpacing={lineSpacing}
                  notation={notation}
                  referenceKey={notation === 'numbers' ? effectivePerformanceKey : undefined}
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
              notation={notation}
              referenceKey={notation === 'numbers' ? effectivePerformanceKey : undefined}
            />
          )}

          {/* Bottom Padding for scroll clearance: ensures floating controls never occlude the final lines */}
          <div
            className="flex items-center justify-center text-xs font-mono text-app-border select-none"
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
                     bg-app-surface/90 backdrop-blur-md rounded-t-2xl border-x border-t shadow-xl text-xs font-mono select-none
                     transition-all duration-300 ease-in-out transform ${
                       inPerformanceMode
                         ? showStageOverlays
                           ? 'opacity-100 translate-y-0 pointer-events-auto'
                           : 'opacity-0 translate-y-16 pointer-events-none'
                         : 'opacity-100 translate-y-0 pointer-events-auto'
                     }`}
          style={{
            borderColor: 'var(--custom-dock-border)',
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
              isInSetlistMode ? 'text-app-accent hover:text-app-text' : 'text-app-action hover:text-app-text'
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
              isInSetlistMode ? 'text-app-accent hover:text-app-text' : 'text-app-action hover:text-app-text'
            }`}
            title="Open setlist / library"
          >
            {isInSetlistMode
              ? `${activeSetlistSongIndex + 1}\u202f/\u202f${activeSetlistSongs.length}`
              : `${activeSongIndex + 1}\u202f/\u202f${songs.length}`}
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
              isInSetlistMode ? 'text-app-accent hover:text-app-text' : 'text-app-action hover:text-app-text'
            }`}
            title="Next Song"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Draggable Minimal Stage Control Dock (Prev Section • Autoscroll FAB • Next Section) */}
      <StageControlDock
        isAutoScrolling={isAutoScrolling}
        onToggleAutoScroll={handleToggleAutoScroll}
        onOpenStageOptions={() => {
          setIsStageMenuOpen(true)
          triggerOverlaysShow()
        }}
        onPrevSection={handlePrevSection}
        onNextSection={handleNextSection}
        canPrevSection={sectionHeaders.length > 0 && canPrevSection}
        canNextSection={sectionHeaders.length > 0 && canNextSection}
        visible={inPerformanceMode ? (!controlsAutoHide || showStageOverlays) : true}
        onUserInteraction={triggerOverlaysShow}
      />

      {/* Speed input popup */}
      {isSpeedPromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setIsSpeedPromptOpen(false)}
        >
          <form
            onSubmit={handleCustomSpeedSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl bg-app-surface border border-app-border p-5 shadow-2xl text-app-text"
          >
            <h3 className="text-base font-bold text-app-accent mb-2">Set Scroll Speed</h3>
            <p className="text-xs text-app-muted mb-4">Enter scroll speed in dp/s (5–180):</p>
            <input
              type="number"
              min="5"
              max="180"
              autoFocus
              value={speedInputText}
              onChange={(e) => setSpeedInputText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-app-base border border-app-border text-center text-lg font-mono font-bold text-app-accent focus:outline-none focus:border-app-action"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button type="button" onClick={() => setIsSpeedPromptOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-app-muted hover:text-app-text">
                Cancel
              </button>
              <button type="submit"
                className="px-4 py-1.5 rounded-lg bg-app-action text-app-on-action text-xs font-bold hover:bg-app-action">
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
            className="relative z-10 rounded-t-3xl bg-app-surface border-t border-x border-app-border shadow-2xl px-5 pt-3 max-h-[85vh] overflow-y-auto"
            style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-app-border rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-extrabold text-app-text tracking-wide uppercase flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-app-action" /> Stage Options
              </h2>
            </div>

            {/* --- Notation selector row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">Notation</span>
              <div className="grid grid-cols-2 gap-1.5 flex-1">
                {(['chords', 'numbers'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`stage-notation-${mode}-btn`}
                    onClick={() => setNotation(mode)}
                    className={`py-1.5 rounded-xl border text-xs font-mono font-bold text-center transition-all cursor-pointer ${
                      notation === mode
                        ? 'bg-app-action text-app-on-action border-app-action shadow-sm'
                        : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                    }`}
                  >
                    {mode === 'chords' ? 'Chords' : 'Numbers'}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Transpose / Key row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">
                {notation === 'numbers' ? 'Key' : 'Transpose'}
              </span>
              <div className={`flex items-center rounded-xl border p-0.5 flex-1 ${
                notation === 'numbers'
                  ? effectivePerformanceKey ? 'bg-app-base border-app-border' : 'bg-[#DC6E67]/10 border-[#DC6E67]/50'
                  : transposeOffset !== 0 ? 'bg-app-accent/10 border-app-accent' : 'bg-app-base border-app-border'
              }`}>
                <button
                  type="button"
                  disabled={notation === 'numbers' && !effectivePerformanceKey}
                  onClick={() => onTransposeChange(transposeOffset - 1)}
                  className="p-2 text-app-text hover:text-app-action cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                  title={notation === 'numbers' ? 'Step Key Down (-1)' : 'Transpose Down (-1)'}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsKeyPickerOpen(true)}
                  className={`flex-1 text-center text-sm font-mono font-extrabold cursor-pointer ${
                    notation === 'numbers'
                      ? effectivePerformanceKey ? 'text-app-accent' : 'text-status-error'
                      : transposeOffset !== 0 ? 'text-app-accent' : 'text-app-text'
                  }`}
                >
                  {notation === 'numbers'
                    ? `Key: ${effectivePerformanceKey || 'Not Set'}`
                    : `Transpose: ${offsetStr}`}
                </button>
                {transposeOffset !== 0 && (
                  <button
                    type="button"
                    onClick={() => onTransposeChange(0)}
                    className="p-2 text-app-muted hover:text-status-error cursor-pointer"
                    title={notation === 'numbers' ? 'Reset Key to Original' : 'Reset Transposition'}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={notation === 'numbers' && !effectivePerformanceKey}
                  onClick={() => onTransposeChange(transposeOffset + 1)}
                  className="p-2 text-app-text hover:text-app-action cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                  title={notation === 'numbers' ? 'Step Key Up (+1)' : 'Transpose Up (+1)'}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* --- Font size row & Presets --- */}
            <div className="mb-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-app-muted w-20 shrink-0">Font Size</span>
                <div className="flex items-center bg-app-base rounded-xl border border-app-border flex-1">
                  <button
                    type="button"
                    {...createHoldHandlers(-1)}
                    className="px-4 py-2 text-sm font-extrabold text-app-text hover:text-app-action cursor-pointer select-none active:scale-95 transition-transform"
                    title="Decrease font size (Hold to adjust)"
                  >
                    A-
                  </button>
                  <span
                    onDoubleClick={() => setStageFontSize(STAGE_SIZE_PRESETS.L)}
                    onTouchStart={handleNumericDoubleTap}
                    className="flex-1 text-center text-sm font-mono font-bold text-app-accent cursor-pointer select-none py-1"
                    title="Double-tap to reset to Stage default (L / 24px)"
                  >
                    {fontSizePx}px
                  </span>
                  <button
                    type="button"
                    {...createHoldHandlers(1)}
                    className="px-4 py-2 text-sm font-extrabold text-app-text hover:text-app-action cursor-pointer select-none active:scale-95 transition-transform"
                    title="Increase font size (Hold to adjust)"
                  >
                    A+
                  </button>
                </div>
              </div>

              {/* Quick Stage Size Presets [ S | M | L | XL ] */}
              <div className="flex items-center gap-1.5 pl-[88px]">
                {(['S', 'M', 'L', 'XL'] as const).map((key) => {
                  const size = STAGE_SIZE_PRESETS[key]
                  const isSelected = fontSizePx === size
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStageFontSize(size)}
                      className={`flex-1 py-1 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer text-center ${
                        isSelected
                          ? 'bg-app-button text-app-button-text border-app-accent shadow-sm'
                          : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                      }`}
                      title={`${key} (${size}px)`}
                    >
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* --- Chord Scaling Ratio --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">Chord Size</span>
              <div className="grid grid-cols-4 gap-1.5 flex-1">
                {CHORD_SCALE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setChordScale(value)}
                    className={`py-1.5 rounded-xl border text-xs font-mono font-bold text-center transition-all cursor-pointer ${
                      chordScale === value
                        ? 'bg-app-action text-app-on-action border-app-action shadow-sm'
                        : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Font Weight --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">Weight</span>
              <div className="grid grid-cols-3 gap-1.5 flex-1">
                {FONT_WEIGHT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFontWeight(value)}
                    className={`py-1.5 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                      fontWeight === value
                        ? 'bg-app-action text-app-on-action border-app-action font-bold shadow-sm'
                        : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Line Spacing --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">Spacing</span>
              <div className="grid grid-cols-3 gap-1.5 flex-1">
                {LINE_SPACING_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLineSpacing(value)}
                    className={`py-1.5 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                      lineSpacing === value
                        ? 'bg-app-action text-app-on-action border-app-action font-bold shadow-sm'
                        : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Autoscroll speed row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">Speed</span>
              <div className="flex items-center bg-app-base rounded-xl border border-app-border flex-1">
                <button type="button"
                  onClick={() => handleAdjustSpeed(Math.max(5, scrollSpeed - 5))}
                  className="px-4 py-2 text-app-text hover:text-app-action cursor-pointer">
                  <Minus className="w-4 h-4" />
                </button>
                <button type="button"
                  onClick={() => { setSpeedInputText(scrollSpeed.toString()); setIsStageMenuOpen(false); setIsSpeedPromptOpen(true) }}
                  className="flex-1 text-center text-sm font-mono font-bold text-app-accent cursor-pointer py-2">
                  {scrollSpeed} dp/s
                </button>
                <button type="button"
                  onClick={() => handleAdjustSpeed(Math.min(150, scrollSpeed + 5))}
                  className="px-4 py-2 text-app-text hover:text-app-action cursor-pointer">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* --- Column toggle + Font style row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">Layout</span>
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <button type="button"
                  onClick={() => setIsTwoColumn(!isTwoColumn)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold cursor-pointer transition-all ${
                    isTwoColumn ? 'bg-app-accent/20 border-app-accent text-app-accent' : 'bg-app-base border-app-border text-app-text'
                  }`}>
                  {isTwoColumn ? <Columns2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  {isTwoColumn ? '2-Col' : '1-Col'}
                </button>
                {(['mono','sans','serif'] as const).map((fs) => (
                  <button key={fs} type="button" onClick={() => setFontStyle(fs)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                      fontStyle === fs ? 'bg-app-action border-app-action text-app-on-action font-extrabold' : 'bg-app-base border-app-border text-app-text'
                    }`}>
                    {fs.charAt(0).toUpperCase() + fs.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* --- Fullscreen Controls Auto-Hide row --- */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">Controls</span>
              <div className="grid grid-cols-2 gap-1.5 flex-1">
                <button
                  type="button"
                  data-testid="stage-controls-auto-hide-on-btn"
                  onClick={() => setControlsAutoHide(true)}
                  className={`py-1.5 rounded-xl border text-xs font-mono font-bold text-center transition-all cursor-pointer ${
                    controlsAutoHide
                      ? 'bg-app-action text-app-on-action border-app-action shadow-sm'
                      : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                  }`}
                  title="Auto-hide navigation dock with HUD in fullscreen mode"
                >
                  Auto-Hide
                </button>
                <button
                  type="button"
                  data-testid="stage-controls-auto-hide-off-btn"
                  onClick={() => setControlsAutoHide(false)}
                  className={`py-1.5 rounded-xl border text-xs font-mono font-bold text-center transition-all cursor-pointer ${
                    !controlsAutoHide
                      ? 'bg-app-action text-app-on-action border-app-action shadow-sm'
                      : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                  }`}
                  title="Keep floating navigation dock visible during fullscreen mode"
                >
                  Always Visible
                </button>
              </div>
            </div>

            {/* --- Sync to TV / Stage Cast Action --- */}
            <div className="flex items-center gap-2 mb-5">
              <span className="text-xs font-mono text-app-muted w-20 shrink-0">TV Sync</span>
              <button
                type="button"
                data-testid="stage-options-sync-tv-btn"
                onClick={async () => {
                  setIsStageMenuOpen(false)
                  await handleTogglePresentation()
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border text-xs font-mono font-bold transition-all cursor-pointer flex-1 ${
                  isCastActive
                    ? 'bg-[#DC6E67]/20 border-[#DC6E67] text-status-error hover:bg-[#DC6E67]/30 shadow-sm animate-pulse'
                    : 'bg-app-base border-app-border text-app-text hover:text-app-action hover:border-app-action'
                }`}
                title={
                  isCastActive
                    ? 'Disconnect / Stop Presenting (Session Active - click to terminate)'
                    : 'Sync to TV / Secondary Display (AirPlay, Smart TV, or Teleprompter pairing)'
                }
              >
                <Tv className="w-4 h-4" />
                <span>{isCastActive ? 'Disconnect TV Sync' : 'Sync to TV'}</span>
              </button>
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
                className="w-full py-3 rounded-2xl bg-app-base border border-app-border
                           text-sm font-bold text-app-text hover:border-[#DC6E67] hover:text-status-error
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
        requestedChord={selectedChordName}
        onClose={() => {
          setSelectedVoicing(null)
          setSelectedChordName(null)
        }}
      />

      {/* Key & Transpose Picker Modal */}
      <KeyPickerModal
        isOpen={isKeyPickerOpen}
        onClose={() => setIsKeyPickerOpen(false)}
        originalKey={effectiveBaseKey || 'C'}
        currentOffset={transposeOffset}
        onSelectOffset={(offset) => onTransposeChange(offset)}
        onReset={() => onTransposeChange(0)}
      />

      {/* Stage Tools & Band Sync Modal */}
      <BandSyncModal
        isOpen={isBandSyncModalOpen}
        onClose={() => setIsBandSyncModalOpen(false)}
        initialTab="sync"
      />

      {/* Secondary TV Browser Pairing & AirPlay Modal */}
      <TvPresentationModal
        isOpen={isTvPresentationModalOpen}
        onClose={() => setIsTvPresentationModalOpen(false)}
        detectedLanIp={syncState.detectedLanIp || syncState.customHostIp}
      />
    </div>
  )
}
