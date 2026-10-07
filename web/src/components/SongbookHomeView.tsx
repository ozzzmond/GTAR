import { SongSetlistDialog } from './SongSetlistDialog'
import { resolveSetlistSong } from '../utils/setlistSongs'
import { DropdownPortal } from './DropdownPortal'
import React, { useState, useMemo, useRef, useCallback } from 'react'
import {
  ListPlus,
  Music,
  Plus,
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
  Check,
  CheckCircle2,
  AlertCircle,
  Menu,
} from 'lucide-react'
import { exportSingleSetlistJson, parseBackupJson } from '../utils/jsonBackup'
import { getSongMetadataStatus } from '../utils/chordProMetadata'
import { extractShareToken, type SharedSetlistPayload } from '../utils/sharedSetlist'
import { Link, QrCode } from 'lucide-react'
import { SwipeableActionCard } from './SwipeableActionCard'
import type { ActiveSongState, WebSetlist } from '../types/gtar'

interface SongbookHomeViewProps {
  onSongMembershipChange: (songId: string | number, setlistId: string | number, included: boolean) => void
  onCreateSetlistForSong: (songId: string | number, name: string) => void
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
  onBulkAddSongsToSetlist?: (songIds: Array<string | number>, setlistId: string | number) => void
  onBulkDeleteSetlists?: (setlistIds: Array<string | number>) => void
  onShareSetlist?: (setlist: WebSetlist) => void
  onImportSharedSetlist?: (shared: SharedSetlistPayload) => void
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
  onOpenSongbook,
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
  onImportSharedSetlist,
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

  // Song multi-selection state
  const [isSongSelectionMode, setIsSongSelectionMode] = useState(false)
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string | number>>(() => new Set())
  const [isBulkDeleteSongsConfirmOpen, setIsBulkDeleteSongsConfirmOpen] = useState(false)
  const [isBulkAddToSetlistModalOpen, setIsBulkAddToSetlistModalOpen] = useState(false)

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

  type SortOption = 'title' | 'artist' | 'key' | 'date'
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gtar_songbook_sort')
      if (saved === 'title' || saved === 'artist' || saved === 'key' || saved === 'date') {
        return saved
      }
    }
    return 'title'
  })

  const [filterKey, setFilterKey] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gtar_songbook_filter_key') || 'ALL'
    }
    return 'ALL'
  })

  const [filterSetlistId, setFilterSetlistId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gtar_songbook_filter_setlist') || 'ALL'
    }
    return 'ALL'
  })

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

  const handleFilterKeyChange = (newKey: string) => {
    setFilterKey(newKey)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_songbook_filter_key', newKey)
    }
  }

  const handleFilterSetlistChange = (slId: string) => {
    setFilterSetlistId(slId)
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_songbook_filter_setlist', slId)
    }
  }

  // Find setlists containing a song
  const getSongSetlists = (song: ActiveSongState) => {
    return activeSetlists.filter((sl) =>
      sl.songs.some(
        (ref) => resolveSetlistSong(ref, songs)?.id === song.id
      )
    )
  }

  // Available unique keys in library
  const availableKeys = useMemo(() => {
    const keys = new Set<string>()
    songs.forEach((s) => {
      if (s.key && s.key.trim()) {
        keys.add(s.key.trim().toUpperCase())
      }
    })
    return Array.from(keys).sort()
  }, [songs])

  // Map songs with their original index in library
  const indexedSongs = useMemo(() => {
    return songs.map((song, originalIdx) => ({ song, originalIdx }))
  }, [songs])

  // Filter songs
  const filteredIndexedSongs = useMemo(() => {
    return indexedSongs.filter(({ song }) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchTitle = song.title?.toLowerCase().includes(q)
        const matchArtist = song.artist?.toLowerCase().includes(q)
        if (!matchTitle && !matchArtist) return false
      }

      if (filterKey !== 'ALL') {
        const sKey = (song.key || '').trim().toUpperCase()
        if (sKey !== filterKey.toUpperCase()) return false
      }

      if (filterSetlistId !== 'ALL') {
        const sl = activeSetlists.find((s) => String(s.id) === String(filterSetlistId))
        if (!sl) return false
        const inSetlist = sl.songs.some(
          (ref) => resolveSetlistSong(ref, songs)?.id === song.id
        )
        if (!inSetlist) return false
      }

      if (filterMetadata !== 'ALL') {
        const metaStatus = getSongMetadataStatus(song).status
        if (filterMetadata === 'METADATA_OK' && metaStatus !== 'METADATA_OK') return false
        if (filterMetadata === 'NEEDS_METADATA' && metaStatus !== 'NEEDS_METADATA') return false
      }

      return true
    })
  }, [indexedSongs, songs, searchQuery, filterKey, filterSetlistId, filterMetadata, activeSetlists])

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
      if (sortBy === 'key') {
        return (a.song.key || '').localeCompare(b.song.key || '')
      }
      // 'date' or default order
      return a.originalIdx - b.originalIdx
    })
    return list
  }, [filteredIndexedSongs, sortBy])

  // Filter setlists by search query (matching setlist name or tracks inside setlist)
  const filteredSetlists = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return activeSetlists
    return activeSetlists.filter((sl) => {
      const matchName = sl.name.toLowerCase().includes(q)
      const matchSong = (sl.songs || []).some((ref) => {
        const resolved = resolveSetlistSong(ref, songs)
        const t = resolved?.title || ref.title || ''
        const a = resolved?.artist || ref.artist || ''
        return t.toLowerCase().includes(q) || a.toLowerCase().includes(q)
      })
      return matchName || matchSong
    })
  }, [activeSetlists, searchQuery, songs])

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
      const res = await fetch(`/api/setlist/share?token=${extracted.token}`)
      if (!res.ok) {
        throw new Error('Shared setlist not found or expired.')
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
    <div className="songbook-ui flex-1 overflow-y-auto px-2 sm:px-8 py-3 sm:py-6 max-w-7xl mx-auto w-full select-none">
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
              Choose a setlist to generate an immutable QR code and link snapshot:
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
              Selected songs will be removed from your songbook and references to them will be removed from setlists.
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

      {/* 1. Compact Panel Header — title + New Setlist button, no hero */}
      <div className="flex items-center justify-between mb-5 px-1">
        <div className="flex items-center gap-2.5">
          <div className="ui-section-icon w-8 h-8 rounded-xl bg-app-surface border border-app-border flex items-center justify-center text-app-action">
            <Music className="ui-section-icon w-4 h-4" />
          </div>
          <h1 className="ui-section-text text-lg font-bold ui-primary-text text-app-heading tracking-tight">
            Songbook &amp; Gig Library
          </h1>
        </div>
        <button
          type="button"
          onClick={onNewSetlist || onOpenSetlists}
          className="px-4 py-2 rounded-xl bg-app-button hover:bg-app-button text-app-button-text font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md active:scale-95"
          title="Create new empty gig setlist"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
          <span>New Setlist</span>
        </button>
      </div>

      {/* 2. Gig Setlists Grid */}
      {setlists.length > 0 && (
        <div className="mb-6">
          {/* Hidden file input for Setlist .json import */}
          <input
            ref={setlistFileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleSetlistImportFile}
            className="hidden"
          />

          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <Layers className="ui-section-icon w-4 h-4 text-app-accent" />
              <h2 className="ui-section-text text-xs font-bold ui-primary-text text-app-heading uppercase tracking-wider font-mono">
                Gig Setlists ({searchQuery.trim() ? `${filteredSetlists.length} of ${setlists.length}` : filteredSetlists.length})
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {isSetlistSelectionMode ? (
                <div data-testid="setlist-selection-bar" className="flex items-center gap-2">
                  <span data-testid="setlist-selection-count" className="ui-action-text text-xs font-mono font-bold text-app-action">
                    {selectedSetlistIds.size} selected
                  </span>
                  <button
                    type="button"
                    data-testid="bulk-delete-setlists"
                    disabled={selectedSetlistIds.size === 0}
                    onClick={() => setIsBulkDeleteSetlistsConfirmOpen(true)}
                    className="text-xs font-bold text-status-error hover:bg-[#DC6E67]/15 px-2.5 py-1 rounded-lg border border-[#DC6E67]/40 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Delete selected setlists"
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
                    className="text-xs font-mono ui-secondary-text text-app-muted hover:text-app-heading px-2 py-1 rounded cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  {!setlistsCollapsed && (
                    <button
                      type="button"
                      data-testid="toggle-setlist-selection-mode"
                      onClick={() => {
                        setIsSetlistSelectionMode(true)
                        setSelectedSetlistIds(new Set())
                      }}
                      className="ui-action-text text-xs px-2 py-1 border border-app-action/40 rounded text-app-action hover:bg-app-action/10 cursor-pointer"
                    >
                      Select
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="main-share-setlist-btn"
                    disabled={activeSetlists.length === 0}
                    onClick={handleMainShareSetlist}
                    aria-label="Share Setlist"
                    className="p-1.5 rounded-lg border border-app-accent/40 bg-app-surface text-app-accent hover:bg-app-accent/15 transition-colors cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-app-accent"
                    title={activeSetlists.length === 0 ? 'Create a setlist first to share' : 'Share Setlist'}
                  >
                    <QrCode className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={toggleSetlists} aria-expanded={!setlistsCollapsed} aria-controls="gig-setlist-cards" className="ui-action-text text-xs px-2 py-1 border border-app-action/40 rounded text-app-action">
                    {setlistsCollapsed ? 'Show' : 'Hide'}
                  </button>
                  <button
                    type="button"
                    data-testid="main-import-setlist-btn"
                    onClick={() => {
                      setImportLinkError(null)
                      setIsImportModalOpen(true)
                    }}
                    className="ui-action-text text-[10px] font-bold text-app-action hover:bg-app-action/15 px-2 py-1 rounded-lg border border-app-action/40 flex items-center gap-1 transition-colors cursor-pointer"
                    title="Import single setlist (.json) into your library"
                  >
                    <Upload className="w-3 h-3" />
                    <span>Import</span>
                  </button>
                  <button
                    type="button"
                    data-testid="open-setlists-panel-btn"
                    onClick={onOpenSetlists}
                    className="p-1.5 rounded-lg border border-app-border bg-app-surface text-app-muted hover:text-app-heading hover:border-app-action/40 transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-app-action"
                    title="Open Setlists panel"
                    aria-label="Open Setlists panel"
                  >
                    <Menu className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          <div id="gig-setlist-cards" hidden={setlistsCollapsed}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-2.5">
            {filteredSetlists.map((sl) => {
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
                      <div className="text-xs sm:text-sm font-bold ui-primary-text text-app-heading group-hover:text-app-action truncate transition-colors">
                        {sl.name}
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
                      title="Play setlist"
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
                      title="Setlist actions"
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
                            title="Delete setlist"
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
        </div>
      )}

      {/* 3. Main Songs Grid / List */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <Music className="ui-section-icon w-4 h-4 text-app-action" />
            <h2 className="ui-section-text text-sm font-bold ui-primary-text text-app-heading uppercase tracking-wider font-mono">
              Songs Library ({filteredIndexedSongs.length} of {songs.length})
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {songs.length > 0 && isSongSelectionMode ? (
              <div data-testid="song-selection-bar" className="flex items-center gap-2">
                <span data-testid="song-selection-count" className="ui-action-text text-xs font-mono font-bold text-app-action">
                  {selectedSongIds.size} selected
                </span>
                <button
                  type="button"
                  data-testid="bulk-add-to-setlist"
                  disabled={selectedSongIds.size === 0}
                  onClick={() => setIsBulkAddToSetlistModalOpen(true)}
                  className="ui-action-text text-xs font-bold text-app-action hover:bg-app-action/15 px-2.5 py-1 rounded-lg border border-app-action/40 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Add selected songs to setlist"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>Add to Setlist</span>
                </button>
                <button
                  type="button"
                  data-testid="bulk-delete-songs"
                  disabled={selectedSongIds.size === 0}
                  onClick={() => setIsBulkDeleteSongsConfirmOpen(true)}
                  className="text-xs font-bold text-status-error hover:bg-[#DC6E67]/15 px-2.5 py-1 rounded-lg border border-[#DC6E67]/40 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Delete selected songs"
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
                  className="text-xs font-mono ui-secondary-text text-app-muted hover:text-app-heading px-2 py-1 rounded cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {songs.length > 0 && (
                  <button
                    type="button"
                    data-testid="toggle-song-selection-mode"
                    onClick={() => {
                      setIsSongSelectionMode(true)
                      setSelectedSongIds(new Set())
                    }}
                    className="ui-action-text text-xs px-2.5 py-1 border border-app-action/40 rounded-lg text-app-action hover:bg-app-action/10 font-mono font-semibold cursor-pointer"
                    title="Manage song selection, setlist assignment, and batch actions"
                  >
                    Manage
                  </button>
                )}
                {onOpenSongbook && (
                  <button
                    type="button"
                    data-testid="open-songbook-panel-btn"
                    onClick={onOpenSongbook}
                    className="p-1.5 rounded-lg border border-app-border bg-app-surface text-app-muted hover:text-app-heading hover:border-app-action/40 transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-app-action"
                    title="Open Songbook panel"
                    aria-label="Open Songbook panel"
                  >
                    <Menu className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sort & Filter Toolbar */}
        {songs.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-3 mb-4 p-3 rounded-2xl bg-app-filter border border-app-border shadow-sm">
            <div className="flex items-center gap-2.5 flex-wrap">
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
                  <option value="key">Key</option>
                  <option value="date">Library Order</option>
                </select>
              </div>

              {/* Key Filter Dropdown */}
              {availableKeys.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <span className="ui-secondary-text text-app-muted text-[11px] font-bold">Key:</span>
                  <select
                    value={filterKey}
                    onChange={(e) => handleFilterKeyChange(e.target.value)}
                    className="bg-app-base border border-app-border ui-primary-text text-app-text rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-app-action transition-colors"
                  >
                    <option value="ALL">All Keys</option>
                    {availableKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
          </div>
        )}

        {songs.length === 0 ? (
          <div className="p-12 text-center rounded-3xl border border-app-border bg-app-surface/50 ui-secondary-text text-app-muted space-y-3">
            <Music className="ui-section-icon w-8 h-8 mx-auto text-app-action" />
            <div className="text-base font-bold ui-primary-text text-app-heading">Your Songbook is Empty</div>
            <p className="text-xs max-w-sm mx-auto">
              Create your first song template or import chord charts from files or online web sources.
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
            <p className="text-xs">Try clearing your search query or adjusting key/setlist filters.</p>
            <button
              type="button"
              onClick={() => {
                handleSearchChange('')
                handleFilterKeyChange('ALL')
                handleFilterSetlistChange('ALL')
                handleFilterMetadataChange('ALL')
              }}
              className="ui-action-text mt-2 px-3 py-1.5 rounded-lg bg-app-base border border-app-border text-xs text-app-action font-bold cursor-pointer hover:border-app-action"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-2.5">
            {sortedIndexedSongs.map(({ song, originalIdx }, displayIdx) => {
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
                        <span
                          data-testid={`song-metadata-status-${originalIdx}`}
                          role="status"
                          aria-label={isMetaOk ? 'Metadata OK' : 'Needs Metadata'}
                          title={isMetaOk ? 'Metadata OK' : `Needs Metadata (${metadataStatus.missingFields.join(', ')})`}
                          className={`p-0.5 rounded flex items-center justify-center shrink-0 ${
                            isMetaOk ? 'text-status-success' : 'text-app-accent'
                          }`}
                        >
                          {isMetaOk ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5" />
                          )}
                        </span>
                        {songSetlists.length > 0 && (
                          <>
                            <button
                              type="button"
                              aria-label={`Used in ${songSetlists.length} ${songSetlists.length === 1 ? 'setlist' : 'setlists'}`}
                              aria-haspopup="dialog"
                              aria-expanded={membershipPopoverSongId === (song.id ?? originalIdx)}
                              aria-controls={membershipPopoverSongId === (song.id ?? originalIdx) ? `membership-popover-${originalIdx}` : undefined}
                              title={`Used in ${songSetlists.length} ${songSetlists.length === 1 ? 'setlist' : 'setlists'}`}
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
                                      title={`Manage ${sl.name}`}
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
                        title="Song options"
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
                            title="Add to Setlist"
                          >
                            <ListPlus className="ui-action-text ui-action-text w-3.5 h-3.5 text-app-action" />
                            <span>Add to Setlist</span>
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
                            title="Delete song"
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
    </div>
  )
}
