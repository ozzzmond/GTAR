/**
 * #191 (RFC #188 S3): feeds the header status pill and the Sync Center. Device facts are recomputed
 * only on the events that can change them (save, other tab, sync finished) and a one-minute tick
 * for the "Synced · 2m" age, never per render.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  computeSongbookChecksum,
  estimateSongbookUploadBytes,
  inspectSyncReference,
  readCloudSyncMeta,
  songbookUploadHeadroom,
  type CloudSyncStatus,
  type SongbookHeadroom,
  type SyncReferenceState,
} from './cloudSongbookSync'
import { isLibraryIndexActive, peekPersistedLibrary } from './syncJournal'
import { tryReadCloudThemeSettings } from './backupSettings'
import { deriveSyncPill, type SyncPill } from './syncStatus'
import type { SyncLibrary } from './syncMerge'

export interface SyncDeviceFacts {
  lastSyncedAt: number | null
  localChanged: boolean
  songs: number | null
  setlists: number | null
  chartsInIndexedDb: boolean
  syncReference: SyncReferenceState
  headroom: SongbookHeadroom | null
}

const EMPTY: SyncDeviceFacts = { lastSyncedAt: null, localChanged: false, songs: null, setlists: null,
  chartsInIndexedDb: false, syncReference: 'none', headroom: null }

export async function readSyncDeviceFacts(storage: Storage = localStorage): Promise<SyncDeviceFacts> {
  const meta = readCloudSyncMeta(storage)
  let library: SyncLibrary | null
  try { library = peekPersistedLibrary(storage) as SyncLibrary | null } catch { library = null }
  const theme = tryReadCloudThemeSettings(storage)
  const full = library ? { ...library, ...(theme ? { themeSettings: theme } : {}) } : null
  let syncReference: SyncReferenceState
  try { syncReference = await inspectSyncReference(storage) } catch { syncReference = 'missing' }
  let chartsInIndexedDb = false
  try { chartsInIndexedDb = isLibraryIndexActive(storage) } catch { /* storage unavailable */ }
  return {
    lastSyncedAt: meta.lastSyncedAt,
    localChanged: Boolean(full && meta.lastSyncedChecksum && computeSongbookChecksum(full) !== meta.lastSyncedChecksum),
    songs: library ? library.songs.filter(song => !(song as { isDeleted?: boolean }).isDeleted).length : null,
    setlists: library ? library.setlists.filter(setlist => !setlist.isDeleted).length : null,
    chartsInIndexedDb,
    syncReference,
    headroom: full ? songbookUploadHeadroom(estimateSongbookUploadBytes(full)) : null,
  }
}

// Not 'gtar:cloud_sync_state': the dialog re-emits it on every header render, which would loop.
// A finished sync is caught by the isProcessing change below instead.
const REFRESH_EVENTS = ['gtar-library-persisted', 'storage', 'gtar-recovery-changed'] as const
const sameFacts = (a: SyncDeviceFacts, b: SyncDeviceFacts) => JSON.stringify(a) === JSON.stringify(b)

export function useSyncStatus(input: { enabled: boolean; signedIn: boolean; status: CloudSyncStatus; isProcessing: boolean; recoveryNeedsDecision: boolean }):
  { pill: SyncPill; facts: SyncDeviceFacts } {
  const { enabled, signedIn, status, isProcessing, recoveryNeedsDecision } = input
  const [facts, setFacts] = useState<SyncDeviceFacts>(EMPTY)
  const [now, setNow] = useState(() => Date.now())
  // Re-read device facts when a sync finishes (processing true -> false) or its status changes.
  const syncEpoch = `${isProcessing}:${status}`

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    let alive = true
    let running = false
    let again = false
    const refresh = () => {
      if (running) { again = true; return }
      running = true
      void readSyncDeviceFacts().then(next => { if (alive) setFacts(prev => sameFacts(prev, next) ? prev : next) })
        .catch(() => { /* facts stay as they were */ })
        .finally(() => { running = false; if (again && alive) { again = false; refresh() } })
    }
    refresh()
    REFRESH_EVENTS.forEach(type => window.addEventListener(type, refresh))
    const tick = window.setInterval(() => setNow(Date.now()), 60000)
    return () => {
      alive = false
      REFRESH_EVENTS.forEach(type => window.removeEventListener(type, refresh))
      window.clearInterval(tick)
    }
  }, [enabled, syncEpoch])

  const pill = useMemo(() => deriveSyncPill({
    signedIn, status, isProcessing, recoveryNeedsDecision, now,
    lastSyncedAt: facts.lastSyncedAt, localChanged: facts.localChanged,
    syncReference: facts.syncReference, headroom: facts.headroom?.level ?? null,
  }), [signedIn, status, isProcessing, recoveryNeedsDecision, now, facts])

  return { pill, facts }
}
