import { SharedSetlistCatalogPanel } from './SharedSetlistCatalogPanel'
import { useSharedSetlists } from '../utils/useSharedSetlists'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Music,
  ListMusic,
  Search,
  RefreshCw,
  Download,
  AlertCircle,
  WifiOff,
  Lock,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  History,
  X,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Trash2,
  Edit3,
} from 'lucide-react'
import type {
  SharedCatalogSongItem,
  CatalogSongRevisionItem,
  CatalogDataState,
} from '../types/sharedCatalog'
import {
  sharedCatalogService,
} from '../utils/sharedCatalogService'
import {
  getSharedCatalogSong,
  updateSharedCatalogSong,
  unpublishSharedCatalogSong,
  DEFAULT_PAGE_LIMIT,
} from '../utils/sharedCatalogClient'
import { CatalogApiError } from '../types/sharedCatalog'
import { cloneSharedCatalogSongToPersonal } from '../utils/sharedCatalogImport'
import type { ActiveSongState } from '../types/gtar'
import { useOptionalGoogleAuth } from '../utils/authContext'

export interface SharedCatalogBrowserProps {
  personalSongs?: ActiveSongState[]
  onSongUnpublished?: (catalogSongId: string) => void;
  onImportSong: (song: ActiveSongState) => boolean | void
  onSongImported?: (songTitle: string) => void
  currentUserId?: string | null
  userRole?: string | null
}

export const SharedCatalogBrowser: React.FC<SharedCatalogBrowserProps> = ({
  personalSongs = [],
  onSongUnpublished,
  onImportSong,
  onSongImported,
  currentUserId: propUserId,
  userRole: propUserRole,
}) => {
  const auth = useOptionalGoogleAuth()
  const activeUserId = (
    propUserId ||
    auth?.session?.user?.id ||
    auth?.session?.user?.sub ||
    auth?.session?.user?.email ||
    ''
  ).trim().toLowerCase()
  const activeUserRole = propUserRole || auth?.role || auth?.session?.role || 'member'
  const isSuperAdmin = auth?.isSuperAdmin || activeUserRole === 'admin' || activeUserRole === 'SUPER_ADMIN'

  const [catalogKind, setCatalogKind] = useState<'songs' | 'setlists'>('songs')
  const setlistCapability = useSharedSetlists()

  // State
  const [songs, setSongs] = useState<SharedCatalogSongItem[]>([])
  const [dataState, setDataState] = useState<CatalogDataState>('LOADING')
  const [isStale, setIsStale] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [hasMore, setHasMore] = useState<boolean>(false)
  const [pageOffset, setPageOffset] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  // Detail / Preview modal state
  const [previewSong, setPreviewSong] = useState<SharedCatalogSongItem | null>(null)
  const [revisions, setRevisions] = useState<CatalogSongRevisionItem[]>([])
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false)

  // Edit Shared Song modal state (Author / Admin only)
  const [editingSong, setEditingSong] = useState<SharedCatalogSongItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editArtist, setEditArtist] = useState('')
  const [editRawContent, setEditRawContent] = useState('')
  const [editChangeSummary, setEditChangeSummary] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Unpublish confirmation state (Author / Admin only)
  const [unpublishConfirmSong, setUnpublishConfirmSong] = useState<SharedCatalogSongItem | null>(null)
  const [isUnpublishing, setIsUnpublishing] = useState(false)
  const [unpublishError, setUnpublishError] = useState<string | null>(null)

  // Import tracking state to prevent rapid repeated taps
  const [importingSongIds, setImportingSongIds] = useState<Set<string>>(new Set())
  const [importedSuccessIds, setImportedSuccessIds] = useState<Set<string>>(new Set())
  const [importFeedback, setImportFeedback] = useState<string | null>(null)
  const [duplicateImportSong, setDuplicateImportSong] = useState<SharedCatalogSongItem | null>(null)

  // Find existing personal song matching catalog identity (sharedSourceSongId or publishedCatalogSongId)
  const findMatchingPersonalSong = useCallback((catalogSongId: string): ActiveSongState | undefined => {
    if (!catalogSongId || !personalSongs || personalSongs.length === 0) return undefined
    return personalSongs.find(
      (s) =>
        Boolean(s.sharedSourceSongId && s.sharedSourceSongId === catalogSongId) ||
        Boolean(s.publishedCatalogSongId && s.publishedCatalogSongId === catalogSongId)
    )
  }, [personalSongs])

  // Request race-condition guard
  const activeRequestIdRef = useRef<number>(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Set account on mount or when activeUserId changes
  useEffect(() => {
    sharedCatalogService.setAccount(activeUserId || null)
  }, [activeUserId])

  // Load songs function
  const loadSongs = useCallback(
    async (offset = 0, forceOnline = false) => {
      // Cancel prior active request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      const controller = new AbortController()
      abortControllerRef.current = controller

      const reqId = ++activeRequestIdRef.current
      setDataState('LOADING')
      setErrorMessage(null)

      try {
        const result = await sharedCatalogService.getCatalogSongs({
          limit: DEFAULT_PAGE_LIMIT,
          offset,
          forceOnline,
          signal: controller.signal,
        })

        // If stale request returned after a newer one was launched, ignore
        if (reqId !== activeRequestIdRef.current) return

        setSongs(result.songs)
        setDataState(result.state)
        setIsStale(result.isStale)
        setTotalCount(result.total ?? result.songs.length)
        setHasMore(result.hasMore ?? false)
        if (result.error && result.state === 'OFFLINE_CACHED') {
          // Cached results with network warning
          setErrorMessage(result.error)
        } else if (result.error && result.state === 'ERROR') {
          setErrorMessage(result.error)
        }
      } catch (err: unknown) {
        if (reqId !== activeRequestIdRef.current) return
        if (err instanceof CatalogApiError && err.code === 'ABORTED') {
          return // User initiated abort or race condition cancellation
        }
        setDataState('ERROR')
        setErrorMessage(err instanceof Error ? err.message : 'Failed to retrieve Shared Catalog')
      } finally {
        if (reqId === activeRequestIdRef.current) {
          setIsRefreshing(false)
        }
      }
    },
    []
  )

  // Initial fetch and on pageOffset change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Asynchronous catalog fetch synchronizes active offset with remote or cached data.
    void loadSongs(pageOffset)
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [loadSongs, pageOffset])

  // Manual refresh handler
  const handleRefresh = () => {
    setIsRefreshing(true)
    void loadSongs(pageOffset, true)
  }

  // Client-side filtering across current loaded page by title and artist
  const filteredSongs = songs.filter((s) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase().trim()
    const matchTitle = (s.title || '').toLowerCase().includes(q)
    const matchArtist = (s.artist || '').toLowerCase().includes(q)
    return matchTitle || matchArtist
  })

  // Open Preview Details modal
  const handleOpenPreview = async (song: SharedCatalogSongItem) => {
    setPreviewSong(song)
    setRevisions([])
    setIsLoadingDetails(true)

    try {
      const details = await getSharedCatalogSong({ id: song.id })
      setRevisions(details.revisions)
    } catch {
      // Revisions are optional diagnostics; fallback to showing song preview without revision history
      setRevisions([])
    } finally {
      setIsLoadingDetails(false)
    }
  }

  const executeImport = useCallback((song: SharedCatalogSongItem) => {
    if (importingSongIds.has(song.id)) return // Prevent double tap

    setImportingSongIds((prev) => new Set(prev).add(song.id))

    try {
      // Convert to independent clone with unique UUID and source catalog metadata
      const personalClone = cloneSharedCatalogSongToPersonal(song)

      // Commit to personal library via caller persistence hook
      const result = onImportSong(personalClone)
      if (result === false) {
        // Persistence failed
        setImportFeedback(`Failed to import "${song.title}" to My Songs.`)
        setTimeout(() => setImportFeedback(null), 3500)
        return
      }

      setImportedSuccessIds((prev) => new Set(prev).add(song.id))
      setImportFeedback(`Imported "${song.title}" to My Songs`)
      onSongImported?.(song.title)
      setTimeout(() => setImportFeedback(null), 3500)
    } catch (err: unknown) {
      setImportFeedback(err instanceof Error ? err.message : 'Import failed')
      setTimeout(() => setImportFeedback(null), 3500)
    } finally {
      setImportingSongIds((prev) => {
        const next = new Set(prev)
        next.delete(song.id)
        return next
      })
    }
  }, [importingSongIds, onImportSong, onSongImported])

  // Handle Import to My Songs
  const handleImport = useCallback((song: SharedCatalogSongItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (importingSongIds.has(song.id)) return // Prevent double tap

    const existingMatch = findMatchingPersonalSong(song.id)
    if (existingMatch) {
      setDuplicateImportSong(song)
      return
    }

    executeImport(song)
  }, [findMatchingPersonalSong, executeImport, importingSongIds])

  // Check if current user is authorized to edit or unpublish
  const canUserModify = (song: SharedCatalogSongItem): boolean => {
    if (!activeUserId) return false
    if (isSuperAdmin) return true
    return song.publisher_user_id.toLowerCase() === activeUserId
  }

  // Open Edit Shared Song modal
  const handleOpenEdit = (song: SharedCatalogSongItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setEditingSong(song)
    setEditTitle(song.title)
    setEditArtist(song.artist || '')
    setEditRawContent(song.raw_content)
    setEditChangeSummary('')
    setEditError(null)
  }

  // Submit Edit Shared Song
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingSong) return
    setIsUpdating(true)
    setEditError(null)

    try {
      const updated = await updateSharedCatalogSong({
        id: editingSong.id,
        expected_revision: editingSong.current_revision,
        title: editTitle.trim(),
        artist: editArtist.trim() || null,
        raw_content: editRawContent,
        format: editingSong.format,
        change_summary: editChangeSummary.trim() || undefined,
      })

      // Update in-memory songs list
      setSongs((prev) => prev.map((s) => (s.id === updated.song.id ? updated.song : s)))
      if (previewSong && previewSong.id === updated.song.id) {
        setPreviewSong(updated.song)
      }
      setEditingSong(null)
      setImportFeedback(`Updated "${updated.song.title}" (rev ${updated.song.current_revision})`)
      setTimeout(() => setImportFeedback(null), 3500)
    } catch (err: unknown) {
      if (err instanceof CatalogApiError && (err.status === 409 || err.code === 'REVISION_CONFLICT')) {
        setEditError('Revision conflict: this song was modified by another user. Please refresh.')
      } else if (err instanceof CatalogApiError && err.status === 403) {
        setEditError('Forbidden: Only the original publisher or an admin can update this shared song.')
      } else {
        setEditError(err instanceof Error ? err.message : 'Failed to update song.')
      }
    } finally {
      setIsUpdating(false)
    }
  }

  // Submit Unpublish
  const handleConfirmUnpublish = async () => {
    if (!unpublishConfirmSong) return
    setIsUnpublishing(true)
    setUnpublishError(null)

    try {
      await unpublishSharedCatalogSong({
        id: unpublishConfirmSong.id,
        expected_revision: unpublishConfirmSong.current_revision,
      })
      onSongUnpublished?.(unpublishConfirmSong.id)
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('gtar-shared-catalog-cache-updated'))

      // Remove from in-memory list
      setSongs((prev) => prev.filter((s) => s.id !== unpublishConfirmSong.id))
      setTotalCount((prev) => Math.max(0, prev - 1))
      if (previewSong && previewSong.id === unpublishConfirmSong.id) {
        setPreviewSong(null)
      }
      setImportFeedback(`Unpublished "${unpublishConfirmSong.title}"`)
      setTimeout(() => setImportFeedback(null), 3500)
      setUnpublishConfirmSong(null)
    } catch (err: unknown) {
      if (err instanceof CatalogApiError && (err.status === 409 || err.code === 'REVISION_CONFLICT')) {
        setUnpublishError('Revision conflict: song was modified. Please refresh.')
      } else if (err instanceof CatalogApiError && err.status === 403) {
        setUnpublishError('Forbidden: Only the original publisher or an admin can unpublish this shared song.')
      } else {
        setUnpublishError(err instanceof Error ? err.message : 'Failed to unpublish song.')
      }
    } finally {
      setIsUnpublishing(false)
    }
  }

  return (
    <div className="shared-catalog-browser space-y-4" data-testid="shared-catalog-browser">
      <nav aria-label="Shared Catalog content" className="flex items-center gap-2 mb-3">
        <button
          type="button"
          data-testid="catalog-tab-songs"
          aria-pressed={catalogKind === 'songs'}
          onClick={() => setCatalogKind('songs')}
          className={`min-h-11 px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            catalogKind === 'songs'
              ? 'bg-app-action text-app-on-action shadow-sm'
              : 'bg-app-surface border border-app-border text-app-muted hover:text-app-heading hover:border-app-action'
          }`}
        ><Music className="w-3.5 h-3.5" /><span>Songs</span></button>
        <button
          type="button"
          data-testid="catalog-tab-setlists"
          aria-pressed={catalogKind === 'setlists'}
          disabled={!setlistCapability.enabled}
          aria-describedby={!setlistCapability.enabled ? 'setlist-availability' : undefined}
          onClick={() => setCatalogKind('setlists')}
          className={`min-h-11 px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
            catalogKind === 'setlists'
              ? 'bg-app-action text-app-on-action shadow-sm'
              : 'bg-app-surface border border-app-border text-app-muted hover:text-app-heading hover:border-app-action'
          }`}
        ><ListMusic className="w-3.5 h-3.5" /><span>Setlists</span></button>
      </nav>
      {!setlistCapability.enabled && <p id="setlist-availability" role="status" className="text-xs text-app-muted">{setlistCapability.message} <button type="button" className="min-h-11 px-2 underline cursor-pointer" onClick={setlistCapability.reload}>Check availability</button></p>}
      {catalogKind === 'setlists' && setlistCapability.enabled ? <SharedSetlistCatalogPanel /> : <>
      {/* Toast Notification */}
      {importFeedback && (
        <div
          role="status"
          aria-live="polite"
          data-testid="shared-catalog-toast"
          className="p-3 bg-app-surface border border-app-border rounded-xl text-xs font-mono font-bold text-app-heading flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" />
          <span className="flex-1">{importFeedback}</span>
        </div>
      )}

      {/* Toolbar: Search, Refresh, Stale Badge */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
          <input
            type="search"
            data-testid="catalog-search-input"
            placeholder="Search shared songs by title or artist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-app-surface border border-app-border text-xs font-mono text-app-heading placeholder:text-app-muted focus:border-app-action focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 justify-end">
          {/* Status badge: Stale or Offline-Cached */}
          {dataState === 'OFFLINE_CACHED' && (
            <span
              data-testid="catalog-offline-badge"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-status-warning/15 text-status-warning border border-status-warning/30 text-[10px] font-mono font-bold"
              title={isStale ? 'Cached version older than 5 minutes' : 'Showing offline cached catalog'}
            >
              <WifiOff className="w-3 h-3" />
              <span>{isStale ? 'Offline (Stale Cache)' : 'Offline (Cached)'}</span>
            </span>
          )}

          {dataState === 'ONLINE' && isStale && (
            <span
              data-testid="catalog-stale-badge"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-app-muted/15 text-app-muted text-[10px] font-mono"
            >
              <Clock className="w-3 h-3" />
              <span>Stale</span>
            </span>
          )}

          <button
            type="button"
            data-testid="catalog-refresh-button"
            disabled={isRefreshing}
            onClick={handleRefresh}
            className="px-3 py-2 rounded-xl border border-app-border bg-app-surface text-app-heading hover:border-app-action font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
            title="Refresh Shared Catalog"
            aria-label="Refresh Shared Catalog"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* State Renderings */}
      {dataState === 'LOADING' && (
        <div data-testid="catalog-loading-state" className="p-12 text-center rounded-2xl border border-app-border bg-app-surface/40 space-y-3">
          <RefreshCw className="w-6 h-6 mx-auto text-app-action animate-spin" />
          <div className="text-sm font-bold text-app-heading">Loading Shared Catalog...</div>
          <p className="text-xs text-app-muted">Checking network connection and local cache...</p>
        </div>
      )}

      {dataState === 'AUTH_REQUIRED' && (
        <div data-testid="catalog-auth-required-state" className="p-10 text-center rounded-2xl border border-app-border bg-app-surface space-y-3">
          <Lock className="w-8 h-8 mx-auto text-app-accent" />
          <div className="text-base font-bold text-app-heading">Authentication Required</div>
          <p className="text-xs text-app-muted max-w-sm mx-auto">
            You must be signed in with an active GTAR account to browse and import songs from the Shared Catalog.
          </p>
        </div>
      )}

      {dataState === 'ERROR' && (
        <div data-testid="catalog-error-state" className="p-8 text-center rounded-2xl border border-status-error/40 bg-app-surface space-y-3">
          <AlertCircle className="w-7 h-7 mx-auto text-status-error" />
          <div className="text-sm font-bold text-app-heading">Failed to Load Shared Catalog</div>
          <p className="text-xs text-app-muted font-mono">{errorMessage || 'An unexpected network error occurred.'}</p>
          <button
            type="button"
            data-testid="catalog-retry-button"
            onClick={handleRefresh}
            className="mt-2 px-4 py-1.5 rounded-lg bg-app-action text-app-on-action text-xs font-bold font-mono transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {dataState !== 'LOADING' && dataState !== 'AUTH_REQUIRED' && dataState !== 'ERROR' && songs.length === 0 && (
        <div data-testid="catalog-empty-state" className="p-12 text-center rounded-2xl border border-app-border bg-app-surface/50 space-y-3">
          <Globe className="w-8 h-8 mx-auto text-app-action" />
          <div className="text-base font-bold text-app-heading">Shared Catalog is Empty</div>
          <p className="text-xs text-app-muted max-w-sm mx-auto">
            No songs have been published to the shared catalog yet. Be the first to share one of your songs!
          </p>
        </div>
      )}

      {/* Non-empty Songs Listing */}
      {dataState !== 'LOADING' && dataState !== 'AUTH_REQUIRED' && dataState !== 'ERROR' && songs.length > 0 && (
        <div className="space-y-3">
          {filteredSongs.length === 0 ? (
            <div data-testid="catalog-no-search-results" className="p-8 text-center rounded-xl border border-app-border bg-app-surface/30 text-xs text-app-muted">
              No songs match &quot;{searchQuery}&quot;. Try a different query.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5" data-testid="catalog-song-list">
              {filteredSongs.map((song) => {
                const matchingPersonal = findMatchingPersonalSong(song.id)
                const isImporting = importingSongIds.has(song.id)
                const isImported = importedSuccessIds.has(song.id) || Boolean(matchingPersonal)
                const isAuthorOrAdmin = canUserModify(song)

                return (
                  <div
                    key={song.id}
                    data-testid={`catalog-card-${song.id}`}
                    onClick={() => handleOpenPreview(song)}
                    className="p-3 rounded-xl border border-app-border bg-app-surface/70 hover:border-app-action hover:bg-app-surface transition-all cursor-pointer flex flex-col justify-between gap-2.5 group select-none"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-xs sm:text-sm text-app-heading group-hover:text-app-action transition-colors truncate">
                          {song.title}
                        </h3>
                        <span
                          className="px-1.5 py-0.5 rounded bg-app-base border border-app-border text-[9px] font-mono text-app-muted shrink-0"
                          title={`Revision ${song.current_revision}`}
                        >
                          r{song.current_revision}
                        </span>
                      </div>
                      <p className="text-[11px] text-app-muted truncate mt-0.5">
                        {song.artist || 'Unknown Artist'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-app-border/40 text-[10px] font-mono text-app-muted">
                      <div className="flex items-center gap-1.5 truncate">
                        <User className="w-3 h-3 shrink-0" />
                        <span className="truncate" title={`Publisher: ${song.publisher_user_id}`}>
                          {song.publisher_user_id.length > 12
                            ? `${song.publisher_user_id.slice(0, 10)}...`
                            : song.publisher_user_id}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {isAuthorOrAdmin && (
                          <>
                            <button
                              type="button"
                              data-testid={`edit-catalog-${song.id}`}
                              onClick={(e) => handleOpenEdit(song, e)}
                              className="p-1 rounded hover:bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer"
                              title="Edit shared song"
                              aria-label={`Edit ${song.title}`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              data-testid={`unpublish-catalog-${song.id}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setUnpublishConfirmSong(song)
                                setUnpublishError(null)
                              }}
                              className="p-1 rounded hover:bg-status-error/15 text-app-muted hover:text-status-error transition-colors cursor-pointer"
                              title="Unpublish song"
                              aria-label={`Unpublish ${song.title}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          data-testid={`import-btn-${song.id}`}
                          disabled={isImporting}
                          onClick={(e) => handleImport(song, e)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold font-mono flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50 ${
                            isImported
                              ? 'bg-status-success/20 text-status-success border border-status-success/40'
                              : 'bg-app-action text-app-on-action hover:bg-app-action/90'
                          }`}
                          title={matchingPersonal ? (matchingPersonal.publishedCatalogSongId === song.id ? "Already published from My Songs" : "Already in My Songs") : "Import copy to My Songs"}
                          aria-label={`Import ${song.title} to My Songs`}
                        >
                          <Download className="w-3 h-3" />
                          <span>{isImported ? 'Imported' : isImporting ? 'Importing...' : 'Import'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Bounded Pagination Controls */}
          <div
            data-testid="catalog-pagination"
            className="flex items-center justify-between pt-3 border-t border-app-border text-xs font-mono text-app-muted px-1"
          >
            <span>
              Showing {songs.length} of {totalCount} songs
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="catalog-prev-page"
                disabled={pageOffset <= 0}
                onClick={() => setPageOffset((prev) => Math.max(0, prev - DEFAULT_PAGE_LIMIT))}
                className="px-2.5 py-1 rounded-lg border border-app-border bg-app-surface text-app-heading disabled:opacity-30 disabled:cursor-not-allowed hover:border-app-action flex items-center gap-1 cursor-pointer transition-colors"
                aria-label="Previous Page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Prev</span>
              </button>
              <button
                type="button"
                data-testid="catalog-next-page"
                disabled={!hasMore}
                onClick={() => setPageOffset((prev) => prev + DEFAULT_PAGE_LIMIT)}
                className="px-2.5 py-1 rounded-lg border border-app-border bg-app-surface text-app-heading disabled:opacity-30 disabled:cursor-not-allowed hover:border-app-action flex items-center gap-1 cursor-pointer transition-colors"
                aria-label="Next Page"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Song Detail / Preview Modal */}
      {previewSong && (
        <dialog
          open
          data-testid="catalog-preview-modal"
          onCancel={() => setPreviewSong(null)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90vh] rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 flex flex-col overflow-hidden"
        >
          <div className="p-4 sm:p-5 flex items-center justify-between border-b border-app-border/60">
            <div className="min-w-0 pr-3">
              <h2 className="text-base font-bold text-app-heading truncate">{previewSong.title}</h2>
              <p className="text-xs text-app-muted truncate mt-0.5">{previewSong.artist || 'Unknown Artist'}</p>
            </div>
            <button
              type="button"
              data-testid="close-catalog-preview"
              onClick={() => setPreviewSong(null)}
              className="p-1 rounded-lg hover:bg-app-base text-app-muted hover:text-app-heading cursor-pointer"
              aria-label="Close Preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
            {/* Metadata Badges */}
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
              <span className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                Key: {previewSong.key || 'N/A'}
              </span>
              <span className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                Revision: r{previewSong.current_revision}
              </span>
              <span className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                Format: {previewSong.format}
              </span>
              <span className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted">
                Publisher: {previewSong.publisher_user_id}
              </span>
            </div>

            {/* Content Preview */}
            <div className="rounded-xl border border-app-border bg-app-base p-3 font-mono text-xs whitespace-pre-wrap max-h-64 overflow-y-auto select-text leading-relaxed">
              {previewSong.raw_content}
            </div>

            {/* Revision History */}
            {isLoadingDetails ? (
              <div className="py-2 text-xs font-mono text-app-muted flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-app-action" />
                <span>Loading revision history...</span>
              </div>
            ) : revisions.length > 0 ? (
              <div className="space-y-1.5 pt-2 border-t border-app-border/40">
                <div className="text-xs font-bold font-mono text-app-heading flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-app-accent" />
                  <span>Revision History ({revisions.length})</span>
                </div>
                <div className="space-y-1 text-[11px] font-mono text-app-muted max-h-32 overflow-y-auto">
                  {revisions.map((rev) => (
                    <div key={rev.id} className="p-1.5 rounded bg-app-base/60 flex items-center justify-between">
                      <span>
                        r{rev.revision}: {rev.change_summary || 'No summary'}
                      </span>
                      <span className="text-[10px] opacity-70">
                        {new Date(rev.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="p-4 border-t border-app-border/60 flex justify-end gap-2 font-mono text-xs font-bold">
            <button
              type="button"
              onClick={() => setPreviewSong(null)}
              className="px-3.5 py-2 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              data-testid="preview-import-btn"
              disabled={importingSongIds.has(previewSong.id)}
              onClick={() => handleImport(previewSong)}
              className="px-4 py-2 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Import to My Songs</span>
            </button>
          </div>
        </dialog>
      )}

      {/* Edit Shared Song Modal */}
      {editingSong && (
        <dialog
          open
          data-testid="catalog-edit-modal"
          onCancel={() => setEditingSong(null)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90vh] rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 flex flex-col overflow-hidden"
        >
          <div className="p-4 border-b border-app-border/60 flex items-center justify-between">
            <h2 className="text-sm font-bold text-app-heading flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-app-action" />
              <span>Edit Shared Song (r{editingSong.current_revision})</span>
            </h2>
            <button
              type="button"
              onClick={() => setEditingSong(null)}
              className="p-1 rounded-lg hover:bg-app-base text-app-muted hover:text-app-heading cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveEdit} className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
            {editError && (
              <div data-testid="edit-error-banner" className="p-2.5 rounded-lg bg-status-error/15 border border-status-error/30 text-status-error text-xs font-mono font-medium">
                {editError}
              </div>
            )}

            <div>
              <label htmlFor="edit-song-title" className="text-[11px] font-mono font-bold text-app-muted block mb-1">
                Song Title
              </label>
              <input
                id="edit-song-title"
                data-testid="edit-song-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
                className="w-full rounded-lg border border-app-border bg-app-base p-2 text-xs font-mono text-app-heading focus:border-app-action focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="edit-song-artist" className="text-[11px] font-mono font-bold text-app-muted block mb-1">
                Artist (Optional)
              </label>
              <input
                id="edit-song-artist"
                data-testid="edit-song-artist"
                type="text"
                value={editArtist}
                onChange={(e) => setEditArtist(e.target.value)}
                className="w-full rounded-lg border border-app-border bg-app-base p-2 text-xs font-mono text-app-heading focus:border-app-action focus:outline-none"
              />
            </div>

            <div className="flex-1 flex flex-col min-h-36">
              <label htmlFor="edit-song-content" className="text-[11px] font-mono font-bold text-app-muted block mb-1">
                Lyrics &amp; Chords
              </label>
              <textarea
                id="edit-song-content"
                data-testid="edit-song-content"
                value={editRawContent}
                onChange={(e) => setEditRawContent(e.target.value)}
                required
                className="w-full flex-1 rounded-lg border border-app-border bg-app-base p-2.5 font-mono text-xs text-app-heading focus:border-app-action focus:outline-none resize-none leading-relaxed"
              />
            </div>

            <div>
              <label htmlFor="edit-song-summary" className="text-[11px] font-mono font-bold text-app-muted block mb-1">
                Change Summary (Optional)
              </label>
              <input
                id="edit-song-summary"
                data-testid="edit-song-summary"
                type="text"
                placeholder="e.g. Corrected chorus chords"
                value={editChangeSummary}
                onChange={(e) => setEditChangeSummary(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-app-border bg-app-base p-2 text-xs font-mono text-app-heading focus:border-app-action focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-app-border/40 font-mono text-xs font-bold">
              <button
                type="button"
                onClick={() => setEditingSong(null)}
                className="px-3.5 py-1.5 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="save-edit-submit"
                disabled={isUpdating || !editTitle.trim() || !editRawContent.trim()}
                className="px-4 py-1.5 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 transition-colors cursor-pointer disabled:opacity-40"
              >
                {isUpdating ? 'Saving...' : 'Save New Revision'}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {/* Duplicate Import Warning Modal */}
      {duplicateImportSong && (
        <dialog
          open
          data-testid="duplicate-import-modal"
          onCancel={() => setDuplicateImportSong(null)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-amber-500/60 bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 text-amber-400 mb-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-base font-bold text-app-heading">Already in My Songs</h2>
            </div>
            <p className="text-xs text-app-muted leading-relaxed mb-4">
              A matching copy of &quot;{duplicateImportSong.title}&quot; is already in your songbook. Importing again will create another independent personal copy with its own edits.
            </p>
            <div className="flex justify-end gap-2 font-mono text-xs font-bold">
              <button
                type="button"
                data-testid="cancel-duplicate-import-btn"
                onClick={() => setDuplicateImportSong(null)}
                className="px-3.5 py-2 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-duplicate-import-btn"
                onClick={() => {
                  const songToImport = duplicateImportSong
                  setDuplicateImportSong(null)
                  executeImport(songToImport)
                }}
                className="px-4 py-2 rounded-lg bg-amber-500/90 text-black hover:bg-amber-400 transition-colors cursor-pointer"
              >
                Import Another Copy
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Unpublish Confirmation Modal */}
      {unpublishConfirmSong && (
        <dialog
          open
          data-testid="unpublish-confirm-modal"
          onCancel={() => setUnpublishConfirmSong(null)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-status-error/60 bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 text-status-error mb-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-base font-bold text-app-heading">Unpublish Shared Song?</h2>
            </div>
            <p className="text-xs text-app-muted leading-relaxed mb-3">
              Are you sure you want to unpublish &quot;{unpublishConfirmSong.title}&quot;? It will no longer be visible to other members. All revision history will be preserved.
            </p>
            {unpublishError && (
              <p data-testid="unpublish-error-text" className="text-xs text-status-error font-mono font-medium mb-3">
                {unpublishError}
              </p>
            )}
            <div className="flex justify-end gap-2 font-mono text-xs font-bold">
              <button
                type="button"
                data-testid="cancel-unpublish-btn"
                onClick={() => setUnpublishConfirmSong(null)}
                className="px-3.5 py-2 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-unpublish-btn"
                disabled={isUnpublishing}
                onClick={handleConfirmUnpublish}
                className="px-4 py-2 rounded-lg bg-status-error text-white hover:bg-status-error/90 transition-colors cursor-pointer disabled:opacity-40"
              >
                {isUnpublishing ? 'Unpublishing...' : 'Unpublish'}
              </button>
            </div>
          </div>
        </dialog>
      )}
      </>}
    </div>
  )
}
