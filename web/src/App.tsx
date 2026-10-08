import {
  persistLibrary,
  readPersistedLibrary,
  isQuotaError,
  performStorageHousekeeping,
  recoveryData,
  hasActionableRecovery,
  requestDurableStorage,
  setupCrossTabLibraryConflictGuard,
} from './utils/syncJournal'
import { deduplicateLibrary } from './utils/syncMerge'
import { generateUUID, isValidUUID } from './utils/uuid'
import { normalizeSongbookIds } from './utils/songbookFoundation'
import { SETTINGS_KEYS, SETTINGS_CHANGED, readBackupSettings } from './utils/backupSettings'
import { parseBackupJson, normalizeBackupSong, createSingleSetlistPayload } from './utils/jsonBackup'
import { setSongMembership, resolveSetlistSong, mergeBackupLibrary, partitionSongs } from './utils/setlistSongs'
import {
  readStageSession,
  saveStageSession,
  clearStageSession,
  validateAndResolveStageSession,
} from './utils/stageSession'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Header } from './components/Header'
import { DesktopEditor } from './components/DesktopEditor'
import { StageView } from './components/StageView'
import { StagePresentationView } from './components/StagePresentationView'
import { SongbookHomeView } from './components/SongbookHomeView'
import { TrashView } from './components/TrashView'
import { JsonBridgeModal } from './components/JsonBridgeModal'
import { KeyPickerModal } from './components/KeyPickerModal'
import { SetlistDrawer } from './components/SetlistDrawer'
import { ShareSetlistModal } from './components/ShareSetlistModal'
import { ImportSharedSetlistModal } from './components/ImportSharedSetlistModal'
import type { SharedSetlistPayload } from './utils/sharedSetlist'
import { WebsiteUrlSourceModal } from './components/WebsiteUrlSourceModal'
import { ImportDialogModal } from './components/ImportDialogModal'
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
import { stageCast } from './utils/stageCast'
import { bandSync } from './utils/bandSync'
import { detectSongKey } from './utils/songParser'
import type { ActiveSongState } from './types/gtar'
import type { FetchedChordSheet } from './utils/onlineSearch'
import { exportAllDataJson } from './utils/jsonBackup'
import { isDevEnv } from './utils/env'
import { buildViewHistoryState, isGtarViewHistoryState } from './utils/viewHistory'

// Modern GTAR v1.0.42 Default Stage Setlist
const DEFAULT_SETLIST: ActiveSongState[] = [
  {
    id: 'd1080001-0001-4000-8000-000000000001',
    title: 'Stand By Me',
    artist: 'Ben E. King',
    key: 'A',
    capo: 'Capo 2',
    bpm: '118',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: `{title: Stand By Me}
{artist: Ben E. King}
{key: A}
{capo: Capo 2}
{tempo: 118}

Intro: [A] [F#m] [D] [E] [A]

[Verse 1]
When the [A]night has come
[F#m]And the land is dark
And the [D]moon is the [E]only light we'll [A]see
No I [A]won't be afraid, no I [F#m]won't be afraid
Just as [D]long as you [E]stand, stand by [A]me

[Chorus]
So darling, darling, [A]stand by me
Oh [F#m]stand by me
Oh [D]stand, [E]stand by me, [A]stand by me

[Verse 2]
If the [A]sky that we look upon
[F#m]Should tumble and fall
Or the [D]mountains should [E]crumble to the [A]sea
I won't [A]cry, I won't cry, no I [F#m]won't shed a tear
Just as [D]long as you [E]stand, stand by [A]me

[Outro]
[A]Whenever you're in trouble, won't you [F#m]stand by me
Oh [D]stand by me, [E]oh stand by [A]me`,
  },
  {
    id: 'd1080001-0001-4000-8000-000000000002',
    title: 'Ang Huling El Bimbo',
    artist: 'Eraserheads',
    key: 'G',
    capo: 'No Capo',
    bpm: '124',
    format: 'TWO_LINE',
    transposeOffset: 0,
    rawContent: `{title: Ang Huling El Bimbo}
{artist: Eraserheads}
{key: G}
{capo: No Capo}
{tempo: 124}

[Intro]
G - A7 - C - G
[G] [A7] [C] [G]

[Verse 1]
Kamukha mo si Paraluman
Nung tayo ay bata pa
At ang galing-galing mong sumayaw
Mapa-Boogie man o Cha-Cha

[Chorus]
Magkahawak ang ating kamay
At walang kamalay-malay
Na ang huling El Bimbo
Ay papunta na sa dulo

[Bridge]
At dahan-dahang lumipas
Ang mga araw at taon
Lumaki tayong dalawa
Naiwan ang kahapon

[Outro]
[G] [A7] [C] [G]
La la la la la la la la la`,
  },
  {
    id: 'd1080001-0001-4000-8000-000000000003',
    title: 'Hotel California',
    artist: 'Eagles',
    key: 'Bm',
    capo: 'Capo 2',
    bpm: '75',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: `{title: Hotel California}
{artist: Eagles}
{key: Bm}
{capo: Capo 2}
{tempo: 75}

Intro: [Bm] [F#7] [A] [E] [G] [D] [Em] [F#7]

[Verse 1]
On a [Bm]dark desert highway, [F#7]cool wind in my hair
[A]Warm smell of colitas [E]rising up through the air
[G]Up ahead in the distance, [D]I saw a shimmering light
[Em]My head grew heavy and my sight grew dim, [F#7]I had to stop for the night

[Chorus]
[G]Welcome to the Hotel Cali[D]fornia
Such a [F#7]lovely place, such a [Bm]lovely face
Plenty of [G]room at the Hotel Cali[D]fornia
Any [Em]time of year, you can [F#7]find it here`,
  },
  {
    id: 'd1080001-0001-4000-8000-000000000004',
    title: 'Hallelujah',
    artist: 'Leonard Cohen',
    key: 'C',
    capo: 'No Capo',
    bpm: '56',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: `{title: Hallelujah}
{artist: Leonard Cohen}
{key: C}
{capo: No Capo}
{tempo: 56}

Intro: [C] [Am] [C] [Am]

[Verse 1]
Now I've [C]heard there was a [Am]secret chord
That [C]David played, and it [Am]pleased the Lord
But [F]you don't really [G]care for music, [C]do you? [G]
It [C]goes like this, the [F]fourth, the [G]fifth
The [Am]minor fall, the [F]major lift
The [G]baffled king com[E7]posing Halle[Am]lujah

[Chorus]
Halle[F]lujah, Halle[Am]lujah
Halle[F]lujah, Halle[C]lu---[G]--[C]jah`,
  },
]

const DEFAULT_SAMPLE_SETLISTS: WebSetlist[] = [
  {
    id: 'd1080002-0001-4000-8000-000000000001',
    name: 'Acoustic Gig Set',
    songs: [
      { id: 'd1080001-0001-4000-8000-000000000001', title: 'Stand By Me', artist: 'Ben E. King' },
      { id: 'd1080001-0001-4000-8000-000000000002', title: 'Ang Huling El Bimbo', artist: 'Eraserheads' },
      { id: 'd1080001-0001-4000-8000-000000000003', title: 'Hotel California', artist: 'Eagles' },
      { id: 'd1080001-0001-4000-8000-000000000004', title: 'Hallelujah', artist: 'Leonard Cohen' },
    ],
  },
]

export interface WebSetlist {
  id: string | number
  name: string
  createdAt?: number
  isDeleted?: boolean
  songs: Array<{ title: string; artist?: string; id?: string | number }>
}

function App() {
  const isPresentationRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.includes('/stage/present') ||
      window.location.search.includes('view=present') ||
      window.location.hash.includes('present'))

  if (isPresentationRoute) {
    return <StagePresentationView />
  }
  return <LibraryStartup />
}

const RECOVERY_NOTICE_ACK_KEY = 'gtar_recovery_notice_ack_v1'

// Compact 128-bit content identity; never duplicate archives in acknowledgement storage.
function recoveryNoticeFingerprint(value: string): string {
  let a = 1779033703, b = 3144134277, c = 1013904242, d = 2773480762
  for (let i = 0; i < value.length; i++) {
    const k = value.charCodeAt(i)
    a = b ^ Math.imul(a ^ k, 597399067)
    b = c ^ Math.imul(b ^ k, 2869860233)
    c = d ^ Math.imul(c ^ k, 951274213)
    d = a ^ Math.imul(d ^ k, 2716044179)
  }
  a = Math.imul(c ^ (a >>> 18), 597399067)
  b = Math.imul(d ^ (b >>> 22), 2869860233)
  c = Math.imul(a ^ (c >>> 17), 951274213)
  d = Math.imul(b ^ (d >>> 19), 2716044179)
  return `v2:${value.length}:` + [a ^ b ^ c ^ d, b ^ a, c ^ a, d ^ a]
    .map(part => (part >>> 0).toString(16).padStart(8, '0')).join('')
}

// Acknowledge this exact archive set only. New/changed sources need attention.
const recoveryNoticeId = () => recoveryNoticeFingerprint(JSON.stringify(Object.entries(recoveryData())
  .filter(([key]) => key !== 'gtar_library_v1' && key !== 'gtar_sync_library_owner')
  .sort(([a], [b]) => a.localeCompare(b))))
const checkRecovery = () => {
  try { readPersistedLibrary(); return { retired: !hasActionableRecovery(), damaged: false, noticeId: recoveryNoticeId() } }
  catch { return { retired: false, damaged: true, noticeId: null } }
}

function LibraryStartup() {
  const [status, setStatus] = useState(() => { performStorageHousekeeping(); return checkRecovery() })
  useEffect(() => {
    const refresh = () => setStatus(checkRecovery())
    window.addEventListener('gtar-library-persisted', refresh)
    window.addEventListener('storage', refresh)
    // Child startup migration can persist before this listener is installed.
    refresh()
    return () => { window.removeEventListener('gtar-library-persisted', refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const exportRecovery = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(recoveryData(), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'GTAR-storage-recovery.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(RECOVERY_NOTICE_ACK_KEY)
      // Existing 8j acknowledgements contain the full serialized source set.
      return saved?.startsWith('[') ? recoveryNoticeFingerprint(saved) : saved
    } catch { return null }
  })
  const dismissed = !status.damaged && status.noticeId !== null && dismissedNotice === status.noticeId
  const dismissRecovery = () => {
    if (status.damaged || status.noticeId === null) return
    setDismissedNotice(status.noticeId)
    try { localStorage.setItem(RECOVERY_NOTICE_ACK_KEY, status.noticeId) } catch { /* Session acknowledgement still works. */ }
  }
  const showBanner = status.damaged || (isDevEnv && !status.retired)
  return <>
    {!dismissed && showBanner && <aside role="alert" className="p-4 bg-amber-100 text-black flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <span>{status.damaged ? 'Device library needs recovery. Original browser data has been preserved.' : 'Recovery data is available. Export it before clearing browser storage.'}</span>
        <button className="underline ml-3 cursor-pointer" onClick={exportRecovery}>Export recovery data</button>
      </div>
      {!status.damaged && <button
        type="button"
        aria-label="Dismiss recovery notice"
        title="Dismiss recovery notice"
        data-testid="dismiss-recovery-banner"
        onClick={dismissRecovery}
        className="p-1.5 rounded hover:bg-amber-200 text-black/70 hover:text-black focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shrink-0"
      >
        <span aria-hidden="true" className="text-lg leading-none font-bold">×</span>
      </button>}
    </aside>}
    {!status.damaged && <LibraryApp />}
  </>
}

function LibraryApp() {
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
      if (normalized.migrated) {
        savedLibrary = { ...savedLibrary, songs: normalized.songs, setlists: normalized.setlists }
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
    const repaired = deduplicateLibrary({ songs: normalized.songs, setlists: normalized.setlists })
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
    }
    window.addEventListener(SETTINGS_CHANGED, reloadSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED, reloadSettings)
  }, [])

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const lastStorageWarningTimeRef = useRef<number>(0)

  const handleStorageWriteFailure = useCallback((err: unknown) => {
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
  }, [])

  // Best-effort non-blocking durable storage request (Gap 2)
  useEffect(() => {
    requestDurableStorage().catch(() => {})
  }, [])

  // Cross-tab storage conflict protection for gtar_library_v1 (Gap 3)
  useEffect(() => {
    let lastConflictWarning = 0
    const cleanup = setupCrossTabLibraryConflictGuard(() => {
      console.warn('[Storage] gtar_library_v1 was updated in another tab. In-memory state preserved.')
      const now = Date.now()
      if (now - lastConflictWarning > 10000) {
        lastConflictWarning = now
        setToastMessage('Songbook library updated in another tab. Current active edits are preserved.')
        setTimeout(() => setToastMessage(null), 5000)
      }
    })
    return cleanup
  }, [])

  // Persist canonical library on any songs, trash, or setlists change (with quota relief)
  useEffect(() => {
    try {
      persistLibrary({ songs: [...songs, ...deletedSongs], setlists })
    } catch (err) {
      handleStorageWriteFailure(err)
    }
  }, [songs, deletedSongs, setlists, handleStorageWriteFailure])

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
      DEFAULT_SETLIST[0]
    : songs[activeSongIndex] || DEFAULT_SETLIST[0]

  // Global Modals
  const [isWebsiteUrlModalOpen, setIsWebsiteUrlModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isBackupRestoreModalOpen, setIsBackupRestoreModalOpen] = useState(false)
  const [isStageSettingsModalOpen, setIsStageSettingsModalOpen] = useState(false)
  const [isStageToolsModalOpen, setIsStageToolsModalOpen] = useState(false)
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false)
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false)
  const [isHeaderKeyPickerOpen, setIsHeaderKeyPickerOpen] = useState(false)
  const [isSetlistDrawerOpen, setIsSetlistDrawerOpen] = useState(false)
  const [drawerInitialTab, setDrawerInitialTab] = useState<'songbook' | 'setlists'>('setlists')
  const [sharingSetlist, setSharingSetlist] = useState<WebSetlist | null>(null)
  const [incomingSharedSetlist, setIncomingSharedSetlist] = useState<SharedSetlistPayload | null>(null)
  // True when StageView enters fullscreen or focus mode — hides the global Header
  const [isStagePerformanceMode, setIsStagePerformanceMode] = useState(false)

  // Handle incoming ?share=<token> parameter on load
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const shareToken = urlParams.get('share')
      if (shareToken && /^[a-f0-9]{16}$/i.test(shareToken)) {
        fetch(`/api/setlist/share?token=${shareToken}`)
          .then((res) => {
            if (!res.ok) throw new Error('Shared setlist not found or expired')
            return res.json()
          })
          .then((data) => {
            if (data?.setlist) {
              setIncomingSharedSetlist(data.setlist)
            }
          })
          .catch((err) => {
            console.warn('[Share] Failed to load shared setlist:', err)
            setToastMessage('Could not load shared setlist: link may be expired or invalid.')
            setTimeout(() => setToastMessage(null), 4000)
          })
          .finally(() => {
            // Clean up share parameter from URL without page reload
            const cleanUrl = new URL(window.location.href)
            cleanUrl.searchParams.delete('share')
            window.history.replaceState({}, document.title, cleanUrl.pathname + (cleanUrl.search || ''))
          })
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Stage Cast Active Presentation State
  const [isCastActive, setIsCastActive] = useState(() => stageCast.isPresentationActive())
  const [isTvPresentationModalOpen, setIsTvPresentationModalOpen] = useState(false)

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
        effectiveKey: currentSong.key || '',
        transposeOffset: currentSong.transposeOffset || 0,
        fontSizePx: 22,
        fontStyle,
        isTwoColumn,
        chordScale: 100,
        fontWeight: 'regular',
        lineSpacing: 'normal',
      })

      const caps = stageCast.getPresentationCapabilities()
      if (caps.recommendedMode === 'tv_pairing' || !caps.canDirectPresent) {
        setIsTvPresentationModalOpen(true)
      } else {
        const res = await stageCast.requestPresentation()
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
          const incomingSetlistName = msg.payload.setlistName || 'Band Setlist'
          const incomingSongs: Array<Partial<ActiveSongState>> = Array.isArray(msg.payload.songs) ? msg.payload.songs : []

          // Smart Merge: do not overwrite or duplicate existing (match title + artist)
          const songMap = new Map(
            songs.map((s) => [
              `${s.title.trim().toLowerCase()}::${(s.artist || '').trim().toLowerCase()}`,
              s,
            ])
          )

          const newSongsToAppend: ActiveSongState[] = []
          for (const item of incomingSongs) {
            const key = `${(item.title || '').trim().toLowerCase()}::${(item.artist || '').trim().toLowerCase()}`
            if (!songMap.has(key)) {
              const newSong: ActiveSongState = {
                id: generateUUID(),
                title: item.title || 'Untitled Song',
                artist: item.artist || '',
                key: item.key || detectSongKey(item.rawContent || ''),
                capo: item.capo || 'No Capo',
                bpm: item.bpm || '120',
                format: item.format || 'CHORD_PRO',
                transposeOffset: 0,
                rawContent: item.rawContent || '',
              }
              songMap.set(key, newSong)
              newSongsToAppend.push(newSong)
            }
          }
          if (newSongsToAppend.length > 0) {
            setSongs((prev) => [...prev, ...newSongsToAppend])
          }

          // Reconstruct/activate received setlist on Member device immediately
          const newSetlistId = generateUUID()
          const syncedSetlist: WebSetlist = {
            id: newSetlistId,
            name: incomingSetlistName,
            songs: incomingSongs.map((s) => {
              const matchedSong = songMap.get(`${(s.title || '').trim().toLowerCase()}::${(s.artist || '').trim().toLowerCase()}`)
              return {
                id: matchedSong?.id || (s.id && isValidUUID(s.id) ? s.id : undefined),
                title: s.title || 'Untitled Song',
                artist: s.artist,
              }
            }),
          }

          setSetlists((prevSetlists) => {
            const filtered = prevSetlists.filter(
              (sl) => sl.name.trim().toLowerCase() !== incomingSetlistName.trim().toLowerCase()
            )
            return [...filtered, syncedSetlist]
          })

          setActiveSetlistId(newSetlistId)
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
  }, [songs, activeSetlist, activeSetlistSongs, setlists, handleTransposeChange])

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

    bandSync.broadcastSetlist(targetSetlist.name, payloadSongs)
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

  // Soft-delete song from library (moves to Trash bin)
  const handleDeleteSong = (indexToDelete: number) => {
    const songToDelete = songs[indexToDelete]
    if (!songToDelete) return

    // Move to deletedSongs (Trash)
    setDeletedSongs((prev) => [{ ...songToDelete, isDeleted: true }, ...prev])

    if (songs.length <= 1) {
      // If last remaining song is deleted, create blank song template
      const blankSong: ActiveSongState = {
        id: generateUUID(),
        title: 'New Song',
        artist: '',
        key: 'G',
        capo: 'No Capo',
        bpm: '120',
        format: 'CHORD_PRO',
        transposeOffset: 0,
        rawContent: `{title: New Song}\n{artist: }\n{key: G}\n{tempo: 120}\n\n[Intro]\n\n[Verse 1]\n\n[Chorus]\n`,
      }
      setSongs([blankSong])
      setActiveSongIndex(0)
    } else {
      const updatedSongs = songs.filter((_, idx) => idx !== indexToDelete)
      setSongs(updatedSongs)
      if (activeSongIndex === indexToDelete) {
        setActiveSongIndex(Math.min(indexToDelete, updatedSongs.length - 1))
      } else if (activeSongIndex > indexToDelete) {
        setActiveSongIndex(activeSongIndex - 1)
      }
    }

    setToastMessage(`Moved "${songToDelete.title}" to Trash.`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Bulk delete songs from library (moves to Trash) and reconciles setlist references
  const handleBulkDeleteSongs = (ids: Array<string | number>) => {
    const idSet = new Set(ids.map(String))
    const songsToDelete = songs.filter((s) => s.id !== undefined && idSet.has(String(s.id)))
    if (songsToDelete.length === 0) return

    setDeletedSongs((prev) => [...songsToDelete.map((s) => ({ ...s, isDeleted: true })), ...prev])

    // Reconcile setlist references: remove deleted songs from all setlists
    setSetlists((prev) =>
      prev.map((sl) => ({
        ...sl,
        songs: sl.songs.filter((ref) => ref.id === undefined || !idSet.has(String(ref.id))),
      }))
    )

    const remainingSongs = songs.filter((s) => s.id === undefined || !idSet.has(String(s.id)))
    if (remainingSongs.length === 0) {
      const blankSong: ActiveSongState = {
        id: generateUUID(),
        title: 'New Song',
        artist: '',
        key: 'G',
        capo: 'No Capo',
        bpm: '120',
        format: 'CHORD_PRO',
        transposeOffset: 0,
        rawContent: `{title: New Song}\n{artist: }\n{key: G}\n{tempo: 120}\n\n[Intro]\n\n[Verse 1]\n\n[Chorus]\n`,
      }
      setSongs([blankSong])
      setActiveSongIndex(0)
    } else {
      setSongs(remainingSongs)
      setActiveSongIndex((prev) => Math.min(prev, remainingSongs.length - 1))
    }

    setToastMessage(`Moved ${songsToDelete.length} ${songsToDelete.length === 1 ? 'song' : 'songs'} to Trash.`)
    setTimeout(() => setToastMessage(null), 3500)
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

    setDeletedSongs((prev) => prev.filter((s) => String(s.id) !== String(id)))
    const restoredSong: ActiveSongState = { ...songToRestore, isDeleted: false }
    setSongs((prev) => [restoredSong, ...prev])

    setToastMessage(`Restored "${restoredSong.title}" to Songbook Library!`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Permanently delete song from Trash
  const handlePermanentDeleteSong = (id: number | string) => {
    const target = deletedSongs.find((s) => String(s.id) === String(id))
    setDeletedSongs((prev) => prev.filter((s) => String(s.id) !== String(id)))
    setToastMessage(`Permanently deleted ${target ? `"${target.title}"` : 'song'}.`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Permanently delete all songs in Trash
  const handleEmptyTrash = () => {
    const count = deletedSongs.length
    setDeletedSongs([])
    setToastMessage(`Trash emptied (${count} songs permanently deleted).`)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Create new blank song template and switch to Desktop Editor
  const handleNewSong = () => {
    const blankSong: ActiveSongState = {
      id: generateUUID(),
      title: 'New Song',
      artist: '',
      key: 'G',
      capo: 'No Capo',
      bpm: '120',
      format: 'CHORD_PRO',
      transposeOffset: 0,
      rawContent: `{title: New Song}\n{artist: }\n{key: G}\n{tempo: 120}\n\n[Intro]\n\n[Verse 1]\n\n[Chorus]\n`,
    }
    setSongs((prev) => [blankSong, ...prev])
    setActiveSongIndex(0)
    setActiveSetlistId(null)
    setActiveView('editor')
    setIsSetlistDrawerOpen(false)
  }

  const handleSongMembership = (songId: string | number, setlistId: string | number, included: boolean) => {
    const song = songs.find(item => String(item.id) === String(songId))
    const setlist = setlists.find(item => String(item.id) === String(setlistId))
    if (!song || !setlist) return
    setSetlists(previous => previous.map(item => String(item.id) === String(setlistId)
      ? setSongMembership(item, song, included) : item))
    setToastMessage(`${included ? 'Added to' : 'Removed from'} ${setlist.name}`)
    setTimeout(() => setToastMessage(null), 3000)
  }

  const handleCreateSetlistForSong = (songId: string | number, name: string) => {
    const song = songs.find(item => String(item.id) === String(songId))
    if (!song || !name.trim()) return
    const created = setSongMembership({ id: generateUUID(), name: name.trim(), createdAt: Date.now(), songs: [] }, song, true)
    setSetlists(previous => [...previous, created])
    setToastMessage(`Added to ${created.name}`)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Create a new setlist
  const handleNewSetlist = () => {
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
  }, [])

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
  }, [handleTogglePresentation, handleNavigateHome])

  // Update song fields in editor
  const handleUpdateSong = (updated: Partial<ActiveSongState>) => {
    const targetId = updated.id ?? currentSong?.id
    const isExisting = songs.some(s => String(s.id) === String(targetId))
    if (!isExisting) {
      // Do not auto-save unpersisted new blank song to library
      return false
    }
    const nextSongs = songs.map(s => String(s.id) === String(targetId) ? { ...s, ...updated, id: s.id } : s)
    try { persistLibrary({ songs: [...nextSongs, ...deletedSongs], setlists }) }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSongs(nextSongs)
    return true
  }

  // Explicit save also reports persistence failure to the editor.
  const handleSaveSongFromEditor = (updatedSong: ActiveSongState) => {
    const targetId = updatedSong.id ?? currentSong?.id
    const isExisting = songs.some(s => String(s.id) === String(targetId))
    const nextSongs = isExisting
      ? songs.map(s => String(s.id) === String(targetId) ? { ...s, ...updatedSong, id: s.id } : s)
      : [updatedSong, ...songs]
    try { persistLibrary({ songs: [...nextSongs, ...deletedSongs], setlists }) }
    catch (err) { handleStorageWriteFailure(err); return false }
    setSongs(nextSongs)
    if (!isExisting) {
      setActiveSongIndex(0)
    }
    return true
  }

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
    // Synchronously commit to canonical storage; throws if quota/write fails
    persistLibrary({ songs: parsed.songs, setlists: parsed.setlists })
    setSongs(partition.active)
    setDeletedSongs(partition.deleted)
    setSetlists(parsed.setlists)
    setActiveSetlistId(null)
    setActiveSongIndex(0)
    setActiveSetlistSongIndex(0)
    setQueueMode('library')
  }

  const handleSmartMerge = (importedSongs: Array<Partial<ActiveSongState>>, importedSetlists: WebSetlist[]) => {
    const existingSongs = [...songs, ...deletedSongs]
    const parsed = parseBackupJson(JSON.stringify({ songs: importedSongs, setlists: importedSetlists }), { mode: 'merge', existingSongs })
    if (!parsed.isValid) throw new Error(parsed.error)
    const merged = mergeBackupLibrary(existingSongs, parsed.songs, parsed.setlists)
    const partition = partitionSongs(merged.songs)
    const nextSetlists = [...setlists]
    for (const setlist of merged.setlists) {
      const index = nextSetlists.findIndex(item => String(item.id) === String(setlist.id))
      if (index >= 0) nextSetlists[index] = setlist
      else nextSetlists.push(setlist)
    }
    // Synchronously commit to canonical storage; throws if quota/write fails
    persistLibrary({ songs: merged.songs, setlists: nextSetlists })
    setSongs(partition.active)
    setDeletedSongs(partition.deleted)
    setSetlists(nextSetlists)
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

  // Filter songs if searchQuery is active
  const filteredSongs = searchQuery.trim()
    ? songs.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.artist?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : songs

  return (
    <div className="min-h-screen flex flex-col bg-app-base text-app-text">
      {/* Unified Android v1.0.44 Top Bar — hidden in stage performance mode */}
      {!isStagePerformanceMode && (
        <Header
          activeView={activeView}
          onViewChange={(view) => navigateSafely(() => setActiveView(view))}
          song={currentSong}
          allSongs={songs}
          songsCount={filteredSongs.length > 0 ? filteredSongs.length : songs.length}
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
          onOpenCast={handleTogglePresentation}
          isCastActive={isCastActive}
          onCloudSyncApplied={(updated) => {
            const partition = partitionSongs(updated.songs)
            setSongs(partition.active)
            setDeletedSongs(partition.deleted)
            setSetlists(updated.setlists)
            setToastMessage('Songbook synced with Cloud')
            setTimeout(() => setToastMessage(null), 3500)
          }}
        />
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
            onShareSetlist={(sl) => setSharingSetlist(sl)}
            onImportSharedSetlist={(shared) => setIncomingSharedSetlist(shared)}
          />
        ) : activeView === 'editor' ? (
          <DesktopEditor
            song={currentSong}
            onUpdateSong={handleUpdateSong}
            onSaveSong={handleSaveSongFromEditor}
            onClose={() => setActiveView('stage')}
            navigationGuardRef={editorNavigationGuard}
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
              songs={filteredSongs.length > 0 ? filteredSongs : songs}
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

      {/* Slide-over Setlist / Library Drawer */}
      <SetlistDrawer
        isOpen={isSetlistDrawerOpen}
        initialTab={drawerInitialTab}
        onClose={() => setIsSetlistDrawerOpen(false)}
        songs={filteredSongs.length > 0 ? filteredSongs : songs}
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
        onNewSong={handleNewSong}
        onNewSetlist={handleNewSetlist}
        onImportSingleSetlist={handleImportSingleSetlist}
        onSmartMerge={handleSmartMerge}
        onExportAllData={() => exportAllDataJson([...songs, ...deletedSongs], setlists)}
        onShareSetlist={(sl) => setSharingSetlist(sl)}
      />

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
      <ImportDialogModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSong={handleImportSong}
        onImportAllSongs={handleImportAllSongs}
        onImportSingleSetlist={handleImportSingleSetlist}
        onSmartMerge={handleSmartMerge}
        existingSongs={[...songs, ...deletedSongs]}
      />

      {/* Backup & Restore Modal Dialog (Export Backup & Restore Backup Smart Merge) */}
      <BackupRestoreDialogModal
        isOpen={isBackupRestoreModalOpen}
        onClose={() => setIsBackupRestoreModalOpen(false)}
        currentSong={currentSong}
        allSongs={[...songs, ...deletedSongs]}
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
        originalKey={currentSong.key}
        currentOffset={currentSong.transposeOffset || 0}
        onSelectOffset={handleTransposeChange}
        onReset={() => handleTransposeChange(0)}
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
  )
}

export default App
