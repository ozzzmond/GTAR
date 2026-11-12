import type { TagColors } from './songTags'
import { appLogger } from './logger'
/**
 * #85 slice 1: library persistence glue moved verbatim from App.tsx. Owns the persisted baseline
 * (revision token), the cross-tab conflict state and guard (#177 adoption tracking, #300 IndexedDB revision
 * loading), the unload guard and the canonical persist effect. Behavior is unchanged.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ActiveSongState, SetlistFolder } from '../types/gtar'
import type { WebSetlist } from '../App'
import {
  StaleWriteConflictError, decodeLibraryRevision, getPersistedLibraryRaw, isQuotaError, isStaleWriteConflictError, libraryMatchesRevision, libraryRevision, loadLibraryRevision, loadedLibraryRevision,
  persistLibrary, saveCrossTabConflictSnapshot, setupCrossTabLibraryConflictGuard,
} from './syncJournal'
import { LIBRARY_WRITE_FAILED_EVENT, isMissingLibraryBodyError, libraryStorePending } from './libraryStore'
import { partitionSongs } from './setlistSongs'

export interface LibraryPersistenceInput {
  songs: ActiveSongState[]
  deletedSongs: ActiveSongState[]
  setlists: WebSetlist[]
  tagColors?: TagColors
  setTagColors?: Dispatch<SetStateAction<TagColors | undefined>>
  folders?: SetlistFolder[]
  setFolders?: Dispatch<SetStateAction<SetlistFolder[]>>
  setSongs: Dispatch<SetStateAction<ActiveSongState[]>>
  setDeletedSongs: Dispatch<SetStateAction<ActiveSongState[]>>
  setSetlists: Dispatch<SetStateAction<WebSetlist[]>>
  setToastMessage: Dispatch<SetStateAction<string | null>>
  editorRecoveryDraftRef: MutableRefObject<(() => ActiveSongState | null) | null>
}

export function useLibraryPersistence({
  songs, deletedSongs, setlists, folders, tagColors, setTagColors, setFolders, setSongs, setDeletedSongs, setSetlists, setToastMessage, editorRecoveryDraftRef,
}: LibraryPersistenceInput) {
  // #453 D1: the baseline is the revision of the library this tab actually read. It is behind the
  // stored head when another tab committed between opening storage and this mount.
  const persistedBaselineRef = useRef<string | null>(loadedLibraryRevision())
  const startupHeadCheckedRef = useRef(false)
  const [crossTabConflict, setCrossTabConflict] = useState<{ remoteRaw: string | null; detectedAt: number } | null>(null)

  const [conflictRecoverySaved, setConflictRecoverySaved] = useState(false)
  const getConflictDraft = useCallback(() => {
    const librarySongs = [...songs, ...deletedSongs]
    const editorDraft = editorRecoveryDraftRef.current?.()
    if (!editorDraft) return { songs: librarySongs, setlists, folders, tagColors }
    const found = librarySongs.some(song => String(song.id) === String(editorDraft.id))
    return {
      songs: found ? librarySongs.map(song => String(song.id) === String(editorDraft.id) ? editorDraft : song) : [...librarySongs, editorDraft],
      setlists, folders, tagColors,
    }
  }, [songs, deletedSongs, setlists, folders, tagColors, editorRecoveryDraftRef])

  const lastStorageWarningTimeRef = useRef<number>(0)

  const handleStorageWriteFailure = useCallback((err: unknown) => {
    appLogger.warn('StorageSaveFailure', String((err as Error)?.name ?? 'Error'))
    if (isStaleWriteConflictError(err)) {
      console.warn('[Storage] Stale write rejected: library updated externally.', err)
      const currentRaw = getPersistedLibraryRaw()
      setCrossTabConflict({ remoteRaw: currentRaw, detectedAt: Date.now() })
      try {
        saveCrossTabConflictSnapshot(getConflictDraft())
        setConflictRecoverySaved(true)
      } catch { setConflictRecoverySaved(false) }
      setToastMessage('Conflict detected: Another tab modified the library. Local edits remain in memory; keep this tab open and export your draft.')
      return
    }

    const isQuota = isQuotaError(err)
    const warnMsg = isQuota
      ? 'Storage quota reached: changes may not be saved to device storage.'
      : 'Storage write failed: changes may not be saved to device storage.'
    console.warn(`[Storage] ${warnMsg} State preserved in memory.`, err)

    const now = Date.now()
    if (now - lastStorageWarningTimeRef.current > 10000) {
      lastStorageWarningTimeRef.current = now
      setToastMessage(warnMsg)
      setTimeout(() => setToastMessage(null), 5000)
    }
  }, [getConflictDraft, setToastMessage])


  // #177: the guard compares against the library this tab last committed or adopted. Closure state
  // lags one render behind an adoption, so a burst of external saves looked like local edits.
  // State arrays adopted verbatim from another tab, keyed by identity. Local edits always create new
  // arrays, so state made only of adopted arrays has nothing local to save or protect, even when a
  // concurrent render commits an older adoption after the baseline has moved to a newer one.
  const adoptedStateRef = useRef(new WeakMap<object, string>())
  const isAdoptedState = (state: { songs: object; deletedSongs: object; setlists: object; folders?: object; tagColors?: object }) =>
    [state.songs, state.deletedSongs, state.setlists, ...(state.folders ? [state.folders] : []), ...(state.tagColors ? [state.tagColors] : [])].every(part => adoptedStateRef.current.has(part))
  const localLibraryRef = useRef<{ songs: ActiveSongState[]; deletedSongs: ActiveSongState[]; setlists: WebSetlist[]; folders?: SetlistFolder[]; tagColors?: TagColors } | null>(null)
  useEffect(() => { localLibraryRef.current = { songs, deletedSongs, setlists, folders, tagColors } }, [songs, deletedSongs, setlists, folders, tagColors])

  // Cross-tab storage conflict protection for the persisted library
  useEffect(() => {
    const onExternal = (externalRaw: string | null) => {
      const local = localLibraryRef.current ?? { songs, deletedSongs, setlists, folders, tagColors }
      const currentLocal = { songs: [...local.songs, ...local.deletedSongs], setlists: local.setlists, folders: local.folders, tagColors: local.tagColors }
      const baselineRaw = persistedBaselineRef.current
      // Match JSON storage semantics, including omitted optional editor fields.
      let hasLocalChanges = !isAdoptedState(local)
      // Compares the persisted JSON representation of the library at the baseline revision.
      if (hasLocalChanges && baselineRaw && libraryMatchesRevision(currentLocal, baselineRaw)) hasLocalChanges = false

      if (editorRecoveryDraftRef.current?.()) hasLocalChanges = true

      if (hasLocalChanges) {
        console.warn('[Storage] Cross-tab conflict: external write while local has unsaved edits.')
        setCrossTabConflict({ remoteRaw: externalRaw, detectedAt: Date.now() })
        try {
          saveCrossTabConflictSnapshot(getConflictDraft())
          setConflictRecoverySaved(true)
        } catch { setConflictRecoverySaved(false) }
        setToastMessage('Songbook library updated in another tab while you have unsaved edits. Draft remains in memory; keep this tab open and export it.')
      } else {
        console.info('[Storage] External library update adopted into clean tab.')
        if (externalRaw) {
          const adopt = () => {
            const parsed = decodeLibraryRevision(externalRaw) as { songs: ActiveSongState[]; setlists: WebSetlist[]; folders?: SetlistFolder[]; tagColors?: TagColors }
            persistedBaselineRef.current = externalRaw
            const partitioned = partitionSongs(parsed.songs)
            const adoptedFolders = parsed.folders ?? []
            const adoptedColors = parsed.tagColors
            for (const adopted of [partitioned.active, partitioned.deleted, parsed.setlists, adoptedFolders, ...(adoptedColors ? [adoptedColors] : [])]) adoptedStateRef.current.set(adopted, externalRaw)
            localLibraryRef.current = { songs: partitioned.active, deletedSongs: partitioned.deleted, setlists: parsed.setlists, folders: adoptedFolders, tagColors: adoptedColors }
            setSongs(partitioned.active)
            setDeletedSongs(partitioned.deleted)
            setSetlists(parsed.setlists)
            setFolders?.(adoptedFolders)
            setTagColors?.(adoptedColors)
            setToastMessage('Songbook library updated from another tab.')
            setTimeout(() => setToastMessage(null), 4000)
          }
          try {
            adopt()
          } catch (error) {
            // #300: another tab's committed IndexedDB save is loaded before adopting.
            if (isMissingLibraryBodyError(error)) {
              loadLibraryRevision(externalRaw)
                .then(() => { if (libraryRevision() === externalRaw) adopt() })
                .catch(() => {
                  setCrossTabConflict({ remoteRaw: externalRaw, detectedAt: Date.now() })
                  setToastMessage('Another tab saved charts this tab could not load. Your library was not replaced; reload to continue.')
                })
            }
            // Malformed external data safely ignored
          }
        }
      }
    }
    const cleanup = setupCrossTabLibraryConflictGuard(onExternal)
    // #453 D1: a save committed by another tab before this guard was listening raised no event
    // here. Handle it once, like any external update (adopt when clean, conflict otherwise).
    if (!startupHeadCheckedRef.current) {
      startupHeadCheckedRef.current = true
      const head = getPersistedLibraryRaw()
      if (head !== null && head !== persistedBaselineRef.current) onExternal(head)
    }
    return cleanup
  }, [songs, deletedSongs, setlists, folders, tagColors, setTagColors, setFolders, getConflictDraft, editorRecoveryDraftRef, setSongs, setDeletedSongs, setSetlists, setToastMessage])

  // #300: a save is committed to IndexedDB after it returns; a failed commit (another tab's newer
  // save, quota) is reported here and the edits stay in memory.
  useEffect(() => {
    const failed = (event: Event) => {
      const error = (event as CustomEvent).detail
      if (error && typeof error === 'object' && (error as { name?: string }).name === 'LibraryStaleWriteError') {
        handleStorageWriteFailure(new StaleWriteConflictError((error as Error).message, (error as { currentRaw?: string | null }).currentRaw ?? null, { songs: [...songs, ...deletedSongs], setlists, folders, tagColors }))
      } else handleStorageWriteFailure(error)
    }
    window.addEventListener(LIBRARY_WRITE_FAILED_EVENT, failed)
    return () => window.removeEventListener(LIBRARY_WRITE_FAILED_EVENT, failed)
  }, [songs, deletedSongs, setlists, folders, tagColors, setTagColors, setFolders, handleStorageWriteFailure])

  // State-only mutations can outlive a failed save outside the editor.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (libraryStorePending()) { event.preventDefault(); event.returnValue = ''; return }
      if (isAdoptedState({ songs, deletedSongs, setlists, folders, tagColors })) return
      // An unreadable baseline cannot establish durability.
      if (libraryMatchesRevision({ songs: [...songs, ...deletedSongs], setlists, folders, tagColors }, persistedBaselineRef.current)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [songs, deletedSongs, setlists, folders, tagColors])

  // Persist canonical library on any songs, trash, or setlists change (with quota relief)
  useEffect(() => {
    if (crossTabConflict) {
      return
    }
    if (isAdoptedState({ songs, deletedSongs, setlists, folders, tagColors })) return
    const candidate = { songs: [...songs, ...deletedSongs], setlists, folders, tagColors }
    if (libraryMatchesRevision(candidate, persistedBaselineRef.current)) return
    try {
      persistLibrary(candidate, localStorage, { expectedRaw: persistedBaselineRef.current })
      persistedBaselineRef.current = libraryRevision()
    } catch (err) {
      setTimeout(() => {
        handleStorageWriteFailure(err)
      }, 0)
    }
  }, [songs, deletedSongs, setlists, folders, tagColors, setTagColors, setFolders, handleStorageWriteFailure, crossTabConflict])

  return {
    persistedBaselineRef, crossTabConflict, setCrossTabConflict, conflictRecoverySaved, setConflictRecoverySaved,
    getConflictDraft, handleStorageWriteFailure,
  }
}
