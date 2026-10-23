/**
 * #85 slice 1: library persistence glue moved verbatim from App.tsx. Owns the persisted baseline
 * (revision token), the cross-tab conflict state and guard (#177 adoption tracking, #171 B1 body
 * loading), the unload guard and the canonical persist effect. Behavior is unchanged.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ActiveSongState } from '../types/gtar'
import type { WebSetlist } from '../App'
import {
  decodeLibraryRevision, getPersistedLibraryRaw, isQuotaError, isStaleWriteConflictError, libraryRevision, persistLibrary,
  same, saveCrossTabConflictSnapshot, setupCrossTabLibraryConflictGuard,
} from './syncJournal'
import { isMissingLibraryBodyError, loadLibraryIndexBodies } from './libraryIndex'
import { partitionSongs } from './setlistSongs'

export interface LibraryPersistenceInput {
  songs: ActiveSongState[]
  deletedSongs: ActiveSongState[]
  setlists: WebSetlist[]
  setSongs: Dispatch<SetStateAction<ActiveSongState[]>>
  setDeletedSongs: Dispatch<SetStateAction<ActiveSongState[]>>
  setSetlists: Dispatch<SetStateAction<WebSetlist[]>>
  setToastMessage: Dispatch<SetStateAction<string | null>>
  editorRecoveryDraftRef: MutableRefObject<(() => ActiveSongState | null) | null>
}

export function useLibraryPersistence({
  songs, deletedSongs, setlists, setSongs, setDeletedSongs, setSetlists, setToastMessage, editorRecoveryDraftRef,
}: LibraryPersistenceInput) {
  const persistedBaselineRef = useRef<string | null>(getPersistedLibraryRaw())
  const [crossTabConflict, setCrossTabConflict] = useState<{ remoteRaw: string | null; detectedAt: number } | null>(null)

  const [conflictRecoverySaved, setConflictRecoverySaved] = useState(false)
  const getConflictDraft = useCallback(() => {
    const librarySongs = [...songs, ...deletedSongs]
    const editorDraft = editorRecoveryDraftRef.current?.()
    if (!editorDraft) return { songs: librarySongs, setlists }
    const found = librarySongs.some(song => String(song.id) === String(editorDraft.id))
    return {
      songs: found ? librarySongs.map(song => String(song.id) === String(editorDraft.id) ? editorDraft : song) : [...librarySongs, editorDraft],
      setlists,
    }
  }, [songs, deletedSongs, setlists, editorRecoveryDraftRef])

  const lastStorageWarningTimeRef = useRef<number>(0)

  const handleStorageWriteFailure = useCallback((err: unknown) => {
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
  const isAdoptedState = (state: { songs: object; deletedSongs: object; setlists: object }) =>
    [state.songs, state.deletedSongs, state.setlists].every(part => adoptedStateRef.current.has(part))
  const localLibraryRef = useRef<{ songs: ActiveSongState[]; deletedSongs: ActiveSongState[]; setlists: WebSetlist[] } | null>(null)
  useEffect(() => { localLibraryRef.current = { songs, deletedSongs, setlists } }, [songs, deletedSongs, setlists])

  // Cross-tab storage conflict protection for the persisted library
  useEffect(() => {
    const cleanup = setupCrossTabLibraryConflictGuard((externalRaw) => {
      const local = localLibraryRef.current ?? { songs, deletedSongs, setlists }
      const currentLocal = { songs: [...local.songs, ...local.deletedSongs], setlists: local.setlists }
      const baselineRaw = persistedBaselineRef.current
      // Match JSON storage semantics, including omitted optional editor fields.
      let hasLocalChanges = !isAdoptedState(local)
      if (hasLocalChanges && baselineRaw) {
        try {
          const parsedBase = decodeLibraryRevision(baselineRaw)
          if (same(parsedBase, JSON.parse(JSON.stringify(currentLocal)))) {
            hasLocalChanges = false
          }
        } catch {
          hasLocalChanges = true
        }
      }

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
            const parsed = decodeLibraryRevision(externalRaw) as { songs: ActiveSongState[]; setlists: WebSetlist[] }
            persistedBaselineRef.current = externalRaw
            const partitioned = partitionSongs(parsed.songs)
            for (const adopted of [partitioned.active, partitioned.deleted, parsed.setlists]) adoptedStateRef.current.set(adopted, externalRaw)
            localLibraryRef.current = { songs: partitioned.active, deletedSongs: partitioned.deleted, setlists: parsed.setlists }
            setSongs(partitioned.active)
            setDeletedSongs(partitioned.deleted)
            setSetlists(parsed.setlists)
            setToastMessage('Songbook library updated from another tab.')
            setTimeout(() => setToastMessage(null), 4000)
          }
          try {
            adopt()
          } catch (error) {
            // #171 B1: another tab saved charts this tab has not loaded; fetch them before adopting.
            if (isMissingLibraryBodyError(error)) {
              loadLibraryIndexBodies(externalRaw)
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
    })
    return cleanup
  }, [songs, deletedSongs, setlists, getConflictDraft, editorRecoveryDraftRef, setSongs, setDeletedSongs, setSetlists, setToastMessage])

  // State-only mutations can outlive a failed save outside the editor.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (isAdoptedState({ songs, deletedSongs, setlists })) return
      try {
        const raw = persistedBaselineRef.current
        if (raw !== null && same(decodeLibraryRevision(raw), JSON.parse(JSON.stringify({ songs: [...songs, ...deletedSongs], setlists })))) return
      } catch { /* An unreadable baseline cannot establish durability. */ }
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [songs, deletedSongs, setlists])

  // Persist canonical library on any songs, trash, or setlists change (with quota relief)
  useEffect(() => {
    if (crossTabConflict) {
      return
    }
    if (isAdoptedState({ songs, deletedSongs, setlists })) return
    const candidate = { songs: [...songs, ...deletedSongs], setlists }
    const baselineRaw = persistedBaselineRef.current
    if (baselineRaw) {
      try {
        const parsedBase = decodeLibraryRevision(baselineRaw)
        if (same(parsedBase, JSON.parse(JSON.stringify(candidate)))) {
          return
        }
      } catch { /* proceed to persist */ }
    }
    try {
      persistLibrary(candidate, localStorage, { expectedRaw: persistedBaselineRef.current })
      persistedBaselineRef.current = libraryRevision()
    } catch (err) {
      setTimeout(() => {
        handleStorageWriteFailure(err)
      }, 0)
    }
  }, [songs, deletedSongs, setlists, handleStorageWriteFailure, crossTabConflict])

  return {
    persistedBaselineRef, crossTabConflict, setCrossTabConflict, conflictRecoverySaved, setConflictRecoverySaved,
    getConflictDraft, handleStorageWriteFailure,
  }
}
