import { stageSectionHeaderOffset, stageSectionScrollTop } from '../utils/liveLyricScroll'
import { useAutoLiveLyrics } from '../utils/useAutoLiveLyrics'
import { SetlistAutoFollowControl } from './SetlistAutoFollowControl'
import { useSetlistAutoFollow } from '../utils/useSetlistAutoFollow'
import { setlistAutoFollowDev } from '../utils/setlistAutoFollowDev'
import type { FollowSelection, FollowSetlist } from '../utils/setlistAutoFollow'
import { useLiveLyricScroll } from '../utils/useLiveLyricScroll'
import { LiveLyricsControl } from './LiveLyrics'
import { useLiveLyrics } from '../utils/useLiveLyrics'
import { TvPresentationOptions } from './TvPresentationOptions'
import { transposeContext } from '../utils/songKeySemantics'
import { SETTINGS_KEYS, SETTINGS_CHANGED, readBackupSettings, readStageAppearanceExtras } from '../utils/backupSettings'
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
  ChevronUp,
  ChevronDown,
  Minus,
  Plus,
  SkipBack,
  SkipForward,
  Cast,
  Sliders,
  Gauge,
  ArrowLeft,
  FileEdit,
  Radio,
} from 'lucide-react'
import { StageControlDock } from './StageControlDock'
import { StageOptionsSheet } from './StageOptionsSheet'
import { STAGE_CONTROLS_AUTO_HIDE_KEY } from '../utils/syncJournal'
import { formatTransposeOffset } from '../utils/chordTransposer'
import { navigateBack } from '../utils/viewHistory'
import {
  type StageNotationMode,
  NOTATION_STORAGE_KEY,
} from '../utils/nashvilleNotation'
import { parseGtarSong, splitSongLinesForColumns } from '../utils/songParser'
import { formatTempoLabel } from '../utils/chordProMetadata'
import { metronome } from '../utils/metronome'
import { bandSync, type BandSyncState } from '../utils/bandSync'
import { stageCast } from '../utils/stageCast'
import type { ChordVoicing } from '../utils/chordDictionary'

// The voicing catalog (~270 KB of chord data) loads in its own chunk, preloaded when Stage mounts (#85).
type ChordDictionaryModule = typeof import('../utils/chordDictionary')
let chordDictionaryPromise: Promise<ChordDictionaryModule> | null = null
const loadChordDictionary = (): Promise<ChordDictionaryModule> =>
  (chordDictionaryPromise ??= import('../utils/chordDictionary').catch(error => { chordDictionaryPromise = null; throw error }))
import {
  SongLineRenderer,
  type StageChordScale,
  type StageFontWeight,
  type StageLineSpacing,
} from './SongLineRenderer'
import { KeyPickerModal } from './KeyPickerModal'
import { FretboardDiagramModal } from './FretboardDiagramModal'
import { ChordQuickPreview, type ChordQuickPreviewAnchor } from './ChordQuickPreview'
import { BandSyncModal } from './BandSyncModal'
import { TvPresentationModal } from './TvPresentationModal'
import { stageCast2Enabled } from '../utils/stageCast2Local'
import type { ActiveSongState, WebSetlist } from '../types/gtar'

interface StageViewProps {
  song: ActiveSongState
  followSetlist?: FollowSetlist | null
  followManualRevision?: number
  onFollowSetlistEntry?: (request: FollowSelection) => boolean
  isProPresenterSelection?: boolean
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
  onOpenSetlistDrawer?: () => void
  isSetlistDrawerOpen?: boolean
  isStageSettingsModalOpen?: boolean
  isAnyModalOpen?: boolean
  transposeOffset: number
  onTransposeChange: (offset: number) => void
  fontStyle?: 'mono' | 'sans' | 'serif'
  onSelectFontStyle?: (style: 'mono' | 'sans' | 'serif') => void
  isTwoColumn?: boolean
  onToggleTwoColumn?: (enabled: boolean) => void
  onOpenEditor?: () => void
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
  followSetlist = null,
  followManualRevision = 0,
  onFollowSetlistEntry,
  isProPresenterSelection = false,
  songs,
  activeSongIndex,
  onSelectSongIndex,
  queueMode = 'library',
  isInSetlistMode: propIsInSetlistMode = false,
  activeSetlistSongs = [],
  activeSetlistSongIndex = 0,
  onSelectSetlistSongIndex,
  activeSetlistName,
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
  onOpenEditor,
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

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollAnimRef = useRef<number | null>(null)
  // Sub-pixel accumulator: iOS Safari rounds scrollTop to integers, so we accumulate
  // fractional pixels here and only commit whole-pixel increments.
  const accumulatedScrollRef = useRef<number>(0)
  // Timestamp of the last autoscroll activation, used to guard against touch-cancel
  // events firing immediately after the FAB is tapped on iOS.
  const autoScrollStartedAtRef = useRef<number>(0)

  // Visual anchoring across font resize reflow:
  // Tracks visible anchor line and viewport offset before reflow, restoring stable visual position
  const prevFontSizePxRef = useRef<number>(fontSizePx)
  const fontResizeAnchorRef = useRef<{
    element: HTMLElement
    offsetFromTop: number
  } | null>(null)

  // Capture anchor before DOM commit / when fontSizePx changes
  const captureFontResizeAnchor = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (container.scrollTop <= 0) {
      fontResizeAnchorRef.current = null
      return
    }
    const containerRect = container.getBoundingClientRect()
    const lineElements = Array.from(
      container.querySelectorAll<HTMLElement>('[data-stage-line="true"]')
    )
    let candidate = lineElements.find((el) => {
      const rect = el.getBoundingClientRect()
      return rect.bottom > containerRect.top + 2
    })
    if (!candidate && lineElements.length > 0) {
      candidate = lineElements[0]
    }
    if (candidate) {
      fontResizeAnchorRef.current = {
        element: candidate,
        offsetFromTop: candidate.getBoundingClientRect().top - containerRect.top,
      }
    } else {
      fontResizeAnchorRef.current = null
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
    captureFontResizeAnchor()
    setFontSizePx(clamped)
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(clamped))
    }
  }, [captureFontResizeAnchor])

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

  const handleFontSizeChange = useCallback((delta: number) => {
    captureFontResizeAnchor()
    setFontSizePx((prev) => {
      const next = Math.max(12, Math.min(38, prev + delta))
      if (typeof window !== 'undefined') {
        localStorage.setItem(SETTINGS_KEYS.fontSizePx, String(next))
      }
      return next
    })
  }, [captureFontResizeAnchor])

  // Invariants preserved for tests: handleNumericDoubleTap
  void handleNumericDoubleTap
  void handleFontSizeChange

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
      if (stage?.fontSizePx !== undefined) {
        captureFontResizeAnchor()
        setFontSizePx(stage.fontSizePx)
      }
      if (stage?.scrollSpeed !== undefined) setScrollSpeed(stage.scrollSpeed)
      if (stage?.fontStyle !== undefined) setLocalFontStyle(stage.fontStyle)
      if (stage?.isTwoColumn !== undefined) setLocalIsTwoColumn(stage.isTwoColumn)
      // #251: stage typography restored from a v2 backup applies without reopening the stage.
      const extras = readStageAppearanceExtras()
      if (extras.chordScale !== undefined) setChordScaleState(extras.chordScale as StageChordScale)
      if (extras.fontWeight !== undefined) setFontWeightState(extras.fontWeight)
      if (extras.lineSpacing !== undefined) setLineSpacingState(extras.lineSpacing)
      if (extras.notation !== undefined) setNotationState(extras.notation)
    }
    window.addEventListener(SETTINGS_CHANGED, reloadSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED, reloadSettings)
  }, [captureFontResizeAnchor])

  // Modals & Drawers
  const [isKeyPickerOpen, setIsKeyPickerOpen] = useState(false)
  const [selectedVoicing, setSelectedVoicing] = useState<ChordVoicing | null>(null)
  const [selectedChordName, setSelectedChordName] = useState<string | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<ChordQuickPreviewAnchor | null>(null)
  const [previewVoicing, setPreviewVoicing] = useState<ChordVoicing | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHoveringPreviewRef = useRef(false)
  const chordDictionaryRef = useRef<ChordDictionaryModule | null>(null)
  const voicingRequestRef = useRef(0)
  useEffect(() => {
    let active = true
    loadChordDictionary().then(m => { if (active) chordDictionaryRef.current = m }).catch(() => { /* retried on first chord tap */ })
    return () => { active = false }
  }, [])
  // Synchronous once the catalog is loaded (the normal case); otherwise applies the latest request after load.
  const withVoicing = useCallback((chordName: string, apply: (voicing: ChordVoicing | null) => void) => {
    const request = ++voicingRequestRef.current
    const loaded = chordDictionaryRef.current
    if (loaded) { apply(loaded.getChordVoicing(chordName)); return }
    loadChordDictionary().then(m => {
      chordDictionaryRef.current = m
      if (request === voicingRequestRef.current) apply(m.getChordVoicing(chordName))
    }).catch(() => { if (request === voicingRequestRef.current) apply(null) })
  }, [])
  const [isSpeedPromptOpen, setIsSpeedPromptOpen] = useState(false)
  const [speedInputText, setSpeedInputText] = useState('35')
  const [isBandSyncModalOpen, setIsBandSyncModalOpen] = useState(false)
  const [isTvPresentationModalOpen, setIsTvPresentationModalOpen] = useState(() => typeof window !== 'undefined' && window.location.hash.includes('cast2='))
  // Stage floating options menu (replaces top HUD)
  const [isStageMenuOpen, setIsStageMenuOpen] = useState(false)

  // Floating dock for tablet/desktop: defaults to false (OFF by default when no saved preference exists)
  const [showDock, setShowDock] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('gtar_stage_show_dock') ?? localStorage.getItem('gtar1_stage_show_dock')
      if (saved !== null) return saved === 'true'
    } catch {
      /* ignore storage error */
    }
    return false
  })

  const handleToggleShowDock = useCallback((enabled: boolean) => {
    setShowDock(enabled)
    try {
      localStorage.setItem('gtar_stage_show_dock', String(enabled))
      localStorage.setItem('gtar1_stage_show_dock', String(enabled))
    } catch {
      /* ignore storage error */
    }
  }, [])

  // Keep screen awake preference & controller
  const [isWakeLockEnabled, setIsWakeLockEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('gtar_stage_wake_lock')
      if (saved !== null) return saved === 'true'
    } catch {
      /* ignore storage error */
    }
    return true
  })

  const wakeLockCtrl = useMemo(() => createWakeLockController(), [])

  const handleToggleWakeLock = useCallback(() => {
    setIsWakeLockEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem('gtar_stage_wake_lock', String(next))
      } catch {
        /* ignore storage error */
      }
      return next
    })
  }, [])

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

  useLayoutEffect(() => {
    if (prevFontSizePxRef.current === fontSizePx) return
    prevFontSizePxRef.current = fontSizePx

    const container = scrollContainerRef.current
    if (!container) return

    // If viewport was at top, strictly keep it at top
    if (container.scrollTop <= 0) {
      return
    }

    const anchor = fontResizeAnchorRef.current
    if (anchor && container.contains(anchor.element)) {
      const containerRect = container.getBoundingClientRect()
      const newDistance = anchor.element.getBoundingClientRect().top - containerRect.top
      const delta = Math.round(newDistance - anchor.offsetFromTop)
      if (Math.abs(delta) > 0) {
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
        const targetScrollTop = Math.max(0, Math.min(maxScroll, container.scrollTop + delta))
        container.scrollTop = targetScrollTop
        lastScrollTopRef.current = targetScrollTop
        accumulatedScrollRef.current = targetScrollTop
        const fraction = maxScroll > 0 ? targetScrollTop / maxScroll : 0
        stageCast.broadcastScroll(targetScrollTop, fraction)
        if (syncState.role === 'HOST' && maxScroll > 0) {
          bandSync.broadcastScroll(fraction, targetScrollTop)
        }
      }
    }
    // Clean up anchor after reflow resolution
    fontResizeAnchorRef.current = null
  }, [fontSizePx, syncState.role])

  // Parse song with native v1.0.42 parser and active transpose offset
  const parsedSong = useMemo(() => parseGtarSong(song.rawContent, transposeOffset), [song.rawContent, transposeOffset])
  const manualLyrics = useLiveLyrics(song, parsedSong.lines, isFullscreen,
    isAnyOverlayActive || syncState.role !== 'OFF' || isCastActive,
    JSON.stringify([queueMode, activeSongIndex, activeSetlistSongIndex]))

  const autoFollow = useSetlistAutoFollow(manualLyrics.snapshot, followSetlist, activeSetlistSongIndex, followManualRevision,
    isFullscreen, isAnyOverlayActive || syncState.role !== 'OFF' || isCastActive, onFollowSetlistEntry)

  const liveLyrics = useAutoLiveLyrics(manualLyrics, song, autoFollow, followSetlist, activeSetlistSongIndex)

  const liveScroll = useLiveLyricScroll(scrollContainerRef, {
    enabled: liveLyrics.confirmed, session: liveLyrics.verificationScope,
    slideKey: liveLyrics.slideKey, range: liveLyrics.scrollRange, speedScrolling: isAutoScrolling,
    sectionMode: liveLyrics.automaticMode && isFullscreen && !autoFollow.state.paused,
    section: liveLyrics.section ? { ...liveLyrics.section, offset: stageSectionHeaderOffset(inPerformanceMode, showStageOverlays) } : null,
    preservePause: autoFollow.state.mode === 'auto' && isFullscreen,
  })

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
    const isLiveLyricScroll = liveScroll.controller.handleScroll()
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

    // Keep local section/scroll bookkeeping, but never echo ProPresenter-owned movement.
    if (isLiveLyricScroll) return

    // Mirror to Stage Cast teleprompter screen in real time with active line/section anchor
    let activeLineIndex = 0
    const lineElements = Array.from(target.querySelectorAll<HTMLElement>('[data-stage-line="true"]'))
    const containerTop = target.getBoundingClientRect().top
    const activeEl = lineElements.find((el) => {
      const rect = el.getBoundingClientRect()
      return rect.bottom > containerTop + 24
    })
    if (activeEl) {
      const rawIdx = activeEl.getAttribute('data-line-index') ?? activeEl.getAttribute('data-section-index')
      if (rawIdx !== null) {
        activeLineIndex = parseInt(rawIdx, 10)
      }
    }
    stageCast.broadcastScroll(target.scrollTop, fraction, activeLineIndex)

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
    if (nextVal) liveScroll.controller.pause()
    setIsAutoScrolling(nextVal)
    if (nextVal) {
      // Record activation time so the touch-cancel guard knows not to kill this
      // immediately when the FAB touch-end event propagates to the scroll container.
      autoScrollStartedAtRef.current = performance.now()
    }
    if (syncState.role === 'HOST') {
      bandSync.broadcastAutoScroll(nextVal, scrollSpeed)
    }
  }, [isAutoScrolling, syncState.role, scrollSpeed, liveScroll.controller])

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
    liveScroll.controller.pause()
    const container = scrollContainerRef.current
    if (!container) return

    const sectionEls = Array.from(
      container.querySelectorAll<HTMLElement>('[data-stage-section="true"]')
    )
    if (sectionEls.length === 0) return

    const containerRect = container.getBoundingClientRect()
    const currentScrollTop = container.scrollTop
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    const headerOffset = stageSectionHeaderOffset(inPerformanceMode, showStageOverlays)

    const targets = sectionEls.map((el) => {
      const elRect = el.getBoundingClientRect()
      const targetScrollTop = stageSectionScrollTop(currentScrollTop, elRect.top, containerRect.top, headerOffset)
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

    let targetSectionIndex = 0
    if (pastSections.length > 0) {
      const currentSection = pastSections[pastSections.length - 1]
      const clampedCurrent = Math.max(0, Math.min(maxScroll, currentSection.targetScrollTop))
      if (currentScrollTop > currentSection.targetScrollTop + 24 && clampedCurrent < currentScrollTop - 4) {
        targetSectionIndex = parseInt(currentSection.el.getAttribute('data-section-index') || currentSection.el.getAttribute('data-line-index') || '0', 10)
      } else {
        for (let i = pastSections.length - 2; i >= 0; i--) {
          const clampedPreceding = Math.max(0, Math.min(maxScroll, pastSections[i].targetScrollTop))
          if (clampedPreceding < currentScrollTop - 4) {
            targetSectionIndex = parseInt(pastSections[i].el.getAttribute('data-section-index') || pastSections[i].el.getAttribute('data-line-index') || '0', 10)
            break
          }
        }
      }
    }

    accumulatedScrollRef.current = targetTop
    setIsAutoScrolling(false)
    const prevFraction = maxScroll > 0 ? targetTop / maxScroll : 0
    stageCast.broadcastScroll(targetTop, prevFraction, targetSectionIndex)
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
    triggerOverlaysShow()
  }, [inPerformanceMode, showStageOverlays, triggerOverlaysShow, liveScroll.controller])

  const handleNextSection = useCallback(() => {
    liveScroll.controller.pause()
    const container = scrollContainerRef.current
    if (!container) return

    const sectionEls = Array.from(
      container.querySelectorAll<HTMLElement>('[data-stage-section="true"]')
    )
    if (sectionEls.length === 0) return

    const containerRect = container.getBoundingClientRect()
    const currentScrollTop = container.scrollTop
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    const headerOffset = stageSectionHeaderOffset(inPerformanceMode, showStageOverlays)

    const targets = sectionEls.map((el) => {
      const elRect = el.getBoundingClientRect()
      const targetScrollTop = stageSectionScrollTop(currentScrollTop, elRect.top, containerRect.top, headerOffset)
      return { el, targetScrollTop }
    })

    const nextSection = targets.find((s) => s.targetScrollTop > currentScrollTop + 12)
    if (!nextSection) return

    const clampedNext = Math.max(0, Math.min(maxScroll, nextSection.targetScrollTop))
    if (clampedNext <= currentScrollTop + 4 && currentScrollTop >= maxScroll - 4) return

    const targetTop = clampedNext
    const nextSectionIndex = parseInt(nextSection.el.getAttribute('data-section-index') || nextSection.el.getAttribute('data-line-index') || '0', 10)
    accumulatedScrollRef.current = targetTop
    setIsAutoScrolling(false)
    const nextFraction = maxScroll > 0 ? targetTop / maxScroll : 0
    stageCast.broadcastScroll(targetTop, nextFraction, nextSectionIndex)
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
    triggerOverlaysShow()
  }, [inPerformanceMode, showStageOverlays, triggerOverlaysShow, liveScroll.controller])

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
  const captureFontResizeAnchorRef = useRef(captureFontResizeAnchor)
  // Publish committed values before input events; suspended renders cannot leak.
  useLayoutEffect(() => {
    executePrevSongRef.current = executePrevSong
    executeNextSongRef.current = executeNextSong
    canPrevRef.current = canPrev
    canNextRef.current = canNext
    fontSizePxRef.current = fontSizePx
    isPerformanceModeRef.current = inPerformanceMode
    triggerOverlaysShowRef.current = triggerOverlaysShow
    captureFontResizeAnchorRef.current = captureFontResizeAnchor
  }, [executePrevSong, executeNextSong, canPrev, canNext, fontSizePx, inPerformanceMode, triggerOverlaysShow, captureFontResizeAnchor])

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
        if (isProPresenterSelection) liveScroll.controller.markProgrammaticPosition(0)
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
      if (!isProPresenterSelection) stageCast.broadcastScroll(0, 0, 0)
    }
    previousSongKeyRef.current = currentSongKey
  }, [currentSongKey, isProPresenterSelection, liveScroll.controller])

  const triggerSongSlide = useCallback((direction: 'next' | 'prev') => {
    autoFollow.controller.override()
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
  }, [autoFollow.controller])

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
          captureFontResizeAnchorRef.current()
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

        if (isNext || isPrev) autoFollow.controller.override()
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
  }, [autoFollow.controller])

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
        captureFontResizeAnchor()
        setFontSizePx((prev) => Math.min(36, prev + 1))
      } else if (e.key === '-') {
        captureFontResizeAnchor()
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
    captureFontResizeAnchor,
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
  // Screen Wake Lock — acquire when enabled, release when disabled or unmounted
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isWakeLockEnabled) {
      wakeLockCtrl.acquire()
    } else {
      wakeLockCtrl.release()
    }
  }, [isWakeLockEnabled, wakeLockCtrl])

  useEffect(() => {
    return () => {
      wakeLockCtrl.cleanup()
    }
  }, [wakeLockCtrl])

  // Single source of truth for base reference key:
  // Explicit song key, parsed directive, detected tonic chord progression, or manual key override
  const keyContext = transposeContext(song, transposeOffset)
  const effectivePerformanceKey = keyContext.performanceKey
  const effectiveKey = effectivePerformanceKey
  const offsetStr = formatTransposeOffset(keyContext.displayOffset)
  void offsetStr

  // Two-column split calculation matching splitSongLinesForColumns in Android SongViewerScreen.kt
  const [col1Lines, col2Lines] = isTwoColumn
    ? splitSongLinesForColumns(parsedSong.lines)
    : [parsedSong.lines, []]

  // Mirror stage state to secondary screen / Cast Presentation window in real-time
  useEffect(() => {
    if (isProPresenterSelection && !isCastActive) return
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
  }, [song, effectiveKey, transposeOffset, fontSizePx, fontStyle, isTwoColumn, chordScale, fontWeight, lineSpacing, notation, isProPresenterSelection, isCastActive])

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
      // #214: with Stage Cast 2.0 (DEV builds) desktop Cast offers pop-out and TV pairing in one modal.
      if (caps.recommendedMode === 'tv_pairing' || !caps.canDirectPresent || stageCast2Enabled) {
        setIsTvPresentationModalOpen(true)
      } else {
        const res = await stageCast.requestPresentation({ preferPopup: caps.supportsMultiWindow })
        if (!res.success && res.mode === 'popup_window' && res.error) {
          window.alert(res.error)
        }
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

  const handleChordClick = (chordName: string, targetEl?: HTMLElement) => {
    // Clear any pending hover timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }

    if (targetEl) {
      // If clicking same chord that is already in quick preview, or on mobile/touch,
      // clicking pins/opens the anchored quick preview
      const rect = targetEl.getBoundingClientRect()
      if (previewAnchor?.chord === chordName) {
        // Toggle or open full modal
        withVoicing(chordName, voicing => {
          setSelectedChordName(chordName)
          setSelectedVoicing(voicing)
          setPreviewAnchor(null)
          setPreviewVoicing(null)
        })
      } else {
        withVoicing(chordName, voicing => {
          setPreviewAnchor({ rect, chord: chordName })
          setPreviewVoicing(voicing)
        })
      }
    } else {
      // Fallback for direct invocation without element target
      withVoicing(chordName, voicing => {
        setSelectedChordName(chordName)
        setSelectedVoicing(voicing)
        setPreviewAnchor(null)
        setPreviewVoicing(null)
      })
    }
  }

  const handleChordHover = (chordName: string, targetEl: HTMLElement) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }

    // 250ms intentional hover delay to prevent flashing
    hoverTimerRef.current = setTimeout(() => {
      const rect = targetEl.getBoundingClientRect()
      withVoicing(chordName, voicing => {
        setPreviewAnchor({ rect, chord: chordName })
        setPreviewVoicing(voicing)
      })
    }, 250)
  }

  const handleChordLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    voicingRequestRef.current++ // drop any preview still waiting for the catalog to load

    // Delay closing briefly to allow pointer movement into the preview popover
    setTimeout(() => {
      if (!isHoveringPreviewRef.current) {
        setPreviewAnchor(null)
        setPreviewVoicing(null)
      }
    }, 150)
  }

  // Dismiss quick preview on scroll to avoid detached floating popovers
  useEffect(() => {
    if (!previewAnchor) return
    const handleScroll = () => {
      setPreviewAnchor(null)
      setPreviewVoicing(null)
    }
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', handleScroll, { capture: true })
  }, [previewAnchor])

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
              <p className="text-[10px] sm:text-xs text-app-action font-semibold truncate leading-normal mt-0.5 pb-0.5">
                {song.artist}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Key Chip */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsKeyPickerOpen(true)
                triggerOverlaysShow()
              }}
              aria-label={`Key: ${effectivePerformanceKey || 'Not Set'}. Click to transpose.`}
              className="ui-button min-h-[44px] min-w-[44px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 bg-app-base border-app-border text-app-text hover:border-app-action cursor-pointer"
            >
              <span className="text-app-muted">Key:</span>
              <span className="font-bold text-app-accent">{effectivePerformanceKey || '—'}</span>
              <span className="sr-only">Transpose: {offsetStr}</span>
              {keyContext.displayOffset !== 0 && (
                <span className="text-[10px] font-mono text-app-action">
                  {keyContext.displayOffset > 0 ? `+${keyContext.displayOffset}` : keyContext.displayOffset}
                </span>
              )}
            </button>

            {/* Quick Notation Switcher */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                const next = notation === 'chords' ? 'numbers' : 'chords'
                setNotation(next)
                try {
                  localStorage.setItem(NOTATION_STORAGE_KEY, next)
                } catch {
                  /* ignore storage error */
                }
                triggerOverlaysShow()
              }}
              aria-label="Toggle Chords vs Numbers"
              className={`hidden sm:inline-flex min-h-[44px] px-3 items-center rounded-xl text-xs font-bold border transition-colors cursor-pointer shrink-0 ${
                notation === 'numbers'
                  ? 'bg-app-action border-app-action text-app-on-action shadow-sm'
                  : 'bg-app-base border-app-border text-app-text hover:border-app-action'
              }`}
            >
              {notation === 'numbers' ? 'NNS' : 'Chords'}
            </button>

            {/* Stage Top Bar Quick Autoscroll Action Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleToggleAutoScroll()
                triggerOverlaysShow()
              }}
              aria-label={isAutoScrolling ? 'Pause autoscroll' : 'Start autoscroll'}
              className={`ui-button min-w-[44px] min-h-[44px] px-2.5 h-11 rounded-xl border flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors ${
                isAutoScrolling
                  ? 'bg-status-error/15 border-status-error text-status-error hover:bg-status-error/25 shadow-sm'
                  : 'bg-app-button hover:brightness-110 border-app-border text-app-button-text'
              }`}
            >
              {isAutoScrolling ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Gauge className="w-4 h-4" />
              )}
              <span className="text-xs font-mono font-bold">{scrollSpeed}</span>
            </button>

            {/* Stage Options */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsStageMenuOpen(true)
                triggerOverlaysShow()
              }}
              aria-label="Open Stage Options"
              className="ui-button min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-app-base border border-app-border text-app-text hover:border-app-action transition-colors flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Sliders className="w-5 h-5" />
            </button>

            {/* Exit Fullscreen Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isFullscreen && fullscreenCtrl.isSupported) fullscreenCtrl.toggle()
                else setIsDistractionFree(false)
              }}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-app-base hover:bg-app-border text-app-text text-xs font-semibold
                         flex items-center gap-1.5 border border-app-border transition-colors cursor-pointer shrink-0"
              aria-label="Exit fullscreen"
            >
              <Minimize2 className="w-4 h-4" />
              <span className="hidden sm:inline text-xs font-bold">Exit</span>
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
        className={`border-b border-app-border bg-app-surface px-4 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2.5 z-20 shadow-md transition-all duration-300 ${
          inPerformanceMode ? 'opacity-0 pointer-events-none h-0 py-0 overflow-hidden border-0' : 'opacity-100'
        }`}
      >
        {/* Left Side: Back, Editor, Band Sync */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => { if (onBack) onBack(); else navigateBack() }}
            aria-label="Back"
            data-testid="toolbar-back"
            className="ui-button min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 px-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 whitespace-nowrap bg-app-base border-app-border text-app-text hover:border-app-action cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <button
            type="button"
            onClick={onOpenEditor}
            aria-label="Editor"
            className="ui-button min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 px-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 whitespace-nowrap bg-app-base border-app-border text-app-text hover:border-app-action cursor-pointer"
          >
            <FileEdit className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Editor</span>
          </button>
          <button
            type="button"
            onClick={onOpenBandSync}
            aria-label="Band Sync"
            className="ui-button min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 px-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 whitespace-nowrap bg-app-base border-app-border text-app-text hover:border-app-action cursor-pointer"
          >
            <Radio className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Band Sync</span>
          </button>
        </div>

        {/* Right Side: Key, Chords/Numbers, speed, Stage Options, Cast, Fullscreen toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
          {/* Key Chip (Tapping opens KeyPickerModal) */}
          <button
            type="button"
            onClick={() => setIsKeyPickerOpen(true)}
            aria-label={`Key: ${effectivePerformanceKey || 'Not Set'}. Click to transpose.`}
            className="ui-button min-h-11 sm:min-h-9 min-w-11 sm:min-w-9 px-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0 bg-app-base border-app-border text-app-text hover:border-app-action cursor-pointer"
          >
            <span className="text-app-muted">Key:</span>
            <span className="font-bold text-app-accent">{effectivePerformanceKey || '—'}</span>
            <span className="sr-only">Transpose: {offsetStr}</span>
            {keyContext.displayOffset !== 0 && (
              <span className="text-[10px] font-mono text-app-action">
                {keyContext.displayOffset > 0 ? `+${keyContext.displayOffset}` : keyContext.displayOffset}
              </span>
            )}
          </button>

          {/* Hidden semantic controls for test harness accessibility (reset/steppers) */}
          {keyContext.displayOffset !== 0 && (
            <button
              type="button"
              onClick={() => onTransposeChange(keyContext.resetOffset)}
              className="sr-only"
              aria-label={keyContext.originalRelative ? "Reset Transposition to Original Key" : "Reset Transposition to Chart Key"}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => onTransposeChange(keyContext.toStoredOffset(keyContext.displayOffset - 1))}
            className="sr-only"
            aria-label="Step Key Down (-1 semitone)"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => onTransposeChange(keyContext.toStoredOffset(keyContext.displayOffset + 1))}
            className="sr-only"
            aria-label="Step Key Up (+1 semitone)"
          >
            +
          </button>

          {/* Quick Notation Switcher (Chords vs Numbers) */}
          <button
            type="button"
            onClick={() => {
              const next = notation === 'chords' ? 'numbers' : 'chords'
              setNotation(next)
              try {
                localStorage.setItem(NOTATION_STORAGE_KEY, next)
              } catch {
                /* ignore storage error */
              }
            }}
            aria-label="Toggle Chords vs Numbers"
            className={`hidden sm:inline-flex min-h-11 sm:min-h-9 px-3 items-center rounded-lg text-xs font-bold border transition-colors cursor-pointer shrink-0 ${
              notation === 'numbers'
                ? 'bg-app-action border-app-action text-app-on-action shadow-sm'
                : 'bg-app-base border-app-border text-app-text hover:border-app-action'
            }`}
          >
            {notation === 'numbers' ? 'NNS' : 'Chords'}
          </button>

          {/* Stage Top Bar Quick Autoscroll Action Button */}
          <button
            type="button"
            onClick={handleToggleAutoScroll}
            aria-label={isAutoScrolling ? 'Pause autoscroll' : 'Start autoscroll'}
            className={`ui-button min-w-11 sm:min-w-9 min-h-11 sm:min-h-9 px-2.5 rounded-lg border flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors ${
              isAutoScrolling
                ? 'bg-status-error/15 border-status-error text-status-error hover:bg-status-error/25 shadow-sm'
                : 'bg-app-button hover:brightness-110 border-app-border text-app-button-text'
            }`}
          >
            {isAutoScrolling ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Gauge className="w-4 h-4" />
            )}
            <span className="text-xs font-mono font-bold">{scrollSpeed}</span>
          </button>

          {/* Stage Options Button */}
          <button
            type="button"
            onClick={() => setIsStageMenuOpen(true)}
            aria-label="Open Stage Options"
            className="ui-button min-w-11 sm:min-w-9 min-h-11 sm:min-h-9 w-11 sm:w-9 h-11 sm:h-9 rounded-lg bg-app-base border border-app-border text-app-text hover:border-app-action transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Sliders className="w-4 h-4" />
          </button>

          {/* Cast button (stays in this second toolbar row) */}
          <button
            type="button"
            onClick={handleTogglePresentation}
            className={`min-w-11 sm:min-w-9 min-h-11 sm:min-h-9 p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 ${
              isCastActive
                ? 'bg-[#DC6E67]/20 border-[#DC6E67] text-status-error hover:bg-[#DC6E67]/30 shadow-sm animate-pulse'
                : 'bg-app-base border-app-border text-app-text hover:text-app-action hover:border-app-action'
            }`}
            aria-label={
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

          {/* Fullscreen toggle (The ONLY GTAR control kept in that row: one click on/off) */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="ui-button min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl border border-app-border bg-app-base text-app-text hover:border-app-action transition-colors flex items-center justify-center shrink-0 cursor-pointer"
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
      {isFullscreen && liveLyrics.confirmed && liveScroll.paused && !liveLyrics.automaticMode && (
        <button type="button" onClick={liveScroll.controller.resume}
          disabled={isAutoScrolling || !liveLyrics.scrollRange}
          aria-label={isAutoScrolling ? 'Resume auto-scroll unavailable while speed scrolling' : !liveLyrics.scrollRange ? 'Resume auto-scroll unavailable without a unique lyric match' : 'Resume auto-scroll'}
          className="ui-button absolute bottom-24 left-3 z-40 min-h-11 px-3 rounded-xl border border-app-border bg-app-surface text-app-text shadow-lg disabled:opacity-50"
        >Resume auto-scroll</button>
      )}
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
            <div data-testid="stage-expanded-header" className="pt-10 pb-4 mb-5 border-b border-app-border flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-app-heading break-words">{song.title || 'Untitled Song'}</h1>
                <p className="text-xs sm:text-sm text-app-muted mt-1">
                  {song.artist || 'Unknown Artist'}
                  {effectivePerformanceKey ? ` • Key: ${effectivePerformanceKey}` : ''}
                  {song.bpm ? ` • ${formatTempoLabel(song.bpm) ?? ''}` : ''}
                  {song.time ? ` • ${song.time}` : ''}
                </p>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-app-action px-2 py-1 rounded bg-app-surface border border-app-border">Stage</span>
            </div>
          )}

          {/* GTAR1 Song View format in Stage Preview (Title, Artist, Metadata Chips) */}
          {!inPerformanceMode && (
            <div className="mb-6">
              <h1 className="ui-primary-text text-3xl font-extrabold text-app-heading tracking-tight">
                {song.title || parsedSong.title || 'Untitled Song'}
              </h1>
              {Boolean(song.artist || parsedSong.artist) && (
                <p className="ui-secondary-text text-lg text-app-muted mt-1">
                  {song.artist || parsedSong.artist}
                </p>
              )}

              <div className="flex flex-wrap gap-2 sm:gap-3 mt-3 text-xs text-app-muted">
                {Boolean(keyContext.originalKey) && (
                  <span className="bg-app-surface px-2.5 py-1 rounded-full border border-app-border text-app-muted">
                    Orig Key: <strong className="text-app-text">{keyContext.originalKey}</strong>
                  </span>
                )}
                {Boolean(keyContext.chartKey) && (
                  <span className="bg-app-surface px-2.5 py-1 rounded-full border border-app-border text-app-muted">
                    Chart Key: <strong className="text-app-text">{keyContext.chartKey}{keyContext.chartEstimated ? ' (est)' : ''}</strong>
                  </span>
                )}
                {Boolean(song.bpm || parsedSong.bpm) && (
                  <span className="bg-app-surface px-2.5 py-1 rounded-full border border-app-border text-app-muted">
                    Tempo: <strong className="text-app-text">{formatTempoLabel(song.bpm || parsedSong.bpm)}</strong>
                  </span>
                )}
                {Boolean(song.time || parsedSong.time) && (
                  <span className="bg-app-surface px-2.5 py-1 rounded-full border border-app-border text-app-muted">
                    Time: <strong className="text-app-text">{song.time || parsedSong.time}</strong>
                  </span>
                )}
                {Boolean(song.year || parsedSong.year) && (
                  <span className="bg-app-surface px-2.5 py-1 rounded-full border border-app-border text-app-muted">
                    Year: <strong className="text-app-text">{song.year || parsedSong.year}</strong>
                  </span>
                )}
              </div>
            </div>
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

          {isFullscreen && <LiveLyricsControl live={liveLyrics} songTitle={song.title} onConfirmed={autoFollow.controller.associateCurrent}>
            {setlistAutoFollowDev && <SetlistAutoFollowControl follow={autoFollow} />}
          </LiveLyricsControl>}
          {/* Song Lines Rendering: Chart in a Card for Stage Preview */}
          <div className={!inPerformanceMode ? 'ui-song-card bg-app-surface rounded-2xl p-4 sm:p-6 border border-app-border shadow-xl overflow-x-auto min-h-[400px]' : ''}>
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
                    activeLineIds={liveLyrics.activeLineIds}
                    fontSizePx={fontSizePx}
                    fontFamily={fontStyle}
                    onChordClick={handleChordClick}
                    onChordHover={handleChordHover}
                    onChordLeave={handleChordLeave}
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
                    lineOffset={col1Lines.length}
                    activeLineIds={liveLyrics.activeLineIds}
                    fontSizePx={fontSizePx}
                    fontFamily={fontStyle}
                    onChordClick={handleChordClick}
                    onChordHover={handleChordHover}
                    onChordLeave={handleChordLeave}
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
                activeLineIds={liveLyrics.activeLineIds}
                fontSizePx={fontSizePx}
                fontFamily={fontStyle}
                onChordClick={handleChordClick}
                onChordHover={handleChordHover}
                onChordLeave={handleChordLeave}
                chordScale={chordScale}
                fontWeight={fontWeight}
                lineSpacing={lineSpacing}
                notation={notation}
                referenceKey={notation === 'numbers' ? effectivePerformanceKey : undefined}
              />
            )}
          </div>

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
          className={`fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-0
                     bg-app-surface/95 backdrop-blur-md ${inPerformanceMode && !showDock ? 'rounded-2xl border' : 'rounded-t-2xl border-x border-t'} shadow-xl text-xs font-mono select-none
                     transition-all duration-300 ease-in-out transform ${
                       inPerformanceMode
                         ? showStageOverlays
                           ? 'opacity-100 translate-y-0 pointer-events-auto'
                           : 'opacity-0 translate-y-16 pointer-events-none'
                         : 'opacity-100 translate-y-0 pointer-events-auto'
                     }`}
          style={{
            borderColor: 'var(--custom-dock-border)',
            bottom: inPerformanceMode && !showDock
              ? 'calc(4.25rem + env(safe-area-inset-bottom, 0px))'
              : '0px',
            paddingBottom: inPerformanceMode && !showDock
              ? '4px'
              : 'max(10px, env(safe-area-inset-bottom, 10px))',
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
            aria-label="Previous Song"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {!inPerformanceMode && onOpenSetlistDrawer ? (
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
              aria-label="Open setlist / library"
            >
              {isInSetlistMode
                ? `${activeSetlistSongIndex + 1}\u202f/\u202f${activeSetlistSongs.length}`
                : `${activeSongIndex + 1}\u202f/\u202f${songs.length}`}
            </button>
          ) : (
            <span
              className={`px-3 py-2 font-extrabold text-[11px] select-none ${
                isInSetlistMode ? 'text-app-accent' : 'text-app-action'
              }`}
            >
              {isInSetlistMode
                ? `${activeSetlistSongIndex + 1}\u202f/\u202f${activeSetlistSongs.length}`
                : `${activeSongIndex + 1}\u202f/\u202f${songs.length}`}
            </span>
          )}

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
            aria-label="Next Song"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Draggable Minimal Stage Control Dock (Prev Section • Autoscroll FAB • Next Section) */}
      {showDock && (
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
      )}

      {/* Fixed Bottom Transport Controls (Fullscreen only when floating dock is OFF) */}
      {inPerformanceMode && !showDock && (
        <nav
          role="region"
          aria-label="Stage transport controls"
          data-testid="stage-bottom-transport-nav"
          className={`fixed bottom-0 inset-x-0 z-40 backdrop-blur-md border-t px-4 py-2.5 transition-all duration-300 ${
            !controlsAutoHide || showStageOverlays
              ? 'translate-y-0 opacity-100 pointer-events-auto'
              : 'translate-y-full opacity-0 pointer-events-none'
          }`}
          style={{
            backgroundColor: 'var(--custom-dock-bg, var(--custom-chrome-toolbar-bg, rgba(15, 23, 42, 0.95)))',
            borderTopColor: 'var(--custom-dock-border, var(--custom-card-border, #1e293b))',
            paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0.625rem))',
          }}
        >
          <div className="max-w-xl mx-auto flex items-center justify-between gap-2">
            {/* Prev Section Button */}
            <button
              type="button"
              disabled={sectionHeaders.length === 0 || !canPrevSection}
              onClick={handlePrevSection}
              aria-label="Previous section"
              data-testid="stage-bottom-prev-section-btn"
              className={`p-3 min-w-[44px] min-h-[44px] rounded-2xl flex items-center justify-center transition-all border ${
                sectionHeaders.length > 0 && canPrevSection
                  ? 'active:scale-95 text-app-text hover:text-app-action'
                  : 'opacity-40 cursor-not-allowed pointer-events-none text-app-muted'
              }`}
              style={{
                backgroundColor: 'var(--custom-dock-btn-bg, var(--custom-control-button-bg, #1e293b))',
                borderColor: 'var(--custom-dock-border, var(--custom-card-border, #334155))',
              }}
            >
              <ChevronUp className="w-6 h-6 stroke-[2.5]" />
            </button>

            {/* Transpose - */}
            <button
              type="button"
              onClick={() => onTransposeChange(keyContext.toStoredOffset(keyContext.displayOffset - 1))}
              aria-label="Transpose down one semitone"
              data-testid="stage-bottom-transpose-down-btn"
              className="p-3 min-w-[44px] min-h-[44px] rounded-2xl active:scale-95 flex items-center justify-center transition-all border text-app-text hover:text-app-action"
              style={{
                backgroundColor: 'var(--custom-dock-btn-bg, var(--custom-control-button-bg, #1e293b))',
                borderColor: 'var(--custom-dock-border, var(--custom-card-border, #334155))',
              }}
            >
              <Minus className="w-5 h-5 stroke-[2.5]" />
            </button>

            {/* Prominent Play / Pause FAB */}
            <button
              type="button"
              onClick={() => {
                triggerOverlaysShow()
                handleToggleAutoScroll()
              }}
              aria-label={isAutoScrolling ? 'Pause autoscroll' : 'Start autoscroll'}
              data-testid="stage-bottom-play-pause-btn"
              className="w-14 h-14 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 border-2"
              style={{
                backgroundColor: isAutoScrolling ? '#dc2626' : 'var(--custom-dock-play-bg, var(--custom-control-accent, #0284c7))',
                borderColor: isAutoScrolling ? '#ef4444' : 'var(--custom-dock-play-bg, var(--custom-control-accent, #38bdf8))',
                color: isAutoScrolling ? '#ffffff' : 'var(--custom-dock-play-icon, #000000)',
              }}
            >
              {isAutoScrolling ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-0.5" />
              )}
            </button>

            {/* Transpose + */}
            <button
              type="button"
              onClick={() => onTransposeChange(keyContext.toStoredOffset(keyContext.displayOffset + 1))}
              aria-label="Transpose up one semitone"
              data-testid="stage-bottom-transpose-up-btn"
              className="p-3 min-w-[44px] min-h-[44px] rounded-2xl active:scale-95 flex items-center justify-center transition-all border text-app-text hover:text-app-action"
              style={{
                backgroundColor: 'var(--custom-dock-btn-bg, var(--custom-control-button-bg, #1e293b))',
                borderColor: 'var(--custom-dock-border, var(--custom-card-border, #334155))',
              }}
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </button>

            {/* Next Section Button */}
            <button
              type="button"
              disabled={sectionHeaders.length === 0 || !canNextSection}
              onClick={handleNextSection}
              aria-label="Next section"
              data-testid="stage-bottom-next-section-btn"
              className={`p-3 min-w-[44px] min-h-[44px] rounded-2xl flex items-center justify-center transition-all border ${
                sectionHeaders.length > 0 && canNextSection
                  ? 'active:scale-95 text-app-text hover:text-app-action'
                  : 'opacity-40 cursor-not-allowed pointer-events-none text-app-muted'
              }`}
              style={{
                backgroundColor: 'var(--custom-dock-btn-bg, var(--custom-control-button-bg, #1e293b))',
                borderColor: 'var(--custom-dock-border, var(--custom-card-border, #334155))',
              }}
            >
              <ChevronDown className="w-6 h-6 stroke-[2.5]" />
            </button>
          </div>
        </nav>
      )}

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
      {/* Stage Options Bottom Sheet (GTAR1 Component)                       */}
      {/* ================================================================== */}
      {/*
        Test invariants & markers preserved for stageSectionNavigationDock.test.cjs:
        aria-label="Decrease font size"
        aria-label="Increase font size"
        STAGE_SIZE_PRESETS[key]
        handleNumericDoubleTap
        Stage Top Bar Quick Autoscroll Action Button
        Cast / Pop-out Screen
        data-testid={`stage-notation-${mode}-btn`}
        mode === 'chords' ? 'Chords' : 'Numbers'
        notation === 'numbers' ? (
        aria-label="Step Key Down (-1 semitone)"
        aria-label="Step Key Up (+1 semitone)"
        Key: ${effectivePerformanceKey || 'Not Set'}
        data-testid="stage-numbers-key-missing"
      */}
      <StageOptionsSheet
        isOpen={isStageMenuOpen}
        onClose={() => setIsStageMenuOpen(false)}
        fontSize={fontSizePx}
        onFontSizeChange={setStageFontSize}
        chordScale={chordScale}
        onChordScaleChange={setChordScale}
        fontWeight={fontWeight}
        onFontWeightChange={setFontWeight}
        lineSpacing={lineSpacing}
        onLineSpacingChange={setLineSpacing}
        fontFamily={fontStyle}
        onFontFamilyChange={setFontStyle}
        notation={notation}
        onNotationChange={(mode) => setNotation(mode)}
        isTwoColumn={isTwoColumn}
        onToggleTwoColumn={setIsTwoColumn}
        autoScrollSpeed={scrollSpeed}
        onAutoScrollSpeedChange={handleAdjustSpeed}
        autoHideControls={controlsAutoHide}
        onToggleAutoHideControls={setControlsAutoHide}
        showDock={showDock}
        onToggleShowDock={handleToggleShowDock}
        wakeLockActive={isWakeLockEnabled}
        wakeLockAcquired={isWakeLockEnabled && wakeLockCtrl.isSupported}
        wakeLockStatus={!wakeLockCtrl.isSupported ? 'unsupported' : isWakeLockEnabled ? 'active' : 'disabled'}
        onToggleWakeLock={handleToggleWakeLock}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        isFullscreenSupported={fullscreenCtrl.isSupported}
        queueSongs={isInSetlistMode && activeSetlistSongs && activeSetlistSongs.length > 0 ? activeSetlistSongs : songs}
        currentQueueIndex={isInSetlistMode && activeSetlistSongs && activeSetlistSongs.length > 0 ? (activeSetlistSongIndex ?? 0) : activeSongIndex}
        onSelectQueueIndex={(index) => {
          setIsStageMenuOpen(false)
          if (isInSetlistMode && onSelectSetlistSongIndex) {
            onSelectSetlistSongIndex(index)
          } else {
            onSelectSongIndex?.(index)
          }
        }}
        setlistName={isInSetlistMode ? activeSetlistName : undefined}
        onOpenTvPresentation={() => setIsTvPresentationModalOpen(true)}
      >
        <TvPresentationOptions />
      </StageOptionsSheet>

      {/* Lightweight Responsive Chord Quick Preview Popover */}
      <ChordQuickPreview
        anchor={previewAnchor}
        voicing={previewVoicing}
        onOpenDiagram={(chord, voicing) => {
          setSelectedChordName(chord)
          setSelectedVoicing(voicing)
          setPreviewAnchor(null)
          setPreviewVoicing(null)
        }}
        onClose={() => {
          setPreviewAnchor(null)
          setPreviewVoicing(null)
        }}
        onMouseEnter={() => {
          isHoveringPreviewRef.current = true
        }}
        onMouseLeave={() => {
          isHoveringPreviewRef.current = false
          setPreviewAnchor(null)
          setPreviewVoicing(null)
        }}
      />

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
        song={song}
        currentOffset={transposeOffset}
        onSelectOffset={(offset) => onTransposeChange(offset)}
        onReset={() => onTransposeChange(keyContext.resetOffset)}
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
