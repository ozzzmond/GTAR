import type { SyncLibrary } from './syncMerge'
import { prunePersistedLogs } from './logger'

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