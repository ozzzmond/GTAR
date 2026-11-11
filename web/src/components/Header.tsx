import type { SetlistFolder } from '../types/gtar'
import { recoveryDotClass, useRecoveryAttention } from '../utils/recoveryAttention'
import { OPEN_BACKUP_CENTER_EVENT } from '../utils/backupCenter'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { SearchResults } from './SearchResults'
import {
  Search,
  X,
  Globe,
  Palette,
  Wrench,
  Command,
  Trash2,
  Download,
  Terminal,
  Menu,
  Sun,
  Moon,
  Settings,
  FolderArchive,
  Info,
  Layers,
} from 'lucide-react'
import {
  SETTINGS_KEYS,
  SETTINGS_CHANGED,
  type ThemeMode,
  type ThemeModeAssignments,
  type CustomThemeColors,
  DEFAULT_CUSTOM_COLORS,
  DEFAULT_THEME_MODE_ASSIGNMENTS,
  loadThemeModeAssignments,
  getThemeAssignedRole,
  isLightTheme,
} from '../utils/backupSettings'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import {
  GTAR_APP_VERSION,
  GTAR_PREVIEW_IDENTITY,
  GTAR_DEV_VERSION,
  GTAR_DEV_PROVENANCE,
} from '../types/gtar'

import {
  formatDevDiagLine1,
  formatDevDiagLine2,
  formatHeaderVersion,
  formatPreviewIdentity,
} from '../utils/headerFormatters'
import {
  searchOnlineChords,
  type OnlineChordResult,
  type FetchedChordSheet,
} from '../utils/onlineSearch'
import { setOnlineSourcesEnabled, useOnlineSourcesEnabled } from '../utils/onlineSources'
import { ChordPreviewModal } from './ChordPreviewModal'
import { DebugLogsModal } from './DebugLogsModal'
import { AboutModal } from './AboutModal'
import { CloudSyncModal } from './CloudSyncModal'
import { resolveThemePalette } from './ThemeModal'
import devMascot from '../assets/bebegirl1-transparent.png'
import prodMascot from '../assets/bebeboy-transparent.png'
import { isDevEnv } from '../utils/env'
import type { SyncLibrary } from '../utils/syncMerge'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function getLuminance(hex: string): number {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return 0
  const channels = [0, 2, 4].map((offset) => {
    const val = parseInt(clean.substring(offset, offset + 2), 16) / 255
    return val <= 0.04045 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1)
  const l2 = getLuminance(hex2)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function resolveAccessibleIconColor(bgHex: string, candidateHex?: string, fallbackTextHex?: string): string {
  if (candidateHex && getContrastRatio(candidateHex, bgHex) >= 3.0) {
    return candidateHex
  }
  if (fallbackTextHex && getContrastRatio(fallbackTextHex, bgHex) >= 3.0) {
    return fallbackTextHex
  }
  const contrastWhite = getContrastRatio('#FFFFFF', bgHex)
  const contrastBlack = getContrastRatio('#000000', bgHex)
  return contrastWhite >= contrastBlack ? '#FFFFFF' : '#000000'
}

interface HeaderProps {
  activeView: 'songbook' | 'editor' | 'stage' | 'trash'
  onViewChange: (view: 'songbook' | 'editor' | 'stage' | 'trash') => void
  song: ActiveSongState
  allSongs?: ActiveSongState[]
  songsCount?: number
  deletedSongsCount?: number
  activeSongIndex?: number
  queueMode?: 'library' | 'setlist'
  activeSetlistSongsCount?: number
  activeSetlistSongIndex?: number
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onSelectSearchSong?: (songIndex: number) => void
  onSearchWebExternal?: (query: string) => void
  onNavigateHome?: () => void
  onOpenWebsiteUrlSource: () => void
  onOpenStageTools: () => void
  onToggleTheme: () => void
  onOpenStageSettings?: () => void
  onOpenImportModal: () => void
  /** Library (songs including trash) for the Backup & Restore center's file card. */
  backupSongs?: ActiveSongState[]
  onImportAllSongs?: (songs: Array<Partial<ActiveSongState>>) => void
  /** #303: reports whether a header-owned dialog (Backup & Restore center, debug logs) is open, so Stage shortcuts pause. */
  onOverlayChange?: (open: boolean) => void
  onOpenSetlistDrawer?: () => void
  isExplorerOpen?: boolean
  shortcutsBlocked?: boolean
  folders?: SetlistFolder[]
  setlists?: WebSetlist[]
  activeSetlistId?: string | number | null
  activeSetlistName?: string
  activeSetlistSongs?: Array<{ title: string; artist?: string; key?: string }>
  onSelectSetlistSong?: (setlistId: string | number, songIdx: number) => void
  onSelectSetlist?: (setlistId: string | number) => void
  onPushSetlistToBandSync?: (setlistId?: string | number) => void
  onDirectImportOnlineSong?: (sheet: FetchedChordSheet, openStage?: boolean) => void
  onCloudRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[], folders?: SetlistFolder[]) => void | Promise<void>
  onCloudMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[], folders?: SetlistFolder[]) => void | Promise<void>
  onCloudSyncApplied?: (updatedLibrary: SyncLibrary) => void
  /** RFC #188 S6: pause automatic sync (editor open, cross-tab conflict). */
  autoSyncBlocked?: boolean
  onOpenCast?: () => void
  isCastActive?: boolean
  /** #319 (GTAR1 header): New Song action and the Songbook ↔ Setlists switcher. */
  onNewSong?: () => void
  activeSection?: 'songs' | 'setlists' | null
  onOpenSection?: (section: 'songs' | 'setlists') => void
  currentTheme?: ThemeMode
  themeModeAssignments?: ThemeModeAssignments
  onToggleThemeMode?: () => void
  customColors?: CustomThemeColors
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onViewChange,
  allSongs = [],
  deletedSongsCount = 0,
  searchQuery,
  onSearchQueryChange,
  onSelectSearchSong,
  onSearchWebExternal,
  onNavigateHome,
  onOpenWebsiteUrlSource,
  onOpenStageTools,
  onToggleTheme,
  onOpenImportModal,
  backupSongs,
  onImportAllSongs,
  onOverlayChange,
  onOpenSetlistDrawer,
  isExplorerOpen = false,
  shortcutsBlocked = false,
  setlists = [],
  folders,
  onSelectSetlistSong,
  onSelectSetlist,
  onDirectImportOnlineSong,
  onCloudSyncApplied,
  onCloudRestore,
  onCloudMerge,
  autoSyncBlocked = false,
  onOpenCast,
  isCastActive = false,
  currentTheme,
  themeModeAssignments,
  onToggleThemeMode,
  customColors,
}) => {
  void activeView
  void onOpenStageTools
  void onOpenCast
  void isCastActive
  const [showBackupRestoreModal, setShowBackupRestoreModal] = useState(false)
  const [showDebugLogsModal, setShowDebugLogsModal] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [showAdvancedTools, setShowAdvancedTools] = useState(false)

  const effectiveTheme: ThemeMode = currentTheme ||
    (typeof localStorage !== 'undefined' ? (localStorage.getItem(SETTINGS_KEYS.themeMode) as ThemeMode | null) : null) ||
    'solarized-dark'
  const effectiveAssignments: ThemeModeAssignments = themeModeAssignments ||
    (typeof localStorage !== 'undefined' ? loadThemeModeAssignments() : DEFAULT_THEME_MODE_ASSIGNMENTS)
  const activeRole = getThemeAssignedRole(effectiveTheme, effectiveAssignments)
  const isCurrentLight = activeRole === 'light' || (activeRole === null && isLightTheme(effectiveTheme, customColors))
  const targetRole = isCurrentLight ? 'dark' : 'light'
  const modeSwitchLabel = targetRole === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'
  const destTheme: ThemeMode = targetRole === 'light' ? effectiveAssignments.light : effectiveAssignments.dark

  const [isModeHovered, setIsModeHovered] = useState(false)
  const [isModeFocused, setIsModeFocused] = useState(false)
  const [settingsSeq, setSettingsSeq] = useState(0)

  useEffect(() => {
    const onSettings = () => setSettingsSeq((s) => s + 1)
    window.addEventListener(SETTINGS_CHANGED, onSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED, onSettings)
  }, [])

  const effectiveCustomColors = useMemo(() => {
    void settingsSeq
    if (customColors) return customColors
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEYS.customThemeColors) || 'null')
        if (saved && typeof saved === 'object') return saved
      } catch { /* ignore */ }
    }
    return DEFAULT_CUSTOM_COLORS
  }, [customColors, settingsSeq])

  const destColors = useMemo(() => {
    void settingsSeq
    try {
      if (typeof resolveThemePalette === 'function') {
        const resolved = resolveThemePalette(destTheme, effectiveCustomColors)
        if (resolved && typeof resolved === 'object' && resolved.bgHex) {
          return resolved
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_CUSTOM_COLORS
  }, [destTheme, effectiveCustomColors, settingsSeq])

  const safeDest = destColors || DEFAULT_CUSTOM_COLORS
  const destBg = safeDest.bgHex || (targetRole === 'light' ? '#f4ecd8' : '#002B36')
  const destBorder = safeDest.cardBorder || safeDest.searchBorder || (targetRole === 'light' ? '#ded3ba' : '#073642')
  const destAction = safeDest.actionColor || safeDest.uiLinkText || (targetRole === 'light' ? '#268bd2' : '#2AA198')
  const destIconColor = useMemo(() => {
    return resolveAccessibleIconColor(destBg, destAction, safeDest.textHex)
  }, [destBg, destAction, safeDest.textHex])

  const modeButtonStyle: React.CSSProperties = {
    backgroundColor: destBg,
    borderColor: isModeHovered || isModeFocused ? destAction : destBorder,
    color: destIconColor,
    boxShadow: isModeFocused ? `0 0 0 2px ${destAction}` : undefined,
  }
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 768)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => { if (mobileSearchOpen) searchInputRef.current?.focus({ preventScroll: true }) }, [mobileSearchOpen])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (shortcutsBlocked || showBackupRestoreModal || showDebugLogsModal || showAboutModal) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        if (target?.closest('dialog, [role=dialog]') || target?.id === 'multi-song-search-input') return
        event.preventDefault()
        if (compact) setMobileSearchOpen(true)
        searchInputRef.current?.focus({ preventScroll: true })
      } else if (event.key === 'Escape') {
        onSearchQueryChange('')
        setIsSearchFocused(false)
        setMobileSearchOpen(false)
        searchInputRef.current?.blur()
        if (compact) searchTriggerRef.current?.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [shortcutsBlocked, compact, onSearchQueryChange, showBackupRestoreModal, showDebugLogsModal, showAboutModal])
  const onlineSourcesEnabled = useOnlineSourcesEnabled()
  const [onlineResults, setOnlineResults] = useState<OnlineChordResult[]>([])
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [isSearchingOnline, setIsSearchingOnline] = useState(false)
  const [previewResult, setPreviewResult] = useState<OnlineChordResult | null>(null)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isAppInstalled, setIsAppInstalled] = useState(false)
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  )

  // Header dialog overlay blocks Stage keyboard/pedal shortcuts
  const showCloudSyncModal = showBackupRestoreModal
  const headerOverlayOpen = showCloudSyncModal || showDebugLogsModal || showAboutModal
  const overlayCallback = useRef(onOverlayChange)
  useEffect(() => { overlayCallback.current = onOverlayChange }, [onOverlayChange])
  useEffect(() => { overlayCallback.current?.(headerOverlayOpen) }, [headerOverlayOpen])
  useEffect(() => () => overlayCallback.current?.(false), [])
  useEffect(() => {
    const open = () => setShowBackupRestoreModal(true)
    window.addEventListener(OPEN_BACKUP_CENTER_EVENT, open)
    return () => window.removeEventListener(OPEN_BACKUP_CENTER_EVENT, open)
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const popoverItem = 'w-full min-h-11 px-3 py-2 rounded-xl bg-app-base hover:bg-app-surface text-app-heading ui-primary-text text-xs font-semibold flex items-center gap-2.5 border border-app-border transition-colors cursor-pointer mb-2'

  // Recovery Data: accessible within Debug Logs
  const isSuperAdmin = false
  const showRecoveryData = isDevEnv || isSuperAdmin || true
  const recoveryAttention = useRecoveryAttention(showRecoveryData)

  // Advanced Tools: future home for optional Web Sources, ProPresenter, and modular integrations
  const advancedTools = (
    <div data-testid="advanced-tools" className="w-full">
      <button
        type="button"
        data-testid="advanced-tools-button"
        aria-expanded={showAdvancedTools}
        onClick={() => setShowAdvancedTools(open => !open)}
        className={`${popoverItem} justify-between`}
      >
        <span className="flex items-center gap-2.5">
          <Wrench className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
          <span>Advanced Tools</span>
        </span>
        <span className="text-app-muted text-[10px]">{showAdvancedTools ? '▲' : '▼'}</span>
      </button>
      {showAdvancedTools && (
        <div className="pl-3 border-l-2 border-app-border/60 my-1 space-y-1">
          <button
            type="button"
            data-testid="profile-web-sources"
            onClick={() => { setShowSettingsMenu(false); onOpenWebsiteUrlSource() }}
            className={popoverItem}
          >
            <Globe className="w-4 h-4 text-app-action shrink-0" />
            <span>Web Sources</span>
          </button>
          <div
            data-testid="settings-propresenter-stub"
            className="w-full min-h-11 px-3 py-2 rounded-xl bg-app-base/40 text-app-muted text-xs flex items-center justify-between border border-app-border/40 opacity-70 mb-2 cursor-not-allowed"
          >
            <span className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-app-muted shrink-0" aria-hidden="true" />
              <span>ProPresenter</span>
            </span>
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-surface text-app-muted ui-secondary-text border border-app-border">Modular</span>
          </div>
        </div>
      )}
    </div>
  )

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      if ('prompt' in e) {
        setDeferredInstallPrompt(e as BeforeInstallPromptEvent)
      }
    }

    const handleAppInstalled = () => {
      setIsAppInstalled(true)
      setDeferredInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialize from the browser display mode after installing the prompt listener.
      setIsAppInstalled(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleTriggerInstall = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt()
      const choice = await deferredInstallPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setDeferredInstallPrompt(null)
        setIsAppInstalled(true)
      }
    } else {
      alert(
        'To install GTAR as a Standalone Stage App:\n\n' +
        '• Chrome/Edge: Click the Install icon in the address bar (or Menu > Install app)\n' +
        '• iOS Safari: Tap Share and select "Add to Home Screen"\n' +
        '• Android: Tap browser menu (⋮) and select "Install app" or "Add to Home Screen"'
      )
    }
  }

  const searchContainerRef = useRef<HTMLElement>(null)
  const settingsMenuContainerRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showSettingsMenu) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSettingsMenu(false)
        settingsButtonRef.current?.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSettingsMenu])

  // Filter matching songs for real-time search dropdown overlay
  const matchingSearchSongs = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase()
    if (!q) return []
    return allSongs
      .map((s, originalIdx) => ({ ...s, originalIdx }))
      .filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.artist && s.artist.toLowerCase().includes(q))
      )
  }, [allSongs, searchQuery])

  // Matching setlists based on setlist name or track names within setlist
  const matchingSearchSetlists = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase()
    if (!q || !setlists) return []
    return setlists.filter((sl) => {
      const matchName = sl.name.toLowerCase().includes(q)
      const matchSong = (sl.songs || []).some(
        (ref) =>
          ref.title?.toLowerCase().includes(q) ||
          (ref.artist && ref.artist.toLowerCase().includes(q))
      )
      return matchName || matchSong
    })
  }, [setlists, searchQuery])

  // Real Online Chord Search (debounced 350ms)
  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (!onlineSourcesEnabled || !trimmed || trimmed.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Invalid search queries synchronously clear prior remote results and request state.
      setOnlineResults([])
      setOnlineError(null)
      setIsSearchingOnline(false)
      return
    }

    setIsSearchingOnline(true)
    setOnlineError(null)
    const timeout = setTimeout(() => {
      searchOnlineChords(trimmed)
        .then((res) => {
          setOnlineResults(res)
          setOnlineError(null)
          setIsSearchingOnline(false)
        })
        .catch((err) => {
          setOnlineResults([])
          setOnlineError(err instanceof Error ? err.message : 'Network error — unable to reach search service')
          setIsSearchingOnline(false)
        })
    }, 350)

    return () => clearTimeout(timeout)
  }, [searchQuery, onlineSourcesEnabled])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false)
      }
      if (settingsMenuContainerRef.current && !settingsMenuContainerRef.current.contains(e.target as Node)) {
        if (settingsButtonRef.current && settingsButtonRef.current.contains(e.target as Node)) {
          return
        }
        setShowSettingsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const dismissResults = () => {
    setIsSearchFocused(false)
    setMobileSearchOpen(false)
  }
  const closeMobileSearch = () => {
    onSearchQueryChange('')
    dismissResults()
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => searchTriggerRef.current?.focus({ preventScroll: true }))
    } else {
      searchTriggerRef.current?.focus({ preventScroll: true })
    }
  }
  const resultsPanel = (
    <SearchResults
      songs={matchingSearchSongs}
      setlists={matchingSearchSetlists}
      online={onlineResults}
      isSearchingOnline={isSearchingOnline}
      isOffline={isOffline}
      onlineError={onlineError}
      onSelectSong={(originalIdx) => {
        dismissResults()
        onSelectSearchSong?.(originalIdx)
        onViewChange('stage')
      }}
      onSelectSetlist={(sl) => {
        dismissResults()
        if (onSelectSetlistSong && (sl.songs || []).length > 0) {
          onSelectSetlistSong(sl.id, 0)
          onViewChange('stage')
        } else {
          onSelectSetlist?.(sl.id)
        }
      }}
      onPreviewOnline={(result) => { dismissResults(); setPreviewResult(result) }}
      onOpenImport={() => { dismissResults(); onOpenImportModal() }}
      onOpenSources={() => {
        dismissResults()
        if (onSearchWebExternal && searchQuery.trim()) onSearchWebExternal(searchQuery)
        else onOpenWebsiteUrlSource()
      }}
    />
  )
  const showResults = isSearchFocused && searchQuery.trim().length > 0
  const isProductionRelease = GTAR_APP_VERSION !== '0.0.0-unversioned' && !GTAR_PREVIEW_IDENTITY && !isDevEnv
  const mascotSrc = isProductionRelease ? prodMascot : devMascot

  const devDiagnostics = (inline: boolean) => isDevEnv && (
    <div
      data-testid={inline ? 'dev-header-diagnostics' : 'dev-header-diagnostics-compact'}
      className={inline
        ? 'hidden sm:flex flex-col justify-center border-l border-app-border/40 pl-2 sm:pl-3 text-[9px] sm:text-[10px] font-mono leading-tight header-primary-text text-app-heading tracking-tight select-none min-w-0 max-w-[35vw]'
        : 'sm:hidden pt-1 text-center text-[9px] font-mono leading-tight header-primary-text text-app-heading tracking-tight select-none truncate w-full'}
    >
      <span data-testid={inline ? 'dev-header-diag-line1' : undefined} className={inline ? 'truncate whitespace-nowrap' : ''}>
        {formatDevDiagLine1(GTAR_DEV_PROVENANCE, GTAR_DEV_VERSION)}
      </span>
      {!inline && ' · '}
      <span data-testid={inline ? 'dev-header-diag-line2' : undefined} className={inline ? 'truncate whitespace-nowrap' : ''}>
        {formatDevDiagLine2(GTAR_DEV_PROVENANCE)}
      </span>
    </div>
  )

  return (
    <>
      <header className="bg-app-header border-b border-app-border sticky top-0 z-40 flex flex-col select-none max-w-full">
      {/* Row 1 (GTAR1 header) — the compact search overlay covers this row only */}
      <div className="relative px-2 sm:px-3 py-2 sm:py-2.5">
      <div className="flex items-center justify-between gap-1 sm:gap-4">
        {/* Left: Explorer drawer toggle & GTAR branding (DEV deployment details / PROD version stay visible) */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-3 min-w-0">
          <button type="button" aria-label="Open Music Explorer" aria-expanded={isExplorerOpen}
            onClick={onOpenSetlistDrawer}
            className="md:hidden relative flex w-9 h-9 items-center justify-center rounded-xl header-neutral-icon text-app-text hover:text-app-heading hover:bg-app-base transition-colors shrink-0 before:absolute before:-inset-1 before:content-['']">
            {isExplorerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button type="button" onClick={onNavigateHome} aria-label="GTAR home"
            className="flex sm:flex-row flex-col items-center sm:gap-2 gap-0 text-center sm:text-left group min-h-9 cursor-pointer shrink-0">
            <div className="w-10 h-10 rounded-xl border border-app-border bg-app-base overflow-hidden flex items-center justify-center shadow-sm shrink-0 group-hover:opacity-90 transition-all">
              <img src={mascotSrc} alt="GTAR Logo"
                className="w-full h-full object-contain p-0 select-none scale-110" />
            </div>
            <div className="hidden sm:flex items-center">
              <span className="text-base font-extrabold header-primary-text text-app-heading tracking-tight group-hover:text-app-link transition-colors">
                GTAR
              </span>
              {(isDevEnv || GTAR_PREVIEW_IDENTITY) && (
                <span className="ml-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-accent/25 text-app-accent border border-app-accent/40">DEV</span>
              )}
            </div>
          </button>
          {devDiagnostics(true)}
          {GTAR_PREVIEW_IDENTITY && (
            <div
              className="hidden sm:flex flex-col justify-center border-l border-app-border/40 pl-2 sm:pl-3 text-[9px] sm:text-[10px] font-mono leading-tight header-primary-text text-app-heading tracking-tight select-none min-w-0 max-w-[35vw]"
            >
              <span data-testid="header-preview-identity" className="truncate whitespace-nowrap">
                {formatPreviewIdentity(GTAR_PREVIEW_IDENTITY)}
              </span>
            </div>
          )}
        </div>

        {/* Center: desktop search (GTAR1 design) */}
        {!compact && (
          <form ref={(node) => { searchContainerRef.current = node }} role="search" aria-label="Global song search"
            onSubmit={(event) => event.preventDefault()} className="relative flex flex-1 min-w-0 max-w-[36rem] mx-1 sm:mx-2">
            <div className={`header-search-box relative flex min-w-0 w-full items-center transition-all duration-200 rounded-xl border bg-app-surface ${
              isSearchFocused ? 'border-app-accent ring-2 ring-app-accent/20' : 'border-app-border hover:border-app-border/80'}`}>
              <div className="pl-3.5 pr-2 pointer-events-none shrink-0">
                <Search className={`w-4 h-4 transition-colors ${isSearchFocused ? 'text-app-accent' : 'header-neutral-icon text-app-muted'}`} />
              </div>
              <input id="search-input" ref={searchInputRef} type="text" maxLength={200}
                aria-label="Search songs, artists and setlists" aria-controls="global-search-results"
                value={searchQuery}
                onFocus={() => setIsSearchFocused(true)}
                onChange={(e) => { onSearchQueryChange(e.target.value); setIsSearchFocused(true) }}
                placeholder="Search songs & setlists... (Esc to clear)"
                className="header-search-input min-h-[36px] min-w-0 w-full py-1.5 pr-2 border-0 bg-transparent text-xs text-app-text placeholder:text-app-muted focus:outline-none focus:ring-0 shadow-none" />
              {searchQuery && (
                <button type="button" aria-label="Clear search"
                  onClick={() => { onSearchQueryChange(''); searchInputRef.current?.focus({ preventScroll: true }) }}
                  className="min-h-9 min-w-9 mr-0.5 flex items-center justify-center header-neutral-icon text-app-muted hover:text-app-heading transition-colors shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="pr-2 shrink-0 hidden md:flex items-center">
                <kbd className="header-search-kbd inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-app-muted bg-app-base border border-app-border rounded select-none pointer-events-none"
                 >
                  <Command className="w-2.5 h-2.5" /> K
                </kbd>
              </div>
            </div>
            {showResults && <div className="absolute top-full left-0 right-0 pt-2 z-50">{resultsPanel}</div>}
          </form>
        )}

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {compact && (
            <button ref={searchTriggerRef} type="button" aria-label="Open search"
              onClick={() => setMobileSearchOpen(true)}
              className={`ui-button mobile-search-trigger relative flex w-9 h-9 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-base text-app-action hover:border-app-action transition-colors active:scale-95 cursor-pointer before:absolute before:-inset-1 before:content-[''] ${
                searchQuery ? 'text-app-accent border-app-accent' : ''}`}>
              <Search className="w-5 h-5" />
            </button>
          )}

          {/* Light/Dark mode switch, placed immediately beside the first header action */}
          <button
            type="button"
            data-testid="header-theme-mode-toggle"
            data-mode={activeRole ?? 'unassigned'}
            aria-label={modeSwitchLabel}
            onClick={onToggleThemeMode}
            onMouseEnter={() => setIsModeHovered(true)}
            onMouseLeave={() => setIsModeHovered(false)}
            onFocus={() => setIsModeFocused(true)}
            onBlur={() => setIsModeFocused(false)}
            style={modeButtonStyle}
            className="relative flex w-9 h-9 shrink-0 items-center justify-center rounded-xl border cursor-pointer transition-colors active:scale-95 before:absolute before:-inset-1 before:content-['']"
          >
            {targetRole === 'dark' ? (
              <Moon className="w-5 h-5 shrink-0" aria-hidden="true" style={{ color: destIconColor }} />
            ) : (
              <Sun className="w-5 h-5 shrink-0" aria-hidden="true" style={{ color: destIconColor }} />
            )}
          </button>

          {deferredInstallPrompt && !isAppInstalled && !compact && (
            <button type="button" onClick={handleTriggerInstall} aria-label="Install GTAR App to Home Screen"
              className="relative flex w-9 h-9 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-base text-app-action hover:border-app-action transition-colors cursor-pointer before:absolute before:-inset-1 before:content-['']">
              <Download className="w-5 h-5 header-neutral-icon text-app-action" />
            </button>
          )}

          {/* Settings Gear Button & Dropdown */}
          <div ref={settingsMenuContainerRef} className="avatar-wrapper flex items-center justify-center shrink-0">
            <button
              ref={settingsButtonRef}
              type="button"
              aria-label="Settings"
              aria-haspopup="menu"
              aria-expanded={showSettingsMenu}
              data-testid="header-settings"
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
              className="relative w-9 h-9 shrink-0 rounded-xl border border-app-border bg-app-base hover:border-app-action flex items-center justify-center cursor-pointer transition-colors active:scale-95 before:absolute before:-inset-1 before:content-['']"
            >
              <Settings className="w-5 h-5 text-app-action header-neutral-icon" aria-hidden="true" />
            </button>

            {showSettingsMenu && (
              <div
                role="menu"
                aria-label="Settings"
                className="avatar-popover animate-scale-in"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-1 py-1.5 mb-2 border-b border-app-border/60 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-app-accent" aria-hidden="true" />
                  <span className="text-xs font-bold text-app-heading">Settings</span>
                </div>

                {/* 1. Theme */}
                <button
                  type="button"
                  data-testid="settings-theme-button"
                  onClick={() => { setShowSettingsMenu(false); onToggleTheme() }}
                  className={popoverItem}
                >
                  <Palette className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
                  <span>Theme</span>
                </button>

                {/* 2. Backup / Restore */}
                <button
                  type="button"
                  data-testid="settings-backup-restore-button"
                  onClick={() => { setShowSettingsMenu(false); setShowBackupRestoreModal(true) }}
                  className={popoverItem}
                >
                  <FolderArchive className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
                  <span>Backup &amp; Restore</span>
                </button>

                {/* Online song sources: opt-in, off by default */}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={onlineSourcesEnabled}
                  data-testid="settings-online-sources"
                  onClick={() => setOnlineSourcesEnabled(!onlineSourcesEnabled)}
                  className={`${popoverItem} justify-between`}
                >
                  <div className="flex items-center gap-2.5">
                    <Globe className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
                    <span>Online song sources</span>
                  </div>
                  <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none bg-app-surface border border-app-border text-app-muted font-mono">
                    {onlineSourcesEnabled ? 'On' : 'Off'}
                  </span>
                </button>

                {/* 3. Debug Logs (includes Recovery Data management) */}
                <button
                  type="button"
                  data-testid="settings-debug-logs"
                  onClick={() => { setShowSettingsMenu(false); setShowDebugLogsModal(true) }}
                  className={`${popoverItem} justify-between`}
                  aria-label={recoveryAttention ? "Debug Logs and Recovery Data, some recovery copies can't be opened" : undefined}
                >
                  <div className="flex items-center gap-2.5">
                    <Terminal className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
                    <span>Debug Logs</span>
                  </div>
                  {recoveryAttention && <span data-testid="settings-debug-logs-dot" aria-hidden="true" className={recoveryDotClass} />}
                </button>

                {/* 4. Advanced Tools */}
                {advancedTools}

                {/* 5. About GTAR */}
                <button
                  type="button"
                  data-testid="settings-about-button"
                  onClick={() => { setShowSettingsMenu(false); setShowAboutModal(true) }}
                  className={popoverItem}
                >
                  <Info className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
                  <span>About GTAR</span>
                </button>

                {/* Mobile/compact Trash */}
                <button
                  type="button"
                  data-testid="profile-trash-button"
                  aria-label={`Trash${deletedSongsCount > 0 ? ` (${deletedSongsCount})` : ''}`}
                  onClick={() => { setShowSettingsMenu(false); onViewChange('trash') }}
                  className={`md:hidden ${popoverItem} justify-between`}
                >
                  <div className="flex items-center gap-2.5">
                    <Trash2 className="w-4 h-4 text-app-action shrink-0" />
                    <span>Trash</span>
                  </div>
                  {deletedSongsCount > 0 && (
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none bg-app-surface border border-app-border text-app-muted font-mono">
                      {deletedSongsCount}
                    </span>
                  )}
                </button>

                {!isAppInstalled && (
                  <button
                    type="button"
                    data-testid="profile-install-app"
                    onClick={() => { setShowSettingsMenu(false); handleTriggerInstall() }}
                    className={popoverItem}
                  >
                    <Download className="w-4 h-4 text-app-action shrink-0" />
                    <span>Install App (PWA)</span>
                  </button>
                )}

                <div data-testid="profile-app-version" className="header-secondary-text pt-2 text-center text-[10px] font-mono text-app-muted select-none border-t border-app-border/40 mt-2">
                  {formatHeaderVersion(isDevEnv, GTAR_DEV_VERSION, GTAR_APP_VERSION)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {isDevEnv ? (
        devDiagnostics(false)
      ) : GTAR_PREVIEW_IDENTITY ? (
        <div
          data-testid="header-prod-version-compact"
          className="sm:hidden pt-1 text-center text-[9px] font-mono leading-tight header-secondary-text text-app-muted tracking-tight select-none truncate w-full"
        >
          {formatPreviewIdentity(GTAR_PREVIEW_IDENTITY)}
        </div>
      ) : null}

      {/* Compact full-width search overlay (GTAR1): the field takes over the header with Cancel */}
      {compact && mobileSearchOpen && (
        <div ref={(node) => { searchContainerRef.current = node }} role="search" aria-label="Mobile expanded song search"
          className="mobile-search-overlay absolute inset-0 z-50 flex items-center gap-2 px-3 bg-app-header border-b border-app-border animate-scale-in">
          <div className="header-search-box flex-1 relative flex items-center min-w-0 rounded-xl bg-app-surface border border-app-accent ring-2 ring-app-accent/20 px-3">
            <Search className="w-4 h-4 text-app-accent mr-2 shrink-0 pointer-events-none" />
            <input id="search-input" ref={searchInputRef} type="text" maxLength={200}
              aria-label="Search songs, artists and setlists" aria-controls="global-search-results"
              value={searchQuery}
              onFocus={() => setIsSearchFocused(true)}
              onChange={(e) => { onSearchQueryChange(e.target.value); setIsSearchFocused(true) }}
              placeholder="Search songs & setlists..."
              className="header-search-input min-h-11 w-full border-0 bg-transparent text-xs text-app-text placeholder:text-app-muted font-medium focus:outline-none focus:ring-0 shadow-none" />
            {searchQuery && (
              <button type="button" aria-label="Clear search"
                onClick={() => { onSearchQueryChange(''); searchInputRef.current?.focus({ preventScroll: true }) }}
                className="min-h-9 min-w-9 flex items-center justify-center header-neutral-icon text-app-muted hover:text-app-heading transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button type="button" onClick={closeMobileSearch} aria-label="Cancel search"
            className="min-h-11 px-2.5 text-xs font-semibold text-app-muted hover:text-app-heading transition-colors shrink-0 flex items-center justify-center">
            Cancel
          </button>
          {showResults && <div className="absolute top-full left-0 right-0 px-3 pt-2">{resultsPanel}</div>}
        </div>
      )}
      </div>

      </header>

      {/* Real Chord Preview & Direct Import Modal */}
      <ChordPreviewModal
        isOpen={Boolean(previewResult)}
        onClose={() => setPreviewResult(null)}
        result={previewResult}
        onImportSong={(sheet: FetchedChordSheet, openStage?: boolean) => {
          if (onDirectImportOnlineSong) {
            onDirectImportOnlineSong(sheet, openStage)
          }
        }}
      />

      {/* In-Browser Debug Logs Modal */}
      <DebugLogsModal
        isOpen={showDebugLogsModal}
        onClose={() => setShowDebugLogsModal(false)}
      />

      {/* About GTAR Modal */}
      <AboutModal
        isOpen={showAboutModal}
        onClose={() => setShowAboutModal(false)}
      />

      {/* Backup & Restore Modal */}
      <CloudSyncModal
        folders={folders}
        isOpen={showBackupRestoreModal}
        onClose={() => setShowBackupRestoreModal(false)}
        onSyncApplied={onCloudSyncApplied}
        restoreBlocked={autoSyncBlocked}
        deviceSongs={backupSongs}
        deviceSetlists={backupSongs ? setlists : undefined}
        onImportAllSongs={onImportAllSongs}
        onFullRestore={onCloudRestore}
        onSmartMerge={onCloudMerge}
      />
    </>
  )
}
