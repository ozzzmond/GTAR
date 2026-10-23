/**
 * #85 slice 3: Shared Setlists publication and catalog wiring moved verbatim from App.tsx.
 * Owns the confirmed/fresh catalog badge state, the publishing-setlist id, the render-synced
 * publication state ref, and the CatalogImportContext value (the caller supplies `open`).
 */
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ActiveSongState } from '../types/gtar'
import type { WebSetlist } from '../App'
import type { ImportBlocker, ImportHost } from './sharedSetlistImport'
import type { SyncLibrary } from './syncMerge'
import { inspectRecovery, hasActionableRecovery, libraryRevision } from './syncJournal'
import { partitionSongs } from './setlistSongs'
import { getConfirmedActiveCatalogIds, sharedCatalogService } from './sharedCatalogService'
import { getStoredSessionStatus } from './googleAuth'

type Setter<T> = Dispatch<SetStateAction<T>>
export interface SetlistPublicationInput {
  getConflictDraft: () => SyncLibrary
  crossTabConflict: { remoteRaw: string | null; detectedAt: number } | null
  editorRecoveryDraftRef: MutableRefObject<(() => ActiveSongState | null) | null>
  persistedBaselineRef: MutableRefObject<string | null>
  setSongs: Setter<ActiveSongState[]>
  setDeletedSongs: Setter<ActiveSongState[]>
  setSetlists: Setter<WebSetlist[]>
}
type CatalogImportValue = ImportHost

export function useSetlistPublication({
  getConflictDraft, crossTabConflict, editorRecoveryDraftRef, persistedBaselineRef, setSongs, setDeletedSongs, setSetlists,
}: SetlistPublicationInput) {
  const [confirmedCatalogIds, setConfirmedCatalogIds] = useState<Set<string>>(new Set())
  const [freshCatalogIds, setFreshCatalogIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const ids = await getConfirmedActiveCatalogIds()
        if (mounted) {
          setConfirmedCatalogIds(ids)
          setFreshCatalogIds(sharedCatalogService.getFreshConfirmedCatalogIds())
        }
      } catch {
        // non-blocking
      }
    }
    const reconcile = async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return
        const auth = getStoredSessionStatus()
        if (!auth.session || auth.isExpired) return
        const result = await sharedCatalogService.reconcilePublicationsBatch()
        if (mounted) {
          setConfirmedCatalogIds(result.confirmedIds)
          setFreshCatalogIds(result.freshIds)
        }
      } catch {
        // non-blocking
      }
    }
    refresh().then(() => reconcile())
    const onCatalogUpdate = () => refresh()
    window.addEventListener('gtar-shared-catalog-cache-updated', onCatalogUpdate)
    window.addEventListener('storage', onCatalogUpdate)
    return () => {
      mounted = false
      window.removeEventListener('gtar-shared-catalog-cache-updated', onCatalogUpdate)
      window.removeEventListener('storage', onCatalogUpdate)
    }
  }, [])

  const [publishingSetlistId, setPublishingSetlistId] = useState<string | number | null>(null)
  const publicationStateRef = useRef({ getLocal: getConflictDraft, blocked: () => !!crossTabConflict || !!editorRecoveryDraftRef.current?.() })
  // Pre-existing render-time ref sync (unchanged by #85); readers need the current render synchronously.
  // eslint-disable-next-line react-hooks/refs
  publicationStateRef.current = { getLocal: getConflictDraft, blocked: () => !!crossTabConflict || !!editorRecoveryDraftRef.current?.() }

  // Everything except `open`, which needs App navigation; App spreads this and adds `open`.
  const catalogImportHost: Omit<CatalogImportValue, 'open'> = {
    getLocal: () => publicationStateRef.current.getLocal(),
    blocked: () => publicationStateRef.current.blocked() || hasActionableRecovery(),
    blockers: () => {
      const reasons: ImportBlocker[] = []
      if (crossTabConflict) reasons.push('cross-tab-conflict')
      if (editorRecoveryDraftRef.current?.()) reasons.push('editor-draft')
      const recovery = inspectRecovery()
      if (recovery.invalid) reasons.push('invalid-recovery')
      if (recovery.sources.some(source => source.status === 'actionable')) reasons.push('actionable-recovery')
      return reasons
    },
    applied: library => {
      persistedBaselineRef.current = libraryRevision()
      const partition = partitionSongs(library.songs)
      setSongs(partition.active); setDeletedSongs(partition.deleted); setSetlists(library.setlists)
    },
  }

  return { confirmedCatalogIds, freshCatalogIds, publishingSetlistId, setPublishingSetlistId, publicationStateRef, catalogImportHost }
}
