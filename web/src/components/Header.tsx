import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Search,
  X,
  Globe,
  Palette,
  MoreVertical,
  Settings,
  FolderOpen,
  CloudUpload,
  Cloud,
  Eye,
  FileEdit,
  PlaySquare,
  Cast,
  Check,
  Layers,
  Radio,
  Plus,
  Loader2,
  Trash2,
  Download,
  Terminal,
  LogOut,
  User,
  Shield,
  RotateCw,
  AlertTriangle,
} from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION } from '../types/gtar'
import type { CloudSyncStatus } from '../utils/cloudSongbookSync'
import {
  searchOnlineChords,
  fetchOnlineChordSheet,
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
  onOpenBackupRestoreModal: () => void
  onOpenSetlistDrawer?: () => void
  setlists?: WebSetlist[]
  activeSetlistId?: string | number | null
  activeSetlistName?: string
  activeSetlistSongs?: Array<{ title: string; artist?: string; key?: string }>
  onSelectSetlistSong?: (setlistId: string | number, songIdx: number) => void
  onSelectSetlist?: (setlistId: string | number) => void
  onPushSetlistToBandSync?: (setlistId?: string | number) => void
  onDirectImportOnlineSong?: (sheet: FetchedChordSheet, openStage?: boolean) => void
  onCloudSyncApplied?: (updatedLibrary: SyncLibrary) => void
  onOpenCast?: () => void
  isCastActive?: boolean
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
}: {
  icon: React.FC<{ className?: string }>
  label: string
  isActive?: boolean
  onClick: () => void
  className?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className={`toolbar-icon-btn ${isActive ? 'active' : ''} ${className}`}
    >
      <Icon className="w-4 h-4" />
      <span className="active-dot" />
      <span className="toolbar-tooltip">{label}</span>
    </button>
  )
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onViewChange,
  allSongs = [],
  songsCount: _songsCount,
  deletedSongsCount = 0,
  queueMode: _queueMode,
  activeSetlistSongsCount: _activeSetlistSongsCount,
  activeSetlistSongIndex: _activeSetlistSongIndex,
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
  onOpenBackupRestoreModal,
  onOpenSetlistDrawer: _onOpenSetlistDrawer,
  setlists = [],
  activeSetlistId: _activeSetlistId,
  activeSetlistName: _activeSetlistName,
  activeSetlistSongs: _activeSetlistSongs = [],
  onSelectSetlistSong,
  onSelectSetlist,
  onPushSetlistToBandSync: _onPushSetlistToBandSync,
  onDirectImportOnlineSong,
  onCloudSyncApplied,
  onOpenCast,
  isCastActive = false,
}) => {
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showCloudSyncModal, setShowCloudSyncModal] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [onlineResults, setOnlineResults] = useState<OnlineChordResult[]>([])
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [isSearchingOnline, setIsSearchingOnline] = useState(false)
  const [previewResult, setPreviewResult] = useState<OnlineChordResult | null>(null)
  const [importingId, setImportingId] = useState<string | number | null>(null)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isAppInstalled, setIsAppInstalled] = useState(false)
  const [showDebugLogsModal, setShowDebugLogsModal] = useState(false)
  const [showUserManagementModal, setShowUserManagementModal] = useState(false)
  const [showAvatarPopover, setShowAvatarPopover] = useState(false)
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  )

  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>('IDLE')
  const [isCloudSyncProcessing, setIsCloudSyncProcessing] = useState(false)

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const handleSyncState = (e: Event) => {
      const customEvent = e as CustomEvent<{ status?: CloudSyncStatus; isProcessing?: boolean }>
      if (customEvent.detail) {
        if (customEvent.detail.status !== undefined) {
          setCloudSyncStatus(customEvent.detail.status)
        }
        if (customEvent.detail.isProcessing !== undefined) {
          setIsCloudSyncProcessing(customEvent.detail.isProcessing)
        }
      }
    }
    window.addEventListener('gtar:cloud_sync_state', handleSyncState)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('gtar:cloud_sync_state', handleSyncState)
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

  const isDevApp = isDevEnv || isSuperAdmin || import.meta.env.VITE_ENABLE_DEV_LOGS === 'true'

  useEffect(() => {
    if (!isSuperAdmin) {
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

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
      setIsAppInstalled(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
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
  const searchContainerRef = useRef<HTMLDivElement>(null)
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
    const q = searchQuery.trim().toLowerCase()
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
    const q = searchQuery.trim().toLowerCase()
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

  // Direct 1-Click Import from Online Results
  const handleDirectImportOnline = async (
    e: React.MouseEvent,
    item: OnlineChordResult
  ) => {
    e.stopPropagation()
    setImportingId(item.id)
    try {
      const sheet = await fetchOnlineChordSheet(item)
      if (onDirectImportOnlineSong) {
        onDirectImportOnlineSong(sheet, false)
      }
    } catch (err) {
      console.error('Failed to import online chord sheet:', err)
    } finally {
      setTimeout(() => setImportingId(null), 1200)
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

  return (
    <>
      <header className="border-b border-app-border bg-app-surface flex flex-col select-none z-30 sticky top-0 shadow-md max-w-full">
      {/* =================================================================== */}
      {/* TIER 1 (Top Bar): Branding & User Profile Avatar                   */}
      {/* =================================================================== */}
      <div className="h-12 sm:h-14 px-3 sm:px-5 flex items-center justify-between w-full">
        {/* Left: Logo + App Title ("GTAR-Dev") + DEV Badge + Version Badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            onClick={onNavigateHome}
            className="flex items-center gap-2 cursor-pointer group select-none transition-transform active:scale-95"
            title="Return to Songbook Library Home (Alt+0)"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-app-base border border-app-border flex items-center justify-center p-0.5 overflow-hidden shadow-inner group-hover:border-app-action group-hover:scale-105 transition-all">
              <img
                src={isDevEnv ? devLogo : prodLogo}
                alt={isDevEnv ? 'GTAR Dev Logo' : 'GTAR Logo'}
                className="w-full h-full object-contain rounded-lg"
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono font-bold text-sm sm:text-base tracking-wider header-primary-text text-app-heading">
                  {isDevEnv ? 'GTAR-Dev' : 'GTAR'}
                </span>
                {isDevEnv && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-app-accent/25 text-app-accent border border-app-accent/40">
                    DEV
                  </span>
                )}
                <span className="text-[10px] font-mono header-secondary-text text-app-muted font-semibold tracking-tight">
                  v{isDevEnv ? GTAR_DEV_VERSION : GTAR_APP_VERSION}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Right Action Icons & User Avatar */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Cloud Sync Button & Health Indicator */}
          {(() => {
            const isSyncing = isCloudSyncProcessing || cloudSyncStatus === 'SYNCING'
            const isInSync = !isSyncing && cloudSyncStatus === 'IN_SYNC'
            const isIssue = !isSyncing && (cloudSyncStatus === 'CONFLICT' || cloudSyncStatus === 'ERROR')

            let syncLabel = 'Cloud Sync'
            let SyncIcon = Cloud
            let iconClass = 'w-4 h-4 text-app-action'
            let btnClass = 'p-1.5 sm:px-2.5 sm:py-1 rounded-xl bg-app-base hover:bg-app-surface text-app-action border border-app-border hover:border-app-action transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95'

            {/* Canonical header entry: title="Cloud Songbook Sync" <span className="hidden md:inline font-mono text-[11px]">Cloud Sync</span> */}
            if (isSyncing) {
              syncLabel = 'Syncing\u2026'
              SyncIcon = RotateCw
              iconClass = 'w-4 h-4 text-app-action header-sync-spin motion-safe:animate-spin'
            } else if (isInSync) {
              syncLabel = 'In Sync'
              SyncIcon = Check
              iconClass = 'w-4 h-4 text-app-action'
            } else if (isIssue) {
              syncLabel = 'Sync Issue'
              SyncIcon = AlertTriangle
              iconClass = 'w-4 h-4 text-status-error'
              btnClass = 'p-1.5 sm:px-2.5 sm:py-1 rounded-xl bg-app-base hover:bg-app-surface text-status-error border border-[#DC6E67]/50 hover:border-[#DC6E67] transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95'
            }

            return (
              <button
                type="button"
                data-testid="header-cloud-sync-button"
                data-sync-state={isSyncing ? 'syncing' : isInSync ? 'in_sync' : isIssue ? 'issue' : 'idle'}
                onClick={() => setShowCloudSyncModal(true)}
                className={btnClass}
                title={syncLabel}
                aria-label={syncLabel}
              >
                <SyncIcon className={iconClass} />
                <span className="hidden md:inline font-mono text-[11px]">{syncLabel}</span>
              </button>
            )
          })()}

          {/* PWA Install Button */}
          {deferredInstallPrompt && !isAppInstalled && (
            <button
              type="button"
              onClick={handleTriggerInstall}
              className="px-2.5 py-1 rounded-xl bg-app-action/15 hover:bg-app-action text-app-action hover:text-app-on-action border border-app-action/40 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
              title="Install GTAR App to Home Screen"
            >
              <Download className="w-4 h-4 header-neutral-icon" />
            </button>
          )}

          {/* Avatar with Auth Status Dot */}
          <div
            ref={avatarPopoverRef}
            className="avatar-wrapper"
            onClick={() => setShowAvatarPopover(!showAvatarPopover)}
            title={currentSession ? `${currentSession.user.email} (Authenticated)` : 'Sign in'}
          >
            {currentSession?.user.picture ? (
              <img
                src={currentSession.user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full border-2 border-app-border hover:border-app-action transition-colors"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-app-base border-2 border-app-border hover:border-app-action flex items-center justify-center text-app-muted transition-colors">
                <User className="w-4 h-4 header-neutral-icon" />
              </div>
            )}
            <span className={`auth-dot ${userDotClass}`} />
            {isSuperAdmin && pendingCount > 0 && (
              <span
                className="pending-badge"
                title={`${pendingCount} pending account approval${pendingCount > 1 ? 's' : ''}`}
              >
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}

            {/* Avatar Popover */}
            {showAvatarPopover && (
              <div className="avatar-popover animate-scale-in" onClick={(e) => e.stopPropagation()}>
                {currentSession ? (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      {currentSession.user.picture && (
                        <img
                          src={currentSession.user.picture}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-full"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold ui-primary-text text-app-heading truncate">
                            {(currentSession.user as { name?: string }).name || 'User'}
                          </span>
                          {isSuperAdmin ? (
                            <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-app-accent/25 text-app-accent border border-app-accent/30 shrink-0">
                              ADMIN
                            </span>
                          ) : (
                            <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-app-action/20 text-app-action border border-app-action/30 shrink-0">
                              USER
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] ui-secondary-text text-app-muted truncate">
                          {currentSession.user.email}
                        </div>
                      </div>
                    </div>

                    {/* Super Admin Access Control */}
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAvatarPopover(false)
                          setShowUserManagementModal(true)
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-app-base hover:bg-app-base/80 text-app-action text-xs font-bold flex items-center justify-center gap-2 border border-app-action/30 transition-all cursor-pointer mb-2"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        <span>Manage Users &amp; Whitelist</span>
                      </button>
                    )}

                    {/* Backup & Restore (JSON) */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAvatarPopover(false)
                        onOpenBackupRestoreModal()
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-app-base hover:bg-app-accent/50 ui-primary-text text-app-heading hover:text-app-action text-xs font-bold flex items-center justify-center gap-2 border border-app-border transition-all cursor-pointer mb-2"
                    >
                      <CloudUpload className="w-3.5 h-3.5 text-app-accent" />
                      <span>Backup &amp; Restore (JSON)</span>
                    </button>

                    <div className="h-[1px] bg-app-border/60 mb-2" />

                    {/* Sign Out */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAvatarPopover(false)
                        handleSignOut?.()
                      }}
                      className="w-full px-3 py-2 rounded-xl hover:bg-app-base text-status-error text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </>
                ) : (
                  <div className="text-center py-2 space-y-3">
                    <p className="text-xs ui-muted-text text-app-muted">
                      Sign in with your approved Google account.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAvatarPopover(false)
                        void handleSignIn?.()
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-app-action hover:bg-app-action text-app-on-action text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>Sign In with Google</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* TIER 2 (Middle Action Bar): Toolbar Action Icons                   */}
      {/* =================================================================== */}
      <div className="w-full bg-app-toolbar border-t border-app-border/40 px-2 sm:px-4 py-1">
        <div className="w-full overflow-x-auto py-1 no-scrollbar" data-testid="main-toolbar-scroll">
          <div className="main-toolbar-content flex items-center justify-center gap-1 sm:gap-2">
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
      {activeView === 'songbook' && (
        <div
          ref={searchContainerRef}
          className="w-full px-3 sm:px-6 py-2 bg-app-surface border-t border-app-border/50 relative"
        >
          <div className="w-full flex items-center relative">
            <div className="pill-search w-full flex items-center">
              <Search className="w-4 h-4 text-app-muted shrink-0" />
              <input
                id="search-input"
                type="text"
                value={searchQuery}
                onFocus={() => setIsSearchFocused(true)}
                onChange={(e) => {
                  onSearchQueryChange(e.target.value)
                  setIsSearchFocused(true)
                }}
                placeholder="Search songs, artists, setlists & online chords..."
                className="min-w-0 flex-1 w-full"
              />
              <span className="kbd-hint hidden sm:inline shrink-0">Ctrl K</span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    onSearchQueryChange('')
                    setIsSearchFocused(false)
                  }}
                  className="ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Real-time search results dropdown overlay: Local + Setlists + Online Results */}
            {isSearchFocused && searchQuery.trim().length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl border border-app-border bg-app-surface shadow-2xl py-2 z-50 animate-scale-in max-h-96 overflow-y-auto">
                {/* A. LOCAL SONGBOOK SECTION */}
                <div className="px-3 py-1 text-[10px] font-mono font-bold ui-secondary-text text-app-muted uppercase tracking-wider flex items-center justify-between border-b border-app-border/60 mb-1">
                  <span>Local Songs ({matchingSearchSongs.length})</span>
                  <span className="text-app-action">Click to View on Stage</span>
                </div>

                {matchingSearchSongs.length > 0 ? (
                  matchingSearchSongs.map((song) => (
                    <button
                      key={`local-${song.title}-${song.originalIdx}`}
                      type="button"
                      onClick={() => {
                        if (onSelectSearchSong) {
                          onSelectSearchSong(song.originalIdx)
                        }
                        onViewChange('stage')
                        setIsSearchFocused(false)
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between gap-3 group cursor-pointer hover:bg-app-base ui-primary-text text-app-text"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-lg bg-app-base text-app-action flex items-center justify-center text-xs font-mono font-bold group-hover:bg-app-action group-hover:text-app-on-action transition-colors shrink-0">
                          {song.originalIdx + 1}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold ui-primary-text text-app-heading group-hover:text-app-action transition-colors truncate">
                            {song.title}
                          </div>
                          {song.artist && (
                            <div className="text-[10px] ui-secondary-text text-app-muted truncate">
                              {song.artist}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                        {song.key && (
                          <span className="px-1.5 py-0.5 rounded bg-app-base text-app-accent font-bold">
                            {song.key}
                          </span>
                        )}
                        {song.bpm && (
                          <span className="px-1.5 py-0.5 rounded bg-app-base ui-secondary-text text-app-muted">
                            {song.bpm} BPM
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-center text-xs ui-secondary-text text-app-muted">
                    No local songs matching &quot;{searchQuery}&quot;
                  </div>
                )}

                {/* B. GIG SETLISTS SECTION */}
                {matchingSearchSetlists.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-mono font-bold text-app-accent uppercase tracking-wider flex items-center justify-between border-t border-b border-app-border/60 mt-2 mb-1 bg-app-base/60">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-app-accent" />
                        <span>Gig Setlists ({matchingSearchSetlists.length})</span>
                      </div>
                      <span className="text-app-accent">Click to Open Setlist</span>
                    </div>

                    {matchingSearchSetlists.map((sl) => (
                      <button
                        key={`setlist-${sl.id}`}
                        type="button"
                        onClick={() => {
                          if (onSelectSetlistSong && (sl.songs || []).length > 0) {
                            onSelectSetlistSong(sl.id, 0)
                            onViewChange('stage')
                          } else if (onSelectSetlist) {
                            onSelectSetlist(sl.id)
                          }
                          setIsSearchFocused(false)
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between gap-3 group cursor-pointer hover:bg-app-base ui-primary-text text-app-text"
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-lg bg-app-base text-app-accent flex items-center justify-center text-xs font-mono font-bold group-hover:bg-app-button group-hover:text-app-button-text transition-colors shrink-0">
                            <Layers className="w-3.5 h-3.5" />
                          </div>
                          <div className="truncate">
                            <div className="text-xs font-bold ui-primary-text text-app-heading group-hover:text-app-accent transition-colors truncate">
                              {sl.name}
                            </div>
                            <div className="text-[10px] ui-secondary-text text-app-muted truncate">
                              {(sl.songs || []).length} {sl.songs?.length === 1 ? 'song' : 'songs'}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-app-accent/15 text-app-accent border border-app-accent/30 shrink-0">
                          START GIG
                        </span>
                      </button>
                    ))}
                  </>
                )}

                {/* C. ONLINE RESULTS SECTION (Parity with Android) */}
                <div className="px-3 py-1.5 text-[10px] font-mono font-bold text-app-action uppercase tracking-wider flex items-center justify-between border-t border-b border-app-border/60 mt-2 mb-1 bg-app-base/60">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-app-action" />
                    <span>Online Results ({onlineResults.length})</span>
                    {isOffline && (
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#DC6E67]/20 text-status-error border border-[#DC6E67]/30">
                        Offline
                      </span>
                    )}
                  </div>
                  {isSearchingOnline && (
                    <div className="flex items-center gap-1 text-app-action">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span className="text-[9px]">Searching...</span>
                    </div>
                  )}
                </div>

                {onlineResults.length > 0 ? (
                  onlineResults.map((onlineItem) => {
                    const isImporting = importingId === onlineItem.id
                    return (
                      <div
                        key={`online-${onlineItem.id}`}
                        className="px-3 py-2 rounded-xl transition-all flex items-center justify-between gap-2.5 hover:bg-app-base ui-primary-text text-app-text group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold ui-primary-text text-app-heading group-hover:text-app-action truncate">
                              {onlineItem.songName}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-app-accent/20 text-app-accent font-bold border border-app-accent/30 shrink-0">
                              {onlineItem.type} v{onlineItem.version}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[10px] ui-secondary-text text-app-muted mt-0.5 font-medium">
                            <span className="truncate">{onlineItem.artistName}</span>
                            <span>•</span>
                            <span className="text-app-accent font-bold">
                              ★ {onlineItem.rating.toFixed(1)}
                            </span>
                            <span>({onlineItem.votes.toLocaleString()} votes)</span>
                            {onlineItem.tonality && (
                              <span className="px-1 py-0.2 rounded bg-app-base text-app-action font-mono font-bold">
                                Key: {onlineItem.tonality}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Inline Action Controls: [Preview] and [+ Import] */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setIsSearchFocused(false)
                              setPreviewResult(onlineItem)
                            }}
                            className="px-2.5 py-1 rounded-lg bg-app-surface hover:bg-app-border ui-primary-text text-app-text text-[11px] font-bold flex items-center gap-1 border border-app-border transition-colors cursor-pointer"
                            title="Preview chord sheet"
                          >
                            <Eye className="w-3 h-3 text-app-action" />
                            <span>Preview</span>
                          </button>

                          <button
                            type="button"
                            disabled={isImporting}
                            onClick={(e) => handleDirectImportOnline(e, onlineItem)}
                            className="px-2.5 py-1 rounded-lg bg-app-action hover:bg-app-action text-app-on-action text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                            title="Fetch and import chord sheet directly to library"
                          >
                            {isImporting ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Plus className="w-3 h-3 stroke-[3]" />
                            )}
                            <span>{isImporting ? 'Importing...' : 'Import'}</span>
                          </button>
                        </div>
                      </div>
                    )
                  })
                ) : !isSearchingOnline ? (
                  isOffline ? (
                    <div className="p-3 text-center space-y-1">
                      <p className="text-xs font-semibold text-status-error">
                        Device is currently offline
                      </p>
                      <p className="text-[11px] ui-muted-text text-app-muted">
                        Connect to the internet to search online chord sheets.
                      </p>
                    </div>
                  ) : onlineError ? (
                    <div className="p-3 text-center space-y-1.5">
                      <p className="text-xs font-semibold text-status-error">
                        {onlineError}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSearchFocused(false)
                          if (onSearchWebExternal) {
                            onSearchWebExternal(searchQuery)
                          } else {
                            onOpenWebsiteUrlSource()
                          }
                        }}
                        className="mt-1 py-1 px-2.5 rounded-lg bg-app-surface hover:bg-app-border text-app-action text-[11px] font-bold border border-app-border inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Globe className="w-3 h-3" />
                        <span>Search Web Sources</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 text-center space-y-2">
                      <p className="text-xs ui-muted-text text-app-muted">
                        No online results found for &quot;{searchQuery}&quot;
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSearchFocused(false)
                          if (onSearchWebExternal) {
                            onSearchWebExternal(searchQuery)
                          } else {
                            onOpenWebsiteUrlSource()
                          }
                        }}
                        className="w-full py-1.5 px-3 rounded-xl bg-app-action/20 hover:bg-app-action text-app-action hover:text-app-on-action font-bold text-xs flex items-center justify-center gap-2 border border-app-action/40 transition-all cursor-pointer shadow-sm"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>Search on Web Sources / Ultimate-Guitar</span>
                      </button>
                    </div>
                  )
                ) : null}
              </div>
            )}
            </div>
          </div>
        )}
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
            <span className="font-semibold">Import Songs &amp; Setlists...</span>
          </button>



          {/* 5. Debug Logs (Debug environment only) */}
          {isDevApp && (
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
      <CloudSyncModal
        isOpen={showCloudSyncModal}
        onClose={() => setShowCloudSyncModal(false)}
        onSyncApplied={onCloudSyncApplied}
        onSyncStateChange={(status, isProcessing) => {
          setCloudSyncStatus(status)
          setIsCloudSyncProcessing(isProcessing)
        }}
      />
    </>
  )
}
