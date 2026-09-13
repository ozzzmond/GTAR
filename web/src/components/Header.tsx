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
  RefreshCw,
  Eye,
  FileEdit,
  ListMusic,
  Music,
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
  Clock,
  Shield,
} from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION } from '../types/gtar'
import {
  searchOnlineChords,
  fetchOnlineChordSheet,
  type OnlineChordResult,
  type FetchedChordSheet,
} from '../utils/onlineSearch'
import { ChordPreviewModal } from './ChordPreviewModal'
import { DebugLogsModal } from './DebugLogsModal'
import { UserManagementModal } from './UserManagementModal'
import { GtaLogoIcon } from './GtaLogoIcon'
import { useGoogleAuth } from './AuthGate'

// Sync session type matching useDriveSync return shape
export interface SyncSessionInfo {
  user: {
    email: string
    name?: string
    picture?: string
  }
  token: string
  expiresAt: number
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
  onCheckForUpdates?: () => void
  isCheckingUpdates?: boolean
  onOpenSetlistDrawer?: () => void
  setlists?: WebSetlist[]
  activeSetlistId?: string | number | null
  activeSetlistName?: string
  activeSetlistSongs?: Array<{ title: string; artist?: string; key?: string }>
  onSelectSetlistSong?: (setlistId: string | number, songIdx: number) => void
  onSelectSetlist?: (setlistId: string | number) => void
  onPushSetlistToBandSync?: (setlistId?: string | number) => void
  onDirectImportOnlineSong?: (sheet: FetchedChordSheet, openStage?: boolean) => void
  // Sync/Auth props (wired from useDriveSync in App.tsx)
  syncSession?: SyncSessionInfo | null
  syncStatus?: string
  syncBusy?: boolean
  onPublishResolvedLibrary?: () => void
  onAdoptCloudLibrary?: () => void
  onExportSyncRecovery?: () => void
  onSyncNow?: () => void
  onSignOut?: () => void
  onSignIn?: () => void
  syncReady?: boolean
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
}: {
  icon: React.FC<{ className?: string }>
  label: string
  isActive?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
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
  songsCount,
  deletedSongsCount = 0,
  queueMode = 'library',
  activeSetlistSongsCount: _activeSetlistSongsCount,
  activeSetlistSongIndex,
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
  onCheckForUpdates,
  isCheckingUpdates = false,
  onOpenSetlistDrawer,
  setlists = [],
  activeSetlistId,
  activeSetlistName,
  activeSetlistSongs = [],
  onSelectSetlistSong,
  onSelectSetlist,
  onDirectImportOnlineSong,
  // Sync props
  syncSession,
  syncStatus = '',
  syncBusy = false,
  onSyncNow,
  onExportSyncRecovery,
  onPublishResolvedLibrary,
  onAdoptCloudLibrary,
  onSignOut,
  onSignIn,
  syncReady = false,
}) => {
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [isSetlistDropdownOpen, setIsSetlistDropdownOpen] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [onlineResults, setOnlineResults] = useState<OnlineChordResult[]>([])
  const [isSearchingOnline, setIsSearchingOnline] = useState(false)
  const [previewResult, setPreviewResult] = useState<OnlineChordResult | null>(null)
  const [importingId, setImportingId] = useState<string | number | null>(null)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null)
  const [isAppInstalled, setIsAppInstalled] = useState(false)
  const [showDebugLogsModal, setShowDebugLogsModal] = useState(false)
  const [showUserManagementModal, setShowUserManagementModal] = useState(false)
  const [showAvatarPopover, setShowAvatarPopover] = useState(false)

  // Retrieve user role from AuthGate context
  let isSuperAdmin = false
  try {
    const auth = useGoogleAuth()
    isSuperAdmin = auth.isSuperAdmin
  } catch {
    // Header rendered outside AuthGate (e.g. isolated test or preview)
  }

  const isDevApp =
    (import.meta.env.DEV ||
    import.meta.env.VITE_APP_ENV === 'debug' ||
    (typeof window !== 'undefined' && window.location.hostname.includes('dev.gtar-web.pages.dev'))) &&
    isSuperAdmin
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredInstallPrompt(e)
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
  const setlistDropdownRef = useRef<HTMLDivElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const avatarPopoverRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnterSetlists = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsSetlistDropdownOpen(true)
  }

  const handleMouseLeaveSetlists = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsSetlistDropdownOpen(false)
    }, 200)
  }

  // Active Setlist context with fallback to first setlist
  const currentActiveSetlist = useMemo(() => {
    if (!setlists.length) return null
    return (
      setlists.find((s) => String(s.id) === String(activeSetlistId)) ||
      setlists[0] ||
      null
    )
  }, [setlists, activeSetlistId])

  // Resolve active setlist songs reliably so it NEVER says "No songs in active setlist" when the setlist has songs
  const displaySetlistSongs = useMemo(() => {
    if (activeSetlistSongs && activeSetlistSongs.length > 0) return activeSetlistSongs
    if (currentActiveSetlist && currentActiveSetlist.songs && currentActiveSetlist.songs.length > 0) {
      return currentActiveSetlist.songs.map((ref) => {
        const match = allSongs.find(
          (s) => s.title.trim().toLowerCase() === ref.title.trim().toLowerCase()
        )
        return {
          title: ref.title,
          artist: ref.artist || match?.artist || '',
          key: match?.key || (ref as any).key || '',
        }
      })
    }
    return []
  }, [activeSetlistSongs, currentActiveSetlist, allSongs])

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

  // Real Online Chord Search (debounced 350ms)
  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed || trimmed.length < 2) {
      setOnlineResults([])
      setIsSearchingOnline(false)
      return
    }

    setIsSearchingOnline(true)
    const timeout = setTimeout(() => {
      searchOnlineChords(trimmed)
        .then((res) => {
          setOnlineResults(res)
          setIsSearchingOnline(false)
        })
        .catch(() => {
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

  // Derive sync status indicator color
  const syncDotClass = useMemo(() => {
    if (!syncSession) return 'error'
    if (syncBusy) return 'syncing'
    if (syncStatus?.toLowerCase().includes('error') || syncStatus?.toLowerCase().includes('offline')) return 'error'
    if (syncStatus?.toLowerCase().includes('syncing') || syncStatus?.toLowerCase().includes('uploading') || syncStatus?.toLowerCase().includes('downloading')) return 'syncing'
    return 'synced'
  }, [syncSession, syncBusy, syncStatus])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false)
      }
      if (setlistDropdownRef.current && !setlistDropdownRef.current.contains(e.target as Node)) {
        setIsSetlistDropdownOpen(false)
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
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  return (
    <>
      <header className="border-b border-[#1A4A55] bg-[#073642] flex flex-col select-none z-30 sticky top-0 shadow-md max-w-full">
      {/* =================================================================== */}
      {/* TIER 1 (Top Bar): Branding & User Profile Avatar                   */}
      {/* =================================================================== */}
      <div className="h-12 sm:h-14 px-3 sm:px-5 flex items-center justify-between w-full">
        {/* Left: Logo + App Title ("GTAR-Dev") + DEV Badge + Version Badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            onClick={onNavigateHome}
            className="flex items-center gap-2 cursor-pointer group select-none transition-transform active:scale-95"
            title="Return to Songbook Library Home"
          >
            <div className="w-8 h-8 rounded-xl bg-[#002B36] border border-[#2AA198]/40 group-hover:border-[#2AA198] flex items-center justify-center text-[#2AA198] group-hover:text-[#35B8AD] shadow-inner transition-colors shrink-0">
              <GtaLogoIcon className="w-4.5 h-4.5 fill-current" />
            </div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-black text-sm text-[#FDF6E3] group-hover:text-[#2AA198] tracking-wide transition-colors">
                {isDevApp ? 'GTAR-Dev' : 'GTAR'}
              </span>
              {isDevApp && (
                <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-black text-[9px] tracking-wider uppercase border border-red-400 shadow-sm animate-pulse">
                  DEV
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCheckForUpdates?.()
                }}
                title={isDevApp ? `Click to check for updates (web v${GTAR_DEV_VERSION})` : `Click to check for updates (web v${GTAR_APP_VERSION})`}
                className="text-[9px] font-mono font-bold uppercase bg-transparent text-[#2AA198] px-1.5 py-0.5 rounded border border-[#2AA198]/40 hover:border-[#2AA198] transition-colors cursor-pointer flex items-center gap-1 shrink-0"
              >
                {isCheckingUpdates && (
                  <RefreshCw className="w-2.5 h-2.5 animate-spin text-[#B58900]" />
                )}
                <span>{isDevApp ? `web v${GTAR_DEV_VERSION}` : `web v${GTAR_APP_VERSION}`}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: User Profile Avatar button (with its status indicator) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* PWA Install App Button (when available and not standalone) */}
          {deferredInstallPrompt && !isAppInstalled && (
            <button
              type="button"
              onClick={handleTriggerInstall}
              title="Install GTAR as Standalone Stage App"
              className="p-1.5 rounded-lg bg-[#10B981]/20 hover:bg-[#10B981] text-[#10B981] hover:text-[#002B36] border border-[#10B981]/50 transition-all cursor-pointer animate-pulse"
            >
              <Download className="w-4 h-4" />
            </button>
          )}

          {/* Avatar with Sync Dot */}
          <div
            ref={avatarPopoverRef}
            className="avatar-wrapper"
            onClick={() => setShowAvatarPopover(!showAvatarPopover)}
            title={syncSession ? `${syncSession.user.email} — ${syncStatus}` : 'Sign in to sync'}
          >
            {syncSession?.user.picture ? (
              <img
                src={syncSession.user.picture}
                alt=""
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full border-2 border-[#1A4A55] hover:border-[#2AA198] transition-colors"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#002B36] border-2 border-[#1A4A55] hover:border-[#2AA198] flex items-center justify-center text-[#93A1A1] transition-colors">
                <User className="w-4 h-4" />
              </div>
            )}
            <span className={`sync-dot ${syncDotClass}`} />

            {/* Avatar Popover */}
            {showAvatarPopover && (
              <div className="avatar-popover animate-scale-in" onClick={(e) => e.stopPropagation()}>
                {syncSession ? (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      {syncSession.user.picture && (
                        <img
                          src={syncSession.user.picture}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-full"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-[#FDF6E3] truncate">
                            {syncSession.user.name || 'User'}
                          </span>
                          {isSuperAdmin ? (
                            <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-[#B58900]/25 text-[#B58900] border border-[#B58900]/30 shrink-0">
                              ADMIN
                            </span>
                          ) : (
                            <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-[#2AA198]/20 text-[#2AA198] border border-[#2AA198]/30 shrink-0">
                              USER
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#93A1A1] truncate">
                          {syncSession.user.email}
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
                        className="w-full px-3 py-2 rounded-xl bg-[#002B36] hover:bg-[#002B36]/80 text-[#2AA198] text-xs font-bold flex items-center justify-center gap-2 border border-[#2AA198]/30 transition-all cursor-pointer mb-2"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        <span>Manage Users &amp; Whitelist</span>
                      </button>
                    )}

                    {/* Sync Now */}
                    <button
                      type="button"
                      disabled={syncBusy}
                      onClick={() => {
                        onSyncNow?.()
                        setShowAvatarPopover(false)
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-[#2AA198]/15 hover:bg-[#2AA198] text-[#2AA198] hover:text-[#002B36] text-xs font-bold flex items-center justify-center gap-2 border border-[#2AA198]/30 transition-all cursor-pointer disabled:opacity-50 mb-2"
                    >
                      {syncBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>{syncBusy ? 'Syncing...' : 'Sync Now'}</span>
                    </button>

                    <button type="button" onClick={onExportSyncRecovery} className="w-full text-xs underline py-1 text-[#93A1A1] hover:text-[#FDF6E3]">Download sync recovery data</button>
                    {syncStatus.includes('Conflicting') && (
                      <div className="flex flex-col gap-1.5 my-2 p-2 rounded-lg bg-[#002B36] border border-[#DC6E67]/40">
                        <div className="text-[10px] text-[#DC6E67] font-semibold">Conflict Detected:</div>
                        <button
                          type="button"
                          disabled={syncBusy}
                          onClick={() => {
                            if (window.confirm('Discard local device changes and restore the cloud library? Make sure to download sync recovery data first if you wish to keep local edits.')) {
                              onAdoptCloudLibrary?.()
                              setShowAvatarPopover(false)
                            }
                          }}
                          className="w-full px-2 py-1.5 rounded bg-[#2AA198]/20 hover:bg-[#2AA198] text-[#2AA198] hover:text-[#002B36] text-[11px] font-bold transition-all text-center cursor-pointer disabled:opacity-50"
                        >
                          Adopt Cloud Library
                        </button>
                        <button
                          type="button"
                          disabled={syncBusy}
                          onClick={() => {
                            if (window.confirm('First download sync recovery data and reconcile all charts and setlists on this device. Publish this device library as the authoritative resolved version? Previous cloud revisions will be retained.')) {
                              onPublishResolvedLibrary?.()
                              setShowAvatarPopover(false)
                            }
                          }}
                          className="w-full px-2 py-1.5 rounded bg-[#D33682]/20 hover:bg-[#D33682] text-[#D33682] hover:text-[#FDF6E3] text-[11px] font-bold transition-all text-center cursor-pointer disabled:opacity-50"
                        >
                          Publish Resolved Device Library
                        </button>
                      </div>
                    )}
                    {/* Sync Status */}
                    <div className="flex items-center gap-1.5 px-1 mb-3">
                      <Clock className="w-3 h-3 text-[#93A1A1] shrink-0" />
                      <span className="text-[10px] text-[#93A1A1] truncate">{syncStatus || 'Ready'}</span>
                    </div>

                    <div className="h-[1px] bg-[#1A4A55]/60 mb-2" />

                    {/* Sign Out */}
                    <button
                      type="button"
                      onClick={() => {
                        onSignOut?.()
                        setShowAvatarPopover(false)
                      }}
                      className="w-full px-3 py-2 rounded-xl hover:bg-[#002B36] text-[#DC6E67] text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </>
                ) : (
                  <div className="text-center py-2 space-y-3">
                    <p className="text-xs text-[#93A1A1]">
                      Sign in with Google to sync your songbook across devices.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAvatarPopover(false)
                        onSignIn?.()
                      }}
                      disabled={!syncReady}
                      className="w-full px-3 py-2 rounded-xl bg-[#2AA198] hover:bg-[#35B8AD] text-[#002B36] text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
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
      <div className="w-full bg-[#002B36]/50 border-t border-[#1A4A55]/40 px-2 sm:px-4 py-1">
        <div className="flex items-center justify-start sm:justify-center gap-1 sm:gap-2 w-full overflow-x-auto py-1 no-scrollbar">
          <ToolbarIconButton
            icon={Music}
            label={`Songbook${songsCount !== undefined ? ` (${songsCount})` : ''}`}
            isActive={activeView === 'songbook'}
            onClick={() => onViewChange('songbook')}
            className="shrink-0"
          />

          {/* Setlists with cascading dropdown */}
          <div
            ref={setlistDropdownRef}
            className="relative shrink-0"
            onMouseEnter={handleMouseEnterSetlists}
            onMouseLeave={handleMouseLeaveSetlists}
          >
            <ToolbarIconButton
              icon={ListMusic}
              label={`Setlists${displaySetlistSongs.length > 0 ? ` (${activeSetlistSongIndex !== undefined ? activeSetlistSongIndex + 1 : 1}/${displaySetlistSongs.length})` : ''}`}
              isActive={queueMode === 'setlist' || isSetlistDropdownOpen}
              onClick={() => setIsSetlistDropdownOpen((prev) => !prev)}
              className={`shrink-0 ${queueMode === 'setlist' ? '!text-[#B58900]' : ''}`}
            />

            {/* Cascading Dropdown Menu */}
            {isSetlistDropdownOpen && (
              <div className="fixed sm:absolute left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 top-24 sm:top-full mt-2 w-auto sm:w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-[#1A4A55] bg-[#073642] shadow-2xl p-2.5 z-50 animate-scale-in text-xs select-none">
                {/* Active Setlist Header & Quick Actions */}
                <div className="px-2 py-1.5 border-b border-[#1A4A55]/60 mb-1 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-mono text-[#93A1A1] uppercase tracking-wider block">
                      Active Setlist
                    </span>
                    <span className="font-extrabold text-[#FDF6E3] text-xs truncate block">
                      {activeSetlistName || currentActiveSetlist?.name || 'Active Setlist'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-[#B58900] bg-[#B58900]/15 px-1.5 py-0.5 rounded border border-[#B58900]/30 shrink-0">
                    {displaySetlistSongs.length} SONGS
                  </span>
                </div>

                {/* Song List with Direct 1-Click Selection */}
                <div className="max-h-60 overflow-y-auto py-1 space-y-0.5 px-1">
                  {displaySetlistSongs && displaySetlistSongs.length > 0 ? (
                    displaySetlistSongs.map((s, idx) => {
                      const isCurrent =
                        queueMode === 'setlist' && activeSetlistSongIndex === idx
                      return (
                        <button
                          key={`${s.title}-${idx}`}
                          type="button"
                          onClick={() => {
                            if (onSelectSetlistSong && currentActiveSetlist) {
                              onSelectSetlistSong(currentActiveSetlist.id, idx)
                            }
                            onViewChange('stage')
                            setIsSetlistDropdownOpen(false)
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-xl transition-all flex items-center justify-between gap-2 group cursor-pointer ${isCurrent
                            ? 'bg-[#B58900]/20 text-[#FDF6E3] border border-[#B58900]/40'
                            : 'hover:bg-[#002B36] text-[#EEE8D5]'
                            }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-5 h-5 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold shrink-0 ${isCurrent
                                ? 'bg-[#B58900] text-[#002B36]'
                                : 'bg-[#002B36] text-[#93A1A1] group-hover:text-[#2AA198]'
                                }`}
                            >
                              {idx + 1}
                            </span>
                            <div className="truncate">
                              <p
                                className={`text-xs font-bold truncate leading-tight ${isCurrent
                                  ? 'text-[#B58900]'
                                  : 'text-[#FDF6E3] group-hover:text-[#2AA198]'
                                  }`}
                              >
                                {s.title}
                              </p>
                              {s.artist && (
                                <p className="text-[10px] text-[#93A1A1] truncate leading-tight">
                                  {s.artist}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {s.key && (
                              <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[#002B36] text-[#2AA198] font-bold">
                                {s.key}
                              </span>
                            )}
                            {isCurrent && (
                              <Check className="w-3.5 h-3.5 text-[#B58900] shrink-0" />
                            )}
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-3 py-4 text-center text-xs text-[#93A1A1]">
                      No songs in active setlist
                    </div>
                  )}
                </div>

                {/* Footer Switcher / Drawer Trigger */}
                <div className="border-t border-[#1A4A55]/60 pt-1.5 mt-1 px-1.5 flex items-center justify-between gap-1">
                  {setlists.length > 1 && (
                    <div className="flex items-center gap-1 overflow-x-auto max-w-[180px] py-0.5">
                      {setlists.map((sl) => (
                        <button
                          key={sl.id}
                          type="button"
                          onClick={() => {
                            if (onSelectSetlist) {
                              onSelectSetlist(sl.id)
                            }
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${String(sl.id) === String(activeSetlistId)
                            ? 'bg-[#B58900] text-[#002B36] font-bold'
                            : 'bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3]'
                            }`}
                          title={`Switch to setlist: ${sl.name}`}
                        >
                          {sl.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {onOpenSetlistDrawer && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSetlistDropdownOpen(false)
                        onOpenSetlistDrawer()
                      }}
                      className="ml-auto text-[10px] font-bold text-[#2AA198] hover:underline px-2 py-1 flex items-center gap-1 cursor-pointer"
                    >
                      <Layers className="w-3 h-3" />
                      <span>Manage All...</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="w-[1px] h-5 bg-[#1A4A55]/50 mx-0.5 shrink-0" />

          <ToolbarIconButton
            icon={FileEdit}
            label="Editor"
            isActive={activeView === 'editor'}
            onClick={() => onViewChange('editor')}
            className="shrink-0"
          />
          <ToolbarIconButton
            icon={Eye}
            label="Stage Mode"
            isActive={activeView === 'stage'}
            onClick={() => onViewChange('stage')}
            className="shrink-0"
          />
          <ToolbarIconButton
            icon={Globe}
            label="Web Sources"
            onClick={onOpenWebsiteUrlSource}
            className="shrink-0"
          />
          <ToolbarIconButton
            icon={Trash2}
            label={`Trash${deletedSongsCount > 0 ? ` (${deletedSongsCount})` : ''}`}
            isActive={activeView === 'trash'}
            onClick={() => onViewChange('trash')}
            className="shrink-0"
          />

          <div className="w-[1px] h-5 bg-[#1A4A55]/50 mx-0.5 shrink-0" />

          <ToolbarIconButton
            icon={Radio}
            label="Band Sync"
            onClick={onOpenStageTools}
            className="shrink-0"
          />
          <ToolbarIconButton
            icon={Palette}
            label="Theme"
            onClick={onToggleTheme}
            className="shrink-0"
          />
          <ToolbarIconButton
            icon={MoreVertical}
            label="More"
            onClick={() => setShowOverflowMenu(!showOverflowMenu)}
            className="shrink-0"
          />
        </div>
      </div>

      {/* =================================================================== */}
      {/* TIER 3 (Bottom Search Bar): Full Width Search Input Container       */}
      {/* =================================================================== */}
      {activeView === 'songbook' && (
        <div
          ref={searchContainerRef}
          className="w-full px-3 sm:px-6 py-2 bg-[#073642] border-t border-[#1A4A55]/50 relative"
        >
          <div className="w-full flex items-center relative">
            <div className="pill-search w-full flex items-center">
              <Search className="w-4 h-4 text-[#93A1A1] shrink-0" />
              <input
                id="search-input"
                type="text"
                value={searchQuery}
                onFocus={() => setIsSearchFocused(true)}
                onChange={(e) => {
                  onSearchQueryChange(e.target.value)
                  setIsSearchFocused(true)
                }}
                placeholder="Search local songbook & online chords..."
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
                  className="text-[#93A1A1] hover:text-[#FDF6E3] cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Real-time search results dropdown overlay: Local + Online Results */}
            {isSearchFocused && searchQuery.trim().length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl border border-[#1A4A55] bg-[#073642] shadow-2xl py-2 z-50 animate-scale-in max-h-96 overflow-y-auto">
                {/* A. LOCAL SONGBOOK SECTION */}
                <div className="px-3 py-1 text-[10px] font-mono font-bold text-[#93A1A1] uppercase tracking-wider flex items-center justify-between border-b border-[#1A4A55]/60 mb-1">
                  <span>Local Songbook ({matchingSearchSongs.length})</span>
                  <span className="text-[#2AA198]">Click to View on Stage</span>
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
                      className="w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between gap-3 group cursor-pointer hover:bg-[#002B36] text-[#EEE8D5]"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-lg bg-[#002B36] text-[#2AA198] flex items-center justify-center text-xs font-mono font-bold group-hover:bg-[#2AA198] group-hover:text-[#002B36] transition-colors shrink-0">
                          {song.originalIdx + 1}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198] transition-colors truncate">
                            {song.title}
                          </div>
                          {song.artist && (
                            <div className="text-[10px] text-[#93A1A1] truncate">
                              {song.artist}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                        {song.key && (
                          <span className="px-1.5 py-0.5 rounded bg-[#002B36] text-[#B58900] font-bold">
                            {song.key}
                          </span>
                        )}
                        {song.bpm && (
                          <span className="px-1.5 py-0.5 rounded bg-[#002B36] text-[#93A1A1]">
                            {song.bpm} BPM
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-center text-xs text-[#93A1A1]">
                    No local songs matching &quot;{searchQuery}&quot;
                  </div>
                )}

                {/* B. ONLINE RESULTS SECTION (Parity with Android) */}
                <div className="px-3 py-1.5 text-[10px] font-mono font-bold text-[#B58900] uppercase tracking-wider flex items-center justify-between border-t border-b border-[#1A4A55]/60 mt-2 mb-1 bg-[#002B36]/60">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[#2AA198]" />
                    <span>Online Results ({onlineResults.length})</span>
                  </div>
                  {isSearchingOnline && (
                    <div className="flex items-center gap-1 text-[#2AA198]">
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
                        className="px-3 py-2 rounded-xl transition-all flex items-center justify-between gap-2.5 hover:bg-[#002B36] text-[#EEE8D5] group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198] truncate">
                              {onlineItem.songName}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#B58900]/20 text-[#B58900] font-bold border border-[#B58900]/30 shrink-0">
                              {onlineItem.type} v{onlineItem.version}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-[#93A1A1] mt-0.5 font-medium">
                            <span className="truncate">{onlineItem.artistName}</span>
                            <span>•</span>
                            <span className="text-[#B58900] font-bold">
                              ★ {onlineItem.rating.toFixed(1)}
                            </span>
                            <span>({onlineItem.votes.toLocaleString()} votes)</span>
                            {onlineItem.tonality && (
                              <span className="px-1 py-0.2 rounded bg-[#002B36] text-[#2AA198] font-mono font-bold">
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
                            className="px-2.5 py-1 rounded-lg bg-[#073642] hover:bg-[#1A4A55] text-[#EEE8D5] text-[11px] font-bold flex items-center gap-1 border border-[#1A4A55] transition-colors cursor-pointer"
                            title="Preview chord sheet"
                          >
                            <Eye className="w-3 h-3 text-[#2AA198]" />
                            <span>Preview</span>
                          </button>

                          <button
                            type="button"
                            disabled={isImporting}
                            onClick={(e) => handleDirectImportOnline(e, onlineItem)}
                            className="px-2.5 py-1 rounded-lg bg-[#2AA198] hover:bg-[#35B8AD] text-[#002B36] text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
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
                  <div className="p-3 text-center space-y-2">
                    <p className="text-xs text-[#93A1A1]">
                      Search online sources for &quot;{searchQuery}&quot;
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
                      className="w-full py-1.5 px-3 rounded-xl bg-[#2AA198]/20 hover:bg-[#2AA198] text-[#2AA198] hover:text-[#002B36] font-bold text-xs flex items-center justify-center gap-2 border border-[#2AA198]/40 transition-all cursor-pointer shadow-sm"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Search on Web Sources / Ultimate-Guitar</span>
                    </button>
                  </div>
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
          className="fixed right-2 sm:right-4 top-24 sm:top-28 w-56 max-w-[calc(100vw-1rem)] rounded-2xl border border-[#1A4A55] bg-[#073642] shadow-2xl py-2 z-50 animate-scale-in"
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
                className="w-full text-left px-4 py-2.5 text-xs text-[#10B981] hover:bg-[#002B36] transition-colors flex items-center gap-3 cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#10B981]" />
                <span className="font-semibold">Install App (PWA)</span>
              </button>
              <div className="h-[1px] bg-[#1A4A55]/60 my-1" />
            </>
          )}

          {/* 1. Stage Settings */}
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false)
              onOpenStageSettings()
            }}
            className="w-full text-left px-4 py-2.5 text-xs text-[#FDF6E3] hover:bg-[#002B36] hover:text-[#2AA198] transition-colors flex items-center gap-3 cursor-pointer"
          >
            <Settings className="w-4 h-4 text-[#2AA198]" />
            <span className="font-semibold">Stage Settings</span>
          </button>

          <div className="h-[1px] bg-[#1A4A55]/60 my-1" />

          {/* 2. Import... */}
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false)
              onOpenImportModal()
            }}
            className="w-full text-left px-4 py-2.5 text-xs text-[#FDF6E3] hover:bg-[#002B36] hover:text-[#2AA198] transition-colors flex items-center gap-3 cursor-pointer"
          >
            <FolderOpen className="w-4 h-4 text-[#2AA198]" />
            <span className="font-semibold">Import...</span>
          </button>

          <div className="h-[1px] bg-[#1A4A55]/60 my-1" />

          {/* 3. Backup & Restore... */}
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false)
              onOpenBackupRestoreModal()
            }}
            className="w-full text-left px-4 py-2.5 text-xs text-[#FDF6E3] hover:bg-[#002B36] hover:text-[#B58900] transition-colors flex items-center gap-3 cursor-pointer"
          >
            <CloudUpload className="w-4 h-4 text-[#B58900]" />
            <span className="font-semibold">Backup & Restore...</span>
          </button>

          <div className="h-[1px] bg-[#1A4A55]/60 my-1" />

          {/* 4. Trash Bin (Basurahan) */}
          <button
            type="button"
            onClick={() => {
              setShowOverflowMenu(false)
              onViewChange('trash')
            }}
            className="w-full text-left px-4 py-2.5 text-xs text-[#FDF6E3] hover:bg-[#002B36] hover:text-[#DC6E67] transition-colors flex items-center justify-between gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-4 h-4 text-[#DC6E67]" />
              <span className="font-semibold">Trash Bin (Basurahan)</span>
            </div>
            {deletedSongsCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#DC6E67]/20 text-[#DC6E67] font-bold">
                {deletedSongsCount}
              </span>
            )}
          </button>

          {/* 5. Debug Logs (Debug environment only) */}
          {isDevApp && (
            <>
              <div className="h-[1px] bg-[#1A4A55]/60 my-1" />
              <button
                type="button"
                onClick={() => {
                  setShowOverflowMenu(false)
                  setShowDebugLogsModal(true)
                }}
                className="w-full text-left px-4 py-2.5 text-xs text-[#FDF6E3] hover:bg-[#002B36] hover:text-[#2AA198] transition-colors flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Terminal className="w-4 h-4 text-[#2AA198]" />
                  <span className="font-semibold">Debug Logs</span>
                </div>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-red-600/25 text-red-400 border border-red-500/30">
                  DEV:5174
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
        onUpdateUsers={onSyncNow}
      />
    </>
  )
}
