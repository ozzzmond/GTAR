import type { SetlistFolder } from '../types/gtar'
import { recoveryDotClass, useRecoveryAttention } from '../utils/recoveryAttention'
import { openRecoveryData } from '../utils/recoveryReview'
import { SyncStatusPill } from './SyncStatusPill'
import { computeSongbookChecksum } from '../utils/cloudBackupFormat'
import { readPersistedLibrary } from '../utils/syncJournal'
import { OPEN_BACKUP_CENTER_EVENT } from '../utils/backupCenter'
import React, { useState, useRef, useEffect, useMemo, useId } from 'react'
import { createPortal } from 'react-dom'
import { SearchResults } from './SearchResults'
import {
  Search,
  X,
  Globe,
  Palette,
  MoreVertical,
  Settings,
  FolderOpen,
  Wrench,
  History,
  FileEdit,
  PlaySquare,
  Cast,
  Radio,
  Command,
  Trash2,
  Download,
  Terminal,
  LogOut,
  User,
  Shield,
  ArrowLeft,
  Menu,
} from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import {
  GTAR_APP_VERSION,
  GTAR_DEV_VERSION,
  GTAR_DEV_PROVENANCE,
} from '../types/gtar'

import {
  formatDevDiagLine1,
  formatDevDiagLine2,
  formatHeaderVersion,
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
import devLogo from '../assets/dev-logo.png'
import prodLogo from '../assets/prod-logo.png'
import { isDevEnv } from '../utils/env'
import { useGoogleAuth } from './AuthGate'
import type { GoogleSession } from '../utils/googleAuth'
import type { SyncLibrary } from '../utils/syncMerge'
import { navigateBack } from '../utils/viewHistory'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
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
  onOpenStageSettings: () => void
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
}

/**
 * ToolbarIconButton — icon-only button with tooltip and cyan active dot
 */
function ToolbarIconButton({
  icon: Icon,
  label,
  isActive = false,
  onClick,
  className = '',
  buttonRef,
  testId,
}: {
  icon: React.FC<{ className?: string }>
  label: string
  isActive?: boolean
  onClick: () => void
  className?: string
  buttonRef?: React.Ref<HTMLButtonElement>
  testId?: string
}) {
  const tooltipId = useId()
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const interaction = useRef({ hovered: false, focused: false })

  useEffect(() => {
    if (!anchor) return
    const dismiss = () => setAnchor(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    // Any viewport/ancestor movement invalidates the fixed anchor, including
    // horizontal toolbar scrolling and the mobile visual viewport.
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKeyDown)
    window.visualViewport?.addEventListener('resize', dismiss)
    window.visualViewport?.addEventListener('scroll', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKeyDown)
      window.visualViewport?.removeEventListener('resize', dismiss)
      window.visualViewport?.removeEventListener('scroll', dismiss)
    }
  }, [anchor])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { setAnchor(null); onClick() }}
        onMouseEnter={(event) => {
          interaction.current.hovered = true
          setAnchor(event.currentTarget.getBoundingClientRect())
        }}
        onMouseLeave={() => {
          interaction.current.hovered = false
          if (!interaction.current.focused) setAnchor(null)
        }}
        onFocus={(event) => {
          interaction.current.focused = true
          setAnchor(event.currentTarget.getBoundingClientRect())
        }}
        onBlur={() => {
          interaction.current.focused = false
          if (!interaction.current.hovered) setAnchor(null)
        }}
        aria-label={label}
        aria-describedby={anchor ? tooltipId : undefined}
        data-testid={testId}
        className={`toolbar-icon-btn ${isActive ? 'active' : ''} ${className}`}
      >
        <Icon className="w-4 h-4" />
        <span className="hidden lg:inline text-xs">{label.replace(/ \(Alt\+\d\)/, '')}</span>
        <span className="active-dot" />
      </button>
      {anchor && createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="toolbar-tooltip"
          ref={(node) => {
            if (!node) return
            const viewport = window.visualViewport
            const left = viewport?.offsetLeft ?? 0
            const top = viewport?.offsetTop ?? 0
            const width = viewport?.width ?? window.innerWidth
            const height = viewport?.height ?? window.innerHeight
            node.style.maxWidth = `${Math.max(0, width - 16)}px`
            const bounds = node.getBoundingClientRect()
            node.style.left = `${Math.max(left + 8, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, left + width - bounds.width - 8))}px`
            node.style.top = `${Math.max(top + 8, Math.min(anchor.bottom + 6, top + height - bounds.height - 8))}px`
          }}
        >{label}</span>,
        document.body,
      )}
    </>
  )
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
  onOpenStageSettings,
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
}) => {
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showCloudSyncModal, setShowCloudSyncModal] = useState(false)
  const [showDebugLogsModal, setShowDebugLogsModal] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 640)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => { if (mobileSearchOpen) searchInputRef.current?.focus() }, [mobileSearchOpen])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (activeView === 'stage' || shortcutsBlocked || showCloudSyncModal || showDebugLogsModal) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        if (target?.closest('dialog, [role=dialog]') || target?.id === 'multi-song-search-input') return
        event.preventDefault()
        if (compact) setMobileSearchOpen(true)
        searchInputRef.current?.focus()
      } else if (event.key === 'Escape') {
        onSearchQueryChange('')
        setIsSearchFocused(false)
        setMobileSearchOpen(false)
        searchInputRef.current?.blur()
        if (compact) searchTriggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [activeView, shortcutsBlocked, compact, onSearchQueryChange, showCloudSyncModal, showDebugLogsModal])
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
  const [backupDates, setBackupDates] = useState<Record<string, string | null>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('gtar_manual_cloud_backup_dates') || '{}')
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch { return {} }
  })
  const [backupChecksums, setBackupChecksums] = useState<Record<string, string | null>>(() => {
    try { return JSON.parse(localStorage.getItem('gtar_manual_cloud_backup_checksums') || '{}') || {} } catch { return {} }
  })
  const [libraryVersion, setLibraryVersion] = useState(0)
  useEffect(() => {
    const refresh = () => setLibraryVersion(v => v + 1)
    window.addEventListener('gtar-library-persisted', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('gtar-library-persisted', refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const localChecksum = useMemo(() => {
    try { const library = readPersistedLibrary(); return library ? computeSongbookChecksum(library) : null } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Persistence events re-read the committed library, including trash.
  }, [libraryVersion])
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
  let currentSession: GoogleSession | null = null
  let handleSignOut: (() => void) | undefined
  let handleSignIn: (() => Promise<void>) | undefined
  try {
    const auth = useGoogleAuth()
    isSuperAdmin = auth.isSuperAdmin
    currentSession = auth.session
    handleSignOut = auth.signOut
    handleSignIn = auth.signIn
  } catch {
    // Header rendered outside AuthGate (e.g. isolated test or preview)
  }

  const backupUserId = String(currentSession?.user?.id || '')
  const cachedBackupDate = backupDates[backupUserId]
  const lastCloudBackup = typeof cachedBackupDate === 'string' && Number.isFinite(Date.parse(cachedBackupDate)) ? cachedBackupDate : null
  const setLastCloudBackup = (date: string | null, checksum?: string | null) => {
    const checksums = { ...backupChecksums, [backupUserId]: checksum ?? null }
    setBackupChecksums(checksums)
    try { localStorage.setItem('gtar_manual_cloud_backup_checksums', JSON.stringify(checksums)) } catch { /* Optional device status. */ }
    const next = { ...backupDates, [backupUserId]: date }
    setBackupDates(next)
    try { localStorage.setItem('gtar_manual_cloud_backup_dates', JSON.stringify(next)) } catch { /* Summary caching is optional. */ }
  }

  // #299 / #264: developer tools, DEV builds only (never rendered in PROD).
  const advancedItem = 'relative w-full min-h-11 px-3 py-2 rounded-xl bg-app-base hover:bg-app-accent/50 ui-primary-text text-app-heading hover:text-app-action text-xs font-bold flex items-center gap-2 border border-app-border transition-all cursor-pointer mb-2'
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

  const overflowMenuRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const [moreMenuCoords, setMoreMenuCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const searchContainerRef = useRef<HTMLElement>(null)
  const avatarPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showOverflowMenu && moreButtonRef.current) {
      const updatePosition = () => {
        if (!moreButtonRef.current) return
        const rect = moreButtonRef.current.getBoundingClientRect()
        const menuWidth = 224
        const margin = 8
        const top = rect.bottom + 6

        let left = rect.right - menuWidth
        const maxLeft = window.innerWidth - menuWidth - margin
        if (left > maxLeft) {
          left = maxLeft
        }
        if (left < margin) {
          left = margin
        }

        setMoreMenuCoords({ top, left })
      }

      updatePosition()
      window.addEventListener('resize', updatePosition)
      window.addEventListener('scroll', updatePosition, true)
      return () => {
        window.removeEventListener('resize', updatePosition)
        window.removeEventListener('scroll', updatePosition, true)
      }
    }
  }, [showOverflowMenu])



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
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        if (moreButtonRef.current && moreButtonRef.current.contains(e.target as Node)) {
          return
        }
        setShowOverflowMenu(false)
      }
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false)
      }
      if (avatarPopoverRef.current && !avatarPopoverRef.current.contains(e.target as Node)) {
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
      window.requestAnimationFrame(() => searchTriggerRef.current?.focus())
    } else {
      searchTriggerRef.current?.focus()
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
  const searchEnabled = activeView !== 'stage'
  const iconButton = 'ui-button min-h-11 min-w-11 px-2 sm:px-2.5 rounded-xl bg-app-button hover:brightness-110 border border-app-border text-app-button-text text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer'
  const devDiagnostics = (inline: boolean) => isDevEnv && (
    <div
      data-testid={inline ? 'dev-header-diagnostics' : 'dev-header-diagnostics-compact'}
      className={inline
        ? 'hidden sm:flex flex-col justify-center border-l border-app-border/40 pl-2 sm:pl-3 text-[9px] sm:text-[10px] font-mono leading-tight header-primary-text text-app-heading tracking-tight select-none min-w-0'
        : 'sm:hidden pt-1 text-center text-[9px] font-mono leading-tight header-primary-text text-app-heading tracking-tight select-none truncate'}
    >
      <span data-testid={inline ? 'dev-header-diag-line1' : undefined} className={inline ? 'truncate whitespace-nowrap' : ''}>
        {formatDevDiagLine1(GTAR_DEV_PROVENANCE)}
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
      <div className="relative px-3 py-2.5">
      <div className="flex items-center justify-between gap-1 sm:gap-4">
        {/* Left: Explorer drawer toggle & GTAR branding (DEV deployment details / PROD version stay visible) */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-3 min-w-0">
          <button type="button" aria-label="Open Music Explorer" aria-expanded={isExplorerOpen}
            onClick={onOpenSetlistDrawer}
            className="md:hidden min-h-11 min-w-11 flex items-center justify-center rounded-lg header-neutral-icon text-app-text hover:text-app-heading hover:bg-app-base transition-colors">
            {isExplorerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button type="button" onClick={onNavigateHome} aria-label={isDevEnv ? 'GTAR-Dev home' : 'GTAR home'}
            className="flex items-center gap-2 text-left group min-h-11 cursor-pointer">
            <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center shadow-sm shrink-0 group-hover:opacity-90 transition-opacity">
              <img src={isDevEnv ? devLogo : prodLogo} alt={isDevEnv ? 'GTAR Dev Logo' : 'GTAR Logo'}
                className="w-full h-full object-cover select-none" />
            </div>
            <div className={isDevEnv ? 'hidden sm:block' : 'block'}>
              <span className="hidden sm:inline text-base font-extrabold header-primary-text text-app-heading tracking-tight group-hover:text-app-link transition-colors">
                {isDevEnv ? 'GTAR-Dev' : 'GTAR'}
              </span>
              {isDevEnv ? (
                <span className="ml-2 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-accent/25 text-app-accent border border-app-accent/40">DEV</span>
              ) : (
                <span data-testid="header-prod-version" className="text-[10px] header-secondary-text text-app-muted font-mono sm:ml-2">
                  {formatHeaderVersion(false, GTAR_DEV_VERSION, GTAR_APP_VERSION)}
                </span>
              )}
            </div>
          </button>
          {devDiagnostics(true)}
        </div>

        {/* Center: desktop search (GTAR1 design) */}
        {searchEnabled && !compact && (
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
                  onClick={() => { onSearchQueryChange(''); searchInputRef.current?.focus() }}
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
          {compact && searchEnabled && (
            <button ref={searchTriggerRef} type="button" aria-label="Open search"
              onClick={() => setMobileSearchOpen(true)}
              className={`ui-button mobile-search-trigger min-h-11 min-w-11 rounded-xl bg-app-surface border transition-colors flex items-center justify-center active:scale-95 ${
                searchQuery ? 'text-app-accent border-app-accent' : 'border-app-border header-neutral-icon text-app-muted hover:text-app-heading hover:border-app-accent'}`}>
              <Search className="w-4 h-4" />
            </button>
          )}

          {/* Cloud status / Backup & Restore (GTAR1 "Backup" slot), with the recovery dot */}
          <SyncStatusPill signedIn={Boolean(currentSession)} lastBackup={lastCloudBackup}
            backupChecksum={backupChecksums[backupUserId] ?? null} localChecksum={localChecksum} now={backupClock}
            recoveryAttention={recoveryAttention} onClick={() => setShowCloudSyncModal(true)} />

          {deferredInstallPrompt && !isAppInstalled && !compact && (
            <button type="button" onClick={handleTriggerInstall} aria-label="Install GTAR App to Home Screen" className={iconButton}>
              <Download className="w-4 h-4 header-neutral-icon text-app-action" />
            </button>
          )}

          {/* Avatar with Auth Status Dot */}
          <div ref={avatarPopoverRef} className="avatar-wrapper">
            <button type="button" aria-label={currentSession ? 'Account menu' : 'Sign in and account menu'} aria-haspopup="menu"
              aria-expanded={showAvatarPopover} data-testid="header-avatar"
              onClick={() => setShowAvatarPopover(!showAvatarPopover)}
              className="relative w-9 h-9 min-h-9 rounded-full flex items-center justify-center cursor-pointer before:absolute before:-inset-1 before:content-['']">
              {currentSession?.user.picture ? (
                <img src={currentSession.user.picture} alt="" referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-full border-2 border-app-border hover:border-app-action transition-colors" />
              ) : (
                <span className="w-9 h-9 rounded-full bg-app-surface border-2 border-app-border hover:border-app-action flex items-center justify-center text-app-muted transition-colors">
                  <User className="w-4 h-4 header-neutral-icon" />
                </span>
              )}
            </button>
            <span className={`auth-dot ${userDotClass}`} />
            {isSuperAdmin && pendingCount > 0 && (
              <span className="pending-badge">{pendingCount > 99 ? '99+' : pendingCount}</span>
            )}

            {showAvatarPopover && (
              <div className="avatar-popover animate-scale-in" onClick={(e) => e.stopPropagation()}>
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

                    {recoveryDataRow}
                    {advancedTools}

                    <div className="h-[1px] bg-app-border/60 mb-2" />

                    <button type="button"
                      onClick={() => { setShowAvatarPopover(false); handleSignOut?.() }}
                      className="w-full min-h-11 px-3 py-2 rounded-xl hover:bg-app-base text-status-error text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer">
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </>
                ) : (
                  <div className="text-center py-2 space-y-3">
                    <p className="text-xs ui-muted-text text-app-muted">
                      Sign in to use cloud backup and the Shared Catalog.
                    </p>
                    <button type="button"
                      onClick={() => { setShowAvatarPopover(false); void handleSignIn?.() }}
                      className="w-full min-h-11 px-3 py-2 rounded-xl bg-app-action hover:bg-app-action text-app-on-action text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer">
                      <User className="w-3.5 h-3.5" />
                      <span>Sign In with Google</span>
                    </button>
                    <div className="text-left">{recoveryDataRow}{advancedTools}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {devDiagnostics(false)}

      {/* Compact full-width search overlay (GTAR1): the field takes over the header with Cancel */}
      {compact && searchEnabled && mobileSearchOpen && (
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
                onClick={() => { onSearchQueryChange(''); searchInputRef.current?.focus() }}
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

      {/* =================================================================== */}
      {/* TIER 2 (Middle Action Bar): Toolbar Action Icons                   */}
      {/* =================================================================== */}
      <div className="w-full bg-app-toolbar border-t border-app-border/40 px-2 sm:px-4 py-1">
        <div className="w-full overflow-x-auto py-1 no-scrollbar" data-testid="main-toolbar-scroll">
          <div className="main-toolbar-content flex items-center justify-center gap-1 sm:gap-2" data-testid="main-toolbar-group">
            <ToolbarIconButton
              icon={ArrowLeft}
              label="Back"
              onClick={() => { navigateBack() }}
              className="shrink-0"
              testId="toolbar-back"
            />
            <ToolbarIconButton
              icon={PlaySquare}
              label="Stage Preview (Alt+1)"
              isActive={activeView === 'stage'}
              onClick={() => onViewChange('stage')}
              className="shrink-0"
            />
            <ToolbarIconButton
              icon={FileEdit}
              label="Editor (Alt+2)"
              isActive={activeView === 'editor'}
              onClick={() => onViewChange('editor')}
              className="shrink-0"
            />
            <ToolbarIconButton
              icon={Radio}
              label="Band Sync (Alt+3)"
              onClick={onOpenStageTools}
              className="shrink-0"
            />
            <ToolbarIconButton
              icon={Cast}
              label="Cast (Alt+4)"
              isActive={isCastActive}
              onClick={onOpenCast || (() => {})}
              className="shrink-0"
            />
            <ToolbarIconButton
              icon={Palette}
              label="Theme (Alt+5)"
              onClick={onToggleTheme}
              className="shrink-0"
            />
            <ToolbarIconButton
              icon={Trash2}
              label={`Trash${deletedSongsCount > 0 ? ` (${deletedSongsCount})` : ''} (Alt+6)`}
              isActive={activeView === 'trash'}
              onClick={() => onViewChange('trash')}
              className="shrink-0"
            />
            <ToolbarIconButton
              buttonRef={moreButtonRef}
              icon={MoreVertical}
              label="More"
              isActive={showOverflowMenu}
              onClick={() => setShowOverflowMenu((prev) => !prev)}
              className="shrink-0"
            />

          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* TIER 3 (Bottom Search Bar): Full Width Search Input Container       */}
      {/* =================================================================== */}
      </header>

      {/* 3-Dots Overflow Menu */}
      {showOverflowMenu && (
        <div
          ref={overflowMenuRef}
          style={{
            position: 'fixed',
            top: `${moreMenuCoords.top}px`,
            left: `${moreMenuCoords.left}px`,
          }}
          className="w-56 max-w-[calc(100vw-1rem)] rounded-2xl border border-app-border bg-app-surface shadow-2xl py-2 z-50 animate-scale-in"
        >
          {/* 0. Install App (PWA) */}
          {!isAppInstalled && (
            <>
              <button
                type="button"
                onClick={() => {
                  setShowOverflowMenu(false)
                  handleTriggerInstall()
                }}
                className="w-full text-left px-4 py-2.5 text-xs text-app-action hover:bg-app-base transition-colors flex items-center gap-3 cursor-pointer"
              >
                <Download className="w-4 h-4 text-app-action" />
                <span className="font-semibold">Install App (PWA)</span>
              </button>
              <div className="h-[1px] bg-app-border/60 my-1" />
            </>
          )}

          {/* 1. Stage Settings */}
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false)
              onOpenStageSettings()
            }}
            className="w-full text-left px-4 py-2.5 text-xs ui-primary-text text-app-heading hover:bg-app-base hover:text-app-action transition-colors flex items-center gap-3 cursor-pointer"
          >
            <Settings className="w-4 h-4 text-app-action" />
            <span className="font-semibold">Stage Settings</span>
          </button>

          <div className="h-[1px] bg-app-border/60 my-1" />

          {/* 2. Web Sources */}
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false)
              onOpenWebsiteUrlSource()
            }}
            className="w-full text-left px-4 py-2.5 text-xs ui-primary-text text-app-heading hover:bg-app-base hover:text-app-action transition-colors flex items-center gap-3 cursor-pointer"
          >
            <Globe className="w-4 h-4 text-app-action" />
            <span className="font-semibold">Web Sources</span>
          </button>

          <div className="h-[1px] bg-app-border/60 my-1" />

          {/* 2. Import... */}
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false)
              onOpenImportModal()
            }}
            className="w-full text-left px-4 py-2.5 text-xs ui-primary-text text-app-heading hover:bg-app-base hover:text-app-action transition-colors flex items-center gap-3 cursor-pointer"
          >
            <FolderOpen className="w-4 h-4 text-app-action" />
            <span className="font-semibold">Import Songs...</span>
          </button>



          {/* 5. Debug Logs: PROD super-admins / debug builds only. On DEV the profile menu's
              Advanced Tools replace this menu item (#191, #299). */}
          {isDevApp && !isDevEnv && (
            <>
              <div className="h-[1px] bg-app-border/60 my-1" />
              <button
                type="button"
                onClick={() => {
                  setShowOverflowMenu(false)
                  setShowDebugLogsModal(true)
                }}
                className="w-full text-left px-4 py-2.5 text-xs ui-primary-text text-app-heading hover:bg-app-base hover:text-app-action transition-colors flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Terminal className="w-4 h-4 text-app-action" />
                  <span className="font-semibold">Debug Logs</span>
                </div>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-red-600/25 text-status-error border border-red-500/30">
                  {isDevEnv ? 'DEV' : 'DIAG'}
                </span>
              </button>
            </>
          )}
        </div>
      )}

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
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90vh] rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-4 sm:p-5 border-b border-app-border/60 flex items-center justify-between">
            <div className="min-w-0 pr-3">
              <h2 className="text-base font-bold text-app-heading truncate">{previewCatalogSong.title}</h2>
              <p className="text-xs text-app-muted truncate mt-0.5">{previewCatalogSong.artist || 'Unknown Artist'}</p>
            </div>
            <button
              type="button"
              data-testid="close-header-catalog-preview"
              onClick={() => setPreviewCatalogSong(null)}
              className="p-1 rounded-lg hover:bg-app-base text-app-muted hover:text-app-heading cursor-pointer"
              aria-label="Close Preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
              <span className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                Key: {previewCatalogSong.key || 'N/A'}
              </span>
              <span className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                Revision: r{previewCatalogSong.current_revision}
              </span>
              <span className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                Format: {previewCatalogSong.format}
              </span>
            </div>

            <div className="rounded-xl border border-app-border bg-app-base p-3 font-mono text-xs whitespace-pre-wrap max-h-64 overflow-y-auto select-text leading-relaxed">
              {previewCatalogSong.raw_content}
            </div>
          </div>

          <div className="p-4 border-t border-app-border/60 flex justify-end gap-2 font-mono text-xs font-bold">
            <button
              type="button"
              onClick={() => setPreviewCatalogSong(null)}
              className="px-3.5 py-2 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              data-testid="header-catalog-preview-import-btn"
              disabled={importingCatalogId === previewCatalogSong.id || importedCatalogIds.has(previewCatalogSong.id)}
              onClick={(e) => {
                handleImportCatalogSong(e, previewCatalogSong)
                setPreviewCatalogSong(null)
              }}
              className="px-4 py-2 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{importedCatalogIds.has(previewCatalogSong.id) ? 'Already in My Songs' : 'Import to My Songs'}</span>
            </button>
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
        onBackupSummary={setLastCloudBackup}
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
