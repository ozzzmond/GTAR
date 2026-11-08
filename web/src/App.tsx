import { SetlistTrashConfirmation } from './components/SetlistTrashConfirmation'
import { ExplorerDragDrop } from './components/ExplorerDragDrop'
import { TagLibraryContext } from './utils/tagLibraryContext'
import { changeTagColorKey, validTagColors, type TagColors } from './utils/songTags'
import { bindLegacySetlists } from './utils/setlistSongs'
import { deleteSetlistFolder, validateFolderParentChange } from './utils/folders'
import { normalizeTags, songHasTag, renameTagInList, removeTagFromList } from './utils/songTags'
import { RecoveryDataPanel } from './components/RecoveryDataPanel'
import { SetlistManager } from './components/SetlistManager'
import { OPEN_RECOVERY_DATA_EVENT } from './utils/recoveryReview'
import { isPresentationLocation } from './utils/presentationRoute'
import { transposeContext } from './utils/songKeySemantics'
import { parseBandSetlist } from './utils/bandSetlistImport'
import {
  libraryRevision,
  reloadLibraryRevision,
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
  recoveryExportData,
  isLibraryStoreActive,
  LIBRARY_STORE_MIGRATED_KEY,
} from './utils/syncJournal'
import { exportOldRecoveryData, useOldRecoveryData } from './utils/recoveryExport'
import { prepareRecoveryArchives, recoveryArchiveBackend, recoveryArchivesInIndexedDb } from './utils/recoveryArchiveStore'
import { appLogger } from './utils/logger'
import { useLibraryPersistence } from './utils/useLibraryPersistence'
import { useLibraryImports } from './utils/useLibraryImports'
import { useAppModals } from './utils/useAppModals'
import { deduplicateLibrary } from './utils/syncMerge'
import { generateUUID } from './utils/uuid'
import { normalizeSongbookIds } from './utils/songbookFoundation'
import {
  SETTINGS_KEYS,
  SETTINGS_CHANGED,
  readBackupSettings,
  loadThemeModeAssignments,
  isLightTheme,
} from './utils/backupSettings'
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
import { KeyPickerModal } from './components/KeyPickerModal'
import { ExplorerNavigation } from './components/ExplorerNavigation'
import type { ExplorerTarget } from './components/MusicExplorerNav'
import { getStoredSessionStatus } from './utils/googleAuth'
import { useOptionalGoogleAuth } from './utils/authContext'
import { ShareSetlistModal } from './components/ShareSetlistModal'
import { ImportSharedSetlistModal } from './components/ImportSharedSetlistModal'
import type { SharedSetlistPayload } from './utils/sharedSetlist'
import { WebsiteUrlSourceModal } from './components/WebsiteUrlSourceModal'
import type { SongFontStyleOption } from './components/StageSettingsModal'
import { StageErrorBoundary } from './components/StageErrorBoundary'
import {
  ThemeModal,
  type ThemeMode,
  type CustomThemeColors,
  type ThemeModeAssignments,
  type ThemeModeRole,
  applyThemeRuntime,
  hydrateThemeSettings,
} from './components/ThemeModal'
import { BandSyncModal } from './components/BandSyncModal'
import { TvPresentationModal } from './components/TvPresentationModal'
import { stageCast2Enabled } from './utils/stageCast2Local'
import { stageCast } from './utils/stageCast'
import { bandSync } from './utils/bandSync'
import { detectSongKey } from './utils/songParser'
import type { ActiveSongState, WebSetlist, SetlistFolder } from './types/gtar'
import type { FetchedChordSheet } from './utils/onlineSearch'
import { isDevEnv } from './utils/env'
import { buildViewHistoryState, isGtarViewHistoryState } from './utils/viewHistory'

// The import dialog pulls in ChordSheetJS (~230 KB); load it only when first opened (#85).
const ImportDialogModal = lazy(() => import('./components/ImportDialogModal').then(m => ({ default: m.ImportDialogModal })))

export type { WebSetlist } from './types/gtar'

function App() {
  const isPresentationRoute =
    typeof window !== 'undefined' && isPresentationLocation(window.location)

  if (isPresentationRoute) {
    return <StagePresentationView />
  }
  return <LibraryStartup />
}

// #167 B1c (DEV): recovery archives load from IndexedDB before anything reads recovery state.
// #300 B3 (DEV and PROD): the library opens from IndexedDB,
// moved there once from the earlier storage, before the library renders.
const needsArchiveStartup = () => isDevEnv && typeof indexedDB !== 'undefined' && !recoveryArchivesInIndexedDb()
const LIBRARY_STORE_ENABLED = true
const needsLibraryStartup = () => LIBRARY_STORE_ENABLED &&
  (typeof indexedDB !== 'undefined' || localStorage.getItem(LIBRARY_STORE_MIGRATED_KEY) === '1')
function LibraryStartup() {
  const [ready, setReady] = useState(() => !needsArchiveStartup() && !needsLibraryStartup())
  const [storageNotice, setStorageNotice] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  useEffect(() => {
    if (ready) return
    let live = true
    const startup = async () => {
      if (needsArchiveStartup()) {
        await prepareRecoveryArchives(recoveryArchiveBackend(), localStorage, (level, message) => appLogger[level]('RecoveryArchives', message))
          .catch((error: unknown) => appLogger.warn('RecoveryArchives', 'IndexedDB unavailable; archives stay in localStorage', error instanceof Error ? error.message : String(error)))
      }
      // Without IndexedDB, only devices that have never migrated may use legacy storage.
      if (!needsLibraryStartup()) return
      const prepared = await prepareLibraryStorage()
      if (prepared.active) appLogger.info('LibraryStore', `Library ready in ${prepared.ms} ms: ${prepared.songs} songs, ${prepared.setlists} setlists${prepared.migrated ? ` (moved from ${prepared.source})` : ''}`)
      else if (live) {
        // #300 review: after the move to IndexedDB, an unreadable start must not show or write the
        // frozen gtar_library_v1. The library is not loaded: only the error and a recovery export.
        if (prepared.blocked) setBlocked(prepared.error ?? 'The songbook could not be opened from the new device storage.')
        else setStorageNotice(prepared.readOnly
          ? `Your songbook could not be moved to the new device storage (${prepared.error}). It is shown read-only so nothing is lost: export a backup, then reload to retry.`
          : `Your songbook could not be moved to the new device storage (${prepared.error}). The earlier storage stays in use and nothing was changed; reload to retry.`)
      }
    }
    startup().catch(() => undefined).finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [ready])
  if (!ready) return <p role="status" className="p-4 text-app-muted">Loading library…</p>
  if (blocked) return <>
    <aside role="alert" data-testid="library-store-blocked" className="p-4 bg-amber-100 text-black">{blocked}</aside>
    <div className="p-4">
      <button className="underline cursor-pointer" onClick={() => { exportOldRecoveryData().catch(() => undefined) }}>Export recovery data</button>
    </div>
  </>
  return <>
    {storageNotice && <aside role="alert" data-testid="library-store-fallback" className="p-4 bg-amber-100 text-black">{storageNotice}</aside>}
    <OldRecoveryExportPrompt />
    <LibraryStartupReadyInner />
  </>
}

/** #300: once, after the move to IndexedDB, offer an export of the old recovery archives (kept read-only, never deleted). */
const OLD_RECOVERY_PROMPT_KEY = 'gtar_old_recovery_prompted_v1'
function OldRecoveryExportPrompt() {
  const old = useOldRecoveryData()
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(OLD_RECOVERY_PROMPT_KEY) !== null } catch { return true } })
  if (!LIBRARY_STORE_ENABLED || dismissed || !old.exists || old.exported || !isLibraryStoreActive()) return null
  const close = () => { try { localStorage.setItem(OLD_RECOVERY_PROMPT_KEY, String(Date.now())) } catch { /* shown again next time */ } setDismissed(true) }
  return <aside role="status" data-testid="old-recovery-export-prompt" className="p-4 bg-amber-100 text-black flex flex-wrap items-center justify-between gap-3">
    <span className="flex-1 min-w-0">Your songbook now lives in the new device storage. Old recovery copies are kept on this device, read-only. Export them once to keep a copy elsewhere.</span>
    <span className="flex gap-3">
      <button className="underline cursor-pointer" onClick={() => { exportOldRecoveryData().then(close, () => undefined) }}>Export old recovery data</button>
      <button className="underline cursor-pointer" onClick={close}>Not now</button>
    </span>
  </aside>
}
function LibraryStartupReadyInner() {
  const [repairPreview, setRepairPreview] = useState<DanglingReferenceRepair | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [status, setStatus] = useState(() => { performStorageHousekeeping(); return checkRecovery() })
  useEffect(() => {
    // #300: with large IndexedDB libraries a full recovery review per save is costly; coalesce bursts of saves.
    let timer: ReturnType<typeof setTimeout> | null = null
    const refreshNow = () => setStatus(checkRecovery())
    const refresh = () => {
      if (!isLibraryStoreActive()) { refreshNow(); return }
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
    try {
      applyDanglingReferenceRepair(repairPreview)
      setRepairPreview(null)
      setRepairError(null)
      setStatus(checkRecovery())
    } catch (err) { setRepairError(err instanceof Error ? err.message : 'Repair failed. Original data remains available for export.') }
  }
  // #181: only a damaged library gets the full-width alert (the app cannot load). Unreadable recovery
  // copies are flagged on the profile menu row "Recovery data" (#304).
  return <>
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
  const [recoveryDataOpen, setRecoveryDataOpen] = useState(false)
  // #303: Backup & Restore center / debug logs are owned by the header; Stage shortcuts pause while they are open.
  const [isHeaderOverlayOpen, setIsHeaderOverlayOpen] = useState(false)
  useEffect(() => {
    const open = () => setRecoveryDataOpen(true)
    window.addEventListener(OPEN_RECOVERY_DATA_EVENT, open)
    return () => window.removeEventListener(OPEN_RECOVERY_DATA_EVENT, open)
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
      return { ...partitionSongs(savedLibrary.songs), setlists: bindLegacySetlists(savedLibrary.setlists, savedLibrary.songs), folders: savedLibrary.folders ?? [], tagColors: savedLibrary.tagColors }
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
    return { ...partitionSongs(migrated.songs), setlists: bindLegacySetlists(migrated.setlists, migrated.songs), folders: migrated.folders ?? [], tagColors: migrated.tagColors }
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
  const [trashSetlistId, setTrashSetlistId] = useState<string | number | null>(null)
  const [trashDropIds, setTrashDropIds] = useState<Array<string | number> | null>(null)
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
  const [tagColors, setTagColors] = useState<TagColors | undefined>(initialLibrary.tagColors)
  const [folders, setFolders] = useState<SetlistFolder[]>(initialLibrary.folders)
  const [setlists, setSetlists] = useState<WebSetlist[]>(initialLibrary.setlists)

  const editorRecoveryDraftRef = useRef<(() => ActiveSongState | null) | null>(null)

  // Stage Color Theme (persisted in localStorage)
  const [stageTheme, setStageTheme] = useState<ThemeMode>(() => hydrateThemeSettings().mode)

  // Only standalone Custom Palette lives here; factory overrides use their own slots.
  const [customThemeColors, setCustomThemeColors] = useState<CustomThemeColors>(() => hydrateThemeSettings().standalone)

  // Light/Dark theme mode assignments
  const [themeAssignments, setThemeAssignments] = useState<ThemeModeAssignments>(() => loadThemeModeAssignments())

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

  useEffect(() => {
    const reloadSettings = () => {
      const settings = readBackupSettings()
      // Hydration also upgrades legacy active-palette backups to separate storage.
      const hydrated = hydrateThemeSettings()
      applyThemeRuntime(hydrated.mode, hydrated.standalone)
      setStageTheme(hydrated.mode)
      setCustomThemeColors(hydrated.standalone)
      setThemeAssignments(loadThemeModeAssignments())
      if (settings.stageSettings?.fontStyle !== undefined) setFontStyle(settings.stageSettings.fontStyle)
      if (settings.stageSettings?.isTwoColumn !== undefined) setIsTwoColumn(settings.stageSettings.isTwoColumn)
    }
    window.addEventListener(SETTINGS_CHANGED, reloadSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED, reloadSettings)
  }, [])

  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail
      if (typeof msg === 'string' && msg) {
        setToastMessage(msg)
        setTimeout(() => setToastMessage(current => current === msg ? null : current), 3500)
      }
    }
    window.addEventListener('gtar:toast', handleToastEvent)
    return () => window.removeEventListener('gtar:toast', handleToastEvent)
  }, [])
  // #85 slice 1: baseline, cross-tab guard, unload guard and persistence live in one hook.
  const {
    persistedBaselineRef, crossTabConflict, setCrossTabConflict, conflictRecoverySaved, setConflictRecoverySaved,
    getConflictDraft, handleStorageWriteFailure,
  } = useLibraryPersistence({ songs, deletedSongs, setlists, folders, tagColors, setTagColors, setFolders, setSongs, setDeletedSongs, setSetlists, setToastMessage, editorRecoveryDraftRef })

  // #257 F3: a stable array, so the backup dialog re-checks "changed since backup" only when the library really changes.
  const backupDialogSongs = useMemo(() => [...songs, ...deletedSongs], [songs, deletedSongs])

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

  // Apply theme to document.body and persist
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEYS.themeMode, stageTheme)
    } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }

    const appliedPalette = applyThemeRuntime(stageTheme, customThemeColors)
    stageCast.setThemeSnapshot(stageTheme, appliedPalette)
  }, [stageTheme, customThemeColors])

  const handleToggleThemeMode = useCallback(() => {
    const assignments = loadThemeModeAssignments()
    setThemeAssignments(assignments)
    let targetRole: ThemeModeRole
    if (stageTheme === assignments.light) {
      targetRole = 'dark'
    } else if (stageTheme === assignments.dark) {
      targetRole = 'light'
    } else {
      targetRole = isLightTheme(stageTheme, customThemeColors) ? 'dark' : 'light'
    }
    const nextTheme = targetRole === 'light' ? assignments.light : assignments.dark
    setStageTheme(nextTheme)
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
  const [isStageToolsModalOpen, setIsStageToolsModalOpen] = modals.stageTools
  const [isThemeModalOpen, setIsThemeModalOpen] = modals.theme
  const [isHeaderKeyPickerOpen, setIsHeaderKeyPickerOpen] = modals.headerKeyPicker

  const [isSetlistDrawerOpen, setIsSetlistDrawerOpen] = modals.setlistDrawer
  const [explorerSelection, setExplorerSelection] = useState<ExplorerTarget>({ type: 'ALL_SONGS' })
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
      if (!authToken || auth.isExpired || !authContext?.session || authContext.accessStatus !== 'active') {
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
    songs, deletedSongs, setlists, folders, tagColors, setTagColors, setFolders, setSongs, setDeletedSongs, setSetlists, persistedBaselineRef, setCrossTabConflict,
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

  const handleManageSetlist = (setlist: WebSetlist) => openSetlistManager(setlist)

  // #312 S2 (DEV): GTAR1 Setlist Manager. Each change is one guarded write (stale-write guard);
  // a handler returns false and reports the failure when nothing was saved.
  const [isSetlistManagerOpen, setIsSetlistManagerOpen] = useState(false)
  const [setlistManagerId, setSetlistManagerId] = useState<string | number | null>(null)
  const [setlistManagerOpener, setSetlistManagerOpener] = useState<HTMLElement | null>(null)
  const openSetlistManager = (setlist: WebSetlist | null) => navigateSafely(() => {
    // Focus returns here on close; a menu item is gone by then, so use its menu button.
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSetlistManagerOpener(active?.closest('[role="menu"]')
      ? document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]')
      : active)
    setSetlistManagerId(setlist?.id ?? setlists.find(sl => !sl.isDeleted)?.id ?? null)
    setIsSetlistDrawerOpen(false)
    setIsSetlistManagerOpen(true)
  })
  const commitManagedSetlists = (nextSetlists: WebSetlist[], message: string, nextFolders = folders) => {
    if (crossTabConflict) {
      setToastMessage('Cannot modify setlist while a cross-tab conflict is unresolved.')
      return false
    }
    try {
      const expectedBaseline = persistedBaselineRef.current
      persistLibrary(
        { tagColors, folders: nextFolders, songs: [...songs, ...deletedSongs], setlists: bindLegacySetlists(nextSetlists, songs) },
        localStorage,
        expectedBaseline !== undefined ? { expectedRaw: expectedBaseline } : undefined
      )
      persistedBaselineRef.current = libraryRevision()
    }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSetlists(bindLegacySetlists(nextSetlists, songs))
    setFolders(nextFolders)
    setToastMessage(message)
    setTimeout(() => setToastMessage(null), 3000)
    return true
  }
  const handleSetlistFolderChange = (id: string | number, folderId: string | null) => {
    const target = managedSetlist(id)
    return !!target && commitManagedSetlists(replaceSetlist({ ...target, folderId }), 'Setlist folder saved')
  }
  const handleSaveFolder = (folder: SetlistFolder) => {
    if (!folder.name.trim() || !validateFolderParentChange(folders, folder.id, folder.parentId)) return false
    const next = folders.some(item => item.id === folder.id) ? folders.map(item => item.id === folder.id ? folder : item) : [...folders, folder]
    return commitManagedSetlists(setlists, 'Folder saved', next)
  }
  const handleDeleteFolder = (id: string) => {
    const next = deleteSetlistFolder(folders, setlists, id)
    if (!commitManagedSetlists(next.setlists, 'Folder deleted; setlists moved to Unfiled', next.folders)) return false
    if (explorerSelection.type === 'FOLDER' && explorerSelection.folderId === id) setExplorerSelection({ type: 'UNFILED_SETLISTS' })
    return true
  }
  const handleChangeTag = (tag: string, renamed?: string) => {
    if (crossTabConflict) return false
    if (renamed !== undefined && normalizeTags([renamed]).length !== 1) return false
    const update = (song: ActiveSongState) => songHasTag(song.tags, tag) ? { ...song, tags: renamed === undefined ? removeTagFromList(song.tags, tag) : renameTagInList(song.tags, tag, renamed) } : song
    const nextSongs = songs.map(update), nextDeleted = deletedSongs.map(update)
    try {
      persistLibrary({ songs: [...nextSongs, ...nextDeleted], setlists, folders, tagColors: changeTagColorKey(tagColors ?? {}, tag, renamed) }, localStorage, { expectedRaw: persistedBaselineRef.current })
      persistedBaselineRef.current = libraryRevision()
    } catch (err) { handleStorageWriteFailure(err); return false }
    setTagColors(changeTagColorKey(tagColors ?? {}, tag, renamed))
    setSongs(nextSongs); setDeletedSongs(nextDeleted)
    if (explorerSelection.type === 'TAG' && explorerSelection.tag === tag) setExplorerSelection(renamed === undefined ? { type: 'ALL_SONGS' } : { type: 'TAG', tag: normalizeTags([renamed])[0] })
    return true
  }
  const handleTagColor = (tag: string, color?: string) => {
    const next = { ...tagColors }
    if (color === undefined) delete next[tag]
    else Object.defineProperty(next, tag, { value: color, enumerable: true, writable: true, configurable: true })
    if (crossTabConflict || !validTagColors(next)) return false
    try {
      persistLibrary({ songs: [...songs, ...deletedSongs], setlists, folders, tagColors: next }, localStorage, { expectedRaw: persistedBaselineRef.current })
      persistedBaselineRef.current = libraryRevision()
      setTagColors(next)
      return true
    } catch (err) { handleStorageWriteFailure(err); return false }
  }
  const handleBulkAddToTag = (ids: Array<string | number>, tag: string) => {
    const canonical = normalizeTags([tag])
    if (crossTabConflict || canonical.length !== 1 || !canonical[0]) return false
    const selected = new Set(ids.map(String))
    const nextSongs = songs.map((song, index) => selected.has(String(song.id ?? index)) ? { ...song, tags: normalizeTags([...normalizeTags(song.tags), canonical[0]]) } : song)
    try {
      persistLibrary({ songs: [...nextSongs, ...deletedSongs], setlists, folders, tagColors }, localStorage, { expectedRaw: persistedBaselineRef.current })
      persistedBaselineRef.current = libraryRevision()
      setSongs(nextSongs)
      return true
    } catch (err) { handleStorageWriteFailure(err); return false }
  }
  const managedSetlist = (setlistId: string | number) => setlists.find(sl => String(sl.id) === String(setlistId) && !sl.isDeleted)
  const replaceSetlist = (next: WebSetlist) => setlists.map(sl => String(sl.id) === String(next.id) ? next : sl)
  // Same semantics as handleBulkAddSongsToSetlist (setSongMembership: no duplicates), in the given order.
  const handleManagerAddSongs = (setlistId: string | number, ids: Array<string | number>) => {
    const target = managedSetlist(setlistId)
    const picked = ids.map(id => songs.find(s => s.id !== undefined && !s.isDeleted && String(s.id) === String(id)))
      .filter((s): s is ActiveSongState => Boolean(s))
    if (!target || picked.length === 0) return false
    const updated = picked.reduce((sl, song) => setSongMembership(sl, song, true), target)
    const added = updated.songs.length - target.songs.length
    if (added === 0) return true
    return commitManagedSetlists(replaceSetlist(updated), `Added ${added} ${added === 1 ? 'song' : 'songs'} to ${target.name}`)
  }
  const handleManagerRename = (setlistId: string | number, name: string) => {
    const target = managedSetlist(setlistId)
    const trimmed = name.trim()
    if (!target || !trimmed) return false
    return commitManagedSetlists(replaceSetlist({ ...target, name: trimmed }), `Renamed setlist to "${trimmed}"`)
  }
  const handleManagerDelete = (setlistId: string | number) => {
    const target = managedSetlist(setlistId)
    if (!target || !commitManagedSetlists(replaceSetlist({ ...target, isDeleted: true }), `Deleted "${target.name}"`)) return false
    if (String(activeSetlistId) === String(setlistId)) {
      setActiveSetlistId(null)
      setQueueMode('library')
    }
    setSetlistManagerId(null)
    return true
  }
  const handleManagerMove = (setlistId: string | number, index: number, direction: 'up' | 'down') => {
    const target = managedSetlist(setlistId)
    const to = direction === 'up' ? index - 1 : index + 1
    if (!target || index < 0 || index >= target.songs.length || to < 0 || to >= target.songs.length) return false
    const reordered = [...target.songs]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(to, 0, moved)
    if (!commitManagedSetlists(replaceSetlist({ ...target, songs: reordered }), `Moved "${moved.title}" ${direction}`)) return false
    if (String(activeSetlistId) === String(setlistId)) {
      if (activeSetlistSongIndex === index) setActiveSetlistSongIndex(to)
      else if (activeSetlistSongIndex === to) setActiveSetlistSongIndex(index)
    }
    return true
  }
  const handleManagerRemove = (setlistId: string | number, index: number) => {
    const target = managedSetlist(setlistId)
    if (!target || index < 0 || index >= target.songs.length) return false
    const removed = target.songs[index]
    if (!commitManagedSetlists(replaceSetlist({ ...target, songs: target.songs.filter((_, i) => i !== index) }), `Removed "${removed.title}"`)) return false
    if (String(activeSetlistId) === String(setlistId) && activeSetlistSongIndex >= index && activeSetlistSongIndex > 0) {
      setActiveSetlistSongIndex(activeSetlistSongIndex - 1)
    }
    return true
  }

  // Music Explorer navigation (#319): the selection drives the single GTAR1 Songbook view.
  const handleExplorerSelect = (target: ExplorerTarget) => {
    setIsSetlistDrawerOpen(false)
    navigateSafely(() => {
      setExplorerSelection(target)
      setActiveView('songbook')
    })
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
    if (typeof crossTabConflict !== 'undefined' && crossTabConflict) {
      setToastMessage('Cannot modify library while a cross-tab conflict is unresolved.')
      return null
    }
    const next = transitionSongLibrary({ active: songs, deleted: deletedSongs,
      setlists: operation.kind === 'empty' ? setlists.filter(setlist => !setlist.isDeleted) : setlists }, operation)
    try {
      const expectedBaseline = typeof persistedBaselineRef !== 'undefined' ? persistedBaselineRef.current : undefined
      persistLibrary(
        { tagColors, folders, songs: [...next.active, ...next.deleted], setlists: next.setlists },
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

  const deletedSetlists = setlists.filter(setlist => setlist.isDeleted)
  const handleRestoreSetlist = (id: number | string) => {
    const target = deletedSetlists.find(setlist => String(setlist.id) === String(id))
    if (!target) return
    const folderId = folders.some(folder => folder.id === target.folderId) ? target.folderId : null
    commitManagedSetlists(replaceSetlist({ ...target, isDeleted: false, folderId }), `Restored "${target.name}"`)
  }
  const handlePermanentDeleteSetlist = (id: number | string) => {
    const target = deletedSetlists.find(setlist => String(setlist.id) === String(id))
    if (!target) return
    commitManagedSetlists(setlists.filter(setlist => String(setlist.id) !== String(id)), `Permanently deleted "${target.name}"`)
  }

  // Permanently delete all songs and setlists in Trash in one guarded write
  const handleEmptyTrash = () => {
    const count = deletedSongs.length
    const setlistCount = deletedSetlists.length
    if (!commitSongLifecycle({ kind: 'empty' })) return
    setToastMessage(`Trash emptied (${count} songs and ${setlistCount} setlists permanently deleted).`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Create new blank song template and switch to Desktop Editor
  const handleNewSong = () => {
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
        { tagColors, folders, songs: [...songs, ...deletedSongs], setlists: nextSetlists },
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
        { tagColors, folders, songs: [...songs, ...deletedSongs], setlists: nextSetlists },
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
    const newId = generateUUID()
    const newSetlistName = `Setlist ${setlists.length + 1}`
    const created: WebSetlist = {
      id: newId,
      name: newSetlistName,
      folderId: explorerSelection.type === 'FOLDER' ? explorerSelection.folderId : null,
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
  }, [setIsSetlistDrawerOpen])

  // Update song fields in editor
  const handleUpdateSong = (updated: Partial<ActiveSongState>) => {
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
        { tagColors, folders, songs: [...nextSongs, ...currentDeletedSongs], setlists: currentSetlists },
        localStorage,
        expectedBaseline !== undefined ? { expectedRaw: expectedBaseline } : undefined
      )
      if (typeof persistedBaselineRef !== 'undefined') {
        persistedBaselineRef.current = libraryRevision()
      }
      if (typeof importStateRef !== 'undefined') {
        importStateRef.current = { tagColors, folders, songs: [...nextSongs, ...currentDeletedSongs], setlists: currentSetlists }
      }
    }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSongs(nextSongs)
    return true
  }

  // Explicit save also reports persistence failure to the editor.
  const handleSaveSongFromEditor = (incoming: ActiveSongState) => {
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
        { tagColors, folders, songs: [...nextSongs, ...deletedSongs], setlists },
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
      songs: newSongStates.map((ns, position) => ({
        entryId: generateUUID(), position,
        id: ns.id!,
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

  const handleReloadPersistedLibrary = async () => {
    try {
      // Re-verify the exact current draft at discard time; an old snapshot or
      // a download being initiated does not prove that this draft is recoverable.
      saveCrossTabConflictSnapshot(getConflictDraft())
      setConflictRecoverySaved(true)
      const raw = await reloadLibraryRevision()
      const reloaded = readPersistedLibrary()
      if (!reloaded || libraryRevision() !== raw) throw new Error('Latest library unavailable or changed. Retry reload.')
      persistedBaselineRef.current = raw
      setCrossTabConflict(null)
      const partitioned = partitionSongs(reloaded.songs)
      setSongs(partitioned.active)
      setDeletedSongs(partitioned.deleted)
      setSetlists(reloaded.setlists)
      setTagColors(reloaded.tagColors)
      setFolders(reloaded.folders ?? [])
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
      setTagColors(candidate.tagColors)
      setFolders(candidate.folders ?? [])
      setCrossTabConflict(null)
      setToastMessage('Storage overwritten with local edits.')
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err) {
      handleStorageWriteFailure(err)
    }
  }

  return (
    <TagLibraryContext.Provider value={{ colors: tagColors, onColorChange: handleTagColor, onAddToTag: handleBulkAddToTag }}>
    {activeView === 'songbook' && <ExplorerDragDrop songs={songs} setlists={setlists} folders={folders}
      onTag={handleBulkAddToTag} onSetlist={handleManagerAddSongs} onFolder={handleSetlistFolderChange}
      onTrashSetlist={setTrashSetlistId}
      onTrash={ids => { setIsSetlistDrawerOpen(false); setTrashDropIds(ids) }}
      onTouchDrag={() => setIsSetlistDrawerOpen(true)} onDropComplete={() => setIsSetlistDrawerOpen(false)} />}
    {trashSetlistId !== null && <SetlistTrashConfirmation
      setlist={setlists.find(sl => !sl.isDeleted && String(sl.id) === String(trashSetlistId))}
      onCancel={() => setTrashSetlistId(null)}
      onConfirm={() => { const id = trashSetlistId; setTrashSetlistId(null); handleManagerDelete(id) }} />}
    {recoveryDataOpen && <RecoveryDataPanel
      blocked={() => Boolean(crossTabConflict) || Boolean(editorRecoveryDraftRef.current?.()) || !same(JSON.parse(JSON.stringify(getConflictDraft())), readPersistedLibrary())}
      onClose={() => setRecoveryDataOpen(false)} />}
    {isSetlistManagerOpen && <SetlistManager folders={folders} onSetlistFolderChange={handleSetlistFolderChange}
      setlists={setlists.filter(sl => !sl.isDeleted)}
      songs={songs}
      selectedSetlistId={setlistManagerId}
      onSelectSetlist={setSetlistManagerId}
      onClose={() => setIsSetlistManagerOpen(false)}
      onRenameSetlist={handleManagerRename}
      onDeleteSetlist={handleManagerDelete}
      onMoveSong={handleManagerMove}
      onRemoveSong={handleManagerRemove}
      onAddSongs={handleManagerAddSongs}
      onPlaySetlist={(setlistId, position) => navigateSafely(() => {
        setIsSetlistManagerOpen(false)
        handleSelectSetlistSong(setlistId, position)
        setActiveView('stage')
      })}
      shortcutsBlocked={activeView === 'stage' || isStagePerformanceMode}
      returnFocusTo={setlistManagerOpener} />}
    <div className="min-h-screen flex flex-col bg-app-base text-app-text">
      {/* Unified Android v1.0.44 Top Bar — hidden in stage performance mode */}
      {!isStagePerformanceMode && (
        <Header
          activeView={activeView}
          onViewChange={(view) => navigateSafely(() => setActiveView(view))}
          song={currentSong}
          allSongs={songs}
          songsCount={songs.length}
          deletedSongsCount={deletedSongs.length + deletedSetlists.length}
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
          currentTheme={stageTheme}
          themeModeAssignments={themeAssignments}
          onToggleThemeMode={handleToggleThemeMode}
          customColors={customThemeColors}
          onOpenImportModal={() => navigateSafely(() => setIsImportModalOpen(true))}
          backupSongs={backupDialogSongs}
          onImportAllSongs={handleImportAllSongs}
          onOverlayChange={setIsHeaderOverlayOpen}
          onOpenSetlistDrawer={() => navigateSafely(() => { setIsSetlistDrawerOpen(true) })}
          isExplorerOpen={isSetlistDrawerOpen}
          shortcutsBlocked={isSetlistDrawerOpen || isSetlistManagerOpen || isImportModalOpen || isStageToolsModalOpen || isThemeModalOpen || isWebsiteUrlModalOpen}
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
          onOpenCast={handleTogglePresentation}
          isCastActive={isCastActive}
          onNewSong={() => navigateSafely(handleNewSong)}
          activeSection={explorerSelection.type === 'ALL_SETLISTS' || explorerSelection.type === 'UNFILED_SETLISTS' || explorerSelection.type === 'FOLDER' ? 'setlists'
            : explorerSelection.type === 'ALL_SONGS' || explorerSelection.type === 'TAG' ? 'songs' : null}
          onOpenSection={(section) => handleExplorerSelect({ type: section === 'songs' ? 'ALL_SONGS' : 'ALL_SETLISTS' })}
          autoSyncBlocked={activeView === 'editor' || Boolean(crossTabConflict)}
          folders={folders}
          onCloudRestore={handleFullRestore}
          onCloudMerge={handleSmartMerge}
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
            setTagColors(stored.tagColors)
            setFolders(stored.folders ?? [])
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

      {/* Main Workspace: Songbook Library vs Split Desktop Editor vs Trash vs 1:1 Stage View */}
      <div className="flex flex-1 min-h-0">
        <ExplorerNavigation
          isHidden={isStagePerformanceMode}
          isOpen={isSetlistDrawerOpen && !isStagePerformanceMode}
          onClose={() => setIsSetlistDrawerOpen(false)}
          songs={songs}
          setlists={setlists}
          folders={folders}
          onSaveFolder={handleSaveFolder}
          onDeleteFolder={handleDeleteFolder}
          onChangeTag={handleChangeTag}
          currentSelection={explorerSelection}
          onSelect={handleExplorerSelect}
          onNewSong={() => navigateSafely(handleNewSong)}
          onNewSetlist={() => navigateSafely(handleNewSetlist)}
          deletedSongsCount={deletedSongs.length + deletedSetlists.length}
          isTrashActive={activeView === 'trash'}
          onOpenTrash={() => navigateSafely(() => setActiveView('trash'))}
        />
      <main className="flex-1 min-w-0 flex overflow-hidden">
        {activeView === 'songbook' ? (
          <SongbookHomeView onRequestTrashSetlist={setTrashSetlistId} folders={folders} trashDropIds={trashDropIds} onDismissTrashDrop={() => setTrashDropIds(null)}
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
            onOpenSetlists={() => handleExplorerSelect({ type: 'ALL_SETLISTS' })}
            onOpenSongbook={() => handleExplorerSelect({ type: 'ALL_SONGS' })}
            onManageSetlist={handleManageSetlist}
            onOpenSetlistManager={openSetlistManager}
            onDeleteSong={handleDeleteSong}
            onDeleteSetlist={handleManagerDelete}
            setlists={setlists}
            onSelectSetlistSong={(setlistId, songIdx) => {
              handleSelectSetlistSong(setlistId, songIdx)
              setActiveView('stage')
            }}
            onImportSingleSetlist={handleImportSingleSetlist}
            onBulkDeleteSongs={handleBulkDeleteSongs}
            onBulkAddSongsToSetlist={handleBulkAddSongsToSetlist}
            onShareSetlist={(sl) => setSharingSetlist(sl)}
            onImportSharedSetlist={(shared) => setIncomingSharedSetlist(shared)}
            onOpenImportSongs={() => navigateSafely(() => setIsImportModalOpen(true))}
            onTrashDuplicates={handleTrashDuplicates}
            onUpdateSong={handleUpdateSong}
            view={explorerSelection}
            onSelectView={handleExplorerSelect}
            onEditSong={(songIdx) => navigateSafely(() => {
              handleSelectLibrarySong(songIdx)
              setActiveView('editor')
            })}
            onOpenSources={() => setIsWebsiteUrlModalOpen(true)}
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
            deletedSetlists={deletedSetlists}
            onRestoreSetlist={handleRestoreSetlist}
            onPermanentDeleteSetlist={handlePermanentDeleteSetlist}
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
              onOpenSetlistDrawer={
                isStagePerformanceMode
                  ? undefined
                  : () => navigateSafely(() => { setIsSetlistDrawerOpen(true) })
              }
              isSetlistDrawerOpen={isSetlistDrawerOpen}
              isAnyModalOpen={
                isSetlistDrawerOpen ||
                isStageToolsModalOpen ||
                isThemeModalOpen ||
                isWebsiteUrlModalOpen ||
                isImportModalOpen ||
                isHeaderKeyPickerOpen ||
                isTvPresentationModalOpen ||
                isHeaderOverlayOpen ||
                recoveryDataOpen ||
                isSetlistManagerOpen
              }
              onBack={() => setActiveView('songbook')}
              onOpenEditor={() => navigateSafely(() => setActiveView('editor'))}
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
      </div>

      {/* Stage Color Theme Modal */}
      <ThemeModal
        isOpen={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
        currentTheme={stageTheme}
        customColors={customThemeColors}
        themeAssignments={themeAssignments}
        onApplyTheme={(theme, colors) => {
          setStageTheme(theme)
          setThemeAssignments(loadThemeModeAssignments())
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

      {/* Stage Tools & Band Sync Modal */}
      <BandSyncModal
        isOpen={isStageToolsModalOpen}
        onClose={() => setIsStageToolsModalOpen(false)}
        initialTab="sync"
        onPushSetlist={handlePushSetlistToMembers}
        activeSetlistName={activeSetlist?.name}
        activeSetlistSongCount={activeSetlistSongs.length}
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

      {/* Share Setlist QR Code Modal */}
      {sharingSetlist && (
        <ShareSetlistModal
          setlist={sharingSetlist}
          allSongs={[...songs, ...deletedSongs]}
          onClose={() => setSharingSetlist(null)}
        />
      )}

      {/* Import Shared Setlist Preview Modal */}
      {incomingSharedSetlist && authContext?.session && authContext.accessStatus === 'active' && (
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
    </TagLibraryContext.Provider>
  )
}

export default App
