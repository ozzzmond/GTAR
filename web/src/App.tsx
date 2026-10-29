import { RecoveryReviewDialog } from './components/RecoveryReviewDialog'
import { CatalogImportContext } from './utils/catalogImportContext'
import type { CatalogSetlistLineage } from './utils/catalogSetlistLineage'
import { PublishSetlistModal } from './components/PublishSetlistModal'
import { isPresentationLocation } from './utils/presentationRoute'
import { transposeContext } from './utils/songKeySemantics'
import { parseBandSetlist } from './utils/bandSetlistImport'
import {
  libraryRevision,
  persistLibrary,
  planDanglingReferenceRepair,
  applyDanglingReferenceRepair,
  type DanglingReferenceRepair,
  readPersistedLibrary,
  saveCrossTabConflictSnapshot,
  preserveStoredLibrary,
  same,
  performStorageHousekeeping,
  requestDurableStorage,
  prepareLibraryStorage,
  autoEnableLibraryIndex,
  retireLibraryV1,
  prepareLibraryB2,
  recoveryExportData,
  isLibraryB2Active,
  isLibraryClosedForSignIn,
  isUnboundDeviceLibraryReadOnly,
  enableLibraryB2,
} from './utils/syncJournal'
import { confirmLibraryOwner, storedSession } from './utils/libraryOwner'
import { B2_FLAG_KEY, LibraryPartitionError, clearB2Hold, flushB2, holdMessage, readB2Hold, type B2Hold } from './utils/libraryB2'
import { LIBRARY_B1_KEY } from './utils/libraryIndex'
import { prepareRecoveryArchives, recoveryArchiveBackend, recoveryArchivesInIndexedDb } from './utils/recoveryArchiveStore'
import { appLogger } from './utils/logger'
import { useLibraryPersistence } from './utils/useLibraryPersistence'
import { useLibraryImports } from './utils/useLibraryImports'
import { useSetlistPublication } from './utils/useSetlistPublication'
import { useAppModals } from './utils/useAppModals'
import { deduplicateLibrary } from './utils/syncMerge'
import { generateUUID } from './utils/uuid'
import { normalizeSongbookIds } from './utils/songbookFoundation'
import { SETTINGS_KEYS, SETTINGS_CHANGED, readBackupSettings } from './utils/backupSettings'
import { createSingleSetlistPayload } from './utils/jsonBackup'
import { setSongMembership, resolveSetlistSong, partitionSongs, transitionSongLibrary, type SongLifecycleOperation } from './utils/setlistSongs'
import {
  readStageSession,
  saveStageSession,
  clearStageSession,
  validateAndResolveStageSession,
} from './utils/stageSession'
import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react'
import { DEFAULT_SAMPLE_SETLISTS, DEFAULT_SETLIST, EMPTY_LIBRARY_SONG, cloudSyncedSetlistIds, removeUnchangedSamples } from './data/defaultLibrary'
import { checkRecovery } from './utils/recoveryNotice'
import { Header } from './components/Header'
import { DesktopEditor } from './components/DesktopEditor'
import { StageView } from './components/StageView'
import { StagePresentationView } from './components/StagePresentationView'
import { SongbookHomeView } from './components/SongbookHomeView'
import { TrashView } from './components/TrashView'
import { JsonBridgeModal } from './components/JsonBridgeModal'
import { KeyPickerModal } from './components/KeyPickerModal'
import { SetlistDrawer } from './components/SetlistDrawer'
import { getStoredSessionStatus } from './utils/googleAuth'
import { useOptionalGoogleAuth } from './utils/authContext'
import { EdgeSwipePanelCoordinator } from './components/EdgeSwipePanelCoordinator'
import { EDGE_SWIPE_STORAGE_KEY } from './utils/edgeSwipe'
import { ShareSetlistModal } from './components/ShareSetlistModal'
import { ImportSharedSetlistModal } from './components/ImportSharedSetlistModal'
import type { SharedSetlistPayload } from './utils/sharedSetlist'
import { WebsiteUrlSourceModal } from './components/WebsiteUrlSourceModal'
import { BackupRestoreDialogModal } from './components/BackupRestoreDialogModal'
import { StageSettingsModal, type SongFontStyleOption } from './components/StageSettingsModal'
import { StageErrorBoundary } from './components/StageErrorBoundary'
import {
  ThemeModal,
  type ThemeMode,
  type CustomThemeColors,
  applyThemeRuntime,
  hydrateThemeSettings,
} from './components/ThemeModal'
import { BandSyncModal } from './components/BandSyncModal'
import { TvPresentationModal } from './components/TvPresentationModal'
import { stageCast2Enabled } from './utils/stageCast2Local'
import { stageCast } from './utils/stageCast'
import { bandSync } from './utils/bandSync'
import { detectSongKey } from './utils/songParser'
import type { ActiveSongState } from './types/gtar'
import type { FetchedChordSheet } from './utils/onlineSearch'
import { exportAllDataJson, libraryFingerprint } from './utils/jsonBackup'
import { backupReminderDue, backupReminderMessage, readBackupStatus } from './utils/backupStatus'
import { isDevEnv } from './utils/env'
import { buildViewHistoryState, isGtarViewHistoryState } from './utils/viewHistory'

// The import dialog pulls in ChordSheetJS (~230 KB); load it only when first opened (#85).
const ImportDialogModal = lazy(() => import('./components/ImportDialogModal').then(m => ({ default: m.ImportDialogModal })))

export interface WebSetlist {
  catalogSource?: CatalogSetlistLineage
  id: string | number
  name: string
  createdAt?: number
  isDeleted?: boolean
  songs: Array<{ title: string; artist?: string; id?: string | number }>
}

function App() {
  const isPresentationRoute =
    typeof window !== 'undefined' && isPresentationLocation(window.location)

  if (isPresentationRoute) {
    return <StagePresentationView />
  }
  return <LibraryStartup />
}

// #167 B1c (DEV): recovery archives load from IndexedDB, and with the #171 B1 toggle on, chart bodies
// too, before anything reads the library or recovery state.
const needsArchiveStartup = () => isDevEnv && typeof indexedDB !== 'undefined' && !recoveryArchivesInIndexedDb()
function LibraryStartup() {
  const [ready, setReady] = useState(() => {
    try { return localStorage.getItem(LIBRARY_B1_KEY) !== '1' && !needsArchiveStartup() && localStorage.getItem(B2_FLAG_KEY) !== '1' } catch { return true }
  })
  useEffect(() => {
    if (ready) return
    let live = true
    const warn = (tag: string, message: string) => (error: unknown) => appLogger.warn(tag, message, error instanceof Error ? error.message : String(error))
    const startup = async () => {
      if (needsArchiveStartup()) {
        await prepareRecoveryArchives(recoveryArchiveBackend(), localStorage, (level, message) => appLogger[level]('RecoveryArchives', message))
          .catch(warn('RecoveryArchives', 'IndexedDB unavailable; archives stay in localStorage'))
      }
      // #167 (DEV): B1 on by default, then retire gtar_library_v1 once the index fully loads.
      if (isDevEnv) await autoEnableLibraryIndex().catch(warn('LibraryIndex', 'Automatic B1 enable skipped; gtar_library_v1 stays the source'))
      const prepared = await prepareLibraryStorage()
      if (isDevEnv && prepared.indexed) await retireLibraryV1().catch(warn('LibraryIndex', 'gtar_library_v1 retirement deferred'))
    }
    const timeout = new Promise(resolve => setTimeout(resolve, 15000))
    // #252: B2 opens (or migrates into) this account's partition after the legacy source is readable.
    // No timeout here: rendering before it finishes would show one storage and save into another.
    const b2 = async () => {
      if (localStorage.getItem(B2_FLAG_KEY) !== '1') return
      try {
        const prepared = await prepareLibraryB2()
        if (prepared.active) appLogger.info('LibraryB2', `B2 ready in ${prepared.ms} ms: ${prepared.songs} songs, ${prepared.setlists} setlists${prepared.migrated ? ' (moved now)' : ''}${prepared.replayed ? `, ${prepared.replayed} journalled saves replayed` : ''}`)
      } catch (error) {
        if (error instanceof LibraryPartitionError) {
          // Another account in this page: finish this partition's saves, then start clean for the new account.
          await flushB2().catch(() => undefined)
          window.location.reload()
          return new Promise<void>(() => {})
        }
        warn('LibraryB2', 'B2 storage unavailable; the earlier library stays in use')(error)
      }
    }
    Promise.race([startup(), timeout]).then(b2).finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [ready])
  if (!ready) return <p role="status" className="p-4 text-app-muted">Loading library…</p>
  return <LibraryStartupReady />
}

function LibraryStartupReady() {
  // #258 F5: with B2 on, this sign-in may not open the earlier library (another account's, or owner
  // unknown) and has no B2 partition open: show nothing of it, change nothing, offer no export of it.
  const [partitionBlocked] = useState(() => isLibraryClosedForSignIn())
  if (partitionBlocked) return <PartitionBlocked />
  return <LibraryStartupReadyInner />
}
function PartitionBlocked() {
  const hold = readB2Hold(localStorage)
  const b2On = (() => { try { return localStorage.getItem(B2_FLAG_KEY) === '1' } catch { return true } })()
  return <aside role="alert" data-testid="library-partition-blocked" className="p-4 bg-amber-100 text-black flex flex-wrap items-center justify-between gap-3">
    <span className="flex-1 min-w-0">{hold ? `${holdMessage(hold)} ` : ''}The songbook on this device belongs to another account, or its owner is unknown, so it is not shown and nothing in it was changed. Sign in with the account that owns it{hold ? ', or retry the new device storage' : ''}.</span>
    {hold && <button className="underline cursor-pointer" onClick={() => { clearB2Hold(localStorage); window.location.reload() }}>Retry</button>}
    {/* DEV: a separate (empty) songbook for this account in the new device storage; the other one is untouched. */}
    {!hold && !b2On && isDevEnv && <button className="underline cursor-pointer" data-testid="open-own-b2-songbook" onClick={() => { enableLibraryB2(); window.location.reload() }}>Use a separate songbook for this account (B2)</button>}
  </aside>
}
function LibraryStartupReadyInner() {
  const [repairPreview, setRepairPreview] = useState<DanglingReferenceRepair | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [status, setStatus] = useState(() => { performStorageHousekeeping(); return checkRecovery() })
  const [b2Hold, setB2Hold] = useState<B2Hold | null>(() => { try { return localStorage.getItem(B2_FLAG_KEY) === '1' ? readB2Hold(localStorage) : null } catch { return null } })
  useEffect(() => {
    const onHold = () => setB2Hold(readB2Hold(localStorage))
    window.addEventListener('gtar-library-b2-hold', onHold)
    return () => window.removeEventListener('gtar-library-b2-hold', onHold)
  }, [])
  useEffect(() => {
    // #252: with B2 (10,000+ songs) a full recovery review per save is costly; coalesce bursts of saves.
    let timer: ReturnType<typeof setTimeout> | null = null
    const refreshNow = () => setStatus(checkRecovery())
    const refresh = () => {
      if (!isLibraryB2Active()) { refreshNow(); return }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; refreshNow() }, 300)
    }
    window.addEventListener('gtar-library-persisted', refresh)
    window.addEventListener('storage', refresh)
    // Child startup migration can persist before this listener is installed.
    refreshNow()
    return () => { if (timer !== null) clearTimeout(timer); window.removeEventListener('gtar-library-persisted', refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const exportRecovery = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(recoveryExportData(), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'GTAR-storage-recovery.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const repairPlan = status.damaged ? planDanglingReferenceRepair() : null
  const applyRepair = () => {
    if (!repairPreview) return
    if (isUnboundDeviceLibraryReadOnly()) {
      setRepairError('This songbook is not linked to an account yet. Link it before applying repairs.')
      return
    }
    try {
      applyDanglingReferenceRepair(repairPreview)
      setRepairPreview(null)
      setRepairError(null)
      setStatus(checkRecovery())
    } catch (err) { setRepairError(err instanceof Error ? err.message : 'Repair failed. Original data remains available for export.') }
  }
  // #181: only a damaged library gets the full-width alert (the app cannot load). Actionable recovery
  // is shown as a red dot on the Cloud Sync button and on "Review local recovery" (DEV only).
  return <>
    {b2Hold && <aside role="alert" data-testid="library-b2-hold" className="p-4 bg-amber-100 text-black flex flex-wrap items-center justify-between gap-3">
      <span className="flex-1 min-w-0">{holdMessage(b2Hold)}</span>
      <span className="flex gap-3">
        <button className="underline cursor-pointer" onClick={exportRecovery}>Export recovery data</button>
        <button className="underline cursor-pointer" onClick={() => { clearB2Hold(localStorage); window.location.reload() }}>Retry</button>
      </span>
    </aside>}
    {status.damaged && <aside role="alert" className="p-4 bg-amber-100 text-black flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <span>Device library needs recovery. Original browser data has been preserved.</span>
        <button className="underline ml-3 cursor-pointer" onClick={exportRecovery}>Export recovery data</button>
      </div>
    </aside>}
    {status.damaged && repairPlan && <section className="p-4" aria-label="Repair dangling setlist references">
      <h2>Repair dangling setlist references</h2>
      <p>Missing song records cannot be reconstructed. This repair removes only setlist entries whose song records no longer exist. Export recovery data first. The exact original input will also be archived before repair.</p>
      {!repairPreview && <button className="border rounded px-3 py-2 cursor-pointer" onClick={() => { setRepairPreview(repairPlan); setRepairError(null) }}>Preview</button>}
      {repairPreview && <div>
        <ul>{repairPreview.references.map((ref, index) => <li key={index}>{ref.name} (setlist {ref.setlistId}), entry {ref.position + 1}: {ref.title} — missing song ID {ref.songId}</li>)}</ul>
        <p>Apply Repair confirms removal of exactly these entries.</p>
        <button className="border rounded px-3 py-2 mr-3 cursor-pointer" onClick={() => { setRepairPreview(null); setRepairError(null) }}>Cancel</button>
        <button className="border rounded px-3 py-2 cursor-pointer" onClick={applyRepair}>Apply Repair</button>
      </div>}
      {repairError && <p role="alert">{repairError}</p>}
    </section>}
    {!status.damaged && <LibraryApp />}
  </>
}

function LibraryApp() {
  const [reviewRecovery, setReviewRecovery] = useState(false)
  useEffect(() => {
    const open = () => setReviewRecovery(true)
    window.addEventListener('gtar-review-recovery', open)
    return () => window.removeEventListener('gtar-review-recovery', open)
  }, [])
  const editorNavigationGuard = useRef<((next: () => void) => void) | null>(null)
  const navigateSafely = (next: () => void) => {
    if (editorNavigationGuard.current) editorNavigationGuard.current(next)
    else next()
  }
  // Load once so legacy songs receive the same IDs used by the setlist migration.
  const [initialLibrary] = useState(() => {
    let savedLibrary = readPersistedLibrary()
    if (savedLibrary) {
      const normalized = normalizeSongbookIds(savedLibrary.songs, savedLibrary.setlists)
      // #228: former sample songs the user never changed are removed (no samples ship any more).
      const cleaned = removeUnchangedSamples({ ...savedLibrary, songs: normalized.songs, setlists: normalized.setlists }, cloudSyncedSetlistIds())
      if (normalized.migrated || cleaned.songs.length !== normalized.songs.length || cleaned.setlists.length !== normalized.setlists.length) {
        savedLibrary = cleaned
        try {
          persistLibrary(savedLibrary)
        } catch { /* storage quota or error */ }
      }
      return { ...partitionSongs(savedLibrary.songs), setlists: savedLibrary.setlists }
    }
    const readSongs = (key: string, fallback: ActiveSongState[]) => {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw === null ? fallback : JSON.parse(raw)
        return Array.isArray(parsed) ? parsed as ActiveSongState[] : fallback
      } catch { return fallback }
    }
    const storedSongs = readSongs('gtar_songs_store', DEFAULT_SETLIST)
    const storedTrash = readSongs('gtar_trash_songs_store', []).map(song => ({ ...song, isDeleted: true }))
    let storedSetlists = DEFAULT_SAMPLE_SETLISTS
    try {
      const saved = localStorage.getItem('gtar_setlists_store')
      if (saved && Array.isArray(JSON.parse(saved))) storedSetlists = JSON.parse(saved)
    } catch { /* Keep the existing fallback. */ }
    const combined = [...storedSongs, ...storedTrash]
    const normalized = normalizeSongbookIds(combined, storedSetlists)
    const repaired = removeUnchangedSamples(deduplicateLibrary({ songs: normalized.songs, setlists: normalized.setlists }), cloudSyncedSetlistIds())
    try {
      persistLibrary(repaired)
      performStorageHousekeeping()
    } catch { /* ignore */ }
    const migrated = readPersistedLibrary() ?? repaired
    return { ...partitionSongs(migrated.songs), setlists: migrated.setlists }
  })

  // Recover active stage session if valid session existed prior to browser/OS restart
  const [initialStageSession] = useState(() => {
    try {
      const rawSession = readStageSession()
      const validated = validateAndResolveStageSession(
        rawSession,
        initialLibrary.active,
        initialLibrary.setlists
      )
      if (rawSession && !validated.isValid) {
        clearStageSession()
      }
      return validated
    } catch {
      clearStageSession()
      return {
        isValid: false,
        view: 'songbook' as const,
        queueMode: 'library' as const,
        activeSongIndex: 0,
        activeSetlistId: null,
        activeSetlistSongIndex: 0,
        resolvedSong: null,
      }
    }
  })

  // View state: Songbook Library Home vs Desktop Editor vs Stage View vs Trash Bin
  const [activeView, setActiveView] = useState<'songbook' | 'editor' | 'stage' | 'trash'>(
    initialStageSession.isValid ? initialStageSession.view : 'songbook'
  )

  // DEV.5a: mirror view changes into browser history (Back semantics, no hardcoded route).
  const viewFromHistoryRef = useRef(false)
  const activeViewRef = useRef(activeView)
  useEffect(() => {
    activeViewRef.current = activeView
    if (typeof window === 'undefined' || !window.history) return
    const current: unknown = window.history.state
    if (!isGtarViewHistoryState(current)) {
      window.history.replaceState(buildViewHistoryState(activeView, 0, current), '')
      viewFromHistoryRef.current = false
      return
    }
    if (viewFromHistoryRef.current) {
      viewFromHistoryRef.current = false
      return
    }
    if (current.gtarView !== activeView) {
      window.history.pushState(buildViewHistoryState(activeView, current.gtarDepth + 1, null), '')
    }
  }, [activeView])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = (event: PopStateEvent) => {
      const state: unknown = event.state
      if (!isGtarViewHistoryState(state) || state.gtarView === activeViewRef.current) return
      const next = () => {
        viewFromHistoryRef.current = true
        setActiveView(state.gtarView)
      }
      if (editorNavigationGuard.current) editorNavigationGuard.current(next)
      else next()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const [songs, setSongs] = useState<ActiveSongState[]>(initialLibrary.active)
  const [deletedSongs, setDeletedSongs] = useState<ActiveSongState[]>(initialLibrary.deleted)

  // Custom Setlists (persisted in localStorage)
  const [setlists, setSetlists] = useState<WebSetlist[]>(initialLibrary.setlists)

  // #247 (Option A): Unbound populated device library encountered by a signed-in session is read-only
  const [unboundReadOnly, setUnboundReadOnly] = useState(() => isUnboundDeviceLibraryReadOnly())
  const [isLinkingOwner, setIsLinkingOwner] = useState(false)

  useEffect(() => {
    const update = () => setUnboundReadOnly(isUnboundDeviceLibraryReadOnly())
    window.addEventListener('storage', update)
    window.addEventListener('gtar:auth_changed', update)
    window.addEventListener('gtar:library_linked', update)
    window.addEventListener('gtar-library-persisted', update)
    return () => {
      window.removeEventListener('storage', update)
      window.removeEventListener('gtar:auth_changed', update)
      window.removeEventListener('gtar:library_linked', update)
      window.removeEventListener('gtar-library-persisted', update)
    }
  }, [])

  const handleLinkUnboundLibrary = async () => {
    const session = storedSession(localStorage)
    if (!session?.userId) {
      setToastMessage('Sign in first to link this songbook.')
      return
    }
    setIsLinkingOwner(true)
    try {
      await confirmLibraryOwner(session.userId)
      setUnboundReadOnly(false)
      window.dispatchEvent(new Event('gtar:library_linked'))
      setToastMessage(`Songbook linked to ${session.userId}!`)
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Could not link songbook.')
      setTimeout(() => setToastMessage(null), 5000)
    } finally {
      setIsLinkingOwner(false)
    }
  }

  const editorRecoveryDraftRef = useRef<(() => ActiveSongState | null) | null>(null)

  // Stage Color Theme (persisted in localStorage)
  const [stageTheme, setStageTheme] = useState<ThemeMode>(() => hydrateThemeSettings().mode)

  // Only standalone Custom Palette lives here; factory overrides use their own slots.
  const [customThemeColors, setCustomThemeColors] = useState<CustomThemeColors>(() => hydrateThemeSettings().standalone)

  const [activeSetlistId, setActiveSetlistId] = useState<string | number | null>(() => {
    if (initialStageSession.isValid && initialStageSession.activeSetlistId) {
      return initialStageSession.activeSetlistId
    }
    try {
      const saved = localStorage.getItem('gtar_active_setlist_id')
      if (saved) return JSON.parse(saved)
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    return 'gig-set-1'
  })
  const [activeSongIndex, setActiveSongIndex] = useState<number>(
    initialStageSession.isValid ? initialStageSession.activeSongIndex : 0
  )
  const [activeSetlistSongIndex, setActiveSetlistSongIndex] = useState<number>(
    initialStageSession.isValid ? initialStageSession.activeSetlistSongIndex : 0
  )
  const [queueMode, setQueueMode] = useState<'library' | 'setlist'>(
    initialStageSession.isValid ? initialStageSession.queueMode : 'library'
  )
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Display Settings (persisted in localStorage)
  const [fontStyle, setFontStyle] = useState<SongFontStyleOption>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEYS.fontStyle) as SongFontStyleOption
      if (saved) return saved
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    return 'mono'
  })
  const [isTwoColumn, setIsTwoColumn] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEYS.isTwoColumn)
      if (saved !== null) return JSON.parse(saved)
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    return false
  })
  const [isEdgeSwipePanelEnabled, setIsEdgeSwipePanelEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(EDGE_SWIPE_STORAGE_KEY)
      if (saved !== null) return JSON.parse(saved)
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    return false
  })

  useEffect(() => {
    const reloadSettings = () => {
      const settings = readBackupSettings()
      // Hydration also upgrades legacy active-palette backups to separate storage.
      const hydrated = hydrateThemeSettings()
      applyThemeRuntime(hydrated.mode, hydrated.standalone)
      setStageTheme(hydrated.mode)
      setCustomThemeColors(hydrated.standalone)
      if (settings.stageSettings?.fontStyle !== undefined) setFontStyle(settings.stageSettings.fontStyle)
      if (settings.stageSettings?.isTwoColumn !== undefined) setIsTwoColumn(settings.stageSettings.isTwoColumn)
      try {
        const savedSwipe = localStorage.getItem(EDGE_SWIPE_STORAGE_KEY)
        if (savedSwipe !== null) setIsEdgeSwipePanelEnabled(JSON.parse(savedSwipe))
      } catch { /* Best-effort */ }
    }
    window.addEventListener(SETTINGS_CHANGED, reloadSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED, reloadSettings)
  }, [])

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  // #85 slice 1: baseline, cross-tab guard, unload guard and persistence live in one hook.
  const {
    persistedBaselineRef, crossTabConflict, setCrossTabConflict, conflictRecoverySaved, setConflictRecoverySaved,
    getConflictDraft, handleStorageWriteFailure,
  } = useLibraryPersistence({ songs, deletedSongs, setlists, setSongs, setDeletedSongs, setSetlists, setToastMessage, editorRecoveryDraftRef })

  // #257 F3: a stable array, so the backup dialog re-checks "changed since backup" only when the library really changes.
  const backupDialogSongs = useMemo(() => [...songs, ...deletedSongs], [songs, deletedSongs])

  // #251: one non-blocking backup reminder per app start (no upload; the user saves the file).
  const backupReminderLibraryRef = useRef({ songs, deletedSongs, setlists })
  useEffect(() => { backupReminderLibraryRef.current = { songs, deletedSongs, setlists } }, [songs, deletedSongs, setlists])
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined
    const show = setTimeout(() => {
      const library = backupReminderLibraryRef.current
      const message = backupReminderMessage(backupReminderDue(readBackupStatus(),
        { songs: library.songs.length, trash: library.deletedSongs.length, setlists: library.setlists.length },
        () => libraryFingerprint([...library.songs, ...library.deletedSongs], library.setlists)))
      if (!message) return
      setToastMessage(message)
      hide = setTimeout(() => setToastMessage(current => current === message ? null : current), 8000)
    }, 6000)
    return () => { clearTimeout(show); if (hide) clearTimeout(hide) }
  }, [])
  // Best-effort non-blocking durable storage request (Gap 2)
  useEffect(() => {
    requestDurableStorage().catch(() => {})
  }, [])

  // Save active setlist ID
  useEffect(() => {
    try {
      localStorage.setItem('gtar_active_setlist_id', JSON.stringify(activeSetlistId))
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }, [activeSetlistId])

  // Save font style to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEYS.fontStyle, fontStyle)
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }, [fontStyle])

  // Save two-column state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEYS.isTwoColumn, JSON.stringify(isTwoColumn))
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }, [isTwoColumn])

  // Save edge swipe panel state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(EDGE_SWIPE_STORAGE_KEY, JSON.stringify(isEdgeSwipePanelEnabled))
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
  }, [isEdgeSwipePanelEnabled])

  // Apply theme to document.body and persist
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEYS.themeMode, stageTheme)
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }

    const appliedPalette = applyThemeRuntime(stageTheme, customThemeColors)
    stageCast.setThemeSnapshot(stageTheme, appliedPalette)
  }, [stageTheme, customThemeColors])

  // Active Setlist context
  const activeSetlist = useMemo(() => {
    const activeList = setlists.filter((sl) => !sl.isDeleted)
    if (!activeList.length) return null
    return (
      activeList.find((sl) => String(sl.id) === String(activeSetlistId)) ||
      activeList[0] ||
      null
    )
  }, [setlists, activeSetlistId])

  // Keep queue positions, including an explicit unavailable-song entry.
  const activeSetlistSongs: ActiveSongState[] = useMemo(() => {
    if (!activeSetlist) return []
    return activeSetlist.songs.map(ref => resolveSetlistSong(ref, songs) ?? {
      id: ref.id, title: ref.title, artist: ref.artist ?? '', isMissing: true,
      key: '', capo: '', bpm: '', format: 'PLAIN', transposeOffset: 0, rawContent: '',
    })
  }, [activeSetlist, songs])

  const isInSetlistMode =
    queueMode === 'setlist' && Boolean(activeSetlist) && activeSetlistSongs.length > 0

  // Current active song strictly honoring current active scope
  const currentSong = isInSetlistMode
    ? activeSetlistSongs[activeSetlistSongIndex] ||
      activeSetlistSongs[0] ||
      songs[0] ||
      EMPTY_LIBRARY_SONG
    : songs[activeSongIndex] || EMPTY_LIBRARY_SONG

  // Global Modals: one reducer (#85 slice 4); each entry keeps the useState [value, setter] shape.
  const modals = useAppModals(() => ({ tvPresentation: typeof window !== 'undefined' && window.location.hash.includes('cast2=') }))
  const [isWebsiteUrlModalOpen, setIsWebsiteUrlModalOpen] = modals.websiteUrl
  const [isImportModalOpen, setIsImportModalOpen] = modals.import
  // Stays mounted after first open so the dialog keeps its state across opens, as before.
  const [importDialogMounted, setImportDialogMounted] = useState(false)
  if (isImportModalOpen && !importDialogMounted) setImportDialogMounted(true)
  const [isBackupRestoreModalOpen, setIsBackupRestoreModalOpen] = modals.backupRestore
  const [isStageSettingsModalOpen, setIsStageSettingsModalOpen] = modals.stageSettings
  const [isStageToolsModalOpen, setIsStageToolsModalOpen] = modals.stageTools
  const [isThemeModalOpen, setIsThemeModalOpen] = modals.theme
  const [isJsonModalOpen, setIsJsonModalOpen] = modals.json
  const [isHeaderKeyPickerOpen, setIsHeaderKeyPickerOpen] = modals.headerKeyPicker
  // #85 slice 3: Shared Setlists publication state, catalog badges and the catalog import context.
  const {
    confirmedCatalogIds, freshCatalogIds, publishingSetlistId, setPublishingSetlistId, publicationStateRef, catalogImportHost,
  } = useSetlistPublication({
    getConflictDraft, crossTabConflict, editorRecoveryDraftRef, persistedBaselineRef, setSongs, setDeletedSongs, setSetlists,
  })

  const [isSetlistDrawerOpen, setIsSetlistDrawerOpen] = modals.setlistDrawer
  const [drawerInitialTab, setDrawerInitialTab] = useState<'songbook' | 'setlists'>('setlists')
  const [sharingSetlist, setSharingSetlist] = useState<WebSetlist | null>(null)
  const [incomingSharedSetlist, setIncomingSharedSetlist] = useState<SharedSetlistPayload | null>(null)
  // True when StageView enters fullscreen or focus mode — hides the global Header
  const [isStagePerformanceMode, setIsStagePerformanceMode] = useState(false)

  const authContext = useOptionalGoogleAuth()
  // Track in-flight and successfully processed tokens to prevent duplicate requests or retry loops
  const inFlightShareRef = useRef<string | null>(null)
  const resolvedShareRef = useRef<string | null>(null)

  // Handle incoming ?share=<token> parameter on load or restored after authentication
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search)
      let shareToken = urlParams.get('share')
      if (!shareToken) {
        try {
          if (typeof sessionStorage !== 'undefined') {
            shareToken = sessionStorage.getItem('gtar_pending_share_token')
          }
        } catch { /* ignore */ }
      }

      if (!shareToken) return

      // Safe handling for malformed tokens: purge immediately fail-closed
      if (!/^[a-f0-9]{16,64}$/i.test(shareToken)) {
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('gtar_pending_share_token')
          }
          const cleanUrl = new URL(window.location.href)
          if (cleanUrl.searchParams.has('share')) {
            cleanUrl.searchParams.delete('share')
            window.history.replaceState({}, document.title, cleanUrl.pathname + (cleanUrl.search || ''))
          }
        } catch { /* ignore */ }
        return
      }

      const tokenToFetch = shareToken.toLowerCase()

      // Prevent duplicate concurrent requests or repeated execution for already resolved token
      if (inFlightShareRef.current === tokenToFetch || resolvedShareRef.current === tokenToFetch) {
        return
      }

      const auth = getStoredSessionStatus()
      const authToken = authContext?.session
        ? (authContext.session.sessionToken || authContext.session.idToken || authContext.session.token)
        : (auth.session ? (auth.session.sessionToken || auth.session.idToken || auth.session.token) : null)

      // If unauthenticated or session expired, retain pending token in sessionStorage for restoration
      if (!authToken || auth.isExpired) {
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('gtar_pending_share_token', tokenToFetch)
          }
        } catch { /* ignore */ }
        return
      }

      inFlightShareRef.current = tokenToFetch

      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
      }

      fetch(`/api/setlist/share?token=${encodeURIComponent(tokenToFetch)}`, { headers })
        .then(async (res) => {
          inFlightShareRef.current = null
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            if (res.status === 401) {
              // Recoverable auth failure: token must survive in sessionStorage
              throw { type: 'RECOVERABLE_AUTH', message: 'Authentication required to view shared setlist.' }
            }
            if (res.status === 403) {
              // Recoverable access approval failure: token survives for when admin approves
              throw { type: 'RECOVERABLE_AUTH', message: 'Active account approval required to view shared setlist.' }
            }
            if (res.status === 410) {
              // Terminal expired or revoked token outcome
              const isRevoked = errData?.error === 'SHARED_SETLIST_REVOKED'
              throw {
                type: 'TERMINAL_EXPIRED',
                message: isRevoked
                  ? 'This shared setlist link has been revoked.'
                  : 'This shared setlist link has expired.',
              }
            }
            if (res.status === 404) {
              // Terminal not-found outcome
              throw { type: 'TERMINAL_NOT_FOUND', message: 'Shared setlist not found.' }
            }
            if (res.status === 400) {
              // Terminal invalid token outcome
              throw { type: 'TERMINAL_INVALID', message: 'Invalid shared setlist link.' }
            }
            throw { type: 'RECOVERABLE_SERVER', message: errData?.error || 'Could not load shared setlist: link may be expired or invalid.' }
          }
          return res.json()
        })
        .then((data) => {
          if (data?.setlist) {
            resolvedShareRef.current = tokenToFetch
            // Successful share resolution: clear pending token
            try {
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.removeItem('gtar_pending_share_token')
              }
            } catch { /* ignore */ }
            setIncomingSharedSetlist(data.setlist)
          }
        })
        .catch((err) => {
          console.warn('[Share] Failed to load shared setlist:', err)
          const isTerminal = err?.type === 'TERMINAL_EXPIRED' || err?.type === 'TERMINAL_NOT_FOUND' || err?.type === 'TERMINAL_INVALID'
          if (isTerminal) {
            resolvedShareRef.current = tokenToFetch
            try {
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.removeItem('gtar_pending_share_token')
              }
            } catch { /* ignore */ }
          }
          const msg = typeof err?.message === 'string'
            ? err.message
            : (err instanceof Error ? err.message : 'Could not load shared setlist.')
          setToastMessage(msg)
          setTimeout(() => setToastMessage(null), 4000)
        })
        .finally(() => {
          inFlightShareRef.current = null
          // Clean up share parameter from URL without page reload once processed
          try {
            const cleanUrl = new URL(window.location.href)
            if (cleanUrl.searchParams.has('share')) {
              cleanUrl.searchParams.delete('share')
              window.history.replaceState({}, document.title, cleanUrl.pathname + (cleanUrl.search || ''))
            }
          } catch { /* ignore */ }
        })
    } catch {
      /* ignore */
    }
  }, [authContext?.session, authContext?.accessStatus])

  // Stage Cast Active Presentation State
  const [isCastActive, setIsCastActive] = useState(() => stageCast.isPresentationActive())
  const [isTvPresentationModalOpen, setIsTvPresentationModalOpen] = modals.tvPresentation

  useEffect(() => {
    const unsubscribe = stageCast.subscribeSessionState((active) => {
      setIsCastActive(active)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handleTogglePresentation = useCallback(async () => {
    if (isCastActive) {
      stageCast.stopPresentation()
    } else {
      stageCast.broadcastState({
        song: currentSong,
        effectiveKey: transposeContext(currentSong, currentSong.transposeOffset || 0).performanceKey,
        transposeOffset: currentSong.transposeOffset || 0,
        fontSizePx: 22,
        fontStyle,
        isTwoColumn,
        chordScale: 100,
        fontWeight: 'regular',
        lineSpacing: 'normal',
      })

      const caps = stageCast.getPresentationCapabilities()
      // #214: with Stage Cast 2.0 (DEV builds) desktop Cast offers pop-out and TV pairing in one modal.
      if (caps.recommendedMode === 'tv_pairing' || !caps.canDirectPresent || stageCast2Enabled) {
        setIsTvPresentationModalOpen(true)
      } else {
        const res = await stageCast.requestPresentation({ preferPopup: caps.supportsMultiWindow })
        if (!res.success && res.mode === 'popup_window' && res.error) {
          window.alert(res.error)
        }
        if (res.mode === 'tv_pairing') {
          setIsTvPresentationModalOpen(true)
        }
      }
    }
  }, [
    isCastActive,
    currentSong,
    fontStyle,
    isTwoColumn,
    setIsTvPresentationModalOpen,
  ])


  // Guard: sync active stage presence to window to protect active performance from unprompted SW reloads
  useEffect(() => {
    const isStageActive = activeView === 'stage' || isStagePerformanceMode
    ;(window as unknown as { __GTAR_STAGE_ACTIVE__?: boolean }).__GTAR_STAGE_ACTIVE__ = isStageActive
    return () => {
      ;(window as unknown as { __GTAR_STAGE_ACTIVE__?: boolean }).__GTAR_STAGE_ACTIVE__ = false
    }
  }, [activeView, isStagePerformanceMode])

  // Persist active stage session across browser/OS termination; clear on exit
  useEffect(() => {
    if (activeView === 'stage') {
      saveStageSession({
        isActive: true,
        queueMode,
        activeSongIndex,
        activeSetlistId,
        activeSetlistSongIndex,
        songId: currentSong?.id,
        songTitle: currentSong?.title,
      })
    } else {
      clearStageSession()
    }
  }, [
    activeView,
    queueMode,
    activeSongIndex,
    activeSetlistId,
    activeSetlistSongIndex,
    currentSong?.id,
    currentSong?.title,
  ])

  // #85 slice 2: import, merge and restore handlers live in one hook.
  const {
    importStateRef, handleSmartMerge, handleImportSong, handleImportAllSongs, handleFullRestore,
    handleImportSingleSetlist, handleImportSharedSetlist,
  } = useLibraryImports({
    songs, deletedSongs, setlists, setSongs, setDeletedSongs, setSetlists, persistedBaselineRef, setCrossTabConflict,
    setToastMessage, setActiveSongIndex, setActiveSetlistId, setActiveSetlistSongIndex, setQueueMode, setIncomingSharedSetlist,
  })

  // Band Sync: listen to leader song sync events when client
  // Transpose handler
  const handleTransposeChange = useCallback((newOffset: number) => {
    if (!Number.isSafeInteger(newOffset) || newOffset < -11 || newOffset > 11) return
    if (isInSetlistMode) {
      const target = activeSetlistSongs[activeSetlistSongIndex]
      if (target) {
        setSongs((prev) =>
          prev.map((s) => (s.id === target.id ? { ...s, transposeOffset: newOffset } : s))
        )
      }
    } else {
      setSongs((prev) =>
        prev.map((s, idx) => (idx === activeSongIndex ? { ...s, transposeOffset: newOffset } : s))
      )
    }
  }, [isInSetlistMode, activeSetlistSongs, activeSetlistSongIndex, activeSongIndex])

  useEffect(() => {
    const unsub = bandSync.onMessage((msg) => {
      if (bandSync.getRole() === 'CLIENT') {
        if (msg.type === 'SONG_SYNC' && msg.payload) {
          // Auto Route: immediately switch directly to Stage View without needing to open setlist drawer
          setActiveView('stage')
          setIsSetlistDrawerOpen(false)

          const title: string = msg.payload.title || msg.payload.songTitle || ''
          const artist: string = msg.payload.artist || ''
          const queueType: string = (msg.payload.queueType || 'LIBRARY').toUpperCase()
          const queueIndex: number =
            msg.payload.queueIndex ?? msg.payload.setlistIndex ?? msg.payload.songIndex ?? 0
          const transpose: number = msg.payload.transpose ?? msg.payload.transposeOffset ?? 0
          const rawContent: string = msg.payload.rawContent || msg.payload.content || ''

          const normTitle = title.trim().toLowerCase()
          const normArtist = artist.trim().toLowerCase()

          if (queueType === 'SETLIST') {
            setQueueMode('setlist')
            let matched = false

            // Try matching in active setlist songs
            if (activeSetlist && activeSetlistSongs.length > 0) {
              const idx = activeSetlistSongs.findIndex(
                (s) =>
                  s.title.trim().toLowerCase() === normTitle &&
                  (!normArtist || s.artist.trim().toLowerCase() === normArtist)
              )
              if (idx !== -1) {
                setActiveSetlistSongIndex(idx)
                matched = true
              } else if (queueIndex >= 0 && queueIndex < activeSetlistSongs.length) {
                setActiveSetlistSongIndex(queueIndex)
                matched = true
              }
            }

            // If not found in active setlist, check other setlists
            if (!matched) {
              for (const sl of setlists) {
                const slIdx = sl.songs.findIndex(
                  (s) =>
                    s.title.trim().toLowerCase() === normTitle &&
                    (!normArtist || (s.artist || '').trim().toLowerCase() === normArtist)
                )
                if (slIdx !== -1) {
                  setActiveSetlistId(sl.id)
                  setActiveSetlistSongIndex(slIdx)
                  matched = true
                  break
                }
              }
            }

            // If still not matched, check songs library
            if (!matched) {
              const libIdx = songs.findIndex(
                (s) =>
                  s.title.trim().toLowerCase() === normTitle &&
                  (!normArtist || s.artist.trim().toLowerCase() === normArtist)
              )
              if (libIdx !== -1) {
                setActiveSongIndex(libIdx)
              } else {
                const effectiveContent = rawContent || `{title: ${title || 'Synced Song'}}\n{artist: ${artist || ''}}\n\n[Verse]\n`
                const newSong: ActiveSongState = {
                  id: generateUUID(),
                  title: title || 'Synced Song',
                  artist: artist || '',
                  key: msg.payload.key || detectSongKey(effectiveContent),
                  capo: msg.payload.capo || 'No Capo',
                  bpm: msg.payload.bpm || '120',
                  format: msg.payload.format || 'CHORD_PRO',
                  transposeOffset: transpose,
                  rawContent: effectiveContent,
                }
                setSongs((prev) => [...prev, newSong])
                setActiveSongIndex(songs.length)
              }
            }
          } else {
            // LIBRARY mode
            setQueueMode('library')
            const libIdx = songs.findIndex(
              (s) =>
                s.title.trim().toLowerCase() === normTitle &&
                (!normArtist || s.artist.trim().toLowerCase() === normArtist)
            )
            if (libIdx !== -1) {
              setActiveSongIndex(libIdx)
            } else {
              const effectiveContent = rawContent || `{title: ${title || 'Synced Song'}}\n{artist: ${artist || ''}}\n\n[Verse]\n`
              const newSong: ActiveSongState = {
                id: generateUUID(),
                title: title || 'Synced Song',
                artist: artist || '',
                key: msg.payload.key || detectSongKey(effectiveContent),
                capo: msg.payload.capo || 'No Capo',
                bpm: msg.payload.bpm || '120',
                format: msg.payload.format || 'CHORD_PRO',
                transposeOffset: transpose,
                rawContent: effectiveContent,
              }
              setSongs((prev) => [...prev, newSong])
              setActiveSongIndex(songs.length)
            }
          }

          if (typeof transpose === 'number') {
            handleTransposeChange(transpose)
          }
        } else if (msg.type === 'SETLIST_SYNC' && msg.payload) {
          try {
            const parsed = parseBandSetlist(msg.payload, importStateRef.current.songs)
            handleSmartMerge(parsed.songs, parsed.setlists)
            setActiveSetlistId(parsed.setlists[0].id)
          } catch (error) {
            setToastMessage(error instanceof Error ? error.message : 'Setlist reception aborted; resolve import conflict explicitly.')
            return
          }
          setActiveSetlistSongIndex(0)
          setQueueMode('setlist')
          setActiveView('stage')

          // Toast: "Received new setlist from Leader"
          setToastMessage('Received new setlist from Leader')
          setTimeout(() => setToastMessage(null), 5000)
        }
      }
    })
    return unsub
  }, [songs, activeSetlist, activeSetlistSongs, setlists, deletedSongs, handleTransposeChange, handleSmartMerge, importStateRef, setIsSetlistDrawerOpen])

  // Select a song from library (switches queue scope to full library)
  const handleSelectLibrarySong = (idx: number) => {
    setActiveSongIndex(idx)
    setQueueMode('library')
  }

  // Select a song from a setlist (switches queue scope to active setlist)
  const handleSelectSetlistSong = (setlistId: string | number, songIdx: number) => {
    setActiveSetlistId(setlistId)
    setActiveSetlistSongIndex(songIdx)
    setQueueMode('setlist')
  }

  // Toggle stage playback queue mode between Library and Setlist
  const handleToggleQueueMode = (mode: 'library' | 'setlist') => {
    if (mode === 'setlist') {
      if (!activeSetlistId && setlists.length > 0) {
        setActiveSetlistId(setlists[0].id)
        setActiveSetlistSongIndex(0)
      }
      setQueueMode('setlist')
    } else {
      setQueueMode('library')
    }
  }

  // Direct select active setlist
  const handleSelectSetlist = (setlistId: string | number) => {
    setActiveSetlistId(setlistId)
    setActiveSetlistSongIndex(0)
    setQueueMode('setlist')
  }

  // Reorder song in a setlist
  const handleReorderSetlistSong = (
    setlistId: string | number,
    songIndex: number,
    moveUp: boolean
  ) => {
    setSetlists((prev) =>
      prev.map((sl) => {
        if (sl.id !== setlistId) return sl
        const targetIndex = moveUp ? songIndex - 1 : songIndex + 1
        if (targetIndex < 0 || targetIndex >= sl.songs.length) return sl
        const updatedSongs = [...sl.songs]
        const [moved] = updatedSongs.splice(songIndex, 1)
        updatedSongs.splice(targetIndex, 0, moved)
        return { ...sl, songs: updatedSongs }
      })
    )
    if (activeSetlistId === setlistId) {
      if (activeSetlistSongIndex === songIndex) {
        setActiveSetlistSongIndex(moveUp ? songIndex - 1 : songIndex + 1)
      } else if (activeSetlistSongIndex === (moveUp ? songIndex - 1 : songIndex + 1)) {
        setActiveSetlistSongIndex(songIndex)
      }
    }
  }

  // Remove song from a setlist
  const handleRemoveSetlistSong = (setlistId: string | number, songIndex: number) => {
    setSetlists((prev) =>
      prev.map((sl) => {
        if (sl.id !== setlistId) return sl
        return {
          ...sl,
          songs: sl.songs.filter((_, idx) => idx !== songIndex),
        }
      })
    )
    if (activeSetlistId === setlistId) {
      if (activeSetlistSongIndex >= songIndex && activeSetlistSongIndex > 0) {
        setActiveSetlistSongIndex(activeSetlistSongIndex - 1)
      }
    }
  }

  // Delete setlist (tombstone for cloud sync propagation)
  const handleDeleteSetlist = (setlistId: string | number) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before modifying setlists.')
      return
    }
    setSetlists((prev) =>
      prev.map((sl) => (String(sl.id) === String(setlistId) ? { ...sl, isDeleted: true } : sl))
    )
    if (activeSetlistId === setlistId) {
      setActiveSetlistId(null)
      setQueueMode('library')
    }
  }

  // Bulk delete setlists
  const handleBulkDeleteSetlists = (ids: Array<string | number>) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before modifying setlists.')
      return
    }
    const idSet = new Set(ids.map(String))
    setSetlists((prev) => prev.map((sl) => (idSet.has(String(sl.id)) ? { ...sl, isDeleted: true } : sl)))
    if (activeSetlistId && idSet.has(String(activeSetlistId))) {
      setActiveSetlistId(null)
      setQueueMode('library')
    }
    setToastMessage(`Deleted ${ids.length} ${ids.length === 1 ? 'setlist' : 'setlists'}.`)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Rename setlist
  const handleRenameSetlist = (setlistId: string | number, newName: string) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before modifying setlists.')
      return
    }
    const trimmed = newName.trim()
    if (!trimmed) return
    setSetlists((prev) =>
      prev.map((sl) => (String(sl.id) === String(setlistId) ? { ...sl, name: trimmed } : sl))
    )
    setToastMessage(`Renamed setlist to "${trimmed}"`)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Manage setlist in slide-over drawer
  const handleManageSetlist = (setlist: WebSetlist) => {
    setActiveSetlistId(setlist.id)
    setIsSetlistDrawerOpen(true)
  }

  // Band Leader Action: Push Setlist to Members
  const handlePushSetlistToMembers = (
    targetSetlistId?: string | number
  ): { success: boolean; message: string } => {
    const targetSetlist = targetSetlistId
      ? setlists.find((s) => String(s.id) === String(targetSetlistId)) || activeSetlist || setlists[0]
      : activeSetlist || setlists[0]

    if (bandSync.getState().role !== 'HOST') {
      const msg = 'Followers cannot broadcast setlists. Only the Band Leader can push setlists.'
      setToastMessage(msg)
      setTimeout(() => setToastMessage(null), 4000)
      return { success: false, message: msg }
    }

    if (!targetSetlist || targetSetlist.songs.length === 0) {
      const msg = 'No setlist available to push. Please create or select a setlist first.'
      setToastMessage(msg)
      setTimeout(() => setToastMessage(null), 4000)
      return { success: false, message: msg }
    }

    let payloadSongs: ActiveSongState[]
    try { payloadSongs = createSingleSetlistPayload(targetSetlist, songs).setlist.songs }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Setlist contains a missing song'
      setToastMessage(message)
      return { success: false, message }
    }

    bandSync.broadcastSetlist(targetSetlist.name, payloadSongs, targetSetlist.id)
    const successMsg = `Pushed setlist '${targetSetlist.name}' (${payloadSongs.length} songs) to band members via BandSync!`
    setToastMessage(successMsg)
    setTimeout(() => setToastMessage(null), 4000)
    return { success: true, message: successMsg }
  }

  // Import online chord sheet directly into songbook library
  const handleImportOnlineChordSheet = (
    sheet: FetchedChordSheet,
    openInStage = false
  ) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before importing songs.')
      return
    }
    const existingIdx = songs.findIndex(
      (s) =>
        s.title.trim().toLowerCase() === sheet.title.trim().toLowerCase() &&
        (!sheet.artist || (s.artist || '').trim().toLowerCase() === sheet.artist.trim().toLowerCase())
    )

    if (existingIdx !== -1) {
      setToastMessage(`"${sheet.title}" is already in your library.`)
      setTimeout(() => setToastMessage(null), 3000)
      if (openInStage) {
        setActiveSongIndex(existingIdx)
        setQueueMode('library')
        setActiveView('stage')
      }
      return
    }

    const newSong: ActiveSongState = {
      id: generateUUID(),
      title: sheet.title,
      artist: sheet.artist,
      key: sheet.key || detectSongKey(sheet.rawContent || ''),
      capo: sheet.capo || 'No Capo',
      bpm: sheet.bpm || '120',
      format: sheet.format,
      transposeOffset: 0,
      rawContent: sheet.rawContent,
    }

    setSongs((prev) => [newSong, ...prev])
    setToastMessage(`Imported "${sheet.title}" to Songbook Library!`)
    setTimeout(() => setToastMessage(null), 4000)

    if (openInStage) {
      setActiveSongIndex(0)
      setQueueMode('library')
      setActiveView('stage')
    }
  }

  const createLifecycleBlank = (): ActiveSongState => {
    return {
      id: generateUUID(),
      title: 'New Song',
      artist: '',
      key: '',
      capo: 'No Capo',
      bpm: '120',
      format: 'CHORD_PRO',
      transposeOffset: 0,
      rawContent: `{title: New Song}\n{artist: }\n{original_key: }\n{tempo: 120 BPM}\n{time: 4/4}\n{year: }\n\n[Intro]\n\n[Verse 1]\n\n[Chorus]\n`,
    }
  }

  // Persist the validated complete candidate before scheduling any state partition.
  const commitSongLifecycle = (operation: SongLifecycleOperation) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before modifying songs.')
      return null
    }
    if (typeof crossTabConflict !== 'undefined' && crossTabConflict) {
      setToastMessage('Cannot modify library while a cross-tab conflict is unresolved.')
      return null
    }
    const next = transitionSongLibrary({ active: songs, deleted: deletedSongs, setlists }, operation)
    try {
      const expectedBaseline = typeof persistedBaselineRef !== 'undefined' ? persistedBaselineRef.current : undefined
      persistLibrary(
        { songs: [...next.active, ...next.deleted], setlists: next.setlists },
        localStorage,
        expectedBaseline !== undefined ? { expectedRaw: expectedBaseline } : undefined
      )
      if (typeof persistedBaselineRef !== 'undefined') {
        persistedBaselineRef.current = libraryRevision()
      }
    }
    catch (err) { handleStorageWriteFailure(err); return null }
    setSongs(next.active)
    setDeletedSongs(next.deleted)
    setSetlists(next.setlists)
    return next
  }

  const handleDeleteSong = (indexToDelete: number) => {
    const songToDelete = songs[indexToDelete]
    if (!songToDelete || songToDelete.id === undefined) return
    const next = commitSongLifecycle({ kind: 'trash', ids: [songToDelete.id], blank: createLifecycleBlank() })
    if (!next) return
    if (activeSongIndex === indexToDelete) setActiveSongIndex(Math.min(indexToDelete, next.active.length - 1))
    else if (activeSongIndex > indexToDelete) setActiveSongIndex(activeSongIndex - 1)
    setToastMessage(`Moved "${songToDelete.title}" to Trash.`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  const handleBulkDeleteSongs = (ids: Array<string | number>) => {
    const idSet = new Set(ids.map(String))
    const count = songs.filter(song => song.id !== undefined && idSet.has(String(song.id))).length
    if (!count) return
    const next = commitSongLifecycle({ kind: 'trash', ids, blank: createLifecycleBlank() })
    if (!next) return
    setActiveSongIndex(Math.min(activeSongIndex, next.active.length - 1))
    setToastMessage(`Moved ${count} ${count === 1 ? 'song' : 'songs'} to Trash.`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // #149 S2: duplicate check. Re-points setlist refs and moves copies to Trash in one validated commit.
  const handleTrashDuplicates = (ids: string[], repoint: Record<string, string>) => {
    const idSet = new Set(ids)
    const count = songs.filter(song => song.id !== undefined && idSet.has(String(song.id))).length
    if (!count) return false
    let next: ReturnType<typeof commitSongLifecycle>
    try { next = commitSongLifecycle({ kind: 'trash', ids, blank: createLifecycleBlank(), repoint }) } catch { return false }
    if (!next) return false
    setActiveSongIndex(Math.min(activeSongIndex, next.active.length - 1))
    setToastMessage(`Moved ${count} duplicate ${count === 1 ? 'song' : 'songs'} to Trash.`)
    setTimeout(() => setToastMessage(null), 3500)
    return true
  }

  // Bulk add songs to destination setlist
  const handleBulkAddSongsToSetlist = (ids: Array<string | number>, setlistId: string | number) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before modifying setlists.')
      return
    }
    const idSet = new Set(ids.map(String))
    const selectedSongs = songs.filter((s) => s.id !== undefined && idSet.has(String(s.id)))
    const targetSetlist = setlists.find((sl) => String(sl.id) === String(setlistId))
    if (!targetSetlist || selectedSongs.length === 0) return

    setSetlists((prev) =>
      prev.map((sl) => {
        if (String(sl.id) !== String(setlistId)) return sl
        let updated = sl
        for (const song of selectedSongs) {
          updated = setSongMembership(updated, song, true)
        }
        return updated
      })
    )

    setToastMessage(`Added ${selectedSongs.length} ${selectedSongs.length === 1 ? 'song' : 'songs'} to ${targetSetlist.name}`)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Restore song from Trash back to library
  const handleRestoreSong = (id: number | string) => {
    const songToRestore = deletedSongs.find((s) => String(s.id) === String(id))
    if (!songToRestore) return

    if (!commitSongLifecycle({ kind: 'restore', ids: [id] })) return
    const restoredSong = songToRestore

    setToastMessage(`Restored "${restoredSong.title}" to Songbook Library!`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Permanently delete song from Trash
  const handlePermanentDeleteSong = (id: number | string) => {
    const target = deletedSongs.find((s) => String(s.id) === String(id))
    if (!target || !commitSongLifecycle({ kind: 'permanent', ids: [id] })) return
    setToastMessage(`Permanently deleted ${target ? `"${target.title}"` : 'song'}.`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Permanently delete all songs in Trash
  const handleEmptyTrash = () => {
    const count = deletedSongs.length
    if (!commitSongLifecycle({ kind: 'empty' })) return
    setToastMessage(`Trash emptied (${count} songs permanently deleted).`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Create new blank song template and switch to Desktop Editor
  const handleNewSong = () => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before adding songs.')
      return
    }
    const blankSong: ActiveSongState = {
      id: generateUUID(),
      title: 'New Song',
      artist: '',
      key: '',
      capo: 'No Capo',
      bpm: '120',
      format: 'CHORD_PRO',
      transposeOffset: 0,
      rawContent: `{title: New Song}\n{artist: }\n{original_key: }\n{tempo: 120 BPM}\n{time: 4/4}\n{year: }\n\n[Intro]\n\n[Verse 1]\n\n[Chorus]\n`,
    }
    setSongs((prev) => [blankSong, ...prev])
    setActiveSongIndex(0)
    setActiveSetlistId(null)
    setActiveView('editor')
    setIsSetlistDrawerOpen(false)
  }

  const handleSongMembership = (songId: string | number, setlistId: string | number, included: boolean) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before modifying setlists.')
      return false
    }
    if (typeof crossTabConflict !== 'undefined' && crossTabConflict) {
      setToastMessage('Cannot modify setlist while a cross-tab conflict is unresolved.')
      return false
    }
    const song = songs.find(item => String(item.id) === String(songId))
    const setlist = setlists.find(item => String(item.id) === String(setlistId))
    if (!song || song.isDeleted || !setlist || setlist.isDeleted) return false
    const nextSetlists = setlists.map(item => String(item.id) === String(setlistId)
      ? setSongMembership(item, song, included) : item)
    try {
      const expectedBaseline = typeof persistedBaselineRef !== 'undefined' ? persistedBaselineRef.current : undefined
      persistLibrary(
        { songs: [...songs, ...deletedSongs], setlists: nextSetlists },
        localStorage,
        expectedBaseline !== undefined ? { expectedRaw: expectedBaseline } : undefined
      )
      if (typeof persistedBaselineRef !== 'undefined') {
        persistedBaselineRef.current = libraryRevision()
      }
    }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSetlists(nextSetlists)
    setToastMessage(`${included ? 'Added to' : 'Removed from'} ${setlist.name}`)
    setTimeout(() => setToastMessage(null), 3000)
    return true
  }

  const handleCreateSetlistForSong = (songId: string | number, name: string) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before creating setlists.')
      return false
    }
    if (typeof crossTabConflict !== 'undefined' && crossTabConflict) {
      setToastMessage('Cannot modify setlist while a cross-tab conflict is unresolved.')
      return false
    }
    const song = songs.find(item => String(item.id) === String(songId))
    if (!song || song.isDeleted || !name.trim()) return false
    const created = setSongMembership({ id: generateUUID(), name: name.trim(), createdAt: Date.now(), songs: [] }, song, true)
    const nextSetlists = [...setlists, created]
    try {
      const expectedBaseline = typeof persistedBaselineRef !== 'undefined' ? persistedBaselineRef.current : undefined
      persistLibrary(
        { songs: [...songs, ...deletedSongs], setlists: nextSetlists },
        localStorage,
        expectedBaseline !== undefined ? { expectedRaw: expectedBaseline } : undefined
      )
      if (typeof persistedBaselineRef !== 'undefined') {
        persistedBaselineRef.current = libraryRevision()
      }
    }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSetlists(nextSetlists)
    setToastMessage(`Added to ${created.name}`)
    setTimeout(() => setToastMessage(null), 3000)
    return true
  }

  // Create a new setlist
  const handleNewSetlist = () => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before creating setlists.')
      return
    }
    const newId = generateUUID()
    const newSetlistName = `Setlist ${setlists.length + 1}`
    const created: WebSetlist = {
      id: newId,
      name: newSetlistName,
      createdAt: Date.now(),
      songs: [],
    }
    setSetlists((prev) => [...prev, created])
    setActiveSetlistId(newId)
    setActiveSetlistSongIndex(0)
    setQueueMode('setlist')
    setToastMessage(`Created new setlist "${newSetlistName}"`)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Navigate Home (Logo click / Songbook tab opens Songbook Library)
  const handleNavigateHome = useCallback(() => {
    setQueueMode('library')
    setActiveView('songbook')
    setSearchQuery('')
    setIsSetlistDrawerOpen(false)
  }, [setIsSetlistDrawerOpen, setQueueMode, setSearchQuery])

  // Desktop Global Navigation Shortcuts (Alt+1..6, Alt+0/H)
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false
      const tagName = el.tagName.toLowerCase()
      return (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        el.isContentEditable ||
        el.getAttribute('contenteditable') === 'true'
      )
    }

    const handleGlobalNavShortcuts = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isEditable(e.target)) return

      switch (e.key) {
        case '1':
          e.preventDefault()
          navigateSafely(() => setActiveView('stage'))
          break
        case '2':
          e.preventDefault()
          navigateSafely(() => setActiveView('editor'))
          break
        case '3':
          e.preventDefault()
          setIsStageToolsModalOpen(true)
          break
        case '4':
          e.preventDefault()
          void handleTogglePresentation()
          break
        case '5':
          e.preventDefault()
          setIsThemeModalOpen(true)
          break
        case '6':
          e.preventDefault()
          navigateSafely(() => setActiveView('trash'))
          break
        case '0':
        case 'h':
        case 'H':
          e.preventDefault()
          navigateSafely(handleNavigateHome)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleGlobalNavShortcuts)
    return () => window.removeEventListener('keydown', handleGlobalNavShortcuts)
  }, [handleTogglePresentation, handleNavigateHome, setIsStageToolsModalOpen, setIsThemeModalOpen])

  // Update song fields in editor
  const handleUpdateSong = (updated: Partial<ActiveSongState>) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      return false
    }
    const targetId = updated.id ?? currentSong?.id
    const currentPartition =
      typeof importStateRef !== 'undefined' && typeof partitionSongs !== 'undefined'
        ? partitionSongs(importStateRef.current.songs)
        : { active: songs, deleted: deletedSongs }
    const activeSongs = currentPartition.active
    const currentDeletedSongs = currentPartition.deleted
    const currentSetlists =
      typeof importStateRef !== 'undefined' ? importStateRef.current.setlists : setlists
    const isExisting = activeSongs.some(s => String(s.id) === String(targetId))
    if (!isExisting) {
      // Do not auto-save unpersisted new blank song to library
      return false
    }
    if (typeof crossTabConflict !== 'undefined' && crossTabConflict) {
      return false
    }
    const nextSongs = activeSongs.map(s => String(s.id) === String(targetId) ? { ...s, ...updated, id: s.id } : s)
    try {
      const expectedBaseline = typeof persistedBaselineRef !== 'undefined' ? persistedBaselineRef.current : undefined
      persistLibrary(
        { songs: [...nextSongs, ...currentDeletedSongs], setlists: currentSetlists },
        localStorage,
        expectedBaseline !== undefined ? { expectedRaw: expectedBaseline } : undefined
      )
      if (typeof persistedBaselineRef !== 'undefined') {
        persistedBaselineRef.current = libraryRevision()
      }
      if (typeof importStateRef !== 'undefined') {
        importStateRef.current = { songs: [...nextSongs, ...currentDeletedSongs], setlists: currentSetlists }
      }
    }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSongs(nextSongs)
    return true
  }

  // Explicit save also reports persistence failure to the editor.
  const handleSaveSongFromEditor = (incoming: ActiveSongState) => {
    if (typeof unboundReadOnly !== 'undefined' && unboundReadOnly) {
      setToastMessage('This songbook is not linked to an account yet. Link it before saving changes.')
      return false
    }
    // #228: saving the empty-library welcome chart creates a normal new song.
    const updatedSong = String(incoming.id ?? currentSong?.id) === EMPTY_LIBRARY_SONG.id ? { ...incoming, id: generateUUID() } : incoming
    const targetId = updatedSong.id ?? currentSong?.id
    const isExisting = songs.some(s => String(s.id) === String(targetId))
    const nextSongs = isExisting
      ? songs.map(s => String(s.id) === String(targetId) ? { ...s, ...updatedSong, id: s.id } : s)
      : [updatedSong, ...songs]
    if (typeof crossTabConflict !== 'undefined' && crossTabConflict) {
      setToastMessage('Conflict active: Cannot save to storage. Draft remains in memory; export it before closing this tab.')
      return false
    }
    try {
      const expectedBaseline = typeof persistedBaselineRef !== 'undefined' ? persistedBaselineRef.current : undefined
      persistLibrary(
        { songs: [...nextSongs, ...deletedSongs], setlists },
        localStorage,
        expectedBaseline !== undefined ? { expectedRaw: expectedBaseline } : undefined
      )
      if (typeof persistedBaselineRef !== 'undefined') {
        persistedBaselineRef.current = libraryRevision()
      }
    }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSongs(nextSongs)
    if (!isExisting) {
      setActiveSongIndex(0)
    }
    return true
  }

  const handleOpenSharedSetlistInStage = (shared: SharedSetlistPayload) => {
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
    setActiveSetlistId(newSetlist.id)
    setActiveSetlistSongIndex(0)
    setQueueMode('setlist')
    setActiveView('stage')
    setIncomingSharedSetlist(null)
  }

  const handleExportConflictDraft = () => {
    try {
      const backupData = JSON.stringify(getConflictDraft(), null, 2)
      const blob = new Blob([backupData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gtar-conflict-draft-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setToastMessage('Local draft backup exported successfully.')
    } catch {
      setToastMessage('Failed to export draft backup.')
    }
  }

  const handleReloadPersistedLibrary = () => {
    try {
      // Re-verify the exact current draft at discard time; an old snapshot or
      // a download being initiated does not prove that this draft is recoverable.
      saveCrossTabConflictSnapshot(getConflictDraft())
      setConflictRecoverySaved(true)
      const raw = libraryRevision()
      const reloaded = readPersistedLibrary()
      if (!reloaded || libraryRevision() !== raw) throw new Error('Latest library unavailable or changed. Retry reload.')
      persistedBaselineRef.current = raw
      setCrossTabConflict(null)
      const partitioned = partitionSongs(reloaded.songs)
      setSongs(partitioned.active)
      setDeletedSongs(partitioned.deleted)
      setSetlists(reloaded.setlists)
      setToastMessage('Loaded latest library; local draft recovery copy verified.')
    } catch {
      setToastMessage('Reload cancelled: recovery copy or latest library could not be verified. Keep this tab open and export your draft.')
    }
    setTimeout(() => setToastMessage(null), 4000)
  }

  const handleForceOverwriteStorage = () => {
    if (!window.confirm("Replace the current stored library with this tab's edits? The stored version will be preserved in recovery first.")) return
    try {
      const candidate = getConflictDraft()
      const expectedRaw = libraryRevision()
      preserveStoredLibrary(expectedRaw)
      persistLibrary(
        candidate,
        localStorage,
        { expectedRaw }
      )
      persistedBaselineRef.current = libraryRevision()
      const partitioned = partitionSongs(candidate.songs)
      setSongs(partitioned.active)
      setDeletedSongs(partitioned.deleted)
      setSetlists(candidate.setlists)
      setCrossTabConflict(null)
      setToastMessage('Storage overwritten with local edits.')
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err) {
      handleStorageWriteFailure(err)
    }
  }

  return (
    <CatalogImportContext.Provider value={{
      ...catalogImportHost,
      open: id => navigateSafely(() => { handleSelectSetlist(id); setActiveView('stage') }),
    }}>
    {reviewRecovery && <RecoveryReviewDialog
      blocked={() => publicationStateRef.current.blocked() || !same(JSON.parse(JSON.stringify(publicationStateRef.current.getLocal())), readPersistedLibrary())}
      onClose={() => setReviewRecovery(false)} />}
    <div className="min-h-screen flex flex-col bg-app-base text-app-text">
      {/* Unified Android v1.0.44 Top Bar — hidden in stage performance mode */}
      {!isStagePerformanceMode && (
        <Header
          activeView={activeView}
          onViewChange={(view) => navigateSafely(() => setActiveView(view))}
          song={currentSong}
          allSongs={songs}
          songsCount={songs.length}
          deletedSongsCount={deletedSongs.length}
          activeSongIndex={activeSongIndex}
          queueMode={queueMode}
          activeSetlistSongsCount={activeSetlistSongs.length}
          activeSetlistSongIndex={activeSetlistSongIndex}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSelectSearchSong={(songIdx) => {
            navigateSafely(() => { handleSelectLibrarySong(songIdx); setActiveView('stage') })
          }}
          onSearchWebExternal={(query) => {
            setSearchQuery(query)
            setIsWebsiteUrlModalOpen(true)
          }}
          onNavigateHome={() => navigateSafely(handleNavigateHome)}
          onOpenWebsiteUrlSource={() => setIsWebsiteUrlModalOpen(true)}
          onOpenStageTools={() => setIsStageToolsModalOpen(true)}
          onToggleTheme={() => setIsThemeModalOpen(true)}
          onOpenStageSettings={() => setIsStageSettingsModalOpen(true)}
          onOpenImportModal={() => navigateSafely(() => setIsImportModalOpen(true))}
          onOpenBackupRestoreModal={() => navigateSafely(() => setIsBackupRestoreModalOpen(true))}
          onOpenSetlistDrawer={() => navigateSafely(() => setIsSetlistDrawerOpen(true))}
          setlists={setlists}
          activeSetlistId={activeSetlistId}
          activeSetlistName={activeSetlist?.name}
          activeSetlistSongs={activeSetlistSongs}
          onSelectSetlistSong={(id, index) => navigateSafely(() => {
            handleSelectSetlistSong(id, index)
            setActiveView('stage')
          })}
          onSelectSetlist={(id) => navigateSafely(() => handleSelectSetlist(id))}
          onPushSetlistToBandSync={handlePushSetlistToMembers}
          onDirectImportOnlineSong={handleImportOnlineChordSheet}
          onImportSharedCatalogSong={handleSaveSongFromEditor}
          onOpenCast={handleTogglePresentation}
          isCastActive={isCastActive}
          autoSyncBlocked={activeView === 'editor' || Boolean(crossTabConflict)}
          onCloudSyncApplied={(updated) => {
            // #208 F6: adopt what is stored now, not the sync's copy: a save from another surface may have
            // landed after the sync wrote, and the stored library already contains both.
            const stored = readPersistedLibrary() ?? updated
            persistedBaselineRef.current = libraryRevision()
            setCrossTabConflict(null)
            const partition = partitionSongs(stored.songs)
            setSongs(partition.active)
            setDeletedSongs(partition.deleted)
            setSetlists(stored.setlists)
            setToastMessage('Songbook synced with Cloud')
            setTimeout(() => setToastMessage(null), 3500)
          }}
        />
      )}

      {crossTabConflict && (
        <aside
          role="alert"
          aria-label="Cross-tab conflict alert"
          data-testid="cross-tab-conflict-alert"
          className="bg-amber-500 text-black px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md z-40 sticky top-0"
        >
          <div className="flex-1 min-w-[280px]">
            <strong className="block font-semibold">Cross-Tab Storage Conflict:</strong>
            <span className="text-sm">
              The songbook library was updated by another tab. Saving is paused to prevent silent overwrite. Your local edits remain in memory. {conflictRecoverySaved ? 'A recovery snapshot was verified.' : 'Recovery snapshot unavailable; keep this tab open and export your draft.'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              data-testid="conflict-export-draft-button"
              className="bg-black/10 hover:bg-black/20 text-black px-3 py-1.5 rounded font-medium border border-black/20 cursor-pointer"
              onClick={handleExportConflictDraft}
            >
              Export Local Draft
            </button>
            <button
              type="button"
              data-testid="conflict-reload-button"
              className="bg-black/10 hover:bg-black/20 text-black px-3 py-1.5 rounded font-medium border border-black/20 cursor-pointer"
              onClick={handleReloadPersistedLibrary}
            >
              Reload Other Tab's Version
            </button>
            <button
              type="button"
              data-testid="conflict-overwrite-button"
              className="bg-black text-amber-300 hover:bg-black/80 px-3 py-1.5 rounded font-medium cursor-pointer"
              onClick={handleForceOverwriteStorage}
            >
              Overwrite Storage With Local Edits
            </button>
          </div>
        </aside>
      )}

      {unboundReadOnly && (
        <aside
          role="alert"
          aria-label="Unbound library ownership warning"
          data-testid="unbound-library-warning"
          className="bg-amber-100 text-black px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md z-40 sticky top-0 border-b border-amber-300"
        >
          <div className="flex-1 min-w-[280px]">
            <strong className="block font-semibold">Unlinked Device Songbook (Read-Only):</strong>
            <span className="text-sm">
              This songbook is stored on this browser and is not yet linked to an account. Editing is paused to prevent unauthorized modifications. Link it to your account to enable editing.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              data-testid="link-unbound-library-button"
              className="bg-amber-800 text-white hover:bg-amber-900 px-3 py-1.5 rounded font-medium cursor-pointer disabled:opacity-50"
              disabled={isLinkingOwner}
              onClick={handleLinkUnboundLibrary}
            >
              {isLinkingOwner ? 'Linking…' : 'Link to this account'}
            </button>
          </div>
        </aside>
      )}

      {/* Main Workspace: Songbook Library vs Split Desktop Editor vs Trash vs 1:1 Stage View */}
      <main className="flex-1 flex overflow-hidden">
        {activeView === 'songbook' ? (
          <SongbookHomeView
            songs={songs}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            activeSongIndex={activeSongIndex}
            onSelectSong={(songIdx) => {
              handleSelectLibrarySong(songIdx)
              setActiveView('stage')
            }}
            onSongMembershipChange={handleSongMembership}
            onCreateSetlistForSong={handleCreateSetlistForSong}
            onNewSong={handleNewSong}
            onNewSetlist={handleNewSetlist}
            onOpenSetlists={() => {
              navigateSafely(() => {
                setDrawerInitialTab('setlists')
                setIsSetlistDrawerOpen(true)
              })
            }}
            onOpenSongbook={() => {
              navigateSafely(() => {
                setActiveSetlistId(null)
                setDrawerInitialTab('songbook')
                setIsSetlistDrawerOpen(true)
              })
            }}
            onManageSetlist={handleManageSetlist}
            onDeleteSong={handleDeleteSong}
            onDeleteSetlist={handleDeleteSetlist}
            onRenameSetlist={handleRenameSetlist}
            setlists={setlists}
            onSelectSetlistSong={(setlistId, songIdx) => {
              handleSelectSetlistSong(setlistId, songIdx)
              setActiveView('stage')
            }}
            onImportSingleSetlist={handleImportSingleSetlist}
            onBulkDeleteSongs={handleBulkDeleteSongs}
            onBulkAddSongsToSetlist={handleBulkAddSongsToSetlist}
            onBulkDeleteSetlists={handleBulkDeleteSetlists}
            onPublishSetlist={(sl) => setPublishingSetlistId(sl.id)}
            onShareSetlist={(sl) => setSharingSetlist(sl)}
            onImportSharedSetlist={(shared) => setIncomingSharedSetlist(shared)}
            onImportSharedCatalogSong={handleSaveSongFromEditor}
            onOpenImportSongs={() => navigateSafely(() => setIsImportModalOpen(true))}
            onTrashDuplicates={handleTrashDuplicates}
            onUpdateSong={handleUpdateSong}
            confirmedCatalogIds={confirmedCatalogIds}
            freshCatalogIds={freshCatalogIds}
          />
        ) : activeView === 'editor' ? (
          <DesktopEditor
            song={currentSong}
            onUpdateSong={handleUpdateSong}
            onSaveSong={handleSaveSongFromEditor}
            onClose={() => setActiveView('stage')}
            navigationGuardRef={editorNavigationGuard}
            recoveryDraftRef={editorRecoveryDraftRef}
            onLeaveWithSavedChanges={() => {
              setToastMessage('Changes saved')
              setTimeout(() => setToastMessage(current => current === 'Changes saved' ? null : current), 2500)
            }}
            transposeOffset={currentSong.transposeOffset || 0}
            onNewSong={handleNewSong}
          />
        ) : activeView === 'trash' ? (
          <TrashView
            deletedSongs={deletedSongs}
            onRestoreSong={handleRestoreSong}
            onPermanentDeleteSong={handlePermanentDeleteSong}
            onEmptyTrash={handleEmptyTrash}
            onBackToSongbook={() => setActiveView('songbook')}
          />
        ) : (
          <StageErrorBoundary onExitToSongbook={() => setActiveView('songbook')}>
            <StageView
              song={currentSong}
              songs={songs}
              activeSongIndex={activeSongIndex}
              onSelectSongIndex={handleSelectLibrarySong}
              queueMode={queueMode}
              onToggleQueueMode={handleToggleQueueMode}
              isInSetlistMode={isInSetlistMode}
              activeSetlistSongs={activeSetlistSongs}
              activeSetlistSongIndex={activeSetlistSongIndex}
              onSelectSetlistSongIndex={setActiveSetlistSongIndex}
              activeSetlistName={activeSetlist?.name}
              setlists={setlists}
              onSelectSetlist={(id) => navigateSafely(() => handleSelectSetlist(id))}
              onOpenSetlistDrawer={() => navigateSafely(() => setIsSetlistDrawerOpen(true))}
              isSetlistDrawerOpen={isSetlistDrawerOpen}
              isStageSettingsModalOpen={isStageSettingsModalOpen}
              isAnyModalOpen={
                isSetlistDrawerOpen ||
                isStageSettingsModalOpen ||
                isStageToolsModalOpen ||
                isThemeModalOpen ||
                isWebsiteUrlModalOpen ||
                isImportModalOpen ||
                isBackupRestoreModalOpen ||
                isJsonModalOpen ||
                isHeaderKeyPickerOpen ||
                isTvPresentationModalOpen
              }
              onBack={() => setActiveView('songbook')}
              transposeOffset={currentSong.transposeOffset || 0}
              onTransposeChange={handleTransposeChange}
              fontStyle={fontStyle}
              onSelectFontStyle={setFontStyle}
              isTwoColumn={isTwoColumn}
              onToggleTwoColumn={setIsTwoColumn}
              onOpenBandSync={() => setIsStageToolsModalOpen(true)}
              onPerformanceModeChange={setIsStagePerformanceMode}
            />
          </StageErrorBoundary>
        )}
      </main>

      {/* Slide-over Setlist / Library Drawer with Opt-in Edge Swipe Coordination */}
      <EdgeSwipePanelCoordinator
        enabled={isEdgeSwipePanelEnabled}
        isOpen={isSetlistDrawerOpen}
        onOpen={() => setIsSetlistDrawerOpen(true)}
        onClose={() => setIsSetlistDrawerOpen(false)}
      >
        {({ drawerStyle, backdropStyle, drawerTouchHandlers }) => (
          <SetlistDrawer
            isOpen={isSetlistDrawerOpen}
            confirmedCatalogIds={confirmedCatalogIds}
            freshCatalogIds={freshCatalogIds}
            initialTab={drawerInitialTab}
            drawerStyle={drawerStyle}
            backdropStyle={backdropStyle}
            drawerTouchHandlers={drawerTouchHandlers}
            onClose={() => setIsSetlistDrawerOpen(false)}
            songs={songs}
            activeSongIndex={activeSongIndex}
            onSelectSongIndex={(idx) => {
              navigateSafely(() => {
                handleSelectLibrarySong(idx)
                setActiveView('stage')
                setIsSetlistDrawerOpen(false)
              })
            }}
            setlists={setlists}
            activeSetlistId={activeSetlistId}
            activeSetlistSongIndex={activeSetlistSongIndex}
            onSelectSetlistSong={(setlistId, songIdx) => {
              navigateSafely(() => {
                handleSelectSetlistSong(setlistId, songIdx)
                setActiveView('stage')
                setIsSetlistDrawerOpen(false)
              })
            }}
            onReorderSetlistSong={handleReorderSetlistSong}
            onRemoveSetlistSong={handleRemoveSetlistSong}
            onDeleteSetlist={handleDeleteSetlist}
            onDeleteSong={handleDeleteSong}
            onSongMembershipChange={handleSongMembership}
            onCreateSetlistForSong={handleCreateSetlistForSong}
            onNewSong={handleNewSong}
            onNewSetlist={handleNewSetlist}
            onImportSingleSetlist={handleImportSingleSetlist}
            onSmartMerge={handleSmartMerge}
            onExportAllData={() => exportAllDataJson([...songs, ...deletedSongs], setlists)}
            onPublishSetlist={(sl) => setPublishingSetlistId(sl.id)}
            onShareSetlist={(sl) => setSharingSetlist(sl)}
          />
        )}
      </EdgeSwipePanelCoordinator>

      {/* Stage Color Theme Modal */}
      <ThemeModal
        isOpen={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
        currentTheme={stageTheme}
        customColors={customThemeColors}
        onApplyTheme={(theme, colors) => {
          setStageTheme(theme)
          if (theme === 'custom' && colors) {
            setCustomThemeColors(colors)
          }
        }}
        onSelectTheme={(theme) => setStageTheme(theme)}
      />

      {/* Website URL Source Modal */}
      <WebsiteUrlSourceModal
        isOpen={isWebsiteUrlModalOpen}
        onClose={() => setIsWebsiteUrlModalOpen(false)}
      />

      {/* Import Modal Dialog (File Import & Folder Batch) */}
      {importDialogMounted && <Suspense fallback={null}><ImportDialogModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSong={handleImportSong}
        onImportAllSongs={handleImportAllSongs}
        onImportSingleSetlist={handleImportSingleSetlist}
        onSmartMerge={handleSmartMerge}
        existingSongs={[...songs, ...deletedSongs]}
        existingSetlists={setlists}
      /></Suspense>}

      {/* Backup & Restore Modal Dialog (Export Backup & Restore Backup Smart Merge) */}
      <BackupRestoreDialogModal
        isOpen={isBackupRestoreModalOpen}
        onClose={() => setIsBackupRestoreModalOpen(false)}
        currentSong={currentSong}
        allSongs={backupDialogSongs}
        setlists={setlists}
        onImportAllSongs={handleImportAllSongs}
        onFullRestore={handleFullRestore}
        onSmartMerge={handleSmartMerge}
        onOpenAdvancedBridge={() => setIsJsonModalOpen(true)}
      />

      {/* Stage Settings Modal */}
      <StageSettingsModal
        isOpen={isStageSettingsModalOpen}
        onClose={() => setIsStageSettingsModalOpen(false)}
        fontStyle={fontStyle}
        onSelectFontStyle={setFontStyle}
        isTwoColumn={isTwoColumn}
        onToggleTwoColumn={setIsTwoColumn}
        edgeSwipePanel={isEdgeSwipePanelEnabled}
        onToggleEdgeSwipePanel={setIsEdgeSwipePanelEnabled}
        onOpenStageTools={() => {
          setIsStageSettingsModalOpen(false)
          setIsStageToolsModalOpen(true)
        }}
        onToggleTheme={() => {
          setIsStageSettingsModalOpen(false)
          setIsThemeModalOpen(true)
        }}
        onExportAllData={() => exportAllDataJson([...songs, ...deletedSongs], setlists)}
        onOpenBackupRestoreModal={() => {
          setIsStageSettingsModalOpen(false)
          setIsBackupRestoreModalOpen(true)
        }}
      />

      {/* Stage Tools & Band Sync Modal */}
      <BandSyncModal
        isOpen={isStageToolsModalOpen}
        onClose={() => setIsStageToolsModalOpen(false)}
        initialTab="sync"
        onPushSetlist={handlePushSetlistToMembers}
        activeSetlistName={activeSetlist?.name}
        activeSetlistSongCount={activeSetlistSongs.length}
      />

      {/* Advanced JSON Bridge Modal */}
      <JsonBridgeModal
        isOpen={isJsonModalOpen}
        initialTab="export"
        setlists={setlists}
        onSmartMerge={handleSmartMerge}
        onClose={() => setIsJsonModalOpen(false)}
        song={currentSong}
        allSongs={[...songs, ...deletedSongs]}
        onImportSong={handleImportSong}
        onImportAllSongs={handleImportAllSongs}
      />

      {/* Header Key Picker Modal */}
      <KeyPickerModal
        isOpen={isHeaderKeyPickerOpen}
        onClose={() => setIsHeaderKeyPickerOpen(false)}
        song={currentSong}
        currentOffset={currentSong.transposeOffset || 0}
        onSelectOffset={handleTransposeChange}
        onReset={() => handleTransposeChange(transposeContext(currentSong, currentSong.transposeOffset || 0).resetOffset)}
      />

      {/* Wireless TV / External Display Presentation Pairing Modal */}
      <TvPresentationModal
        isOpen={isTvPresentationModalOpen}
        onClose={() => setIsTvPresentationModalOpen(false)}
      />

      {publishingSetlistId !== null && (
        <PublishSetlistModal sourceId={publishingSetlistId}
          getLocal={() => publicationStateRef.current.getLocal()}
          blocked={() => publicationStateRef.current.blocked()}
          onClose={() => setPublishingSetlistId(null)} />
      )}
      {/* Share Setlist QR Code Modal */}
      {sharingSetlist && (
        <ShareSetlistModal
          setlist={sharingSetlist}
          allSongs={[...songs, ...deletedSongs]}
          onClose={() => setSharingSetlist(null)}
        />
      )}

      {/* Import Shared Setlist Preview Modal */}
      {incomingSharedSetlist && (
        <ImportSharedSetlistModal
          sharedSetlist={incomingSharedSetlist}
          onImport={handleImportSharedSetlist}
          onOpenStage={handleOpenSharedSetlistInStage}
          onClose={() => setIncomingSharedSetlist(null)}
        />
      )}

      {/* Global Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className={`px-4 py-2.5 rounded-xl bg-app-base border text-app-heading text-xs font-bold shadow-2xl flex items-center gap-2 max-w-md text-center ${
            /fail|quota|warn|error|conflict|cannot|may not/i.test(toastMessage)
              ? 'border-[#CB4B16]'
              : 'border-app-action'
          }`}>
            <span className={`w-2 h-2 rounded-full shrink-0 animate-pulse ${
              /fail|quota|warn|error|conflict|cannot|may not/i.test(toastMessage)
                ? 'bg-[#CB4B16]'
                : 'bg-[#10B981]'
            }`} />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
    </CatalogImportContext.Provider>
  )
}

export default App
