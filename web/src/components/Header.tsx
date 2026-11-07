import type { SetlistFolder } from '../types/gtar'
import { recoveryDotClass, useRecoveryAttention } from '../utils/recoveryAttention'
import { openRecoveryData } from '../utils/recoveryReview'
import { SyncStatusPill } from './SyncStatusPill'
import { useCloudBackupBadge } from '../utils/cloudBackupBadge'
import { cloudBackupStatus } from '../utils/syncStatus'
import { OPEN_BACKUP_CENTER_EVENT } from '../utils/backupCenter'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { SearchResults } from './SearchResults'
import {
  Search,
  X,
  Globe,
  Palette,
  Wrench,
  History,
  Command,
  Trash2,
  Download,
  Terminal,
  LogOut,
  User,
  Shield,
  Menu,
  Sun,
  Moon,
  Music,
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
import { sharedCatalogService } from '../utils/sharedCatalogService'
import { cloneSharedCatalogSongToPersonal } from '../utils/sharedCatalogImport'
import type { SharedCatalogSongItem } from '../types/sharedCatalog'
import {
  searchOnlineChords,
  type OnlineChordResult,
  type FetchedChordSheet,
} from '../utils/onlineSearch'
import { ChordPreviewModal } from './ChordPreviewModal'
import { DebugLogsModal } from './DebugLogsModal'
import { UserManagementModal } from './UserManagementModal'
import { CloudSyncModal } from './CloudSyncModal'
import { resolveThemePalette } from './ThemeModal'
import { primaryButton, secondaryButton, sectionCard, sectionLabel } from './backupCenterUi'
import devMascot from '../assets/bebegirl1-transparent.png'
import prodMascot from '../assets/bebeboy-transparent.png'
import { isDevEnv } from '../utils/env'
import { useGoogleAuth } from './AuthGate'
import type { GoogleSession } from '../utils/googleAuth'
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
  onImportSharedCatalogSong?: (song: ActiveSongState) => boolean | Promise<boolean>
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
  onImportSharedCatalogSong,
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
  const [showCloudSyncModal, setShowCloudSyncModal] = useState(false)
  const [showDebugLogsModal, setShowDebugLogsModal] = useState(false)

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
      if (shortcutsBlocked || showCloudSyncModal || showDebugLogsModal) return
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
  }, [shortcutsBlocked, compact, onSearchQueryChange, showCloudSyncModal, showDebugLogsModal])
  const [onlineResults, setOnlineResults] = useState<OnlineChordResult[]>([])
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [isSearchingOnline, setIsSearchingOnline] = useState(false)
  const [previewResult, setPreviewResult] = useState<OnlineChordResult | null>(null)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isAppInstalled, setIsAppInstalled] = useState(false)
  const [showUserManagementModal, setShowUserManagementModal] = useState(false)
  const [showAvatarPopover, setShowAvatarPopover] = useState(false)
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  )

  const [showAdvancedTools, setShowAdvancedTools] = useState(false)
  // #303: the center (with its restore preview) and the debug-log dialog block Stage keyboard/pedal shortcuts.
  const headerOverlayOpen = showCloudSyncModal || showDebugLogsModal
  const overlayCallback = useRef(onOverlayChange)
  useEffect(() => { overlayCallback.current = onOverlayChange }, [onOverlayChange])
  useEffect(() => { overlayCallback.current?.(headerOverlayOpen) }, [headerOverlayOpen])
  useEffect(() => () => overlayCallback.current?.(false), [])
  useEffect(() => {
    const open = () => setShowCloudSyncModal(true)
    window.addEventListener(OPEN_BACKUP_CENTER_EVENT, open)
    return () => window.removeEventListener(OPEN_BACKUP_CENTER_EVENT, open)
  }, [])
  const [backupClock, setBackupClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setBackupClock(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  // Shared Catalog search state
  const [catalogResults, setCatalogResults] = useState<SharedCatalogSongItem[]>([])
  const [isSearchingCatalog, setIsSearchingCatalog] = useState(false)
  const [previewCatalogSong, setPreviewCatalogSong] = useState<SharedCatalogSongItem | null>(null)
  const [importingCatalogId, setImportingCatalogId] = useState<string | null>(null)
  const [importedCatalogIds, setImportedCatalogIds] = useState<Set<string>>(() => new Set())

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

  // Retrieve user role & auth state from AuthGate context
  let isSuperAdmin = false
  let backupAccessActive = false
  let currentSession: GoogleSession | null = null
  let handleSignOut: (() => void) | undefined
  let handleSignIn: (() => Promise<void>) | undefined
  try {
    const auth = useGoogleAuth()
    isSuperAdmin = auth.isSuperAdmin
    currentSession = auth.session
    backupAccessActive = auth.accessStatus === 'active'
    handleSignOut = auth.signOut
    handleSignIn = auth.signIn
  } catch {
    // Header rendered outside AuthGate (e.g. isolated test or preview)
  }

  const backupToken = currentSession?.sessionToken || currentSession?.idToken || currentSession?.token || ''
  const backupSignedIn = Boolean(backupAccessActive && backupToken && currentSession?.user?.id)
  const backupSessionKey = backupSignedIn ? `${currentSession?.user?.id}:${backupToken}` : ''
  const { record: cloudBackup, matches: backupMatches, onBackupSummary } = useCloudBackupBadge(backupSessionKey, showCloudSyncModal)
  const backupStatus = cloudBackupStatus(backupSignedIn, cloudBackup, backupMatches)

  // #299 / #264: developer tools, DEV builds only (never rendered in PROD).
  const advancedItem = 'relative w-full min-h-11 px-3 py-2 rounded-xl bg-app-base hover:bg-app-accent/50 ui-primary-text text-app-heading hover:text-app-action text-xs font-bold flex items-center gap-2 border border-app-border transition-all cursor-pointer mb-2'
  const popoverItem = 'w-full min-h-11 px-3 py-2 rounded-xl bg-app-base hover:bg-app-surface text-app-heading text-xs font-semibold flex items-center gap-2.5 border border-app-border transition-colors cursor-pointer mb-2'
  const advancedTools = isDevEnv ? (
    <div data-testid="advanced-tools">
      <button type="button" data-testid="advanced-tools-button" aria-expanded={showAdvancedTools}
        onClick={() => setShowAdvancedTools(open => !open)} className={`${advancedItem} justify-between`}>
        <span className="flex items-center gap-2"><Wrench className="w-3.5 h-3.5 text-app-accent" aria-hidden="true" />Advanced Tools</span>
        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-status-error/15 text-status-error border border-status-error/30">DEV</span>
      </button>
      {showAdvancedTools && <div className="pl-2 border-l-2 border-app-border/60 mb-2">
        <button type="button" data-testid="advanced-debug-logs" onClick={() => { setShowAvatarPopover(false); setShowDebugLogsModal(true) }} className={advancedItem}>
          <Terminal className="w-3.5 h-3.5 text-app-accent" aria-hidden="true" />Debug logs options
        </button>
      </div>}
    </div>
  ) : null
  // #304: "Recovery data" — DEV, and admins (role === 'admin') in PROD; never other users.
  const showRecoveryData = isDevEnv || isSuperAdmin
  const recoveryAttention = useRecoveryAttention(showRecoveryData)
  const recoveryDataRow = showRecoveryData ? (
    <button type="button" data-testid="profile-recovery-data" onClick={() => { setShowAvatarPopover(false); openRecoveryData() }} className={advancedItem}
      aria-label={recoveryAttention ? 'Recovery data, some copies can\'t be opened' : undefined}>
      <History className="w-3.5 h-3.5 text-app-accent" aria-hidden="true" />Recovery data
      {recoveryAttention && <span data-testid="profile-recovery-data-dot" aria-hidden="true" className={recoveryDotClass} />}
    </button>
  ) : null

  const isDevApp = isDevEnv || isSuperAdmin || import.meta.env.VITE_ENABLE_DEV_LOGS === 'true'

  useEffect(() => {
    if (!isSuperAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Revoked admin access must immediately clear the external pending count.
      setPendingCount(0)
      return
    }
    const token = currentSession?.sessionToken || currentSession?.idToken || currentSession?.token
    if (!token) return

    let active = true
    const fetchPendingCount = async () => {
      try {
        const res = await fetch('/api/admin/pending-count', {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const data = (await res.json()) as { count?: number }
          if (active && typeof data.count === 'number') {
            setPendingCount(data.count)
          }
        }
      } catch {
        // Network or offline: ignore
      }
    }

    void fetchPendingCount()
    const handleUpdate = () => { void fetchPendingCount() }
    window.addEventListener('gtar:auth_updated', handleUpdate)
    window.addEventListener('focus', handleUpdate)
    return () => {
      active = false
      window.removeEventListener('gtar:auth_updated', handleUpdate)
      window.removeEventListener('focus', handleUpdate)
    }
  }, [isSuperAdmin, currentSession])
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

    if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
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
  const avatarPopoverRef = useRef<HTMLDivElement>(null)
  const avatarButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showAvatarPopover) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowAvatarPopover(false)
        avatarButtonRef.current?.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showAvatarPopover])



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
    if (!trimmed || trimmed.length < 2) {
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
  }, [searchQuery])

  // Shared Catalog Search (debounced 350ms, authenticated/cached via sharedCatalogService)
  useEffect(() => {
    const trimmed = searchQuery.trim().toLowerCase()
    if (!trimmed || trimmed.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Invalid search queries synchronously clear prior remote results and request state.
      setCatalogResults([])
      setIsSearchingCatalog(false)
      return
    }

    setIsSearchingCatalog(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      sharedCatalogService
        .getCatalogSongs({ limit: 50, signal: controller.signal })
        .then((res) => {
          const songs = res.songs || []
          const filtered = songs.filter((s) => {
            const matchTitle = (s.title || '').toLowerCase().includes(trimmed)
            const matchArtist = (s.artist || '').toLowerCase().includes(trimmed)
            return matchTitle || matchArtist
          })
          setCatalogResults(filtered)
          setIsSearchingCatalog(false)
        })
        .catch(() => {
          setCatalogResults([])
          setIsSearchingCatalog(false)
        })
    }, 350)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [searchQuery])

  // Import Shared Catalog song to personal library
  const handleImportCatalogSong = (e: React.MouseEvent, song: SharedCatalogSongItem) => {
    e.stopPropagation()
    if (importingCatalogId === song.id) return
    setImportingCatalogId(song.id)
    try {
      const personalClone = cloneSharedCatalogSongToPersonal(song)
      if (onImportSharedCatalogSong) {
        onImportSharedCatalogSong(personalClone)
      }
      setImportedCatalogIds((prev) => new Set(prev).add(song.id))
    } catch (err) {
      console.error('Failed to import shared catalog song:', err)
    } finally {
      setTimeout(() => setImportingCatalogId(null), 1200)
    }
  }

  // Derive auth status indicator color
  const userDotClass = currentSession ? 'synced' : 'error'

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false)
      }
      if (avatarPopoverRef.current && !avatarPopoverRef.current.contains(e.target as Node)) {
        if (avatarButtonRef.current && avatarButtonRef.current.contains(e.target as Node)) {
          return
        }
        setShowAvatarPopover(false)
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
      catalog={catalogResults}
      online={onlineResults}
      isSearchingCatalog={isSearchingCatalog}
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
      onPreviewCatalog={(song) => { dismissResults(); setPreviewCatalogSong(song) }}
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
        : 'sm:hidden pt-1 text-center text-[9px] font-mono leading-tight header-primary-text text-app-heading tracking-tight select-none truncate'}
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
            <div className="w-9 h-9 rounded-xl border border-app-border bg-app-base overflow-hidden flex items-center justify-center shadow-sm shrink-0 group-hover:opacity-90 transition-all">
              <img src={mascotSrc} alt="GTAR Logo"
                className="w-full h-full object-contain p-0 select-none scale-110" />
            </div>
            <div className="hidden sm:flex items-center">
              <span className="text-base font-extrabold header-primary-text text-app-heading tracking-tight group-hover:text-app-link transition-colors">
                GTAR
              </span>
              {GTAR_PREVIEW_IDENTITY ? (
                <span data-testid="header-preview-identity" className="text-[10px] header-secondary-text text-app-muted font-mono ml-2">
                  {formatPreviewIdentity(GTAR_PREVIEW_IDENTITY)}
                </span>
              ) : isDevEnv ? (
                <span className="ml-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-accent/25 text-app-accent border border-app-accent/40">DEV</span>
              ) : null}
            </div>
            {GTAR_PREVIEW_IDENTITY && (
              <span data-testid="header-prod-version-compact" className="sm:hidden text-[9px] leading-tight header-secondary-text text-app-muted font-mono select-none">
                {formatPreviewIdentity(GTAR_PREVIEW_IDENTITY)}
              </span>
            )}
          </button>
          {devDiagnostics(true)}
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

          {/* Cloud status / Backup & Restore (GTAR1 "Backup" slot), with the recovery dot */}
          <SyncStatusPill status={backupStatus} lastBackup={cloudBackup?.updatedAt ?? null} now={backupClock}
            recoveryAttention={recoveryAttention} onClick={() => setShowCloudSyncModal(true)} />

          {deferredInstallPrompt && !isAppInstalled && !compact && (
            <button type="button" onClick={handleTriggerInstall} aria-label="Install GTAR App to Home Screen"
              className="relative flex w-9 h-9 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-base text-app-action hover:border-app-action transition-colors cursor-pointer before:absolute before:-inset-1 before:content-['']">
              <Download className="w-5 h-5 header-neutral-icon text-app-action" />
            </button>
          )}

          {/* Avatar with Auth Status Dot */}
          <div ref={avatarPopoverRef} className="avatar-wrapper flex items-center justify-center shrink-0">
            <button ref={avatarButtonRef} type="button" aria-label={currentSession ? 'Account menu' : 'Sign in and account menu'} aria-haspopup="menu"
              aria-expanded={showAvatarPopover} data-testid="header-avatar"
              onClick={() => setShowAvatarPopover(!showAvatarPopover)}
              className="relative w-9 h-9 shrink-0 rounded-xl flex items-center justify-center cursor-pointer before:absolute before:-inset-1 before:content-['']">
              {currentSession?.user.picture ? (
                <img src={currentSession.user.picture} alt="" referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-xl border-2 border-app-border hover:border-app-action transition-colors object-cover" />
              ) : (
                <span className="w-9 h-9 rounded-xl bg-app-surface border-2 border-app-border hover:border-app-action flex items-center justify-center text-app-muted transition-colors">
                  <User className="w-5 h-5 header-neutral-icon" />
                </span>
              )}
            </button>
            <span className={`auth-dot ${userDotClass}`} />
            {isSuperAdmin && pendingCount > 0 && (
              <span className="pending-badge">{pendingCount > 99 ? '99+' : pendingCount}</span>
            )}

            {showAvatarPopover && (
              <div role="menu" aria-label="Account and application menu" className="avatar-popover animate-scale-in" onClick={(e) => e.stopPropagation()}>
                {currentSession ? (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      {currentSession.user.picture && (
                        <img src={currentSession.user.picture} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-full" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold ui-primary-text text-app-heading truncate">
                            {(currentSession.user as { name?: string }).name || 'User'}
                          </span>
                          {isSuperAdmin ? (
                            <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-app-accent/25 text-app-accent border border-app-accent/30 shrink-0">ADMIN</span>
                          ) : (
                            <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-app-action/20 text-app-action border border-app-action/30 shrink-0">USER</span>
                          )}
                        </div>
                        <div className="text-[10px] ui-secondary-text text-app-muted truncate">{currentSession.user.email}</div>
                      </div>
                    </div>

                    {isSuperAdmin && (
                      <button type="button"
                        onClick={() => { setShowAvatarPopover(false); setShowUserManagementModal(true) }}
                        className="w-full min-h-11 px-3 py-2 rounded-xl bg-app-base hover:bg-app-base/80 text-app-action text-xs font-bold flex items-center justify-center gap-2 border border-app-action/30 transition-all cursor-pointer mb-2">
                        <Shield className="w-3.5 h-3.5" />
                        <span>Manage Users</span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-2 space-y-3 mb-2">
                    <p className="text-xs ui-muted-text text-app-muted">
                      Sign in to use cloud backup and the Shared Catalog.
                    </p>
                    <button type="button"
                      onClick={() => { setShowAvatarPopover(false); void handleSignIn?.() }}
                      className="w-full min-h-11 px-3 py-2 rounded-xl bg-app-action hover:bg-app-action text-app-on-action text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer">
                      <User className="w-3.5 h-3.5" />
                      <span>Sign In with Google</span>
                    </button>
                  </div>
                )}

                <div className="h-[1px] bg-app-border/60 my-2" />

                {/* Relocated App Actions: Theme, Web Sources, Trash (mobile), Install App (PWA) */}
                <button
                  type="button"
                  data-testid="profile-theme-button"
                  onClick={() => { setShowAvatarPopover(false); onToggleTheme() }}
                  className={popoverItem}
                >
                  <Palette className="w-4 h-4 text-app-action shrink-0" />
                  <span>Theme</span>
                </button>

                <button
                  type="button"
                  data-testid="profile-web-sources"
                  onClick={() => { setShowAvatarPopover(false); onOpenWebsiteUrlSource() }}
                  className={popoverItem}
                >
                  <Globe className="w-4 h-4 text-app-action shrink-0" />
                  <span>Web Sources</span>
                </button>

                {/* Mobile/compact Trash */}
                <button
                  type="button"
                  data-testid="profile-trash-button"
                  aria-label={`Trash${deletedSongsCount > 0 ? ` (${deletedSongsCount})` : ''}`}
                  onClick={() => { setShowAvatarPopover(false); onViewChange('trash') }}
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
                    onClick={() => { setShowAvatarPopover(false); handleTriggerInstall() }}
                    className={popoverItem}
                  >
                    <Download className="w-4 h-4 text-app-action shrink-0" />
                    <span>Install App (PWA)</span>
                  </button>
                )}

                {/* Diagnostics and Developer Tools */}
                {isDevApp && !isDevEnv && (
                  <button
                    type="button"
                    data-testid="profile-debug-logs"
                    onClick={() => { setShowAvatarPopover(false); setShowDebugLogsModal(true) }}
                    className={`${advancedItem} justify-between`}
                  >
                    <div className="flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-app-accent" aria-hidden="true" />
                      <span className="font-semibold">Debug Logs</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-status-error/15 text-status-error border border-status-error/30">
                      DIAG
                    </span>
                  </button>
                )}

                {recoveryDataRow}
                {advancedTools}

                {currentSession && (
                  <>
                    <div className="h-[1px] bg-app-border/60 my-2" />
                    <button type="button"
                      onClick={() => { setShowAvatarPopover(false); handleSignOut?.() }}
                      className="w-full min-h-11 px-3 py-2 rounded-xl hover:bg-app-base text-status-error text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer">
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </>
                )}

                <div data-testid="profile-app-version" className="header-secondary-text pt-2 text-center text-[10px] font-mono text-app-muted select-none border-t border-app-border/40 mt-2">
                  {formatHeaderVersion(isDevEnv, GTAR_DEV_VERSION, GTAR_APP_VERSION)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {devDiagnostics(false)}

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

      {/* Shared Catalog Song Preview Modal */}
      {previewCatalogSong && (
        <dialog
          open
          data-testid="header-catalog-preview-modal"
          onCancel={() => setPreviewCatalogSong(null)}
          className="fixed inset-0 m-auto w-[calc(100vw-1rem)] max-w-lg sm:max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] overflow-hidden rounded-2xl border border-app-border bg-app-surface p-0 text-app-heading shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-xs z-50 flex flex-col animate-fade-in"
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-app-border/80 bg-app-base/60 px-4 py-3 sm:px-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-app-action/40 bg-app-action/20 text-app-action" aria-hidden="true">
              <Music className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-app-muted">Published song preview</p>
              <h2 className="break-words text-sm font-extrabold text-app-heading sm:text-base truncate">{previewCatalogSong.title}</h2>
              <p className="text-xs text-app-muted truncate mt-0.5">{previewCatalogSong.artist || 'Unknown Artist'}</p>
            </div>
            <button
              type="button"
              data-testid="close-header-catalog-preview"
              onClick={() => setPreviewCatalogSong(null)}
              className="flex h-11 w-11 shrink-0 -mr-2 items-center justify-center rounded-xl text-app-muted transition-colors hover:bg-app-base hover:text-app-heading cursor-pointer"
              aria-label="Close Preview"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="preview-revision-badge"
                className="rounded-full border border-app-border bg-app-base px-2.5 py-0.5 font-mono text-[11px] font-bold text-app-muted"
              >
                r{previewCatalogSong.current_revision}
              </span>
              {previewCatalogSong.key && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-app-border bg-app-base px-2.5 py-0.5 text-[11px] leading-5 text-app-muted">
                  <span className="shrink-0">Key</span> <span className="break-words font-bold text-app-heading">{previewCatalogSong.key}</span>
                </span>
              )}
              {previewCatalogSong.original_key && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-app-border bg-app-base px-2.5 py-0.5 text-[11px] leading-5 text-app-muted">
                  <span className="shrink-0">Original key</span> <span className="break-words font-bold text-app-heading">{previewCatalogSong.original_key}</span>
                </span>
              )}
              {previewCatalogSong.bpm && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-app-border bg-app-base px-2.5 py-0.5 text-[11px] leading-5 text-app-muted">
                  <span className="shrink-0">BPM</span> <span className="break-words font-bold text-app-heading">{/^\d+$/.test(previewCatalogSong.bpm) ? `${previewCatalogSong.bpm} BPM` : previewCatalogSong.bpm}</span>
                </span>
              )}
            </div>

            <section className={sectionCard} aria-label="Song chart">
              <h3 className={sectionLabel}>Chart</h3>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-app-border bg-app-base p-3 font-mono text-sm text-app-text select-text leading-relaxed max-h-72 overflow-y-auto">
                {previewCatalogSong.raw_content}
              </pre>
            </section>
          </div>

          <div className="shrink-0 border-t border-app-border bg-app-base/60 px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
              <button
                type="button"
                data-testid="header-catalog-preview-import-btn"
                disabled={importingCatalogId === previewCatalogSong.id || importedCatalogIds.has(previewCatalogSong.id)}
                onClick={(e) => {
                  handleImportCatalogSong(e, previewCatalogSong)
                  setPreviewCatalogSong(null)
                }}
                className={`${primaryButton.replace('w-full ', '')} w-full sm:w-auto inline-flex items-center justify-center gap-1.5`}
              >
                <Download className="h-4 w-4" />
                <span>{importedCatalogIds.has(previewCatalogSong.id) ? 'Already in My Songs' : 'Import to My Songs'}</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewCatalogSong(null)}
                className={`${secondaryButton.replace('flex items-center', 'inline-flex items-center')} w-full sm:w-auto`}
              >
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* In-Browser Debug Logs Modal */}
      <DebugLogsModal
        isOpen={showDebugLogsModal}
        onClose={() => setShowDebugLogsModal(false)}
      />

      {/* Super Admin User Whitelist Management Modal */}
      <UserManagementModal
        isOpen={showUserManagementModal}
        onClose={() => setShowUserManagementModal(false)}
        onUpdateUsers={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gtar:auth_updated'))
          }
        }}
      />
      {/* Cloud Songbook Sync Modal */}
      <CloudSyncModal folders={folders}
        isOpen={showCloudSyncModal}
        onClose={() => setShowCloudSyncModal(false)}
        onSyncApplied={onCloudSyncApplied}
        onBackupSummary={onBackupSummary}
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
