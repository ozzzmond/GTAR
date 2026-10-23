/**
 * #85 slice 2: import, merge and restore handlers moved verbatim from App.tsx. Behavior is unchanged.
 * `importStateRef` keeps the complete library for consecutive transport messages that arrive before
 * React renders a committed merge.
 */
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ActiveSongState } from '../types/gtar'
import type { WebSetlist } from '../App'
import type { SharedSetlistPayload } from './sharedSetlist'
import { libraryRevision, persistLibrary, preserveStoredLibrary } from './syncJournal'
import { normalizeBackupSong, parseBackupJson } from './jsonBackup'
import { mergeBackupLibrary, partitionSongs } from './setlistSongs'
import { mergeImportedSetlists } from './importIdentity'
import { generateUUID } from './uuid'
import { detectSongKey } from './songParser'

type Setter<T> = Dispatch<SetStateAction<T>>
export interface LibraryImportsInput {
  songs: ActiveSongState[]
  deletedSongs: ActiveSongState[]
  setlists: WebSetlist[]
  setSongs: Setter<ActiveSongState[]>
  setDeletedSongs: Setter<ActiveSongState[]>
  setSetlists: Setter<WebSetlist[]>
  persistedBaselineRef: MutableRefObject<string | null>
  setCrossTabConflict: Setter<{ remoteRaw: string | null; detectedAt: number } | null>
  setToastMessage: Setter<string | null>
  setActiveSongIndex: Setter<number>
  setActiveSetlistId: Setter<string | number | null>
  setActiveSetlistSongIndex: Setter<number>
  setQueueMode: Setter<'library' | 'setlist'>
  setIncomingSharedSetlist: Setter<SharedSetlistPayload | null>
}

export function useLibraryImports({
  songs, deletedSongs, setlists, setSongs, setDeletedSongs, setSetlists, persistedBaselineRef, setCrossTabConflict,
  setToastMessage, setActiveSongIndex, setActiveSetlistId, setActiveSetlistSongIndex, setQueueMode, setIncomingSharedSetlist,
}: LibraryImportsInput) {
  // Consecutive transport messages can arrive before React renders the first
  // committed merge. Keep that complete state available to the next reception.
  const importStateRef = useRef({ songs: [...songs, ...deletedSongs], setlists })
  // Pre-existing render-time ref sync (unchanged by #85): consecutive transport messages read it before React renders.
  // eslint-disable-next-line react-hooks/refs
  importStateRef.current = { songs: [...songs, ...deletedSongs], setlists }

  const handleSmartMerge = useCallback((importedSongs: Array<Partial<ActiveSongState>>, importedSetlists: WebSetlist[]) => {
    const existingSongs = importStateRef.current.songs
    const parsed = parseBackupJson(JSON.stringify({ songs: importedSongs, setlists: importedSetlists }), { mode: 'merge', existingSongs })
    if (!parsed.isValid) throw new Error(parsed.error)
    const merged = mergeBackupLibrary(existingSongs, parsed.songs, parsed.setlists)
    const partition = partitionSongs(merged.songs)
    const nextSetlists = mergeImportedSetlists(importStateRef.current.setlists, merged.setlists)
    // A merge based on stale React state must never replace a newer tab's data.
    persistLibrary({ songs: merged.songs, setlists: nextSetlists }, localStorage, { expectedRaw: persistedBaselineRef.current })
    persistedBaselineRef.current = libraryRevision()
    importStateRef.current = { songs: merged.songs, setlists: nextSetlists }
    setCrossTabConflict(null)
    setSongs(partition.active)
    setDeletedSongs(partition.deleted)
    setSetlists(nextSetlists)
  }, [persistedBaselineRef, setCrossTabConflict, setSongs, setDeletedSongs, setSetlists])

  const handleImportSong = (imported: Partial<ActiveSongState>) => {
    const song = normalizeBackupSong({ ...imported, id: generateUUID(), title: imported.title || 'Imported Song' })
    if (song.isDeleted) setDeletedSongs(prev => [song, ...prev])
    else setSongs(prev => [song, ...prev])
    setActiveSongIndex(0)
    setActiveSetlistId(null)
  }

  const handleImportAllSongs = (importedSongs: Array<Partial<ActiveSongState>>) => {
    const normalized = importedSongs.map(song => normalizeBackupSong({ ...song, id: generateUUID(), title: song.title || 'Imported Song' }))
    const partition = partitionSongs(normalized)
    setSongs(prev => [...prev, ...partition.active])
    setDeletedSongs(prev => [...prev, ...partition.deleted])
  }

  const handleFullRestore = (importedSongs: Array<Partial<ActiveSongState>>, importedSetlists: WebSetlist[]) => {
    const parsed = parseBackupJson(JSON.stringify({ songs: importedSongs, setlists: importedSetlists }))
    if (!parsed.isValid) throw new Error(parsed.error)
    const partition = partitionSongs(parsed.songs)
    // Full restore is explicitly confirmed by the restore dialog; preserve the
    // current stored revision too, which may differ from the dialog's local state.
    const expectedRaw = libraryRevision()
    preserveStoredLibrary(expectedRaw)
    persistLibrary({ songs: parsed.songs, setlists: parsed.setlists }, localStorage, { expectedRaw })
    persistedBaselineRef.current = libraryRevision()
    setCrossTabConflict(null)
    setSongs(partition.active)
    setDeletedSongs(partition.deleted)
    setSetlists(parsed.setlists)
    setActiveSetlistId(null)
    setActiveSongIndex(0)
    setActiveSetlistSongIndex(0)
    setQueueMode('library')
  }

  const handleImportSingleSetlist = (setlist: WebSetlist, newSongs: ActiveSongState[]) => {
    handleSmartMerge(newSongs, [setlist])
    setToastMessage(`Imported setlist "${setlist.name}" (${setlist.songs.length} songs)`)
    setTimeout(() => setToastMessage(null), 4000)
  }

  const handleImportSharedSetlist = (shared: SharedSetlistPayload) => {
    const newSongStates: ActiveSongState[] = shared.songs.map((s) => ({
      id: generateUUID(),
      title: s.title,
      artist: s.artist || '',
      key: s.key || detectSongKey(s.rawContent || ''),
      capo: s.capo || 'No Capo',
      bpm: s.bpm || '120',
      time: s.time,
      format: 'CHORD_PRO',
      transposeOffset: 0,
      rawContent: s.rawContent,
    }))

    const newSetlist: WebSetlist = {
      id: generateUUID(),
      name: shared.name,
      createdAt: Date.now(),
      songs: newSongStates.map((ns) => ({
        id: ns.id,
        title: ns.title,
        artist: ns.artist,
      })),
    }

    handleImportSingleSetlist(newSetlist, newSongStates)
    setIncomingSharedSetlist(null)
  }

  return {
    importStateRef, handleSmartMerge, handleImportSong, handleImportAllSongs, handleFullRestore,
    handleImportSingleSetlist, handleImportSharedSetlist,
  }
}
