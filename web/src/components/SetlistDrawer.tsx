import { resolveSetlistSong } from '../utils/setlistSongs'
import React, { useState, useEffect } from 'react'
import {
  X,
  ListMusic,
  Search,
  Music,
  Activity,
  Play,
  CheckCircle2,
  Trash2,
  Plus,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  PlayCircle,
  Download,
  Upload,
} from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { exportAllDataJson, exportSingleSetlistJson, parseBackupJson } from '../utils/jsonBackup'

interface SetlistDrawerProps {
  isOpen: boolean
  onClose: () => void
  songs: ActiveSongState[]
  activeSongIndex: number
  onSelectSongIndex: (index: number) => void
  setlists?: WebSetlist[]
  activeSetlistId?: string | number | null
  activeSetlistSongIndex?: number
  onSelectSetlistSong?: (setlistId: string | number, songIndex: number) => void
  onReorderSetlistSong?: (setlistId: string | number, songIndex: number, moveUp: boolean) => void
  onRemoveSetlistSong?: (setlistId: string | number, songIndex: number) => void
  onDeleteSetlist?: (setlistId: string | number) => void
  onDeleteSong: (index: number) => void
  onNewSong: () => void
  onNewSetlist?: () => void
  onImportSingleSetlist?: (setlist: WebSetlist, songs: ActiveSongState[]) => void
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void
  onExportAllData?: () => void
}

export const SetlistDrawer: React.FC<SetlistDrawerProps> = ({
  isOpen,
  onClose,
  songs,
  activeSongIndex,
  onSelectSongIndex,
  setlists = [],
  activeSetlistId = null,
  activeSetlistSongIndex = 0,
  onSelectSetlistSong,
  onReorderSetlistSong,
  onRemoveSetlistSong,
  onDeleteSetlist,
  onDeleteSong,
  onNewSong,
  onNewSetlist,
  onImportSingleSetlist,
  onSmartMerge,
  onExportAllData,
}) => {
  const [drawerTab, setDrawerTab] = useState<'songbook' | 'setlists'>('songbook')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null)
  const [expandedSetlistId, setExpandedSetlistId] = useState<string | number | null>(activeSetlistId)
  const [drawerToast, setDrawerToast] = useState<string | null>(null)
  const setlistFileInputRef = React.useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && activeSetlistId !== null && activeSetlistId !== undefined) {
      setDrawerTab('setlists')
      setExpandedSetlistId(activeSetlistId)
    }
  }, [isOpen, activeSetlistId])

  const showDrawerToast = (msg: string) => {
    setDrawerToast(msg)
    setTimeout(() => setDrawerToast(null), 3500)
  }

  const handleExportSingle = (sl: WebSetlist) => {
    try {
      const fileName = exportSingleSetlistJson(sl, songs)
      showDrawerToast(`Exported "${sl.name}" as ${fileName}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showDrawerToast(`Export failed: ${msg}`)
    }
  }

  const handleExportAll = () => {
    try {
      if (onExportAllData) {
        onExportAllData()
      } else {
        const fileName = exportAllDataJson(songs, setlists)
        showDrawerToast(`Exported backup as ${fileName}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showDrawerToast(`Export failed: ${msg}`)
    }
  }

  const handleSetlistFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseBackupJson(text, { mode: 'merge', existingSongs: songs })

      if (!parsed.isValid) {
        showDrawerToast(parsed.error || 'Invalid or corrupted JSON file.')
        return
      }

      if (parsed.isSingleSetlist && parsed.setlists.length > 0) {
        if (onImportSingleSetlist) {
          onImportSingleSetlist(parsed.setlists[0], parsed.songs)
        } else if (onSmartMerge) {
          onSmartMerge(parsed.songs, parsed.setlists)
        }
        showDrawerToast(`Imported setlist "${parsed.singleSetlistName}" (${parsed.songs.length} tracks)!`)
      } else {
        if (onSmartMerge) {
          onSmartMerge(parsed.songs, parsed.setlists)
        }
        showDrawerToast(`Imported ${parsed.songs.length} songs and ${parsed.setlists.length} setlists!`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showDrawerToast(`Import error: ${msg}`)
    }

    if (e.target) e.target.value = ''
  }

  if (!isOpen) return null

  // Real-time search filter by Title or Artist
  const filteredSongs = songs.filter((s) => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return true
    return (
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q)
    )
  })

  // Real-time search filter for setlists (matching setlist name or tracks)
  const filteredSetlists = setlists.filter((sl) => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return true
    const matchName = sl.name.toLowerCase().includes(q)
    const matchSong = (sl.songs || []).some((sRef) => {
      const resolved = resolveSetlistSong(sRef, songs)
      const t = resolved?.title || sRef.title || ''
      const a = resolved?.artist || sRef.artist || ''
      return t.toLowerCase().includes(q) || a.toLowerCase().includes(q)
    })
    return matchName || matchSong
  })

  const handleDeleteClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    setConfirmDeleteIndex(index)
  }

  const handleConfirmDelete = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    onDeleteSong(index)
    setConfirmDeleteIndex(null)
  }

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDeleteIndex(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex select-none">
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
      />

      {/* Drawer Container (Sliding smoothly from Left) */}
      <div
        className="relative w-80 sm:w-96 max-w-[88vw] h-full bg-[#073642] border-r border-[#1A4A55] shadow-2xl flex flex-col z-50 animate-in slide-in-from-left duration-200"
        onClick={() => setConfirmDeleteIndex(null)}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-[#1A4A55] bg-[#002B36] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#073642] border border-[#2AA198]/40 flex items-center justify-center text-[#2AA198]">
              <ListMusic className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#FDF6E3]">
                  {drawerTab === 'songbook' ? 'Songbook Library' : 'Gig Setlists'}
                </h2>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#2AA198]/20 text-[#2AA198] border border-[#2AA198]/30">
                  {drawerTab === 'songbook'
                    ? `${songs.length} ${songs.length === 1 ? 'Song' : 'Songs'}`
                    : `${setlists.length} ${setlists.length === 1 ? 'Setlist' : 'Setlists'}`}
                </span>
              </div>
              <p className="text-[10px] font-mono text-[#93A1A1]">Live Stage & Editor Switcher</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#073642] transition-colors cursor-pointer"
            title="Close Drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher: Songbook vs Setlists */}
        <div className="flex border-b border-[#1A4A55] bg-[#002B36]/80 px-2 py-1 gap-1">
          <button
            type="button"
            onClick={() => setDrawerTab('songbook')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
              drawerTab === 'songbook'
                ? 'bg-[#2AA198] text-[#002B36] shadow-sm'
                : 'text-[#93A1A1] hover:text-[#EEE8D5]'
            }`}
          >
            Songbook ({songs.length})
          </button>
          <button
            type="button"
            onClick={() => setDrawerTab('setlists')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
              drawerTab === 'setlists'
                ? 'bg-[#B58900] text-[#002B36] shadow-sm'
                : 'text-[#93A1A1] hover:text-[#EEE8D5]'
            }`}
          >
            Setlists ({setlists.length})
          </button>
        </div>

        {/* Real-time Search & Filter Bar */}
        <div className="p-3 border-b border-[#1A4A55] bg-[#002B36]/60">
          <div className="flex items-center gap-2 bg-[#002B36] px-3 py-2 rounded-xl border border-[#1A4A55] text-xs">
            <Search className="w-3.5 h-3.5 text-[#93A1A1]" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={drawerTab === 'setlists' ? 'Search setlists by name or track...' : 'Search by title or artist...'}
              className="w-full bg-transparent text-[#FDF6E3] focus:outline-none placeholder-[#93A1A1]/60 text-xs font-mono"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-[11px] text-[#93A1A1] hover:text-[#FDF6E3] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Hidden file input for Setlist .json import */}
        <input
          ref={setlistFileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleSetlistFileChange}
          className="hidden"
        />

        {/* Transient feedback toast */}
        {drawerToast && (
          <div className="mx-3 my-1 px-3 py-1.5 rounded-lg bg-[#2AA198] text-[#002B36] text-xs font-bold font-mono animate-fade-in flex items-center justify-between">
            <span>{drawerToast}</span>
            <button
              type="button"
              onClick={() => setDrawerToast(null)}
              className="text-[#002B36] hover:opacity-75"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tab Content: Songbook or Setlists */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {drawerTab === 'setlists' ? (
            <div className="space-y-2">
              {/* Setlists Control Bar: Import Setlist (.json) & Export All (JSON) */}
              <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-[#1A4A55]/60 mb-2">
                <span className="text-[10px] font-mono font-bold text-[#93A1A1] uppercase tracking-wider">
                  Gig Setlists ({setlists.length})
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setlistFileInputRef.current?.click()}
                    className="px-2 py-1 rounded-lg bg-[#2AA198]/15 hover:bg-[#2AA198] text-[#2AA198] hover:text-[#002B36] text-[10px] font-bold font-mono flex items-center gap-1 transition-colors cursor-pointer border border-[#2AA198]/30"
                    title="Import a single setlist (.json) into your library"
                  >
                    <Upload className="w-3 h-3" />
                    <span>Import Setlist</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportAll}
                    className="px-2 py-1 rounded-lg bg-[#002B36] hover:bg-[#1A4A55] text-[#93A1A1] hover:text-[#FDF6E3] text-[10px] font-bold font-mono flex items-center gap-1 transition-colors cursor-pointer border border-[#1A4A55]"
                    title="Export All Data (JSON)"
                  >
                    <Download className="w-3 h-3" />
                    <span>Export All</span>
                  </button>
                </div>
              </div>

              {setlists.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-[#93A1A1] space-y-2">
                  <div className="text-sm font-bold text-[#EEE8D5]">No Custom Setlists</div>
                  <div>Your songbook contains {songs.length} songs.</div>
                  <div className="text-[11px] text-[#2AA198]">
                    Setlists stay completely separate from your full library.
                  </div>
                </div>
              ) : filteredSetlists.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-[#93A1A1] space-y-2">
                  <div className="text-sm font-bold text-[#EEE8D5]">No Matching Setlists</div>
                  <div>No setlists match &quot;{searchQuery}&quot;</div>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-[#002B36] border border-[#1A4A55] text-xs text-[#2AA198] font-bold cursor-pointer hover:border-[#2AA198]"
                  >
                    Clear Search
                  </button>
                </div>
              ) : (
                filteredSetlists.map((sl) => {
                  const isExpanded = expandedSetlistId === sl.id
                  const slSongs = sl.songs || []
                  return (
                    <div
                      key={sl.id || sl.name}
                      className="border border-[#1A4A55] rounded-xl bg-[#002B36]/60 overflow-hidden shadow-sm transition-all"
                    >
                      {/* Setlist Header Card */}
                      <div className="p-3 flex items-center justify-between gap-2">
                        <div
                          onClick={() => setExpandedSetlistId(isExpanded ? null : sl.id)}
                          className="min-w-0 flex-1 flex items-center gap-2.5 cursor-pointer select-none"
                        >
                          <div className="w-8 h-8 rounded-lg bg-[#073642] border border-[#B58900]/40 flex items-center justify-center text-[#B58900] shrink-0">
                            <ListMusic className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-[#FDF6E3] truncate">{sl.name}</div>
                            <div className="text-[10px] font-mono text-[#93A1A1]">
                              {slSongs.length} {slSongs.length === 1 ? 'track' : 'tracks'} • Tap to expand
                            </div>
                          </div>
                        </div>

                        {/* Header Actions: Quick Play Setlist, Export Setlist (.json), Toggle Expand, Delete Setlist */}
                        <div className="flex items-center gap-1 shrink-0">
                          {slSongs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (onSelectSetlistSong) {
                                  onSelectSetlistSong(sl.id, 0)
                                }
                                onClose()
                              }}
                              className="p-1.5 rounded-lg text-[#B58900] hover:text-[#D4A017] hover:bg-[#B58900]/15 transition-colors cursor-pointer"
                              title="Start Gig / Play Setlist from Beginning"
                            >
                              <PlayCircle className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleExportSingle(sl)
                            }}
                            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#2AA198] hover:bg-[#073642] transition-colors cursor-pointer"
                            title="Export Setlist (.json)"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedSetlistId(isExpanded ? null : sl.id)}
                            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#073642] transition-colors cursor-pointer"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                          {onDeleteSetlist && (
                            <button
                              type="button"
                              onClick={() => onDeleteSetlist(sl.id)}
                              className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#DC6E67] hover:bg-[#DC6E67]/15 transition-colors cursor-pointer"
                              title="Delete Setlist"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                    {/* Smoothly Expanded Cascading Songs List (1:1 Android SetlistCard) */}
                    {isExpanded && (
                      <div className="p-2 border-t border-[#1A4A55] bg-[#002B36]/90 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                        {slSongs.length === 0 ? (
                          <div className="p-4 text-center text-[11px] font-mono text-[#93A1A1]">
                            No songs in this setlist. Add songs from your songbook!
                          </div>
                        ) : (
                          slSongs.map((sRef, sIdx: number) => {
                            const resolvedSong = resolveSetlistSong(sRef, songs)
                            const isCurrentSetlistSong =
                              activeSetlistId === sl.id && activeSetlistSongIndex === sIdx
                            return (
                              <div
                                key={sIdx}
                                onClick={() => {
                                  if (onSelectSetlistSong) {
                                    onSelectSetlistSong(sl.id, sIdx)
                                  }
                                  onClose()
                                }}
                                className={`p-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                                  isCurrentSetlistSong
                                    ? 'bg-[#073642] border-[#B58900] shadow-sm'
                                    : 'bg-[#002B36] border-[#1A4A55]/60 hover:border-[#2AA198] hover:bg-[#073642]/60'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {/* Track Number Badge */}
                                  <div
                                    className={`w-6 h-6 rounded-md flex items-center justify-center font-mono text-[10px] font-black shrink-0 ${
                                      isCurrentSetlistSong
                                        ? 'bg-[#B58900] text-[#002B36]'
                                        : 'bg-[#073642] text-[#B58900]'
                                    }`}
                                  >
                                    {sIdx + 1}
                                  </div>

                                  {/* Song Details */}
                                  <div className="min-w-0 flex-1">
                                    <div
                                      className={`text-xs font-semibold truncate ${
                                        isCurrentSetlistSong ? 'text-[#FDF6E3] font-bold' : 'text-[#EEE8D5]'
                                      }`}
                                    >
                                      {resolvedSong?.title ?? `Missing song: ${sRef.title}`}
                                    </div>
                                    <div className="text-[10px] text-[#93A1A1] truncate">
                                      {[resolvedSong?.artist ?? sRef.artist, resolvedSong?.key ? `Key: ${resolvedSong.key}` : null]
                                        .filter(Boolean)
                                        .join(' • ')}
                                    </div>
                                  </div>
                                </div>

                                {/* Reorder Steppers [ ▲ ] [ ▼ ] and Remove [ ✕ ] */}
                                <div
                                  className="flex items-center gap-0.5 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {onReorderSetlistSong && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={sIdx === 0}
                                        onClick={() => onReorderSetlistSong(sl.id, sIdx, true)}
                                        className="p-1 rounded text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#073642] disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                                        title="Move Song Up"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={sIdx === slSongs.length - 1}
                                        onClick={() => onReorderSetlistSong(sl.id, sIdx, false)}
                                        className="p-1 rounded text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#073642] disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                                        title="Move Song Down"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  )}

                                  {onRemoveSetlistSong && (
                                    <button
                                      type="button"
                                      onClick={() => onRemoveSetlistSong(sl.id, sIdx)}
                                      className="p-1 rounded text-[#93A1A1] hover:text-[#DC6E67] hover:bg-[#DC6E67]/15 transition-colors cursor-pointer ml-0.5"
                                      title="Remove from setlist"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                    </div>
                  )
                })
              )}
            </div>
          ) : filteredSongs.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-[#93A1A1]">
              No songs matched &quot;{searchQuery}&quot;
            </div>
          ) : (
            filteredSongs.map((item) => {
              const originalIndex = songs.indexOf(item)
              const isActive = originalIndex === activeSongIndex
              const isDeleting = confirmDeleteIndex === originalIndex

              return (
                <div
                  key={item.id || originalIndex}
                  onClick={() => {
                    onSelectSongIndex(originalIndex)
                    onClose()
                  }}
                  className={`relative p-3 rounded-xl border flex items-center justify-between gap-2.5 transition-all cursor-pointer select-none group ${
                    isActive
                      ? 'border-[#B58900] bg-[#002B36] text-[#FDF6E3] ring-1 ring-[#B58900] shadow-md shadow-[#B58900]/10'
                      : 'border-[#1A4A55] bg-[#002B36]/40 text-[#EEE8D5] hover:border-[#2AA198] hover:bg-[#002B36]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {/* Index or Playing Pulse Icon */}
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono text-xs font-bold shrink-0 ${
                        isActive
                          ? 'bg-[#B58900] text-[#002B36]'
                          : 'bg-[#073642] text-[#93A1A1] group-hover:text-[#2AA198]'
                      }`}
                    >
                      {isActive ? (
                        <Play className="w-3.5 h-3.5 fill-current animate-pulse" />
                      ) : (
                        String(originalIndex + 1).padStart(2, '0')
                      )}
                    </div>

                    {/* Song Info */}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs truncate text-[#FDF6E3] leading-tight">
                        {item.title || 'Untitled Song'}
                      </div>
                      <div className="text-[11px] text-[#2AA198] truncate leading-tight mt-0.5 font-medium">
                        {item.artist || 'Unknown Artist'}
                      </div>
                    </div>
                  </div>

                  {/* Badges Cluster */}
                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                    {item.key && (
                      <span className="px-1.5 py-0.5 rounded bg-[#073642] border border-[#1A4A55] text-[#B58900] font-bold flex items-center gap-1">
                        <Music className="w-2.5 h-2.5" />
                        <span>{item.key}</span>
                      </span>
                    )}
                    {item.bpm && (
                      <span className="hidden sm:flex px-1.5 py-0.5 rounded bg-[#073642] border border-[#1A4A55] text-[#CB4B16] items-center gap-1">
                        <Activity className="w-2.5 h-2.5" />
                        <span>{item.bpm}</span>
                      </span>
                    )}
                    {isActive && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#859900]" />
                    )}

                    {/* Inline Trash / Delete Button */}
                    <button
                      type="button"
                      onClick={(e) => handleDeleteClick(e, originalIndex)}
                      className="p-1 rounded-lg text-[#93A1A1] hover:text-[#DC6E67] hover:bg-[#DC6E67]/15 transition-colors cursor-pointer ml-0.5"
                      title="Delete song from library"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Inline Delete Confirmation Popover */}
                  {isDeleting && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-0 bg-[#073642] border border-[#DC6E67] rounded-xl px-3 py-2 flex items-center justify-between z-10 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center gap-1.5 text-xs text-[#DC6E67] font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Delete song?</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-bold font-mono">
                        <button
                          type="button"
                          onClick={(e) => handleConfirmDelete(e, originalIndex)}
                          className="px-2.5 py-1 rounded-lg bg-[#DC6E67] text-white hover:bg-[#DC6E67]/90 transition-colors cursor-pointer shadow-sm"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelDelete}
                          className="px-2 py-1 rounded-lg bg-[#002B36] text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Drawer Bottom Action Bar: Contextual (+ New Song vs + New Setlist) */}
        <div className="p-3 bg-[#002B36] border-t border-[#1A4A55] flex flex-col gap-2">
          {drawerTab === 'songbook' ? (
            <button
              type="button"
              onClick={() => {
                onNewSong()
                onClose()
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-[#2AA198] text-[#002B36] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#35B8AD] transition-all cursor-pointer shadow-md active:scale-95 select-none"
              title="Create a new blank song template in Desktop Editor"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>New Song</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (onNewSetlist) {
                  onNewSetlist()
                }
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-[#B58900] text-[#002B36] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#B58900]/90 transition-all cursor-pointer shadow-md active:scale-95 select-none"
              title="Create a new empty setlist"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>New Setlist</span>
            </button>
          )}

          <div className="flex items-center justify-between text-[10px] font-mono text-[#93A1A1] px-1">
            {drawerTab === 'songbook' ? (
              <>
                <span>Active: {songs[activeSongIndex]?.title || 'None'}</span>
                <span className="text-[#2AA198]">{songs.length} total</span>
              </>
            ) : (
              <>
                <span>Active Setlist: {setlists.find((s) => s.id === activeSetlistId)?.name || 'None'}</span>
                <span className="text-[#B58900]">{setlists.length} setlists</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
