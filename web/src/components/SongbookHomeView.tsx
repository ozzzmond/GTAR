import { SongSetlistDialog } from './SongSetlistDialog'
import { resolveSetlistSong } from '../utils/setlistSongs'
import React, { useState, useMemo, useEffect } from 'react'
import {
  ListPlus,
  Music,
  Plus,
  Play,
  Trash2,
  AlertTriangle,
  Layers,
  ArrowRight,
  Search,
  X,
  Upload,
  Pencil,
  Share2,
  MoreHorizontal,
} from 'lucide-react'
import { exportSingleSetlistJson, parseBackupJson } from '../utils/jsonBackup'
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
  onDeleteSong: (index: number) => void
  onDeleteSetlist?: (setlistId: string | number) => void
  onRenameSetlist?: (setlistId: string | number, newName: string) => void
  setlists?: WebSetlist[]
  onSelectSetlistSong?: (setlistId: string | number, songIdx: number) => void
  onImportSingleSetlist?: (setlist: WebSetlist, songs: ActiveSongState[]) => void
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
  onDeleteSong,
  onDeleteSetlist,
  onRenameSetlist,
  setlists = [],
  onSelectSetlistSong,
  onImportSingleSetlist,
}) => {
  const [membershipSongId, setMembershipSongId] = useState<string | number | null>(null)
  const membershipSong = songs.find(song => membershipSongId !== null && String(song.id) === String(membershipSongId))
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null)
  const [confirmDeleteSetlistId, setConfirmDeleteSetlistId] = useState<string | number | null>(null)
  const [activeMenuSetlistId, setActiveMenuSetlistId] = useState<string | number | null>(null)
  const [renamingSetlist, setRenamingSetlist] = useState<WebSetlist | null>(null)
  const [renameInputValue, setRenameInputValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const setlistFileInputRef = React.useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (activeMenuSetlistId === null) return
    const handleClickOutside = () => setActiveMenuSetlistId(null)
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [activeMenuSetlistId])

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
    } catch (err: any) {
      alert(`Import error: ${err.message}`)
    }

    if (e.target) e.target.value = ''
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
    return setlists.filter((sl) =>
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
        const sl = setlists.find((s) => String(s.id) === String(filterSetlistId))
        if (!sl) return false
        const inSetlist = sl.songs.some(
          (ref) => resolveSetlistSong(ref, songs)?.id === song.id
        )
        if (!inSetlist) return false
      }

      return true
    })
  }, [indexedSongs, searchQuery, filterKey, filterSetlistId, setlists])

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

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 max-w-7xl mx-auto w-full select-none">
      {membershipSong && <SongSetlistDialog
        song={membershipSong}
        setlists={setlists}
        onMembershipChange={onSongMembershipChange}
        onCreate={onCreateSetlistForSong}
        onClose={() => setMembershipSongId(null)}
      />}

      {/* Rename Setlist Modal Dialog */}
      {renamingSetlist && (
        <dialog
          open
          onCancel={() => setRenamingSetlist(null)}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[#1A4A55] bg-[#073642] text-[#FDF6E3] p-0 shadow-2xl backdrop:bg-black/60 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-sm flex items-center gap-2 text-[#FDF6E3]">
                <Pencil className="w-4 h-4 text-[#2AA198]" />
                Rename Setlist
              </h2>
              <button
                type="button"
                onClick={() => setRenamingSetlist(null)}
                className="p-1 rounded-lg hover:bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3] cursor-pointer"
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
              <label htmlFor="rename-setlist-input" className="text-xs text-[#93A1A1] font-mono block mb-1.5">
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
                className="w-full rounded-lg border border-[#1A4A55] bg-[#002B36] p-2 text-sm text-[#FDF6E3] focus:border-[#2AA198] focus:outline-none"
              />
              <div className="flex justify-end gap-2 mt-4 font-mono text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setRenamingSetlist(null)}
                  className="px-3 py-1.5 rounded-lg bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="save-rename-setlist"
                  disabled={!renameInputValue.trim()}
                  className="px-4 py-1.5 rounded-lg bg-[#2AA198] text-[#002B36] hover:bg-[#2AA198]/90 transition-colors cursor-pointer disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}

      {/* 1. Compact Panel Header — title + New Setlist button, no hero */}
      <div className="flex items-center justify-between mb-5 px-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#073642] border border-[#1A4A55] flex items-center justify-center text-[#2AA198]">
            <Music className="w-4 h-4" />
          </div>
          <h1 className="text-lg font-bold text-[#FDF6E3] tracking-tight">
            Songbook &amp; Gig Library
          </h1>
        </div>
        <button
          type="button"
          onClick={onNewSetlist || onOpenSetlists}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md active:scale-95"
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
              <Layers className="w-4 h-4 text-[#B58900]" />
              <h2 className="text-xs font-bold text-[#FDF6E3] uppercase tracking-wider font-mono">
                Gig Setlists ({setlists.length})
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setlistFileInputRef.current?.click()}
                className="text-[10px] font-bold text-[#2AA198] hover:bg-[#2AA198]/15 px-2 py-1 rounded-lg border border-[#2AA198]/40 flex items-center gap-1 transition-colors cursor-pointer"
                title="Import single setlist (.json) into your library"
              >
                <Upload className="w-3 h-3" />
                <span>Import</span>
              </button>
              <button
                type="button"
                onClick={onOpenSetlists}
                className="text-[10px] font-bold text-[#93A1A1] hover:text-[#FDF6E3] flex items-center gap-1 cursor-pointer"
              >
                <span>Manage</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {setlists.map((sl) => {
              const isDeletingSetlist = confirmDeleteSetlistId === sl.id
              const isMenuOpen = activeMenuSetlistId === sl.id

              return (
                <div
                  key={sl.id}
                  onClick={() => {
                    if (onSelectSetlistSong && sl.songs.length > 0) {
                      onSelectSetlistSong(sl.id, 0)
                    } else {
                      onOpenSetlists()
                    }
                  }}
                  className="px-4 py-3 rounded-2xl bg-[#073642] border border-[#1A4A55] hover:border-[#2AA198]/50 transition-all cursor-pointer group flex items-center justify-between gap-3 relative"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[#FDF6E3] group-hover:text-[#2AA198] truncate transition-colors">
                      {sl.name}
                    </div>
                    <div className="text-[11px] font-mono text-[#93A1A1] mt-0.5">
                      {sl.songs.length} {sl.songs.length === 1 ? 'song' : 'songs'}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Circular play button */}
                    <div className="w-9 h-9 rounded-full bg-[#2AA198]/15 text-[#2AA198] flex items-center justify-center group-hover:bg-[#2AA198] group-hover:text-[#002B36] transition-colors">
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </div>

                    {/* Visible Trash / Delete Action */}
                    {onDeleteSetlist && (
                      <button
                        type="button"
                        aria-label="Delete setlist"
                        data-testid={`delete-setlist-${sl.id}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveMenuSetlistId(null)
                          setConfirmDeleteSetlistId(sl.id)
                        }}
                        className="w-7 h-7 rounded-lg bg-transparent hover:bg-[#002B36] text-[#93A1A1] hover:text-[#DC6E67] flex items-center justify-center transition-colors cursor-pointer"
                        title="Delete setlist"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Three-dot overflow button */}
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Setlist actions"
                        aria-haspopup="true"
                        aria-expanded={isMenuOpen}
                        data-testid={`setlist-menu-${sl.id}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveMenuSetlistId(isMenuOpen ? null : sl.id)
                        }}
                        className="w-7 h-7 rounded-lg bg-transparent hover:bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3] flex items-center justify-center transition-colors cursor-pointer"
                        title="Setlist actions"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {/* Three-dot Action Menu: Rename Setlist | Share Setlist */}
                      {isMenuOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-8 w-40 bg-[#002B36] border border-[#1A4A55] rounded-xl shadow-xl z-30 py-1 font-mono text-xs animate-in fade-in zoom-in-95 duration-100"
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
                              className="w-full text-left px-3 py-2 text-[#EEE8D5] hover:bg-[#073642] hover:text-[#2AA198] flex items-center gap-2 cursor-pointer transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[#2AA198]" />
                              <span>Rename Setlist</span>
                            </button>
                          )}
                          <button
                            type="button"
                            data-testid={`menu-share-${sl.id}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveMenuSetlistId(null)
                              exportSingleSetlistJson(sl, songs)
                            }}
                            className={`w-full text-left px-3 py-2 text-[#EEE8D5] hover:bg-[#073642] hover:text-[#2AA198] flex items-center gap-2 cursor-pointer transition-colors ${
                              onRenameSetlist ? 'border-t border-[#1A4A55]/50' : ''
                            }`}
                          >
                            <Share2 className="w-3.5 h-3.5 text-[#B58900]" />
                            <span>Share Setlist</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline Delete Confirmation Popover */}
                  {isDeletingSetlist && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-0 bg-[#073642] border border-[#DC6E67] rounded-2xl p-4 flex items-center justify-between z-20 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center gap-2 text-xs text-[#DC6E67] font-semibold">
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
                          className="px-2.5 py-1 rounded-lg bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 3. Main Songs Grid / List */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-[#2AA198]" />
            <h2 className="text-sm font-bold text-[#FDF6E3] uppercase tracking-wider font-mono">
              Songs Library ({filteredIndexedSongs.length} of {songs.length})
            </h2>
          </div>
          <span className="text-xs text-[#93A1A1] font-mono">
            Click any song to launch Stage View
          </span>
        </div>

        {/* Sort & Filter Toolbar */}
        {songs.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 rounded-2xl bg-[#073642]/70 border border-[#1A4A55] shadow-sm">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-[#93A1A1] shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by title or artist..."
                className="bg-transparent border-none outline-none text-xs text-[#FDF6E3] placeholder-[#93A1A1] w-full font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-[#93A1A1] hover:text-[#FDF6E3] p-1 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Sort Dropdown */}
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-[#93A1A1] text-[11px] font-bold">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value as SortOption)}
                  className="bg-[#002B36] border border-[#1A4A55] text-[#EEE8D5] rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-[#2AA198] transition-colors"
                >
                  <option value="title">Title (A-Z)</option>
                  <option value="artist">Artist (A-Z)</option>
                  <option value="key">Key</option>
                  <option value="date">Date Added</option>
                </select>
              </div>

              {/* Key Filter Dropdown */}
              {availableKeys.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <span className="text-[#93A1A1] text-[11px] font-bold">Key:</span>
                  <select
                    value={filterKey}
                    onChange={(e) => handleFilterKeyChange(e.target.value)}
                    className="bg-[#002B36] border border-[#1A4A55] text-[#EEE8D5] rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-[#2AA198] transition-colors"
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

              {/* Setlist Filter Dropdown */}
              {setlists.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <span className="text-[#93A1A1] text-[11px] font-bold">Setlist:</span>
                  <select
                    value={filterSetlistId}
                    onChange={(e) => handleFilterSetlistChange(e.target.value)}
                    className="bg-[#002B36] border border-[#1A4A55] text-[#EEE8D5] rounded-lg px-2.5 py-1 text-xs font-mono outline-none cursor-pointer hover:border-[#2AA198] transition-colors"
                  >
                    <option value="ALL">All Setlists</option>
                    {setlists.map((sl) => (
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
          <div className="p-12 text-center rounded-3xl border border-[#1A4A55] bg-[#073642]/50 text-[#93A1A1] space-y-3">
            <Music className="w-8 h-8 mx-auto text-[#2AA198]" />
            <div className="text-base font-bold text-[#FDF6E3]">Your Songbook is Empty</div>
            <p className="text-xs max-w-sm mx-auto">
              Create your first song template or import chord charts from files or online web sources.
            </p>
            <button
              type="button"
              onClick={onNewSong}
              className="mt-2 px-4 py-2 rounded-xl bg-[#2AA198] text-[#002B36] font-bold text-xs"
            >
              + Create First Song
            </button>
          </div>
        ) : sortedIndexedSongs.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-[#1A4A55] bg-[#073642]/40 text-[#93A1A1] space-y-2">
            <div className="text-sm font-bold text-[#FDF6E3]">No matching songs found</div>
            <p className="text-xs">Try clearing your search query or adjusting key/setlist filters.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                handleFilterKeyChange('ALL')
                handleFilterSetlistChange('ALL')
              }}
              className="mt-2 px-3 py-1.5 rounded-lg bg-[#002B36] border border-[#1A4A55] text-xs text-[#2AA198] font-bold cursor-pointer hover:border-[#2AA198]"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {sortedIndexedSongs.map(({ song, originalIdx }, displayIdx) => {
              const isSelected = originalIdx === activeSongIndex
              const isDeleting = confirmDeleteIdx === originalIdx
              const songSetlists = getSongSetlists(song)

              return (
                <div
                  key={song.id || originalIdx}
                  onClick={() => onSelectSong(originalIdx)}
                  className={`relative p-4 rounded-2xl border transition-all cursor-pointer select-none group flex flex-col justify-between min-h-[115px] ${
                    isSelected
                      ? 'border-[#2AA198] bg-[#073642] ring-1 ring-[#2AA198] shadow-lg shadow-[#2AA198]/10'
                      : 'border-[#1A4A55] bg-[#073642]/70 hover:border-[#2AA198] hover:bg-[#073642]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono text-xs font-bold shrink-0 transition-colors shadow-inner ${
                          isSelected
                            ? 'bg-[#2AA198] text-[#002B36]'
                            : 'bg-[#002B36] text-[#93A1A1] group-hover:text-[#2AA198]'
                        }`}
                      >
                        {String(displayIdx + 1).padStart(2, '0')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-sm text-[#FDF6E3] group-hover:text-[#2AA198] transition-colors truncate">
                          {song.title || 'Untitled Song'}
                        </h3>
                        <p className="text-xs text-[#93A1A1] truncate mt-0.5">
                          {song.artist || 'Unknown Artist'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={event => { event.stopPropagation(); setMembershipSongId(song.id ?? null) }}
                      disabled={song.id === undefined}
                      className="p-2 rounded-lg text-[#2AA198] hover:bg-[#2AA198]/15 transition-colors cursor-pointer disabled:opacity-50"
                      title="Add to Setlist"
                      aria-label={`Add ${song.title} to setlist`}
                    >
                      <ListPlus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDeleteIdx(originalIdx)
                      }}
                      className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#DC6E67] hover:bg-[#DC6E67]/15 transition-colors cursor-pointer"
                      title="Delete song"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Metadata & Setlist Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-[#1A4A55]/60 text-[10px] font-mono">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {song.key && (
                        <span className="px-2 py-0.5 rounded-md bg-[#002B36] text-[#B58900] font-bold border border-[#1A4A55]">
                          KEY: {song.key}
                        </span>
                      )}
                      {song.capo && song.capo.toLowerCase() !== 'no capo' && (
                        <span className="px-1.5 py-0.5 rounded-md bg-[#002B36] text-[#2AA198] border border-[#1A4A55]">
                          {song.capo}
                        </span>
                      )}
                      {song.bpm && (
                        <span className="px-1.5 py-0.5 rounded-md bg-[#002B36] text-[#93A1A1] border border-[#1A4A55]">
                          {song.bpm} BPM
                        </span>
                      )}

                      {/* Setlist Badges */}
                      {songSetlists.map((sl) => (
                        <span
                          key={sl.id}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#B58900]/15 text-[#B58900] border border-[#B58900]/30 font-bold"
                          title={`In Setlist: ${sl.name}`}
                        >
                          <Layers className="w-2.5 h-2.5" />
                          <span className="truncate max-w-[80px]">{sl.name}</span>
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-1 text-[#2AA198] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                      <span>OPEN STAGE</span>
                      <Play className="w-2.5 h-2.5 fill-current" />
                    </div>
                  </div>

                  {/* Inline Delete Confirmation Popover */}
                  {isDeleting && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-0 bg-[#073642] border border-[#DC6E67] rounded-2xl p-4 flex items-center justify-between z-20 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center gap-2 text-xs text-[#DC6E67] font-semibold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Delete this song?</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs font-bold">
                        <button
                          type="button"
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
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmDeleteIdx(null)
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
