import { SetlistExplorer } from './SetlistExplorer'
import { ExplorerNavigation, type ExplorerTarget } from './ExplorerNavigation'
import { normalizeTags, matchesSongTags } from '../utils/songTags'
import { SetlistCloudStatusBadge } from './SetlistCloudStatusBadge'
import { useSetlistPublicationStatuses } from '../utils/useSetlistPublicationStatuses'
import { useSharedSetlists } from '../utils/useSharedSetlists'
import { SongSetlistDialog } from './SongSetlistDialog'
import { DuplicateReviewDialog } from './DuplicateReviewDialog'
import { ExportSongsDialog } from './ExportSongsDialog'
import { resolveSetlistSongIndexed, songIdIndex } from '../utils/setlistSongs'
import { DropdownPortal } from './DropdownPortal'
import React, { useState, useMemo, useRef, useCallback } from 'react'
import { useListWindow } from '../utils/listWindow'
import {
  ListPlus,
  Music,
  Play,
  Trash2,
  AlertTriangle,
  Layers,
  ArrowRight,
  X,
  Upload,
  Pencil,
  Share2,
  MoreHorizontal,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { exportSingleSetlistJson, parseBackupJson } from '../utils/jsonBackup'
import { getSongMetadataStatus } from '../utils/chordProMetadata'
import { extractShareToken, type SharedSetlistPayload } from '../utils/sharedSetlist'
import { Link, QrCode, Globe, UploadCloud, CloudCheck, CloudDownload } from 'lucide-react'
import { SongStatusBadge } from './SongStatusBadge'
import { resolvePublishedProvenance, resolveImportedProvenance, type CatalogSongMetadataLookup } from '../utils/sharedCatalogProvenance'
import type { SharedCatalogSongItem } from '../types/sharedCatalog'
import { sharedCatalogService } from '../utils/sharedCatalogService'
import { SwipeableActionCard } from './SwipeableActionCard'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { SharedCatalogBrowser } from './SharedCatalogBrowser'
import { findCatalogDuplicates } from '../utils/catalogDuplicateAdvisory'
import { publishSharedCatalogSong } from '../utils/sharedCatalogClient'
import { CatalogApiError } from '../types/sharedCatalog'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { getStoredSessionStatus, hasServerApproval } from '../utils/googleAuth'

interface SongbookHomeViewProps {
  explorerEnabled?: boolean
  onSongMembershipChange: (songId: string | number, setlistId: string | number, included: boolean) => boolean
  onCreateSetlistForSong: (songId: string | number, name: string) => boolean
  songs: ActiveSongState[]
  activeSongIndex: number
  onSelectSong: (index: number) => void
  onNewSong: () => void
  onNewSetlist?: () => void
  onOpenSetlists: () => void
  onOpenSongbook?: () => void
  onManageSetlist?: (setlist: WebSetlist) => void
  onDeleteSong: (index: number) => void
  onDeleteSetlist?: (setlistId: string | number) => void
  onRenameSetlist?: (setlistId: string | number, newName: string) => void
  setlists?: WebSetlist[]
  onSelectSetlistSong?: (setlistId: string | number, songIdx: number) => void
  onImportSingleSetlist?: (setlist: WebSetlist, songs: ActiveSongState[]) => void
  searchQuery?: string
  onSearchQueryChange?: (query: string) => void
  onBulkDeleteSongs?: (songIds: Array<string | number>) => void
  onBulkAddSongsToSetlist?: (songIds: Array<string | number>, setlistId: string | number) => boolean
  onBulkDeleteSetlists?: (setlistIds: Array<string | number>) => void
  onPublishSetlist?: (setlist: WebSetlist) => void
  onShareSetlist?: (setlist: WebSetlist) => void
  onImportSharedSetlist?: (shared: SharedSetlistPayload) => void
  onImportSharedCatalogSong?: (song: ActiveSongState) => boolean | void
  /** #149: Songs Library ⋯ menu → the existing song import dialog. */
  onOpenImportSongs?: () => void
  /** #149 S2: duplicate check → Move to Trash, after re-pointing setlist refs. */
  onTrashDuplicates?: (trash: string[], repoint: Record<string, string>) => boolean
  onUpdateSong?: (updated: Partial<ActiveSongState>) => boolean | void
  confirmedCatalogIds?: Set<string>
  freshCatalogIds?: Set<string>
  catalogMetadata?: Map<string, CatalogSongMetadataLookup | SharedCatalogSongItem>
  initialTab?: 'my_songs' | 'setlists' | 'shared_catalog'
}

export const SongbookHomeView: React.FC<SongbookHomeViewProps> = ({
  songs,
  onSongMembershipChange,
  onCreateSetlistForSong,
  activeSongIndex,
  onSelectSong,
  onNewSong,
  onNewSetlist,
  onOpenSetlists,
  onManageSetlist,
  onDeleteSong,
  onDeleteSetlist,
  onRenameSetlist,
  setlists = [],
  onSelectSetlistSong,
  onImportSingleSetlist,
  searchQuery: externalSearchQuery,
  onSearchQueryChange,
  onBulkDeleteSongs,
  onBulkAddSongsToSetlist,
  onBulkDeleteSetlists,
  onShareSetlist,
  onPublishSetlist,
  onImportSharedSetlist,
  onImportSharedCatalogSong,
  onOpenImportSongs,
  onTrashDuplicates,
  onUpdateSong,
  confirmedCatalogIds: propConfirmedCatalogIds,
  freshCatalogIds: propFreshCatalogIds,
  catalogMetadata: propCatalogMetadata,
  initialTab,
  explorerEnabled = false,
}) => {
  const [membershipSongId, setMembershipSongId] = useState<string | number | null>(null)
  const membershipSong = songs.find(song => membershipSongId !== null && String(song.id) === String(membershipSongId))
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null)
  const [confirmDeleteSetlistId, setConfirmDeleteSetlistId] = useState<string | number | null>(null)
  const [activeMenuSetlistId, setActiveMenuSetlistId] = useState<string | number | null>(null)
  const [activeMenuSongIdx, setActiveMenuSongIdx] = useState<number | null>(null)
  // Anchor elements for portal-positioned kebab menus (set on click, not read in render)
  const [setlistMenuAnchor, setSetlistMenuAnchor] = useState<HTMLElement | null>(null)
  const [songMenuAnchor, setSongMenuAnchor] = useState<HTMLElement | null>(null)
  const [renamingSetlist, setRenamingSetlist] = useState<WebSetlist | null>(null)
  const [renameInputValue, setRenameInputValue] = useState('')
  const [internalSearchQuery, setInternalSearchQuery] = useState('')
  const searchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery
  const handleSearchChange = (val: string) => {
    if (onSearchQueryChange) onSearchQueryChange(val)
    else setInternalSearchQuery(val)
  }
  const setlistFileInputRef = useRef<HTMLInputElement>(null)

  const activeSetlists = useMemo(() => setlists.filter(sl => !sl.isDeleted), [setlists])

  // Dialog state for Share Setlist chooser (when multiple active setlists exist)
  const [isShareChooserOpen, setIsShareChooserOpen] = useState(false)

  // Dialog state for Link-first Setlist Import
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [pastedShareLink, setPastedShareLink] = useState('')
  const [importLinkError, setImportLinkError] = useState<string | null>(null)
  const [isResolvingLink, setIsResolvingLink] = useState(false)

  // Metadata filter: 'ALL' | 'METADATA_OK' | 'NEEDS_METADATA'
  type MetadataFilterOption = 'ALL' | 'METADATA_OK' | 'NEEDS_METADATA'
  const [filterMetadata, setFilterMetadata] = useState<MetadataFilterOption>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gtar_songbook_filter_metadata')
      if (saved === 'ALL' || saved === 'METADATA_OK' || saved === 'NEEDS_METADATA') {
        return saved
      }
    }
    return 'ALL'
  })

  const handleFilterMetadataChange = (val: MetadataFilterOption) => {
    setFilterMetadata(val)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_songbook_filter_metadata', val)
    }
  }

  // Setlist multi-selection state
  const [isSetlistSelectionMode, setIsSetlistSelectionMode] = useState(false)
  const [selectedSetlistIds, setSelectedSetlistIds] = useState<Set<string | number>>(() => new Set())
  const [isBulkDeleteSetlistsConfirmOpen, setIsBulkDeleteSetlistsConfirmOpen] = useState(false)

  // Navigation tab state: 'my_songs' (default) vs 'shared_catalog'
  const [activeTab, setActiveTab] = useState<'my_songs' | 'setlists' | 'shared_catalog'>(initialTab || 'my_songs')

  const [explorerTag, setExplorerTag] = useState<string | null>(null)
  const [unfiledSetlists, setUnfiledSetlists] = useState(false)
  const [explorerSetlistId, setExplorerSetlistId] = useState<string | number | null>(null)
  const explorerSetlist = explorerEnabled && activeTab === 'setlists'
    ? activeSetlists.find(sl => explorerSetlistId !== null && String(sl.id) === String(explorerSetlistId))
    : undefined
  const explorerSelection: ExplorerTarget | null = activeTab === 'shared_catalog' ? null
    : activeTab === 'setlists' ? explorerSetlist ? { type: 'setlist', id: explorerSetlist.id } : { type: unfiledSetlists ? 'unfiled' : 'setlists' }
    : explorerTag ? { type: 'tag', tag: explorerTag } : { type: 'all' }

  // Auth context for publishing permissions
  const auth = useOptionalGoogleAuth()
  const userRole = auth?.session?.role || auth?.session?.user.role
  const isUserApproved = auth?.accessStatus === 'active' || hasServerApproval(auth?.session)
  const canPublishSetlist = (userRole === 'admin' || userRole === 'member') && isUserApproved
  const setlistCapability = useSharedSetlists(canPublishSetlist)
  const setlistStatusMap = useSetlistPublicationStatuses({
    setlists,
    songs,
    accountId: auth?.session?.user?.id || getStoredSessionStatus().session?.user?.id,
    setlistCapability,
  })
  const storedAuthStatus = getStoredSessionStatus()
  const isAuthActive = auth
    ? !!auth.session && auth.accessStatus === 'active'
    : !storedAuthStatus.isExpired && hasServerApproval(storedAuthStatus.session)

  const onUpdateSongRef = useRef(onUpdateSong)
  React.useEffect(() => {
    onUpdateSongRef.current = onUpdateSong
  }, [onUpdateSong])

  // Confirmed published catalog song IDs (server authoritative)
  const [localConfirmedCatalogIds, setLocalConfirmedCatalogIds] = useState<Set<string>>(() => new Set())
  const confirmedCatalogIds = useMemo(() => {
    const set = new Set(localConfirmedCatalogIds)
    if (propConfirmedCatalogIds) {
      for (const id of propConfirmedCatalogIds) set.add(id)
    }
    return set
  }, [propConfirmedCatalogIds, localConfirmedCatalogIds])
  const [localCatalogMetadata, setLocalCatalogMetadata] = useState<Map<string, CatalogSongMetadataLookup | SharedCatalogSongItem>>(() => sharedCatalogService.getCatalogMetadataMap())
  React.useEffect(() => {
    const handleUpdate = () => setLocalCatalogMetadata(sharedCatalogService.getCatalogMetadataMap())
    window.addEventListener('gtar-shared-catalog-cache-updated', handleUpdate)
    window.addEventListener('storage', handleUpdate)
    return () => {
      window.removeEventListener('gtar-shared-catalog-cache-updated', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [])
  const catalogMetadataMap = useMemo(() => {
    const map = new Map(localCatalogMetadata)
    if (propCatalogMetadata) {
      for (const [k, v] of propCatalogMetadata.entries()) {
        map.set(k, v)
      }
    }
    return map
  }, [localCatalogMetadata, propCatalogMetadata])

  const freshCatalogIds = useMemo(() => {
    const serviceFresh = sharedCatalogService.getFreshConfirmedCatalogIds()
    const set = new Set(serviceFresh)
    if (propFreshCatalogIds) {
      for (const id of propFreshCatalogIds) set.add(id)
    }
    return set
  }, [propFreshCatalogIds])


  // Sync active account and refresh confirmed publication IDs
  React.useEffect(() => {
    const accountId = auth?.session?.user?.id || auth?.session?.user?.email || null
    sharedCatalogService.setAccount(accountId)
    let active = true
    sharedCatalogService.getConfirmedActiveCatalogIds().then((ids) => {
      if (active) setLocalConfirmedCatalogIds(ids)
    }).catch((err) => {
      void err
    })
    return () => {
      active = false
    }
  }, [auth?.session?.user?.id, auth?.session?.user?.email])

  // Publishing state for eligible personal songs
  const [publishingSong, setPublishingSong] = useState<ActiveSongState | null>(null)
  const [publishChangeSummary, setPublishChangeSummary] = useState('')
  const [isSubmittingPublish, setIsSubmittingPublish] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccessNotice, setPublishSuccessNotice] = useState<string | null>(null)
  const [publishRecoveryCatalogId, setPublishRecoveryCatalogId] = useState<string | null>(null)

  const handleOpenPublishModal = (song: ActiveSongState) => {
    setPublishingSong(song)
    setPublishChangeSummary('')
    setPublishError(null)
    setPublishRecoveryCatalogId(null)
  }

  const handleRetrySaveLink = () => {
    if (!publishingSong || !publishRecoveryCatalogId) return
    const saveOutcome = onUpdateSongRef.current ? onUpdateSongRef.current({ id: publishingSong.id, publishedCatalogSongId: publishRecoveryCatalogId }) : false
    if (saveOutcome === true) {
      setLocalConfirmedCatalogIds(prev => new Set(prev).add(publishRecoveryCatalogId))
      sharedCatalogService.markCatalogIdLiveConfirmed(publishRecoveryCatalogId)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gtar-shared-catalog-cache-updated'))
      }
      setPublishSuccessNotice(`Published "${publishingSong.title}" to Shared Catalog!`)
      setPublishingSong(null)
      setPublishRecoveryCatalogId(null)
      setPublishError(null)
      setTimeout(() => setPublishSuccessNotice(null), 4000)
    } else {
      setPublishError(
        `Published to Shared Catalog (Catalog ID: ${publishRecoveryCatalogId}), but saving association to local songbook failed. Retry Save Link or copy Catalog ID.`
      )
    }
  }

  // #253 non-blocking duplicate advisory against the cached Shared Catalog.
  const [focusCatalogSongId, setFocusCatalogSongId] = useState<string | null>(null)
  const publishDuplicates = useMemo(
    () => publishingSong ? findCatalogDuplicates(publishingSong, catalogMetadataMap.values()) : [],
    [publishingSong, catalogMetadataMap],
  )

  const handleConfirmPublish = async () => {
    if (!publishingSong) return
    if (!isAuthActive) {
      setPublishError('Active authenticated membership is required to publish songs to the Shared Catalog.')
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setPublishError('Publishing is unavailable while offline. Please reconnect to the internet.')
      return
    }

    setIsSubmittingPublish(true)
    setPublishError(null)

    try {
      const res = await publishSharedCatalogSong({
        title: publishingSong.title,
        artist: publishingSong.artist || null,
        key: publishingSong.key || null,
        original_key: publishingSong.originalKey || null,
        capo: publishingSong.capo || null,
        bpm: publishingSong.bpm || null,
        time_signature: publishingSong.time || null,
        year: publishingSong.year || null,
        raw_content: publishingSong.rawContent,
        format: publishingSong.format || 'CHORD_PRO',
        change_summary: publishChangeSummary.trim() || undefined,
      })

      const catalogId = res.song?.id
      if (!catalogId) {
        throw new Error('Authoritative server catalog ID was not returned by publication API.')
      }

      // Authoritative remote publication succeeded. Verify personal song save.
      const saveOutcome = onUpdateSongRef.current ? onUpdateSongRef.current({ id: publishingSong.id, publishedCatalogSongId: catalogId }) : false
      if (saveOutcome === true) {
        setLocalConfirmedCatalogIds(prev => new Set(prev).add(catalogId))
        await sharedCatalogService.markPublishedSong(res.song)
        setPublishSuccessNotice(
          res.deduplicated
            ? `Song "${publishingSong.title}" is already published in Shared Catalog`
            : `Published "${publishingSong.title}" to Shared Catalog!`
        )
        setPublishingSong(null)
        setPublishRecoveryCatalogId(null)
        setTimeout(() => setPublishSuccessNotice(null), 4000)
      } else {
        // Remote published but personal link persistence failed/inconclusive.
        // Preserve recovery info and DO NOT show full success notice.
        setPublishRecoveryCatalogId(catalogId)
        setLocalConfirmedCatalogIds(prev => new Set(prev).add(catalogId))
        await sharedCatalogService.markPublishedSong(res.song)
        setPublishError(
          `Published to Shared Catalog (Catalog ID: ${catalogId}), but saving association to local songbook failed. Click "Retry Save Link" to link locally without re-publishing.`
        )
      }
    } catch (err: unknown) {
      if (err instanceof CatalogApiError) {
        if (err.status === 401) {
          setPublishError('Authentication required. Please sign in to publish songs.')
        } else if (err.status === 403) {
          setPublishError('Permission denied: Only active members can publish to the Shared Catalog.')
        } else {
          setPublishError(err.message || 'Failed to publish song.')
        }
      } else {
        setPublishError(err instanceof Error ? err.message : 'Network error publishing song.')
      }
    } finally {
      setIsSubmittingPublish(false)
    }
  }

  // Song multi-selection state
  const [isSongSelectionMode, setIsSongSelectionMode] = useState(false)
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string | number>>(() => new Set())
  const [isBulkDeleteSongsConfirmOpen, setIsBulkDeleteSongsConfirmOpen] = useState(false)
  const [isBulkAddToSetlistModalOpen, setIsBulkAddToSetlistModalOpen] = useState(false)

  // Prune deleted song IDs if library shrinks while keeping selection stable across filter/sort
  React.useEffect(() => {
    queueMicrotask(() => {
      setSelectedSongIds(prev => {
        if (prev.size === 0) return prev
        const validKeys = new Set(songs.map((s, idx) => s.id ?? idx))
        let changed = false
        const next = new Set<string | number>()
        for (const id of prev) {
          if (validKeys.has(id)) next.add(id)
          else changed = true
        }
        return changed ? next : prev
      })
    })
  }, [songs])

  // Prune deleted setlist IDs if activeSetlists shrinks while keeping selection stable across filter/sort
  React.useEffect(() => {
    queueMicrotask(() => {
      setSelectedSetlistIds(prev => {
        if (prev.size === 0) return prev
        const validKeys = new Set(activeSetlists.map(sl => sl.id))
        let changed = false
        const next = new Set<string | number>()
        for (const id of prev) {
          if (validKeys.has(id)) next.add(id)
          else changed = true
        }
        return changed ? next : prev
      })
    })
  }, [activeSetlists])

  // Membership popover state
  const [membershipPopoverSongId, setMembershipPopoverSongId] = useState<string | number | null>(null)
  const [membershipPopoverAnchor, setMembershipPopoverAnchor] = useState<HTMLElement | null>(null)

  const toggleSongSelection = (id: string | number) => {
    setSelectedSongIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSetlistSelection = (id: string | number) => {
    setSelectedSetlistIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirmBulkDeleteSongs = () => {
    const ids = Array.from(selectedSongIds)
    if (onBulkDeleteSongs) {
      onBulkDeleteSongs(ids)
    } else {
      const idSet = new Set(ids.map(String))
      const indicesToDelete = songs
        .map((s, idx) => ({ id: s.id, idx }))
        .filter(item => item.id !== undefined && idSet.has(String(item.id)))
        .map(item => item.idx)
        .sort((a, b) => b - a)
      indicesToDelete.forEach(idx => onDeleteSong(idx))
    }
    setSelectedSongIds(new Set())
    setIsSongSelectionMode(false)
    setIsBulkDeleteSongsConfirmOpen(false)
  }

  const handleConfirmBulkAddToSetlist = (destSetlistId: string | number) => {
    const ids = Array.from(selectedSongIds)
    if (onBulkAddSongsToSetlist) {
      onBulkAddSongsToSetlist(ids, destSetlistId)
    } else {
      ids.forEach(id => onSongMembershipChange(id, destSetlistId, true))
    }
    setSelectedSongIds(new Set())
    setIsSongSelectionMode(false)
    setIsBulkAddToSetlistModalOpen(false)
  }

  const handleConfirmBulkDeleteSetlists = () => {
    const ids = Array.from(selectedSetlistIds)
    if (onBulkDeleteSetlists) {
      onBulkDeleteSetlists(ids)
    } else if (onDeleteSetlist) {
      ids.forEach(id => onDeleteSetlist(id))
    }
    setSelectedSetlistIds(new Set())
    setIsSetlistSelectionMode(false)
    setIsBulkDeleteSetlistsConfirmOpen(false)
  }

  const closeAllMenus = useCallback(() => {
    setActiveMenuSetlistId(null)
    setActiveMenuSongIdx(null)
    setSetlistMenuAnchor(null)
    setSongMenuAnchor(null)
    setMembershipPopoverSongId(null)
    setMembershipPopoverAnchor(null)
  }, [])

  const handleSetlistImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseBackupJson(text, { mode: 'merge', existingSongs: songs })
      if (parsed.isValid && parsed.setlists.length > 0) {
        onImportSingleSetlist?.(parsed.setlists[0], parsed.songs)
      } else {
        alert(parsed.error || 'Failed to parse setlist file.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      alert(`Import error: ${msg}`)
    }

    if (e.target) e.target.value = ''
  }

  const [setlistsCollapsed, setSetlistsCollapsed] = useState(() => {
    try { return localStorage.getItem('gtar_songbook_setlists_collapsed') === 'true' } catch { return false }
  })
  const toggleSetlists = () => {
    const next = !setlistsCollapsed
    setSetlistsCollapsed(next)
    if (next) {
      setIsSetlistSelectionMode(false)
      setSelectedSetlistIds(new Set())
    }
    try { localStorage.setItem('gtar_songbook_setlists_collapsed', String(next)) } catch { /* Session preference remains usable. */ }
  }

  // #149: no Key sort or Key filter. A saved 'key' sort falls back to title.
  type SortOption = 'title' | 'artist' | 'date'
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gtar_songbook_sort')
      if (saved === 'title' || saved === 'artist' || saved === 'date') {
        return saved
      }
    }
    return 'title'
  })
  const [libraryMenuAnchor, setLibraryMenuAnchor] = useState<HTMLElement | null>(null)
  const [isDuplicateReviewOpen, setIsDuplicateReviewOpen] = useState(false)
  const [isExportSongsOpen, setIsExportSongsOpen] = useState(false)
  const [setlistsMenuAnchor, setSetlistsMenuAnchor] = useState<HTMLElement | null>(null)

  const [filterSetlistId, setFilterSetlistId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gtar_songbook_filter_setlist') || 'ALL'
    }
    return 'ALL'
  })

  // #149: Songs Library Hide collapses the song cards (like Song Setlists); filters stay visible.
  // New key: the old gtar_songbook_options_collapsed meant "filters hidden" and must not hide songs.
  const [songsCollapsed, setSongsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('gtar_songbook_songs_collapsed') === 'true'
    } catch {
      return false
    }
  })

  const setSongsCollapsedPersisted = (next: boolean) => {
    setSongsCollapsed(next)
    try {
      localStorage.setItem('gtar_songbook_songs_collapsed', String(next))
    } catch {
      /* Session preference remains usable */
    }
  }

  // Recover safely if persisted filterSetlistId points to a deleted or nonexistent setlist
  React.useEffect(() => {
    if (filterSetlistId !== 'ALL') {
      const exists = activeSetlists.some(sl => String(sl.id) === String(filterSetlistId))
      if (!exists) {
        queueMicrotask(() => {
          setFilterSetlistId('ALL')
          if (typeof window !== 'undefined') {
            localStorage.setItem('gtar_songbook_filter_setlist', 'ALL')
          }
        })
      }
    }
  }, [filterSetlistId, activeSetlists])

  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_songbook_sort', newSort)
    }
  }

  const handleFilterSetlistChange = (slId: string) => {
    setFilterSetlistId(slId)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('gtar_songbook_filter_setlist', slId) } catch { /* Keep the session filter. */ }
    }
  }

  const selectExplorerTarget = (target: ExplorerTarget) => {
    closeAllMenus()
    if (target.type === 'all' || target.type === 'tag') {
      setActiveTab('my_songs')
      setExplorerTag(target.type === 'tag' ? target.tag : null)
      handleFilterSetlistChange('ALL')
      setSongsCollapsedPersisted(false)
    } else {
      setActiveTab('setlists')
      if (target.type !== 'setlist') setUnfiledSetlists(target.type === 'unfiled')
      else if (activeSetlists.find(sl => String(sl.id) === String(target.id))?.folderId) setUnfiledSetlists(false)
      setExplorerSetlistId(target.type === 'setlist' ? target.id : null)
      setSetlistsCollapsed(false)
    }
  }

  // Resolve every setlist reference once per library/setlist change (#139). Previously each
  // song card and filter pass re-resolved every reference by scanning the whole library.
  const songIndex = useMemo(() => songIdIndex(songs), [songs])
  const setlistMemberIds = useMemo(() => new Map(activeSetlists.map(sl => [sl,
    new Set(sl.songs.map(ref => resolveSetlistSongIndexed(ref, songs, songIndex)?.id))] as const)), [activeSetlists, songs, songIndex])

  // Find setlists containing a song
  const getSongSetlists = (song: ActiveSongState) => {
    return activeSetlists.filter((sl) => setlistMemberIds.get(sl)?.has(song.id))
  }

  // Map songs with their original index in library
  const indexedSongs = useMemo(() => {
    return songs.map((song, originalIdx) => ({ song, originalIdx }))
  }, [songs])

  // Filter songs
  const filteredIndexedSongs = useMemo(() => {
    return indexedSongs.filter(({ song }) => {
      if (explorerEnabled && explorerTag && !normalizeTags(song.tags).some(tag => tag.toLowerCase() === explorerTag.toLowerCase())) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchTitle = song.title?.toLowerCase().includes(q)
        const matchArtist = song.artist?.toLowerCase().includes(q)
        if (!matchTitle && !matchArtist && !matchesSongTags(song.tags, q)) return false
      }

      if (filterSetlistId !== 'ALL') {
        const sl = activeSetlists.find((s) => String(s.id) === String(filterSetlistId))
        if (!sl) return false
        if (!setlistMemberIds.get(sl)?.has(song.id)) return false
      }

      if (filterMetadata !== 'ALL') {
        const metaStatus = getSongMetadataStatus(song).status
        if (filterMetadata === 'METADATA_OK' && metaStatus !== 'METADATA_OK') return false
        if (filterMetadata === 'NEEDS_METADATA' && metaStatus !== 'NEEDS_METADATA') return false
      }

      return true
    })
  }, [indexedSongs, searchQuery, filterSetlistId, filterMetadata, activeSetlists, setlistMemberIds, explorerEnabled, explorerTag])

  // Sort songs
  const sortedIndexedSongs = useMemo(() => {
    const list = [...filteredIndexedSongs]
    list.sort((a, b) => {
      if (sortBy === 'title') {
        return (a.song.title || '').localeCompare(b.song.title || '')
      }
      if (sortBy === 'artist') {
        return (a.song.artist || '').localeCompare(b.song.artist || '')
      }
      // 'date' or default order
      return a.originalIdx - b.originalIdx
    })
    return list
  }, [filteredIndexedSongs, sortBy])

  // #252: long lists render only the rows near the viewport (no change below the threshold).
  const songGridRef = useRef<HTMLDivElement>(null)
  const songWindow = useListWindow(sortedIndexedSongs.length, songGridRef, undefined, undefined, activeTab)
  const visibleIndexedSongs = useMemo(() => songWindow.active ? sortedIndexedSongs.slice(songWindow.start, songWindow.end) : sortedIndexedSongs,
    [sortedIndexedSongs, songWindow.active, songWindow.start, songWindow.end])

  // Filter setlists by search query (matching setlist name or tracks inside setlist)
  const filteredSetlists = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return activeSetlists
    return activeSetlists.filter((sl) => {
      const matchName = sl.name.toLowerCase().includes(q)
      const matchSong = (sl.songs || []).some((ref) => {
        const resolved = resolveSetlistSongIndexed(ref, songs, songIndex)
        const t = resolved?.title || ref.title || ''
        const a = resolved?.artist || ref.artist || ''
        return t.toLowerCase().includes(q) || a.toLowerCase().includes(q)
      })
      return matchName || matchSong
    })
  }, [activeSetlists, searchQuery, songs, songIndex])

  type SetlistSortOption = 'manual' | 'title_asc' | 'title_desc' | 'newest' | 'oldest'
  const [setlistSortBy, setSetlistSortBy] = useState<SetlistSortOption>('manual')

  const hasReliableSetlistTimestamps = useMemo(() => {
    return (
      activeSetlists.length > 0 &&
      activeSetlists.every(
        (sl) => typeof sl.createdAt === 'number' && Number.isFinite(sl.createdAt) && sl.createdAt > 0
      )
    )
  }, [activeSetlists])

  const effectiveSetlistSortBy: SetlistSortOption =
    (setlistSortBy === 'newest' || setlistSortBy === 'oldest') && !hasReliableSetlistTimestamps
      ? 'manual'
      : setlistSortBy

  // Display-only sorting for Song Setlists; never mutates or persists reordered setlists
  const sortedSetlists = useMemo(() => {
    if (effectiveSetlistSortBy === 'manual') return filteredSetlists
    const indexed = filteredSetlists.map((sl, idx) => ({ sl, idx }))
    indexed.sort((a, b) => {
      if (effectiveSetlistSortBy === 'title_asc') {
        const cmp = (a.sl.name || '').localeCompare(b.sl.name || '')
        return cmp !== 0 ? cmp : a.idx - b.idx
      }
      if (effectiveSetlistSortBy === 'title_desc') {
        const cmp = (b.sl.name || '').localeCompare(a.sl.name || '')
        return cmp !== 0 ? cmp : a.idx - b.idx
      }
      if (effectiveSetlistSortBy === 'newest') {
        const diff = (b.sl.createdAt ?? 0) - (a.sl.createdAt ?? 0)
        return diff !== 0 ? diff : a.idx - b.idx
      }
      if (effectiveSetlistSortBy === 'oldest') {
        const diff = (a.sl.createdAt ?? 0) - (b.sl.createdAt ?? 0)
        return diff !== 0 ? diff : a.idx - b.idx
      }
      return a.idx - b.idx
    })
    return indexed.map((entry) => entry.sl)
  }, [filteredSetlists, effectiveSetlistSortBy])

  const handleSelectAllSongs = () => {
    setSelectedSongIds((prev) => {
      const next = new Set(prev)
      for (const { song, originalIdx } of sortedIndexedSongs) {
        next.add(song.id ?? originalIdx)
      }
      return next
    })
  }

  const handleSelectNoneSongs = () => {
    setSelectedSongIds(new Set())
  }

  const handleBulkPublishSongs = async () => {
    if (selectedSongIds.size === 0 || isSubmittingPublish) return

    setPublishError(null)
    setPublishSuccessNotice(null)

    if (!isAuthActive) {
      setPublishError('Authentication required: Active approved account needed to publish to the Shared Catalog.')
      return
    }

    const selectedEntries = indexedSongs.filter(({ song, originalIdx }) =>
      selectedSongIds.has(song.id ?? originalIdx)
    )
    if (selectedEntries.length === 0) return

    setIsSubmittingPublish(true)

    const failedIds = new Set<string | number>()
    const newlyConfirmedCatalogIds: string[] = []
    let publishedCount = 0
    let skippedDuplicateCount = 0
    let lastPublishedTitle = ''
    let lastErrorMsg = ''

    try {
      for (const { song, originalIdx } of selectedEntries) {
        const selectionKey = song.id ?? originalIdx

        // Prevent accidental duplicate publication
        if (song.publishedCatalogSongId && confirmedCatalogIds.has(song.publishedCatalogSongId)) {
          skippedDuplicateCount++
          continue
        }

        const title = (song.title || '').trim()
        const content = (
          song.rawContent ||
          (song as unknown as { rawText?: string }).rawText ||
          ''
        ).trim()
        if (!title || !content) {
          failedIds.add(selectionKey)
          lastErrorMsg = `Invalid song "${title || 'Untitled'}": Title and chord chart content are required.`
          continue
        }

        try {
          const res = await publishSharedCatalogSong({
            title,
            artist: song.artist || null,
            key: song.key || null,
            original_key: song.originalKey || null,
            capo: song.capo || null,
            bpm: song.bpm || null,
            time_signature: song.time || null,
            year: song.year || null,
            raw_content: content,
            format: song.format || 'CHORD_PRO',
          })

          const catalogId = res.song?.id
          if (!catalogId) {
            throw new Error('Authoritative server catalog ID was not returned by publication API.')
          }
          await sharedCatalogService.markPublishedSong(res.song)
          newlyConfirmedCatalogIds.push(catalogId)

          let persistedOk = false
          if (song.id !== undefined && onUpdateSongRef.current) {
            try {
              const maybeResult = await onUpdateSongRef.current({
                id: song.id,
                publishedCatalogSongId: catalogId,
              })
              persistedOk = maybeResult !== false
            } catch {
              persistedOk = false
            }
          }

          if (persistedOk) {
            if (res.deduplicated) {
              skippedDuplicateCount++
            } else {
              publishedCount++
              lastPublishedTitle = title
            }
          } else {
            failedIds.add(selectionKey)
            lastErrorMsg = `Published "${title}" (ID: ${catalogId}), but saving link to local songbook failed.`
          }
        } catch (err: unknown) {
          failedIds.add(selectionKey)
          if (err instanceof CatalogApiError) {
            if (err.status === 401) {
              lastErrorMsg = 'Authentication required. Please sign in to publish songs.'
            } else if (err.status === 403) {
              lastErrorMsg = 'Permission denied: Only active members can publish to the Shared Catalog.'
            } else {
              lastErrorMsg = err.message || `Failed to publish "${title}".`
            }
          } else {
            lastErrorMsg = err instanceof Error ? err.message : `Network error publishing "${title}".`
          }
        }
      }

      if (newlyConfirmedCatalogIds.length > 0) {
        setLocalConfirmedCatalogIds((prev) => {
          const next = new Set(prev)
          for (const cid of newlyConfirmedCatalogIds) next.add(cid)
          return next
        })
      }

      if (failedIds.size === 0 && publishedCount > 0) {
        const dupSuffix =
          skippedDuplicateCount > 0 ? ` (${skippedDuplicateCount} already published skipped)` : ''
        const msg =
          publishedCount === 1 && skippedDuplicateCount === 0
            ? `Published "${lastPublishedTitle}" to Shared Catalog`
            : `Published ${publishedCount} ${publishedCount === 1 ? 'song' : 'songs'} to Shared Catalog${dupSuffix}`
        setPublishSuccessNotice(msg)
        setSelectedSongIds(new Set())
        setIsSongSelectionMode(false)
        setTimeout(() => setPublishSuccessNotice(null), 4000)
      } else if (failedIds.size === 0 && publishedCount === 0 && skippedDuplicateCount > 0) {
        setPublishError(
          skippedDuplicateCount === 1
            ? 'Selected song is already published to the Shared Catalog.'
            : `All ${skippedDuplicateCount} selected songs are already published to the Shared Catalog.`
        )
      } else if (publishedCount > 0 && failedIds.size > 0) {
        const dupPart =
          skippedDuplicateCount > 0 ? `, ${skippedDuplicateCount} already published skipped` : ''
        setPublishError(
          `Partial publish: ${publishedCount} published, ${failedIds.size} failed${dupPart}. ${lastErrorMsg}`
        )
        setSelectedSongIds(failedIds)
      } else if (failedIds.size > 0) {
        setPublishError(
          failedIds.size === 1 && lastErrorMsg
            ? lastErrorMsg
            : `Failed to publish ${failedIds.size} selected ${failedIds.size === 1 ? 'song' : 'songs'}. ${lastErrorMsg}`.trim()
        )
        setSelectedSongIds(failedIds)
      }
    } finally {
      setIsSubmittingPublish(false)
    }
  }

  const handleMainShareSetlist = () => {
    if (activeSetlists.length === 0) return
    if (activeSetlists.length === 1) {
      onShareSetlist?.(activeSetlists[0])
    } else {
      setIsShareChooserOpen(true)
    }
  }

  const handleResolvePastedShareLink = async () => {
    setImportLinkError(null)
    const extracted = extractShareToken(pastedShareLink)
    if (!extracted.isValid) {
      setImportLinkError(extracted.error)
      return
    }

    setIsResolvingLink(true)
    try {
      const { session, isExpired } = getStoredSessionStatus()
      const authToken = auth?.session?.sessionToken || auth?.session?.idToken || auth?.session?.token || session?.sessionToken || session?.idToken || session?.token
      if (!authToken || isExpired) {
        throw new Error('Authentication required to view shared setlist.')
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
      }

      const res = await fetch(`/api/setlist/share?token=${encodeURIComponent(extracted.token)}`, { headers })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        if (res.status === 401) {
          throw new Error('Authentication required to view shared setlist.')
        }
        if (res.status === 403) {
          throw new Error('Active account approval required to view shared setlist.')
        }
        if (res.status === 410) {
          throw new Error('This shared setlist link has expired.')
        }
        if (res.status === 404) {
          throw new Error('Shared setlist not found.')
        }
        throw new Error(errData?.error || 'Shared setlist not found or expired.')
      }
      const data = await res.json()
      if (data?.setlist) {
        setIsImportModalOpen(false)
        setPastedShareLink('')
        setImportLinkError(null)
        onImportSharedSetlist?.(data.setlist)
      } else {
        throw new Error('Invalid shared setlist payload received.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setImportLinkError(msg || 'Failed to load shared setlist.')
    } finally {
      setIsResolvingLink(false)
    }
  }

  return (
    <div className="explorer-workspace flex flex-1 min-w-0 min-h-0 relative">
      {explorerEnabled && <ExplorerNavigation songs={songs} setlists={activeSetlists} selection={explorerSelection} onSelect={selectExplorerTarget} />}
    <div className="songbook-ui min-w-0 flex-1 overflow-y-auto px-2 sm:px-8 py-3 sm:py-6 max-w-7xl mx-auto w-full select-none">
      {membershipSong && <SongSetlistDialog
        song={membershipSong}
        setlists={activeSetlists}
        onMembershipChange={onSongMembershipChange}
        onCreate={onCreateSetlistForSong}
        onClose={() => setMembershipSongId(null)}
      />}

            {/* Share Setlist Chooser Modal (when multiple active setlists exist) */}
      {isShareChooserOpen && (
        <dialog
          open
          data-testid="share-setlist-chooser-dialog"
          onCancel={() => setIsShareChooserOpen(false)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-app-surface ui-primary-text text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="ui-section-text font-bold text-sm flex items-center gap-2 ui-primary-text text-app-heading">
                <Share2 className="ui-action-text w-4 h-4 text-app-accent" />
                Select Setlist to Share
              </h2>
              <button
                type="button"
                onClick={() => setIsShareChooserOpen(false)}
                className="p-1 rounded-lg hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs ui-muted-text text-app-muted mb-3">
              Choose a setlist to share:
            </p>
            <div className="max-h-60 overflow-y-auto space-y-1 mb-4">
              {activeSetlists.map((sl) => (
                <button
                  key={sl.id}
                  type="button"
                  data-testid={`share-chooser-target-${sl.id}`}
                  onClick={() => {
                    setIsShareChooserOpen(false)
                    onShareSetlist?.(sl)
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl bg-app-base hover:bg-app-surface border border-app-border hover:border-app-accent text-sm ui-primary-text text-app-text flex items-center justify-between transition-colors cursor-pointer"
                >
                  <span className="font-bold truncate">{sl.name}</span>
                  <span className="text-xs font-mono ui-secondary-text text-app-muted">{sl.songs.length} songs</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsShareChooserOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Link-First Setlist Import Modal */}
      {isImportModalOpen && (
        <dialog
          open
          data-testid="setlist-import-dialog"
          onCancel={() => {
            setIsImportModalOpen(false)
            setImportLinkError(null)
          }}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-app-surface ui-primary-text text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="ui-section-text font-bold text-sm flex items-center gap-2 ui-primary-text text-app-heading">
                <Upload className="ui-action-text w-4 h-4 text-app-action" />
                Import Setlist
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false)
                  setImportLinkError(null)
                }}
                className="p-1 rounded-lg hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Primary Action: Paste GTAR Share Link */}
            <div className="space-y-2 mb-5">
              <label htmlFor="paste-share-link-input" className="text-xs font-bold font-mono ui-primary-text text-app-heading flex items-center gap-1.5">
                <Link className="w-3.5 h-3.5 text-app-action" />
                <span>Paste GTAR Share Link</span>
              </label>
              <p className="text-[11px] ui-muted-text text-app-muted">
                Enter a share link or 16-character token created from GTAR:
              </p>
              <div className="flex items-center gap-2">
                <input
                  id="paste-share-link-input"
                  data-testid="paste-share-link-input"
                  type="text"
                  placeholder="e.g. https://.../?share=0123456789abcdef"
                  value={pastedShareLink}
                  onChange={(e) => {
                    setPastedShareLink(e.target.value)
                    setImportLinkError(null)
                  }}
                  className="flex-1 rounded-lg border border-app-border bg-app-base p-2 text-xs font-mono ui-primary-text text-app-heading focus:border-app-action focus:outline-none"
                />
                <button
                  type="button"
                  data-testid="load-share-link-btn"
                  disabled={!pastedShareLink.trim() || isResolvingLink}
                  onClick={handleResolvePastedShareLink}
                  className="px-3 py-2 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 font-mono text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
                >
                  {isResolvingLink ? 'Loading...' : 'Load'}
                </button>
              </div>
              {importLinkError && (
                <p data-testid="import-link-error" className="text-[11px] text-status-error font-mono font-medium">
                  {importLinkError}
                </p>
              )}
            </div>

            {/* Secondary Action: Legacy JSON file import */}
            <div className="pt-4 border-t border-app-border/60">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold ui-primary-text text-app-heading">
                    Legacy JSON File
                  </div>
                  <div className="text-[10px] ui-secondary-text text-app-muted">
                    Import from a downloaded .json backup
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="choose-setlist-json-file"
                  onClick={() => {
                    setIsImportModalOpen(false)
                    setlistFileInputRef.current?.click()
                  }}
                  className="px-3 py-1.5 rounded-lg border border-app-border hover:border-app-action bg-app-base ui-secondary-text text-app-muted hover:text-app-heading text-xs font-mono font-bold transition-colors cursor-pointer"
                >
                  Select File
                </button>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false)
                  setImportLinkError(null)
                }}
                className="px-3.5 py-1.5 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Publish Song to Shared Catalog Modal Dialog */}
      {publishingSong && (
        <dialog
          open
          data-testid="publish-song-dialog"
          onCancel={() => setPublishingSong(null)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-bold flex items-center gap-2 text-app-heading">
                <UploadCloud className="w-4 h-4 text-app-action" />
                <span>Publish to Shared Catalog</span>
              </h2>
              <button
                type="button"
                onClick={() => setPublishingSong(null)}
                className="p-1 rounded-lg hover:bg-app-base text-app-muted hover:text-app-heading cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div className="p-3 rounded-xl bg-app-base border border-app-border">
                <div className="text-xs font-bold text-app-heading">{publishingSong.title}</div>
                <div className="text-[11px] text-app-muted mt-0.5">{publishingSong.artist || 'Unknown Artist'}</div>
              </div>

              <div className="p-3 rounded-xl bg-status-info/10 border border-status-info/20 text-xs text-app-text space-y-1">
                <p className="font-semibold text-status-info flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  <span>Visible to all active GTAR members</span>
                </p>
                <p className="text-[11px] text-app-muted leading-relaxed">
                  Team members can view it and save their own copy. Yours stays unchanged.
                </p>
              </div>

              <div>
                <label htmlFor="publish-change-summary-input" className="text-[11px] font-mono font-bold text-app-muted block mb-1">
                  Revision Note (Optional)
                </label>
                <input
                  id="publish-change-summary-input"
                  data-testid="publish-change-summary-input"
                  type="text"
                  placeholder="e.g. Initial chart release"
                  value={publishChangeSummary}
                  onChange={(e) => setPublishChangeSummary(e.target.value)}
                  maxLength={150}
                  className="w-full rounded-lg border border-app-border bg-app-base p-2 text-xs font-mono text-app-heading focus:border-app-action focus:outline-none"
                />
              </div>

              {publishDuplicates.length > 0 && !publishRecoveryCatalogId && (
                <div data-testid="publish-duplicate-advisory" role="status" className="p-3 rounded-xl bg-amber-400/10 border border-amber-400/30 text-xs space-y-2">
                  <p className="font-semibold text-status-warning">Similar songs are already in the Shared Catalog</p>
                  <ul className="space-y-1.5">
                    {publishDuplicates.map(dup => (
                      <li key={dup.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 break-words text-app-text">
                          “{dup.title}”{dup.artist ? ` by ${dup.artist}` : ''}
                          <span className="text-app-muted"> · {dup.match === 'chart' ? 'same chart' : 'same lyrics'}</span>
                        </span>
                        <button
                          type="button"
                          data-testid={`open-existing-${dup.id}`}
                          onClick={() => {
                            setPublishingSong(null)
                            setPublishRecoveryCatalogId(null)
                            setFocusCatalogSongId(dup.id)
                            setActiveTab('shared_catalog')
                          }}
                          className="shrink-0 min-h-9 px-2.5 py-1 rounded-lg border border-app-border bg-app-surface text-app-heading hover:border-app-action font-mono font-bold cursor-pointer"
                        >
                          Open existing
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-app-muted">You can still publish your version. Nothing is merged.</p>
                </div>
              )}

              {publishError && (
                <p data-testid="publish-error-text" className="text-[11px] text-status-error font-mono font-medium">
                  {publishError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 font-mono text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setPublishingSong(null)
                  setPublishRecoveryCatalogId(null)
                }}
                className="px-3.5 py-2 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer"
              >
                Cancel
              </button>
              {publishRecoveryCatalogId ? (
                <button
                  type="button"
                  data-testid="retry-save-link-btn"
                  onClick={handleRetrySaveLink}
                  className="px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Retry Save Link</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="confirm-publish-submit-btn"
                  disabled={isSubmittingPublish}
                  onClick={handleConfirmPublish}
                  className="px-4 py-2 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{isSubmittingPublish ? 'Publishing...' : publishDuplicates.length > 0 ? 'Publish anyway' : 'Publish Song'}</span>
                </button>
              )}
            </div>
          </div>
        </dialog>
      )}

      {/* Rename Setlist Modal Dialog */}
      {renamingSetlist && (
        <dialog
          open
          onCancel={() => setRenamingSetlist(null)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-app-surface ui-primary-text text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="ui-section-text font-bold text-sm flex items-center gap-2 ui-primary-text text-app-heading">
                <Pencil className="ui-action-text ui-action-text w-4 h-4 text-app-action" />
                Rename Setlist
              </h2>
              <button
                type="button"
                onClick={() => setRenamingSetlist(null)}
                className="p-1 rounded-lg hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault()
                const trimmed = renameInputValue.trim()
                if (trimmed) {
                  onRenameSetlist?.(renamingSetlist.id, trimmed)
                  setRenamingSetlist(null)
                }
              }}
            >
              <label htmlFor="rename-setlist-input" className="text-xs ui-secondary-text text-app-muted font-mono block mb-1.5">
                Setlist Name
              </label>
              <input
                id="rename-setlist-input"
                data-testid="rename-setlist-input"
                type="text"
                value={renameInputValue}
                onChange={(e) => setRenameInputValue(e.target.value)}
                maxLength={120}
                autoFocus
                className="w-full rounded-lg border border-app-border bg-app-base p-2 text-sm ui-primary-text text-app-heading focus:border-app-action focus:outline-none"
              />
              <div className="flex justify-end gap-2 mt-4 font-mono text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setRenamingSetlist(null)}
                  className="px-3 py-1.5 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="save-rename-setlist"
                  disabled={!renameInputValue.trim()}
                  className="px-4 py-1.5 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 transition-colors cursor-pointer disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}

      {/* Bulk Add To Setlist Modal */}
      {isBulkAddToSetlistModalOpen && (
        <dialog
          open
          data-testid="bulk-add-to-setlist-dialog"
          onCancel={() => setIsBulkAddToSetlistModalOpen(false)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-app-surface ui-primary-text text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="ui-section-text font-bold text-sm flex items-center gap-2 ui-primary-text text-app-heading">
                <ListPlus className="ui-action-text ui-action-text w-4 h-4 text-app-action" />
                Add {selectedSongIds.size} {selectedSongIds.size === 1 ? 'Song' : 'Songs'} to Setlist
              </h2>
              <button
                type="button"
                onClick={() => setIsBulkAddToSetlistModalOpen(false)}
                className="p-1 rounded-lg hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs ui-muted-text text-app-muted mb-3">
              Choose an existing setlist to add selected songs:
            </p>
            <div className="max-h-60 overflow-y-auto space-y-1 mb-4">
              {setlists.filter(sl => !sl.isDeleted).length === 0 ? (
                <div className="text-xs ui-secondary-text text-app-muted italic p-3 text-center bg-app-base/60 rounded-xl">
                  No setlists available.
                </div>
              ) : (
                setlists.filter(sl => !sl.isDeleted).map(sl => (
                  <button
                    key={sl.id}
                    type="button"
                    data-testid={`bulk-add-target-${sl.id}`}
                    onClick={() => handleConfirmBulkAddToSetlist(sl.id)}
                    className="w-full text-left px-3 py-2.5 rounded-xl bg-app-base hover:bg-app-surface border border-app-border hover:border-app-action text-sm ui-primary-text text-app-text flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="font-bold truncate">{sl.name}</span>
                    <span className="text-xs font-mono ui-secondary-text text-app-muted">{sl.songs.length} songs</span>
                  </button>
                ))
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="cancel-bulk-add-to-setlist"
                onClick={() => setIsBulkAddToSetlistModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading font-mono text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Bulk Delete Songs Confirmation Modal */}
      {isBulkDeleteSongsConfirmOpen && (
        <dialog
          open
          data-testid="bulk-delete-songs-confirm-dialog"
          onCancel={() => setIsBulkDeleteSongsConfirmOpen(false)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[#DC6E67] bg-app-surface ui-primary-text text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 text-status-error mb-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="ui-section-text text-base font-bold ui-primary-text text-app-heading">
                Delete {selectedSongIds.size} {selectedSongIds.size === 1 ? 'song' : 'songs'}?
              </h2>
            </div>
            <p className="text-xs ui-muted-text text-app-muted leading-relaxed mb-4">
              Selected songs will move to Trash. Setlist entries are preserved and become available again when restored.
            </p>
            <div className="flex justify-end gap-2 font-mono text-xs font-bold">
              <button
                type="button"
                autoFocus
                data-testid="cancel-bulk-delete-songs"
                onClick={() => setIsBulkDeleteSongsConfirmOpen(false)}
                className="px-3.5 py-2 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-bulk-delete-songs"
                onClick={handleConfirmBulkDeleteSongs}
                className="px-4 py-2 rounded-lg bg-[#DC6E67] text-white hover:bg-[#DC6E67]/90 transition-colors cursor-pointer"
              >
                Delete {selectedSongIds.size} {selectedSongIds.size === 1 ? 'Song' : 'Songs'}
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Bulk Delete Setlists Confirmation Modal */}
      {isBulkDeleteSetlistsConfirmOpen && (
        <dialog
          open
          data-testid="bulk-delete-setlists-confirm-dialog"
          onCancel={() => setIsBulkDeleteSetlistsConfirmOpen(false)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[#DC6E67] bg-app-surface ui-primary-text text-app-heading p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 text-status-error mb-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="ui-section-text text-base font-bold ui-primary-text text-app-heading">
                Delete {selectedSetlistIds.size} {selectedSetlistIds.size === 1 ? 'setlist' : 'setlists'}?
              </h2>
            </div>
            <p className="text-xs ui-muted-text text-app-muted leading-relaxed mb-4">
              Songs in these setlists will remain in your songbook.
            </p>
            <div className="flex justify-end gap-2 font-mono text-xs font-bold">
              <button
                type="button"
                autoFocus
                data-testid="cancel-bulk-delete-setlists"
                onClick={() => setIsBulkDeleteSetlistsConfirmOpen(false)}
                className="px-3.5 py-2 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-bulk-delete-setlists"
                onClick={handleConfirmBulkDeleteSetlists}
                className="px-4 py-2 rounded-lg bg-[#DC6E67] text-white hover:bg-[#DC6E67]/90 transition-colors cursor-pointer"
              >
                Delete {selectedSetlistIds.size} {selectedSetlistIds.size === 1 ? 'Setlist' : 'Setlists'}
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* 1. Compact Panel Header — title, no hero */}
      <div className="flex items-center justify-between mb-5 px-1">
        <div className="flex items-center gap-2.5">
          <div className="ui-section-icon w-8 h-8 rounded-xl bg-app-surface border border-app-border flex items-center justify-center text-app-action">
            <Music className="ui-section-icon w-4 h-4" />
          </div>
          <h1 className="ui-section-text text-lg font-bold ui-primary-text text-app-heading tracking-tight">
            Songbook &amp; Gig Library
          </h1>
        </div>
      </div>

      {/* Publish Success Toast */}
      {publishSuccessNotice && (
        <div
          role="status"
          aria-live="polite"
          data-testid="songbook-publish-toast"
          className="mb-4 p-3 bg-app-surface border border-app-border rounded-xl text-xs font-mono font-bold text-app-heading flex items-center gap-2 shadow-lg animate-in fade-in duration-150"
        >
          <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" />
          <span className="flex-1">{publishSuccessNotice}</span>
        </div>
      )}

      {/* Bulk Publish Error Banner */}
      {publishError && !publishingSong && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="songbook-publish-error"
          className="mb-4 p-3 bg-app-surface border border-[#DC6E67]/50 rounded-xl text-xs font-mono font-bold text-status-error flex items-center justify-between gap-2 shadow-lg animate-in fade-in duration-150"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <AlertTriangle className="w-4 h-4 text-status-error shrink-0" />
            <span className="flex-1 break-words">{publishError}</span>
          </div>
          <button
            type="button"
            data-testid="dismiss-publish-error"
            aria-label="Dismiss publish error"
            onClick={() => setPublishError(null)}
            className="p-1 rounded hover:bg-app-base text-app-muted hover:text-app-heading cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Navigation Tab Bar: My Songs, Setlists, Shared Catalog */}
      <div className="flex items-center gap-2 mb-5 px-1 border-b border-app-border/60 pb-2 flex-wrap">
        <button
          type="button"
          data-testid="tab-my-songs"
          aria-selected={activeTab === 'my_songs'}
          role="tab"
          onClick={() => { setActiveTab('my_songs'); setExplorerTag(null) }}
          className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === 'my_songs'
              ? 'bg-app-action text-app-on-action shadow-sm'
              : 'bg-app-surface border border-app-border text-app-muted hover:text-app-heading hover:border-app-action'
          }`}
        >
          <Music className="w-3.5 h-3.5" />
          <span>My Songs ({songs.length})</span>
        </button>

        <button
          type="button"
          data-testid="tab-setlists"
          aria-selected={activeTab === 'setlists'}
          role="tab"
          onClick={() => { setActiveTab('setlists'); setExplorerSetlistId(null); setUnfiledSetlists(false) }}
          className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === 'setlists'
              ? 'bg-app-action text-app-on-action shadow-sm'
              : 'bg-app-surface border border-app-border text-app-muted hover:text-app-heading hover:border-app-action'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Setlists ({activeSetlists.length})</span>
        </button>

        <button
          type="button"
          data-testid="tab-shared-catalog"
          aria-selected={activeTab === 'shared_catalog'}
          role="tab"
          onClick={() => setActiveTab('shared_catalog')}
          className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === 'shared_catalog'
              ? 'bg-app-action text-app-on-action shadow-sm'
              : 'bg-app-surface border border-app-border text-app-muted hover:text-app-heading hover:border-app-action'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Shared Catalog</span>
        </button>
      </div>

      {explorerEnabled && activeTab === 'my_songs' && explorerTag && (
        <div className="flex items-center gap-3 mb-4 text-app-heading">
          <h2 className="font-semibold">Tag: {explorerTag}</h2>
          <button type="button" className="explorer-control text-app-action" onClick={() => selectExplorerTarget({ type: 'all' })}>All Songs</button>
        </div>
      )}
      {explorerEnabled && activeTab === 'setlists' && <SetlistExplorer
        setlists={sortedSetlists.filter(sl => !unfiledSetlists || !sl.folderId)}
        selected={explorerSetlist} songs={songs} unfiled={unfiledSetlists}
        onSelect={id => selectExplorerTarget({ type: 'setlist', id })}
        onCollection={() => selectExplorerTarget({ type: unfiledSetlists ? 'unfiled' : 'setlists' })}
        onPlay={onSelectSetlistSong}
        onEdit={sl => onManageSetlist ? onManageSetlist(sl) : onOpenSetlists()}
        onNew={onNewSetlist} onAdd={onBulkAddSongsToSetlist}
      />}

      {/* Tab Content: Shared Catalog Browser vs My Songs Personal Library */}
      {activeTab === 'shared_catalog' ? (
        <SharedCatalogBrowser
          personalSongs={songs}
          focusSongId={focusCatalogSongId}
          onImportSong={(song) => {
            if (onImportSharedCatalogSong) {
              return onImportSharedCatalogSong(song)
            }
            return true
          }}
          onSongImported={(title) => {
            setPublishSuccessNotice(`Imported "${title}" to My Songs`)
            setTimeout(() => setPublishSuccessNotice(null), 3500)
          }}
          onSongUnpublished={(unpublishedId) => {
            setLocalConfirmedCatalogIds((prev) => {
              const next = new Set(prev)
              next.delete(unpublishedId)
              return next
            })
            for (const s of songs) {
              if (s.publishedCatalogSongId === unpublishedId && onUpdateSong) {
                onUpdateSong({ id: s.id, publishedCatalogSongId: undefined })
              }
            }
          }}
        />
      ) : (
        <>
          {/* 2. SONG SETLISTS PANEL */}
      {(!(explorerEnabled && activeTab === 'setlists') && (activeTab === 'setlists' || (activeTab === 'my_songs' && activeSetlists.length > 0))) && (
        activeSetlists.length === 0 ? (
          <section aria-label="Song Setlists" className="rounded-2xl border border-app-border bg-app-surface p-6 sm:p-8 mb-6 shadow-xs text-center space-y-3">
            <Layers className="ui-section-icon w-8 h-8 mx-auto text-app-accent" />
            <div className="text-base font-bold ui-primary-text text-app-heading">No Setlists Yet</div>
            <p className="text-xs ui-muted-text text-app-muted max-w-sm mx-auto">
              Create a setlist to organize songs for your next gig or rehearsal.
            </p>
            <button
              type="button"
              data-testid="empty-new-setlist-btn"
              onClick={onNewSetlist || onOpenSetlists}
              className="mt-2 px-4 py-2 rounded-xl bg-app-action text-app-on-action font-bold text-xs cursor-pointer shadow-sm hover:bg-app-action/90"
            >
              + Create First Setlist
            </button>
          </section>
        ) : (
        <section aria-label="Song Setlists" className="rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5 mb-6 shadow-xs">
          {/* Hidden file input for Setlist .json import */}
          <input
            ref={setlistFileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleSetlistImportFile}
            className="hidden"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
            <div className="flex items-center gap-2">
              <Layers className="ui-section-icon w-4 h-4 text-app-accent shrink-0" />
              <h2 className="ui-section-text text-xs sm:text-sm font-bold ui-primary-text text-app-heading uppercase tracking-wider font-mono">
                Song Setlists ({searchQuery.trim() ? `${filteredSetlists.length} of ${activeSetlists.length}` : filteredSetlists.length})
              </h2>
            </div>
          </div>

          {/* Dedicated Tinted Setlist Controls Toolbar */}
          <div
            data-testid="setlist-controls-toolbar"
            className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 rounded-2xl bg-app-filter border border-app-border shadow-sm"
          >
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="ui-secondary-text text-app-muted text-[11px] font-bold">Sort:</span>
                <select
                  data-testid="setlist-sort-select"
                  aria-label="Sort setlists"
                  value={effectiveSetlistSortBy}
                  onChange={(e) => setSetlistSortBy(e.target.value as SetlistSortOption)}
                  className="bg-app-base border border-app-border ui-primary-text text-app-text rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-app-action transition-colors"
                >
                  <option value="manual">Manual Order</option>
                  <option value="title_asc">Title A-Z</option>
                  <option value="title_desc">Title Z-A</option>
                  {hasReliableSetlistTimestamps && (
                    <>
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 max-w-full">
              {isSetlistSelectionMode ? (
                <div data-testid="setlist-selection-bar" className="flex flex-wrap items-center gap-1.5 sm:gap-2 max-w-full">
                  <span data-testid="setlist-selection-count" className="ui-action-text text-xs font-mono font-bold text-app-action">
                    {selectedSetlistIds.size} selected
                  </span>
                  <button
                    type="button"
                    data-testid="bulk-delete-setlists"
                    disabled={selectedSetlistIds.size === 0}
                    onClick={() => setIsBulkDeleteSetlistsConfirmOpen(true)}
                    className="text-xs font-bold text-status-error hover:bg-[#DC6E67]/15 px-2.5 py-1 rounded-lg border border-[#DC6E67]/40 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                  <button
                    type="button"
                    data-testid="cancel-setlist-selection"
                    onClick={() => {
                      setIsSetlistSelectionMode(false)
                      setSelectedSetlistIds(new Set())
                    }}
                    className="text-xs font-mono ui-secondary-text text-app-muted hover:text-app-heading px-2 py-1 rounded cursor-pointer shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div data-testid="setlist-toolbar" className="flex flex-wrap items-center gap-1.5 sm:gap-2 max-w-full">
                  {/* #149 layout: QR → Manage → ⋯ (New Setlist, Import) → Hide */}
                  <button
                    type="button"
                    data-testid="main-share-setlist-btn"
                    disabled={activeSetlists.length === 0}
                    onClick={handleMainShareSetlist}
                    aria-label="Share Setlist"
                    className="p-1.5 rounded-lg border border-app-accent/40 bg-app-surface text-app-accent hover:bg-app-accent/15 transition-colors cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-app-accent shrink-0"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid="toggle-setlist-selection-mode"
                    onClick={() => {
                      if (setlistsCollapsed) {
                        setSetlistsCollapsed(false)
                        try { localStorage.setItem('gtar_songbook_setlists_collapsed', 'false') } catch { /* Session preference remains usable. */ }
                      }
                      setIsSetlistSelectionMode(true)
                      setSelectedSetlistIds(new Set())
                    }}
                    className="ui-action-text text-xs px-2.5 py-1 border border-app-action/40 rounded-lg text-app-action hover:bg-app-action/10 font-mono font-semibold cursor-pointer shrink-0"
                  >
                    Manage
                  </button>
                  <button
                    type="button"
                    data-testid="setlists-menu-btn"
                    aria-label="Setlist actions"
                    aria-haspopup="menu"
                    aria-expanded={!!setlistsMenuAnchor}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeAllMenus()
                      setSetlistsMenuAnchor(setlistsMenuAnchor ? null : e.currentTarget)
                    }}
                    className="w-7 h-7 rounded-lg border border-app-border ui-secondary-text text-app-muted hover:text-app-heading hover:border-app-action/40 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  <DropdownPortal anchorEl={setlistsMenuAnchor} open={!!setlistsMenuAnchor} onClose={() => setSetlistsMenuAnchor(null)} align="right">
                    <div role="menu" onClick={(e) => e.stopPropagation()}
                      className="w-48 bg-app-base border border-app-border rounded-xl shadow-xl py-1 font-mono text-xs animate-in fade-in zoom-in-95 duration-100">
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="main-new-setlist-btn"
                        onClick={() => {
                          setSetlistsMenuAnchor(null)
                          if (onNewSetlist) onNewSetlist()
                          else onOpenSetlists()
                        }}
                        className="w-full text-left px-3 py-2 min-h-11 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <ListPlus className="ui-action-text w-3.5 h-3.5 text-app-action" />
                        <span>New Setlist</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="main-import-setlist-btn"
                        onClick={() => {
                          setSetlistsMenuAnchor(null)
                          setImportLinkError(null)
                          setIsImportModalOpen(true)
                        }}
                        className="w-full text-left px-3 py-2 min-h-11 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors border-t border-app-border/50"
                      >
                        <Upload className="ui-action-text w-3.5 h-3.5 text-app-action" />
                        <span>Import setlist…</span>
                      </button>
                    </div>
                  </DropdownPortal>
                  <button
                    type="button"
                    data-testid="toggle-setlists-collapse"
                    onClick={toggleSetlists}
                    aria-expanded={!setlistsCollapsed}
                    aria-controls="gig-setlist-cards"
                    className="ui-action-text text-xs px-2.5 py-1 border border-app-border rounded-lg text-app-muted hover:text-app-heading hover:border-app-action/40 font-mono font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    {setlistsCollapsed ? 'Show' : 'Hide'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div id="gig-setlist-cards" hidden={setlistsCollapsed}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-2.5">
            {sortedSetlists.map((sl) => {
              const isDeletingSetlist = confirmDeleteSetlistId === sl.id
              const isMenuOpen = activeMenuSetlistId === sl.id
              const isSetlistChosen = selectedSetlistIds.has(sl.id)

              return (
                <SwipeableActionCard
                  key={sl.id}
                  id={sl.id}
                  dataTestId={`setlist-card-${sl.id}`}
                  className="rounded-xl"
                  cardClassName={`ui-setlist-card px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl border transition-all cursor-pointer group flex items-center justify-between gap-2.5 sm:gap-3 relative ${
                    isSetlistChosen
                      ? 'ui-selection-card border-app-action bg-app-surface ring-1 ring-app-action'
                      : 'bg-app-surface border-app-border hover:border-app-action/50'
                  }`}
                  onClick={() => {
                    if (isSetlistSelectionMode) {
                      toggleSetlistSelection(sl.id)
                    } else if (onSelectSetlistSong && sl.songs.length > 0) {
                      onSelectSetlistSong(sl.id, 0)
                    } else {
                      onOpenSetlists()
                    }
                  }}
                  disabled={isDeletingSetlist || isMenuOpen || isSetlistSelectionMode}
                  leftAction={{
                    icon: <Layers className="ui-section-icon w-4 h-4 text-current" />,
                    label: 'Manage',
                    testId: `swipe-action-manage-${sl.id}`,
                    onAction: () => {
                      if (onManageSetlist) {
                        onManageSetlist(sl)
                      } else {
                        onOpenSetlists()
                      }
                    },
                  }}
                  rightAction={{
                    icon: <Trash2 className="w-4 h-4 text-current" />,
                    label: 'Delete',
                    isDestructive: true,
                    testId: `swipe-action-delete-${sl.id}`,
                    onAction: () => {
                      setConfirmDeleteSetlistId(sl.id)
                    },
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isSetlistSelectionMode && (
                      <div
                        data-testid={`select-setlist-${sl.id}`}
                        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors mr-1 ${
                          isSetlistChosen
                            ? 'ui-selection-indicator bg-app-action border-app-action text-app-on-action'
                            : 'border-app-border bg-app-base'
                        }`}
                      >
                        {isSetlistChosen && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="text-xs sm:text-sm font-bold ui-primary-text text-app-heading group-hover:text-app-action truncate transition-colors">
                          {sl.name}
                        </div>
                        <SetlistCloudStatusBadge
                          status={setlistStatusMap.get(sl.id) || 'NEVER_PUBLISHED'}
                          setlistId={sl.id}
                          setlist={sl}
                        />
                      </div>
                      <div className="text-[10px] sm:text-[11px] font-mono ui-secondary-text text-app-muted mt-0.5">
                        {sl.songs.length} {sl.songs.length === 1 ? 'song' : 'songs'}
                      </div>
                    </div>
                  </div>

                  {!isSetlistSelectionMode && (
                    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                    {/* Compact direct play quick action */}
                    <button
                      type="button"
                      aria-label={`Play setlist ${sl.name}`}
                      data-testid={`play-setlist-${sl.id}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onSelectSetlistSong && sl.songs.length > 0) {
                          onSelectSetlistSong(sl.id, 0)
                        } else {
                          onOpenSetlists()
                        }
                      }}
                      className="ui-action-text w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-full bg-app-action/15 hover:bg-app-action text-app-action hover:text-app-on-action flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    >
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    </button>

                    {/* Three-dot overflow button */}
                    <button
                      type="button"
                      aria-label="Setlist actions"
                      aria-haspopup="true"
                      aria-expanded={isMenuOpen}
                      data-testid={`setlist-menu-${sl.id}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveMenuSetlistId(isMenuOpen ? null : sl.id)
                        setActiveMenuSongIdx(null)
                        setSetlistMenuAnchor(isMenuOpen ? null : e.currentTarget)
                        setSongMenuAnchor(null)
                      }}
                      className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg bg-transparent hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {/* Three-dot Action Menu via portal — escapes overflow:hidden */}
                    <DropdownPortal
                      anchorEl={isMenuOpen ? setlistMenuAnchor : null}
                      open={isMenuOpen}
                      onClose={closeAllMenus}
                      align="right"
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-40 bg-app-base border border-app-border rounded-xl shadow-xl py-1 font-mono text-xs animate-in fade-in zoom-in-95 duration-100"
                      >
                        {onRenameSetlist && (
                          <button
                            type="button"
                            data-testid={`menu-rename-${sl.id}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveMenuSetlistId(null)
                              setRenamingSetlist(sl)
                              setRenameInputValue(sl.name)
                            }}
                            className="w-full text-left px-3 py-2 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <Pencil className="ui-action-text ui-action-text w-3.5 h-3.5 text-app-action" />
                            <span>Rename Setlist</span>
                          </button>
                        )}
                        {onPublishSetlist && canPublishSetlist && setlistCapability.enabled && (
                          <button
                            type="button"
                            data-testid={`menu-publish-setlist-${sl.id}`}
                            aria-label={`Publish ${sl.name} to Shared`}
                            onClick={event => { event.stopPropagation(); setActiveMenuSetlistId(null); onPublishSetlist(sl) }}
                            className="w-full text-left px-3 py-2 min-h-11 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <UploadCloud className="ui-action-text w-3.5 h-3.5 text-app-action" />
                            <span>Publish to Shared</span>
                          </button>
                        )}
                        {onShareSetlist && (
                          <button
                            type="button"
                            data-testid={`menu-share-${sl.id}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveMenuSetlistId(null)
                              onShareSetlist(sl)
                            }}
                            className={`w-full text-left px-3 py-2 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-accent flex items-center gap-2 cursor-pointer transition-colors ${
                              onRenameSetlist ? 'border-t border-app-border/50' : ''
                            }`}
                          >
                            <QrCode className="ui-action-text w-3.5 h-3.5 text-app-accent" />
                            <span>Share Setlist</span>
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid={`menu-export-json-${sl.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveMenuSetlistId(null)
                            exportSingleSetlistJson(sl, songs)
                          }}
                          className="w-full text-left px-3 py-2 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors border-t border-app-border/50"
                        >
                          <Upload className="ui-action-text w-3.5 h-3.5 text-app-action rotate-180" />
                          <span>Export JSON</span>
                        </button>
                        {onDeleteSetlist && (
                          <button
                            type="button"
                            data-testid={`menu-delete-${sl.id}`}
                            aria-label="Delete setlist"
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveMenuSetlistId(null)
                              setConfirmDeleteSetlistId(sl.id)
                            }}
                            className="w-full text-left px-3 py-2 text-status-error hover:bg-app-surface hover:text-status-error flex items-center gap-2 cursor-pointer transition-colors border-t border-app-border/50"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-status-error" />
                            <span>Delete Setlist</span>
                          </button>
                        )}
                      </div>
                    </DropdownPortal>
                  </div>
                  )}

                  {/* Inline Delete Confirmation Popover */}
                  {isDeletingSetlist && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-0 bg-app-surface border border-[#DC6E67] rounded-xl p-2.5 sm:p-3 flex items-center justify-between z-20 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center gap-2 text-xs text-status-error font-semibold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Delete setlist?</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs font-bold">
                        <button
                          type="button"
                          data-testid={`confirm-delete-${sl.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteSetlist?.(sl.id)
                            setConfirmDeleteSetlistId(null)
                          }}
                          className="px-3 py-1 rounded-lg bg-[#DC6E67] text-white hover:bg-[#DC6E67]/90 transition-colors cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          data-testid={`cancel-delete-${sl.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDeleteSetlistId(null)
                          }}
                          className="px-2.5 py-1 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </SwipeableActionCard>
              )
            })}
          </div>
          </div>
        </section>
        )
      )}

      {isExportSongsOpen && (
        <ExportSongsDialog songs={songs} preselected={isSongSelectionMode ? [...selectedSongIds] : []}
          onClose={() => setIsExportSongsOpen(false)} />
      )}

      {isDuplicateReviewOpen && onTrashDuplicates && (
        <DuplicateReviewDialog songs={songs} setlists={setlists} onTrashDuplicates={onTrashDuplicates}
          onClose={() => setIsDuplicateReviewOpen(false)} />
      )}

      {/* 3. SONGS LIBRARY PANEL */}
      {activeTab === 'my_songs' && (
      <section aria-label="Songs Library" className="rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5 mb-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
          <div className="flex items-center gap-2">
            <Music className="ui-section-icon w-4 h-4 text-app-action shrink-0" />
            <h2 className="ui-section-text text-sm font-bold ui-primary-text text-app-heading uppercase tracking-wider font-mono">
              Songs Library ({filteredIndexedSongs.length} of {songs.length})
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-w-full">
            {songs.length > 0 && isSongSelectionMode ? (
              <div data-testid="song-selection-bar" className="flex flex-wrap items-center gap-1.5 sm:gap-2 max-w-full">
                <span data-testid="song-selection-count" className="ui-action-text text-xs font-mono font-bold text-app-action shrink-0">
                  {selectedSongIds.size} selected
                </span>
                <button
                  type="button"
                  data-testid="select-all-songs"
                  disabled={sortedIndexedSongs.length === 0}
                  onClick={handleSelectAllSongs}
                  className="ui-action-text text-xs font-mono font-semibold text-app-action hover:bg-app-action/15 px-2 py-1 rounded-lg border border-app-action/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  Select All
                </button>
                <button
                  type="button"
                  data-testid="select-none-songs"
                  disabled={selectedSongIds.size === 0}
                  onClick={handleSelectNoneSongs}
                  className="ui-action-text text-xs font-mono font-semibold text-app-muted hover:text-app-heading hover:bg-app-surface px-2 py-1 rounded-lg border border-app-border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  Select None
                </button>
                <button
                  type="button"
                  data-testid="bulk-publish-to-shared"
                  disabled={selectedSongIds.size === 0 || isSubmittingPublish}
                  aria-disabled={!isAuthActive || selectedSongIds.size === 0 || isSubmittingPublish}
                  onClick={handleBulkPublishSongs}
                  className="ui-action-text text-xs font-bold text-app-action hover:bg-app-action/15 px-2.5 py-1 rounded-lg border border-app-action/40 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Publish to Shared</span>
                </button>
                <button
                  type="button"
                  data-testid="bulk-add-to-setlist"
                  disabled={selectedSongIds.size === 0}
                  onClick={() => setIsBulkAddToSetlistModalOpen(true)}
                  className="ui-action-text text-xs font-bold text-app-action hover:bg-app-action/15 px-2.5 py-1 rounded-lg border border-app-action/40 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>Add to Setlist</span>
                </button>
                <button
                  type="button"
                  data-testid="bulk-delete-songs"
                  disabled={selectedSongIds.size === 0}
                  onClick={() => setIsBulkDeleteSongsConfirmOpen(true)}
                  className="text-xs font-bold text-status-error hover:bg-[#DC6E67]/15 px-2.5 py-1 rounded-lg border border-[#DC6E67]/40 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
                <button
                  type="button"
                  data-testid="cancel-song-selection"
                  onClick={() => {
                    setIsSongSelectionMode(false)
                    setSelectedSongIds(new Set())
                  }}
                  className="text-xs font-mono ui-secondary-text text-app-muted hover:text-app-heading px-2 py-1 rounded cursor-pointer shrink-0"
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Sort & Filter Toolbar */}
        {(songs.length > 0 || onOpenImportSongs || onTrashDuplicates) && (
          <div
            data-testid="songs-library-toolbar"
            className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 rounded-2xl bg-app-filter border border-app-border shadow-sm"
          >
            <div
              id="songbook-sort-filter-options"
              hidden={songs.length === 0}
              className="flex items-center gap-2.5 flex-wrap"
            >
              {/* Sort Dropdown */}
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="ui-secondary-text text-app-muted text-[11px] font-bold">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value as SortOption)}
                  className="bg-app-base border border-app-border ui-primary-text text-app-text rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-app-action transition-colors"
                >
                  <option value="title">Title (A-Z)</option>
                  <option value="artist">Artist (A-Z)</option>
                  <option value="date">Library Order</option>
                </select>
              </div>

              {/* Metadata Filter Dropdown */}
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="ui-secondary-text text-app-muted text-[11px] font-bold">Metadata:</span>
                <select
                  data-testid="filter-metadata-select"
                  value={filterMetadata}
                  onChange={(e) => handleFilterMetadataChange(e.target.value as MetadataFilterOption)}
                  className="bg-app-base border border-app-border ui-primary-text text-app-text rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-app-action transition-colors"
                >
                  <option value="ALL">All</option>
                  <option value="METADATA_OK">Metadata OK</option>
                  <option value="NEEDS_METADATA">Needs Metadata</option>
                </select>
              </div>

              {/* Setlist Filter Dropdown */}
              {activeSetlists.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <span className="ui-secondary-text text-app-muted text-[11px] font-bold">Setlist:</span>
                  <select
                    data-testid="filter-setlist-select"
                    value={filterSetlistId}
                    onChange={(e) => handleFilterSetlistChange(e.target.value)}
                    className="bg-app-base border border-app-border ui-primary-text text-app-text rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-app-action transition-colors"
                  >
                    <option value="ALL">All Setlists</option>
                    {activeSetlists.map((sl) => (
                      <option key={sl.id} value={String(sl.id)}>
                        {sl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div data-testid="songs-library-actions" className="flex flex-wrap items-center gap-1.5 sm:gap-2 ml-auto">
              {/* #149: right side, in order: Manage → ⋯ → Hide */}
              {songs.length > 0 && !isSongSelectionMode && (
                <button
                  type="button"
                  data-testid="toggle-song-selection-mode"
                  onClick={() => {
                    if (songsCollapsed) setSongsCollapsedPersisted(false)
                    setIsSongSelectionMode(true)
                    setSelectedSongIds(new Set())
                  }}
                  className="ui-action-text text-xs px-2.5 py-1 border border-app-action/40 rounded-lg text-app-action hover:bg-app-action/10 font-mono font-semibold cursor-pointer shrink-0"
                >
                  Manage
                </button>
              )}
              {(onOpenImportSongs || onTrashDuplicates) && (
                <>
                  <button
                    type="button"
                    data-testid="songs-library-menu-btn"
                    aria-label="Songs Library actions"
                    aria-haspopup="menu"
                    aria-expanded={!!libraryMenuAnchor}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeAllMenus()
                      setLibraryMenuAnchor(libraryMenuAnchor ? null : e.currentTarget)
                    }}
                    className="w-7 h-7 rounded-lg border border-app-border ui-secondary-text text-app-muted hover:text-app-heading hover:border-app-action/40 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  <DropdownPortal
                    anchorEl={libraryMenuAnchor}
                    open={!!libraryMenuAnchor}
                    onClose={() => setLibraryMenuAnchor(null)}
                    align="right"
                  >
                    <div
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                      className="w-48 bg-app-base border border-app-border rounded-xl shadow-xl py-1 font-mono text-xs animate-in fade-in zoom-in-95 duration-100"
                    >
                      {onOpenImportSongs && (
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="songs-library-menu-import"
                          onClick={() => {
                            setLibraryMenuAnchor(null)
                            onOpenImportSongs()
                          }}
                          className="w-full text-left px-3 py-2 min-h-11 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors"
                        >
                          <Upload className="ui-action-text w-3.5 h-3.5 text-app-action" />
                          <span>Import songs…</span>
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="songs-library-menu-export"
                        disabled={songs.length === 0}
                        onClick={() => {
                          setLibraryMenuAnchor(null)
                          setIsExportSongsOpen(true)
                        }}
                        className="w-full text-left px-3 py-2 min-h-11 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-t border-app-border/50"
                      >
                        <Upload className="ui-action-text w-3.5 h-3.5 text-app-action rotate-180" />
                        <span>Export songs (TXT / PDF)…</span>
                      </button>
                      {onTrashDuplicates && (
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="songs-library-menu-duplicates"
                          disabled={songs.length < 2}
                          onClick={() => {
                            setLibraryMenuAnchor(null)
                            setIsDuplicateReviewOpen(true)
                          }}
                          className="w-full text-left px-3 py-2 min-h-11 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-t border-app-border/50"
                        >
                          <Copy className="ui-action-text w-3.5 h-3.5 text-app-action" />
                          <span>AI Worker: check duplicates…</span>
                        </button>
                      )}
                    </div>
                  </DropdownPortal>
                </>
              )}
              {songs.length > 0 && (
                <button
                  type="button"
                  data-testid="toggle-songs-collapse"
                  aria-expanded={!songsCollapsed}
                  aria-controls="songbook-song-cards"
                  onClick={() => {
                    const next = !songsCollapsed
                    setSongsCollapsedPersisted(next)
                    if (next) {
                      setIsSongSelectionMode(false)
                      setSelectedSongIds(new Set())
                    }
                  }}
                  className="ui-action-text text-xs px-2.5 py-1 border border-app-border rounded-lg text-app-muted hover:text-app-heading hover:border-app-action/40 font-mono font-semibold transition-colors cursor-pointer shrink-0"
                >
                  {songsCollapsed ? 'Show' : 'Hide'}
                </button>
              )}
            </div>
          </div>
        )}

        <div id="songbook-song-cards" hidden={songsCollapsed && songs.length > 0}>
        {songs.length === 0 ? (
          <div className="p-12 text-center rounded-3xl border border-app-border bg-app-surface/50 ui-secondary-text text-app-muted space-y-3">
            <Music className="ui-section-icon w-8 h-8 mx-auto text-app-action" />
            <div className="text-base font-bold ui-primary-text text-app-heading">Your Songbook is Empty</div>
            <p className="text-xs max-w-sm mx-auto">
              Create a song or import charts.
            </p>
            <button
              type="button"
              onClick={onNewSong}
              className="mt-2 px-4 py-2 rounded-xl bg-app-action text-app-on-action font-bold text-xs"
            >
              + Create First Song
            </button>
          </div>
        ) : sortedIndexedSongs.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-app-border bg-app-surface/40 ui-secondary-text text-app-muted space-y-2">
            <div className="text-sm font-bold ui-primary-text text-app-heading">No matching songs found</div>
            <p className="text-xs">Try clearing your search query or adjusting filters.</p>
            <button
              type="button"
              onClick={() => {
                handleSearchChange('')
                handleFilterSetlistChange('ALL')
                handleFilterMetadataChange('ALL')
              }}
              className="ui-action-text mt-2 px-3 py-1.5 rounded-lg bg-app-base border border-app-border text-xs text-app-action font-bold cursor-pointer hover:border-app-action"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div ref={songGridRef} data-testid="song-grid" data-window={songWindow.active ? `${songWindow.start}-${songWindow.end}` : undefined}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-2.5"
            style={songWindow.active ? { paddingTop: songWindow.padTop, paddingBottom: songWindow.padBottom } : undefined}>
            {visibleIndexedSongs.map(({ song, originalIdx }, visibleIdx) => {
              const displayIdx = songWindow.start + visibleIdx
              const isSelected = originalIdx === activeSongIndex
              const isDeleting = confirmDeleteIdx === originalIdx
              const isMenuOpen = activeMenuSongIdx === originalIdx
              const isSongChosen = selectedSongIds.has(song.id ?? originalIdx)
              const songSetlists = getSongSetlists(song)
              const metadataStatus = getSongMetadataStatus(song)
              const isMetaOk = metadataStatus.status === 'METADATA_OK'

              return (
                <SwipeableActionCard
                  key={song.id || originalIdx}
                  id={song.id || originalIdx}
                  dataTestId={`song-card-${originalIdx}`}
                  className="rounded-xl"
                  cardClassName={`ui-song-card relative px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl border transition-all cursor-pointer select-none group flex items-center justify-between gap-2 sm:gap-2.5 ${
                    isSongChosen
                      ? 'ui-selection-card border-app-action bg-app-surface ring-1 ring-app-action'
                      : isSelected
                      ? 'ui-selection-card border-app-action bg-app-surface ring-1 ring-app-action shadow-lg shadow-app-action/10'
                      : 'border-app-border bg-app-surface/70 hover:border-app-action hover:bg-app-surface'
                  }`}
                  onClick={() => {
                    if (isSongSelectionMode) {
                      toggleSongSelection(song.id ?? originalIdx)
                    } else {
                      onSelectSong(originalIdx)
                    }
                  }}
                  disabled={isDeleting || isMenuOpen || isSongSelectionMode}
                  leftAction={{
                    icon: <ListPlus className="w-4 h-4 text-current" />,
                    label: 'Add to Setlist',
                    testId: `swipe-action-add-${originalIdx}`,
                    disabled: song.id === undefined,
                    onAction: () => {
                      setMembershipSongId(song.id ?? null)
                    },
                  }}
                  rightAction={{
                    icon: <Trash2 className="w-4 h-4 text-current" />,
                    label: 'Delete',
                    isDestructive: true,
                    testId: `swipe-action-delete-${originalIdx}`,
                    onAction: () => {
                      setConfirmDeleteIdx(originalIdx)
                    },
                  }}
                >
                  <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
                    {isSongSelectionMode ? (
                      <div
                        data-testid={`select-song-${originalIdx}`}
                        className={`w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg flex items-center justify-center font-mono text-[10px] sm:text-xs font-bold shrink-0 transition-colors border ${
                          isSongChosen
                            ? 'ui-selection-indicator bg-app-action border-app-action text-app-on-action'
                            : 'bg-app-base border-app-border ui-secondary-text text-app-muted'
                        }`}
                      >
                        {isSongChosen ? <Check className="w-4 h-4 stroke-[3]" /> : String(displayIdx + 1).padStart(2, '0')}
                      </div>
                    ) : (
                      <div
                        className={`w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg flex items-center justify-center font-mono text-[10px] sm:text-xs font-bold shrink-0 transition-colors shadow-inner ${
                          isSelected
                            ? 'ui-selection-indicator bg-app-action text-app-on-action'
                            : 'bg-app-base ui-secondary-text text-app-muted group-hover:text-app-action'
                        }`}
                      >
                        {String(displayIdx + 1).padStart(2, '0')}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-xs sm:text-sm ui-primary-text text-app-heading group-hover:text-app-action transition-colors truncate">
                          {song.title || 'Untitled Song'}
                        </h3>
                        <SongStatusBadge
                          testId={`song-metadata-status-${originalIdx}`}
                          ariaLabel={isMetaOk ? 'Metadata OK' : 'Needs Metadata'}
                          className={`p-0.5 rounded flex items-center justify-center shrink-0 ${
                            isMetaOk ? 'text-status-success' : 'text-app-accent'
                          }`}
                          icon={isMetaOk ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                          popoverContent={
                            <div className="space-y-1">
                              <div className="font-semibold text-app-heading flex items-center gap-1.5">
                                {isMetaOk ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" />
                                    <span>Metadata OK</span>
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle className="w-3.5 h-3.5 text-app-accent shrink-0" />
                                    <span>Needs Metadata{metadataStatus.missingFields.length > 0 ? ` (${metadataStatus.missingFields.join(', ')})` : ''}</span>
                                  </>
                                )}
                              </div>
                              {!isMetaOk && metadataStatus.missingFields.length > 0 ? (
                                <div className="text-[11px] text-app-text">
                                  Missing: <span className="font-medium text-app-accent">{metadataStatus.missingFields.join(', ')}</span>
                                </div>
                              ) : (
                                <div className="text-[11px] text-app-muted">
                                  All essential metadata directives complete
                                </div>
                              )}
                            </div>
                          }
                        />
                        {Boolean(song.sharedSourceSongId) && (() => {
                          const catalogItem = catalogMetadataMap.get(song.sharedSourceSongId!)
                          const importedProv = resolveImportedProvenance(song.sharedSourceSongId!, {
                            catalogItem,
                            persistedPublisherId: song.sharedSourcePublisherId,
                            persistedPublisherName: song.sharedSourcePublisherName,
                            currentAccountId: auth?.session?.user?.id || auth?.session?.user?.email,
                          })
                          return (
                            <SongStatusBadge
                              testId={`song-imported-status-${originalIdx}`}
                              ariaLabel="Imported from Shared Catalog"
                              className="p-0.5 rounded flex items-center justify-center shrink-0 text-sky-400 hover:text-sky-300"
                              icon={<CloudDownload className="w-3.5 h-3.5" />}
                              popoverContent={
                                <div className="space-y-1">
                                  <div className="font-semibold text-app-heading flex items-center gap-1.5">
                                    <CloudDownload className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                    <span>Imported from Shared Catalog</span>
                                  </div>
                                  <div className="text-[11px] text-app-text">
                                    {importedProv.publisherText ? (
                                      <>
                                        Publisher: <span className="font-medium text-app-heading">{importedProv.publisherText}</span>
                                      </>
                                    ) : (
                                      <span className="text-app-muted italic">Source unavailable</span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-app-muted font-medium">
                                    Independent personal copy
                                  </div>
                                </div>
                              }
                            />
                          )
                        })()}
                        {Boolean(song.publishedCatalogSongId && confirmedCatalogIds.has(song.publishedCatalogSongId)) && (() => {
                          const isFresh = freshCatalogIds.has(song.publishedCatalogSongId!)
                          const catalogItem = catalogMetadataMap.get(song.publishedCatalogSongId!)
                          const publishedProv = resolvePublishedProvenance(song.publishedCatalogSongId!, {
                            currentAccountId: auth?.session?.user?.id || auth?.session?.user?.email,
                            catalogItem,
                            isFresh,
                            activeUserEmail: auth?.session?.user?.email,
                          })
                          const label = isFresh ? "Published to Shared Catalog (Server Confirmed)" : "Published to Shared Catalog (Cached)"
                          return (
                            <SongStatusBadge
                              testId={`song-published-status-${originalIdx}`}
                              ariaLabel={label}
                              className={isFresh ? "p-0.5 rounded flex items-center justify-center shrink-0 text-status-success hover:text-emerald-300" : "p-0.5 rounded flex items-center justify-center shrink-0 text-amber-400 opacity-90 hover:opacity-100"}
                              icon={<CloudCheck className="w-3.5 h-3.5" />}
                              popoverContent={
                                <div className="space-y-1">
                                  <div className="font-semibold text-app-heading flex items-center gap-1.5">
                                    <CloudCheck className={isFresh ? "w-3.5 h-3.5 text-emerald-400 shrink-0" : "w-3.5 h-3.5 text-amber-400 shrink-0"} />
                                    <span>Published to Shared Catalog</span>
                                  </div>
                                  <div className="text-[11px] text-app-text">
                                    Publisher: <span className="font-medium text-app-heading">{publishedProv.publisherText}</span>
                                  </div>
                                  <div className="text-[11px] flex items-center gap-1 text-app-text">
                                    Status: <span className={isFresh ? "font-medium text-emerald-400" : "font-medium text-amber-400"}>
                                      {publishedProv.statusText}
                                    </span>
                                  </div>
                                </div>
                              }
                            />
                          )
                        })()}
                        {songSetlists.length > 0 && (
                          <>
                            <button
                              type="button"
                              aria-label={`Used in ${songSetlists.length} ${songSetlists.length === 1 ? 'setlist' : 'setlists'}`}
                              aria-haspopup="dialog"
                              aria-expanded={membershipPopoverSongId === (song.id ?? originalIdx)}
                              aria-controls={membershipPopoverSongId === (song.id ?? originalIdx) ? `membership-popover-${originalIdx}` : undefined}
                              data-testid={`song-setlist-indicator-${originalIdx}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                const isThisOpen = membershipPopoverSongId === (song.id ?? originalIdx)
                                closeAllMenus()
                                setMembershipPopoverSongId(isThisOpen ? null : (song.id ?? originalIdx))
                                setMembershipPopoverAnchor(isThisOpen ? null : e.currentTarget)
                              }}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-app-accent/15 text-app-accent hover:bg-app-accent/25 border border-app-accent/30 text-[10px] font-mono font-bold shrink-0 transition-colors cursor-pointer"
                            >
                              <Layers className="ui-section-icon w-2.5 h-2.5" />
                              <span data-testid={`song-setlist-count-${originalIdx}`}>{songSetlists.length}</span>
                            </button>
                            <DropdownPortal
                              anchorEl={membershipPopoverSongId === (song.id ?? originalIdx) ? membershipPopoverAnchor : null}
                              open={membershipPopoverSongId === (song.id ?? originalIdx)}
                              onClose={() => {
                                setMembershipPopoverSongId(null)
                                setMembershipPopoverAnchor(null)
                              }}
                              align="left"
                            >
                              <div
                                id={`membership-popover-${originalIdx}`}
                                role="dialog"
                                aria-label={`Setlists containing ${song.title || 'Untitled Song'}`}
                                data-testid={`membership-popover-${originalIdx}`}
                                onClick={(e) => e.stopPropagation()}
                                className="w-48 bg-app-base border border-app-border rounded-xl shadow-xl py-1.5 px-1 font-mono text-xs animate-in fade-in zoom-in-95 duration-100 z-50"
                              >
                                <div className="px-2 py-1 text-[10px] ui-secondary-text text-app-muted uppercase tracking-wider font-bold border-b border-app-border/40 mb-1">
                                  In Setlists ({songSetlists.length})
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-0.5">
                                  {songSetlists.map((sl, index) => (
                                    <button
                                      key={sl.id}
                                      type="button"
                                      autoFocus={index === 0}
                                      data-testid={`jump-setlist-${sl.id}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setMembershipPopoverSongId(null)
                                        setMembershipPopoverAnchor(null)
                                        if (onManageSetlist) {
                                          onManageSetlist(sl)
                                        } else {
                                          onOpenSetlists()
                                        }
                                      }}
                                      className="ui-link-text w-full text-left px-2 py-1.5 rounded-lg ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center justify-between gap-1.5 cursor-pointer transition-colors"
                                    >
                                      <span className="truncate flex-1">{sl.name}</span>
                                      <ArrowRight className="ui-action-text ui-action-text w-3 h-3 text-app-action shrink-0" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </DropdownPortal>
                          </>
                        )}
                      </div>
                      <p className="text-[11px] sm:text-xs ui-secondary-text text-app-muted truncate mt-0.5">
                        {song.artist || 'Unknown Artist'}
                      </p>
                    </div>
                  </div>

                  {!isSongSelectionMode && (
                    <div className="shrink-0">
                      <button
                        type="button"
                        aria-label={`Song options for ${song.title || 'song'}`}
                        aria-haspopup="true"
                        aria-expanded={isMenuOpen}
                        data-testid={`song-menu-${originalIdx}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveMenuSongIdx(isMenuOpen ? null : originalIdx)
                          setActiveMenuSetlistId(null)
                          setSongMenuAnchor(isMenuOpen ? null : e.currentTarget)
                          setSetlistMenuAnchor(null)
                        }}
                        className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg bg-transparent hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {/* Song Options Menu via portal — escapes overflow:hidden */}
                      <DropdownPortal
                        anchorEl={isMenuOpen ? songMenuAnchor : null}
                        open={isMenuOpen}
                        onClose={closeAllMenus}
                        align="right"
                      >
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="w-44 bg-app-base border border-app-border rounded-xl shadow-xl py-1 font-mono text-xs animate-in fade-in zoom-in-95 duration-100"
                        >
                          <button
                            type="button"
                            data-testid={`menu-add-to-setlist-${originalIdx}`}
                            aria-label={`Add ${song.title} to setlist`}
                            disabled={song.id === undefined}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveMenuSongIdx(null)
                              setMembershipSongId(song.id ?? null)
                            }}
                            className="w-full text-left px-3 py-2 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
                          >
                            <ListPlus className="ui-action-text ui-action-text w-3.5 h-3.5 text-app-action" />
                            <span>Add to Setlist</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`menu-publish-song-${originalIdx}`}
                            aria-label={`Publish ${song.title} to Shared Catalog`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveMenuSongIdx(null)
                              handleOpenPublishModal(song)
                            }}
                            className="w-full text-left px-3 py-2 ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <UploadCloud className="ui-action-text w-3.5 h-3.5 text-app-action" />
                            <span>Publish to Shared</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`menu-delete-song-${originalIdx}`}
                            aria-label={`Delete ${song.title}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveMenuSongIdx(null)
                              setConfirmDeleteIdx(originalIdx)
                            }}
                            className="w-full text-left px-3 py-2 text-status-error hover:bg-app-surface hover:text-status-error flex items-center gap-2 cursor-pointer transition-colors border-t border-app-border/50"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-status-error" />
                            <span>Delete Song</span>
                          </button>
                        </div>
                      </DropdownPortal>
                    </div>
                  )}

                  {/* Inline Delete Confirmation Popover */}
                  {isDeleting && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-0 bg-app-surface border border-[#DC6E67] rounded-xl p-2.5 sm:p-3 flex items-center justify-between z-20 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center gap-2 text-xs text-status-error font-semibold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Delete this song?</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs font-bold">
                        <button
                          type="button"
                          data-testid={`confirm-delete-song-${originalIdx}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteSong(originalIdx)
                            setConfirmDeleteIdx(null)
                          }}
                          className="px-3 py-1 rounded-lg bg-[#DC6E67] text-white hover:bg-[#DC6E67]/90 transition-colors cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          data-testid={`cancel-delete-song-${originalIdx}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDeleteIdx(null)
                          }}
                          className="px-2.5 py-1 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </SwipeableActionCard>
              )
            })}
          </div>
        )}
        </div>
      </section>
      )}
        </>
      )}
    </div>
    </div>
  )
}
