import { mergeSyncLibrary, type SyncLibrary } from './syncMerge'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { prunePersistedLogs } from './logger'

export interface LibraryDelta {
  changedSongs: ActiveSongState[]
  deletedSongIds: (string | number)[]
  songIdsOrder?: (string | number)[]
  setlists: WebSetlist[]
  allowedUsers?: string[]
}

export function computeDelta(base: SyncLibrary | null, target: SyncLibrary): LibraryDelta {
  const baseSongs = new Map((base?.songs ?? []).map(s => [String(s.id), s]))
  const targetSongs = new Map(target.songs.map(s => [String(s.id), s]))

  const changedSongs: ActiveSongState[] = []
  for (const s of target.songs) {
    const b = baseSongs.get(String(s.id))
    if (!b || JSON.stringify(s) !== JSON.stringify(b)) {
      changedSongs.push(s)
    }
  }

  const deletedSongIds: (string | number)[] = []
  for (const [idStr, s] of baseSongs.entries()) {
    if (!targetSongs.has(idStr) && s.id !== undefined) {
      deletedSongIds.push(s.id)
    }
  }

  const songIdsOrder: (string | number)[] = []
  for (const s of target.songs) {
    if (s.id !== undefined) songIdsOrder.push(s.id)
  }

  const delta: LibraryDelta = {
    changedSongs,
    deletedSongIds,
    songIdsOrder,
    setlists: target.setlists,
  }
  if (target.allowedUsers !== undefined) {
    delta.allowedUsers = target.allowedUsers
  }
  return delta
}

export function applyDelta(base: SyncLibrary | null, delta: LibraryDelta): SyncLibrary {
  const songsMap = new Map((base?.songs ?? []).map(s => [String(s.id), s]))
  for (const id of delta.deletedSongIds) {
    songsMap.delete(String(id))
  }
  for (const s of delta.changedSongs) {
    songsMap.set(String(s.id), s)
  }
  let songs: ActiveSongState[]
  if (delta.songIdsOrder && delta.songIdsOrder.length > 0) {
    const ordered: ActiveSongState[] = []
    for (const id of delta.songIdsOrder) {
      const s = songsMap.get(String(id))
      if (s) {
        ordered.push(s)
        songsMap.delete(String(id))
      }
    }
    ordered.push(...songsMap.values())
    songs = ordered
  } else {
    songs = [...songsMap.values()]
  }
  const res: SyncLibrary = {
    songs,
    setlists: delta.setlists,
  }
  if (delta.allowedUsers !== undefined) {
    res.allowedUsers = delta.allowedUsers
  }
  return res
}

export function resolvePendingLibrary(base: SyncLibrary | null, record: unknown): SyncLibrary | null {
  if (!record || typeof record !== 'object') return null
  const r = record as Record<string, unknown>
  if (Array.isArray(r.songs) && Array.isArray(r.setlists)) {
    return r as unknown as SyncLibrary
  }
  if (Array.isArray(r.changedSongs) && Array.isArray(r.deletedSongIds) && Array.isArray(r.setlists)) {
    return applyDelta(base, r as unknown as LibraryDelta)
  }
  return null
}

interface SerializedJournalPending {
  beforeDelta?: LibraryDelta
  mergedDelta?: LibraryDelta
  before?: SyncLibrary | LibraryDelta
  merged?: SyncLibrary | LibraryDelta
  acknowledged: boolean
}

interface SerializedJournal {
  version: 1
  baseline: SyncLibrary | null
  pending?: SerializedJournalPending
}

interface Journal {
  version: 1
  baseline: SyncLibrary | null
  pending?: { before: SyncLibrary; merged: SyncLibrary; acknowledged: boolean }
}

const key = (account: string) => `gtar_sync_v1:${account}`
const ownerKey = 'gtar_sync_library_owner'
const MAX_RECOVERY_SNAPSHOTS = 2

export const LIBRARY_KEY = 'gtar_library_v1'
export const SYNC_RETIRED_KEY = 'gtar_sync_retired_v1'

export const CANONICAL_STORAGE_PREFIXES = [
  LIBRARY_KEY,
  SYNC_RETIRED_KEY,
  ownerKey,
  'gtar_sync_v1:',
  'gtar_songs_store',
  'gtar_trash_songs_store',
  'gtar_setlists_store',
  'gtar_active_setlist_id',
  'gtar_theme_mode',
  'gtar_custom_theme_colors',
  'gtar_font_style',
  'gtar_is_two_column',
]

export function isCanonicalKey(k: string): boolean {
  return CANONICAL_STORAGE_PREFIXES.some(prefix => k === prefix || k.startsWith(prefix))
}

export function isQuotaError(err: unknown): boolean {
  if (!err) return false
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014 ||
      /quota/i.test(err.message)
    )
  }
  if (err instanceof Error) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      /quota/i.test(err.message)
    )
  }
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    return (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014 ||
      (typeof e.message === 'string' && (/quota/i.test(e.message) || e.message.includes('NS_ERROR_DOM_QUOTA_REACHED')))
    )
  }
  return false
}

export function pruneRecoverySnapshots(storage: Storage, account: string, maxAllowed: number) {
  const prefix = `gtar_sync_recovery:${account}:`
  const existingKeys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(prefix) && !isCanonicalKey(k)) existingKeys.push(k)
  }
  existingKeys.sort()
  while (existingKeys.length > maxAllowed) {
    const oldest = existingKeys.shift()
    if (oldest && !isCanonicalKey(oldest)) {
      try { storage.removeItem(oldest) } catch { /* ignore storage error on remove */ }
    }
  }
}

export function pruneAllRecoverySnapshots(storage: Storage, maxAllowed = 0) {
  const prefix = 'gtar_sync_recovery:'
  const existingKeys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(prefix) && !isCanonicalKey(k)) existingKeys.push(k)
  }
  existingKeys.sort()
  while (existingKeys.length > maxAllowed) {
    const oldest = existingKeys.shift()
    if (oldest && !isCanonicalKey(oldest)) {
      try { storage.removeItem(oldest) } catch { /* ignore storage error on remove */ }
    }
  }
}

/** Storage failures stop sync before network writes or local replacement. No tokens are stored. */
export function openSyncJournal(account: string, local: SyncLibrary, storage: Storage = localStorage, resumePending = true) {
  if (!account) throw new Error('Verified account ID is required for sync.')
  const owner = storage.getItem(ownerKey)
  if (owner && owner !== account) throw new Error('This device library belongs to another Google account. Sign in to that account to sync; export its backup before moving data to another account.')
  try {
    storage.setItem(ownerKey, account)
  } catch (err) {
    if (isQuotaError(err)) {
      pruneRecoverySnapshots(storage, account, 0)
      prunePersistedLogs(storage, 10)
      storage.setItem(ownerKey, account)
    } else {
      throw err
    }
  }

  const raw = storage.getItem(key(account))
  let journalData: SerializedJournal = { version: 1, baseline: null }
  if (raw) {
    try {
      journalData = JSON.parse(raw)
    } catch {
      throw new Error('Unsupported sync recovery state. Export device data before recovery.')
    }
  }
  if (journalData.version !== 1) throw new Error('Unsupported sync recovery state. Export device data before recovery.')

  let pendingBefore: SyncLibrary | null = null
  let pendingMerged: SyncLibrary | null = null

  if (journalData.pending?.acknowledged) {
    const rawBefore = journalData.pending.beforeDelta ?? journalData.pending.before
    const rawMerged = journalData.pending.mergedDelta ?? journalData.pending.merged
    pendingBefore = resolvePendingLibrary(journalData.baseline, rawBefore)
    pendingMerged = resolvePendingLibrary(journalData.baseline, rawMerged)
  }

  const journal: Journal = {
    version: journalData.version,
    baseline: journalData.baseline,
    pending: (pendingBefore && pendingMerged && journalData.pending?.acknowledged)
      ? { before: pendingBefore, merged: pendingMerged, acknowledged: true }
      : (journalData.pending ? { before: local, merged: local, acknowledged: Boolean(journalData.pending.acknowledged) } : undefined),
  }

  const resumed = resumePending && journal.pending?.acknowledged && pendingBefore && pendingMerged
    ? mergeSyncLibrary(local, pendingMerged, pendingBefore)
    : local

  let storageDegraded = false
  let warnedQuotaExceeded = false

  function serialize(): string {
    if (!journal.pending) {
      return JSON.stringify({ version: journal.version, baseline: journal.baseline })
    }
    if (!journal.pending.acknowledged) {
      // When unacknowledged, before/merged are not read during recovery reload.
      // Storing { acknowledged: false } prevents multi-megabyte quota bloat during upload.
      return JSON.stringify({
        version: journal.version,
        baseline: journal.baseline,
        pending: { acknowledged: false },
      })
    }
    // Acknowledged state: serialize compact deltas relative to baseline
    return JSON.stringify({
      version: journal.version,
      baseline: journal.baseline,
      pending: {
        acknowledged: true,
        beforeDelta: computeDelta(journal.baseline, journal.pending.before),
        mergedDelta: computeDelta(journal.baseline, journal.pending.merged),
      },
    })
  }

  function saveJournal() {
    const payload = serialize()
    try {
      storage.setItem(key(account), payload)
    } catch (err) {
      if (isQuotaError(err)) {
        pruneRecoverySnapshots(storage, account, 0)
        prunePersistedLogs(storage, 10)
        try {
          storage.setItem(key(account), payload)
        } catch (retryErr) {
          storageDegraded = true
          if (!warnedQuotaExceeded) {
            warnedQuotaExceeded = true
            console.warn('Unable to persist sync journal state (quota exceeded). Proceeding in-memory.', retryErr)
          }
        }
      } else {
        throw err
      }
    }
  }

  return {
    local: resumed,
    get baseline() {
      return (journal.pending?.acknowledged && pendingMerged) ? pendingMerged : journal.baseline
    },
    isDegraded: () => storageDegraded,
    archive(remote: SyncLibrary | null) {
      if (storageDegraded) return
      // Prune older recovery entries to keep at most MAX_RECOVERY_SNAPSHOTS - 1 before adding new
      pruneRecoverySnapshots(storage, account, Math.max(0, MAX_RECOVERY_SNAPSHOTS - 1))
      const prefix = `gtar_sync_recovery:${account}:`
      const recovery = `${prefix}${Date.now()}_${crypto.randomUUID()}`
      const minimalSnapshot = JSON.stringify({
        timestamp: Date.now(),
        local,
        remote,
        journal: { version: journal.version, baseline: journal.baseline },
      })
      try {
        storage.setItem(recovery, minimalSnapshot)
      } catch (e) {
        if (isQuotaError(e)) {
          if (!warnedQuotaExceeded) {
            console.warn('Initial recovery snapshot save failed (quota exceeded). Purging older snapshots down to 0.', e)
          }
          pruneRecoverySnapshots(storage, account, 0)
          prunePersistedLogs(storage, 10)
          try {
            storage.setItem(recovery, minimalSnapshot)
          } catch (retryErr) {
            storageDegraded = true
            if (!warnedQuotaExceeded) {
              warnedQuotaExceeded = true
              console.warn('Unable to persist recovery snapshot to storage (quota exceeded). Proceeding with sync with degraded journal caching.', retryErr)
            }
          }
        } else {
          throw e
        }
      }
    },
    prepare(before: SyncLibrary, merged: SyncLibrary) {
      const activeBaseline = (journal.pending?.acknowledged && pendingMerged) ? pendingMerged : journal.baseline
      journal.baseline = activeBaseline
      journal.pending = { before, merged, acknowledged: false }
      pendingBefore = before
      pendingMerged = merged
      if (storageDegraded) return
      saveJournal()
    },
    acknowledge() {
      if (!journal.pending) throw new Error('Missing prepared sync journal')
      journal.pending.acknowledged = true
      if (storageDegraded) return
      saveJournal()
    },
    complete() {
      if (!journal.pending?.acknowledged) throw new Error('Upload is not acknowledged')
      journal.baseline = journal.pending.merged
      delete journal.pending
      pendingBefore = null
      pendingMerged = null
      if (storageDegraded) return
      saveJournal()
    },
  }
}

export function retireDriveSyncState(storage: Storage = localStorage): boolean {
  try {
    if (storage.getItem(SYNC_RETIRED_KEY) === 'true') {
      return true
    }

    let hasValidCanonical = false
    try {
      const saved = readPersistedLibrary(storage)
      if (saved && Array.isArray(saved.songs) && Array.isArray(saved.setlists)) {
        hasValidCanonical = true
      }
    } catch {
      hasValidCanonical = false
    }

    if (!hasValidCanonical) {
      return false
    }

    const syncKeys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k?.startsWith('gtar_sync_v1:')) {
        syncKeys.push(k)
      }
    }
    for (const k of syncKeys) {
      try { storage.removeItem(k) } catch { /* ignore */ }
    }

    try { storage.removeItem(ownerKey) } catch { /* ignore */ }
    pruneAllRecoverySnapshots(storage, 0)

    try {
      storage.setItem(SYNC_RETIRED_KEY, 'true')
      return true
    } catch {
      return false
    }
  } catch {
    return false
  }
}

export function performStorageHousekeeping(storage: Storage = localStorage) {
  try {
    // Only purge legacy stores if canonical library exists and is valid
    let hasValidCanonical = false
    try {
      const saved = readPersistedLibrary(storage)
      if (saved && Array.isArray(saved.songs) && Array.isArray(saved.setlists)) {
        hasValidCanonical = true
      }
    } catch {
      hasValidCanonical = false
    }

    if (hasValidCanonical) {
      storage.removeItem('gtar_songs_store')
      storage.removeItem('gtar_trash_songs_store')
      storage.removeItem('gtar_setlists_store')
      retireDriveSyncState(storage)
    }

    const maxSnapshots = storage.getItem(SYNC_RETIRED_KEY) === 'true' ? 0 : MAX_RECOVERY_SNAPSHOTS
    pruneAllRecoverySnapshots(storage, maxSnapshots)
    prunePersistedLogs(storage, 30)
  } catch {
    // Storage access might be restricted/unavailable in private modes
  }
}

export function persistLibrary(library: SyncLibrary, storage: Storage = localStorage) {
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library))
  } catch (err) {
    if (isQuotaError(err)) {
      // Emergency quota recovery:
      // 1. Purge all recovery snapshots
      pruneAllRecoverySnapshots(storage, 0)
      // 2. Trim debug logs down to 10 entries
      prunePersistedLogs(storage, 10)
      // 3. Attempt write after purging snapshots and logs
      try {
        storage.setItem(LIBRARY_KEY, JSON.stringify(library))
        // Canonical library is safely written; safe to remove legacy stores if any existed
        try {
          storage.removeItem('gtar_songs_store')
          storage.removeItem('gtar_trash_songs_store')
          storage.removeItem('gtar_setlists_store')
        } catch { /* ignore */ }
        return
      } catch (retryErr) {
        // 4. If write still failed, ONLY purge legacy stores if canonical library ALREADY existed
        // prior to this write (i.e. gtar_songs_store is guaranteed to NOT be the sole migration source!)
        let hasPriorCanonical = false
        try {
          const prior = readPersistedLibrary(storage)
          if (prior && Array.isArray(prior.songs) && Array.isArray(prior.setlists)) {
            hasPriorCanonical = true
          }
        } catch {
          hasPriorCanonical = false
        }

        if (hasPriorCanonical) {
          try {
            storage.removeItem('gtar_songs_store')
            storage.removeItem('gtar_trash_songs_store')
            storage.removeItem('gtar_setlists_store')
            storage.setItem(LIBRARY_KEY, JSON.stringify(library))
            return
          } catch { /* ignore */ }
        }

        throw new Error('Local browser storage quota exceeded. Free up device storage or export a backup.', { cause: retryErr })
      }
    }
    throw err
  }
}

export function readPersistedLibrary(storage: Storage = localStorage): SyncLibrary | null {
  const raw = storage.getItem(LIBRARY_KEY)
  if (!raw) return null
  const library = JSON.parse(raw) as SyncLibrary
  if (!Array.isArray(library.songs) || !Array.isArray(library.setlists)) throw new Error('Device library is damaged. Export recovery data before restoring.')
  return library
}

export function readRecoverySnapshots(account: string, storage: Storage = localStorage) {
  const snapshots: Record<string, unknown> = {}
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i)
    if (name?.startsWith(`gtar_sync_recovery:${account}:`)) snapshots[name] = storage.getItem(name)
  }
  return snapshots
}

export interface StorageFootprint {
  totalBytes: number
  totalMB: number
  keyCount: number
  keys: Record<string, number>
}

export function estimateStorageFootprint(storage: Storage = localStorage): StorageFootprint {
  let totalBytes = 0
  const keys: Record<string, number> = {}
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (!k) continue
      const val = storage.getItem(k) ?? ''
      const bytes = (k.length + val.length) * 2
      totalBytes += bytes
      keys[k] = bytes
    }
  } catch {
    // ignore
  }
  return {
    totalBytes,
    totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    keyCount: Object.keys(keys).length,
    keys,
  }
}

export function logStorageFootprint(tag: string, storage: Storage = localStorage) {
  try {
    const fp = estimateStorageFootprint(storage)
    console.info(`[StorageFootprint] [${tag}] Total: ${fp.totalMB} MB (${fp.totalBytes} bytes across ${fp.keyCount} keys)`)
  } catch { /* ignore */ }
}