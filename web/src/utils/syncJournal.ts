import { mergeSyncLibrary, type SyncLibrary } from './syncMerge'

interface Journal {
  version: 1
  baseline: SyncLibrary | null
  pending?: { before: SyncLibrary; merged: SyncLibrary; acknowledged: boolean }
}
const key = (account: string) => `gtar_sync_v1:${account}`
const ownerKey = 'gtar_sync_library_owner'
const MAX_RECOVERY_SNAPSHOTS = 2

export function isQuotaError(err: unknown): boolean {
  if (!err) return false
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014
  }
  if (err instanceof Error) {
    return err.name === 'QuotaExceededError' || /quota/i.test(err.message)
  }
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    return (
      e.name === 'QuotaExceededError' ||
      e.code === 22 ||
      e.code === 1014 ||
      (typeof e.message === 'string' && /quota/i.test(e.message))
    )
  }
  return false
}

export function pruneRecoverySnapshots(storage: Storage, account: string, maxAllowed: number) {
  const prefix = `gtar_sync_recovery:${account}:`
  const existingKeys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(prefix)) existingKeys.push(k)
  }
  existingKeys.sort()
  while (existingKeys.length > maxAllowed) {
    const oldest = existingKeys.shift()
    if (oldest) {
      try { storage.removeItem(oldest) } catch { /* ignore storage error on remove */ }
    }
  }
}

export function pruneAllRecoverySnapshots(storage: Storage, maxAllowed = 0) {
  const prefix = 'gtar_sync_recovery:'
  const existingKeys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(prefix)) existingKeys.push(k)
  }
  existingKeys.sort()
  while (existingKeys.length > maxAllowed) {
    const oldest = existingKeys.shift()
    if (oldest) {
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
      storage.setItem(ownerKey, account)
    } else {
      throw err
    }
  }
  const raw = storage.getItem(key(account))
  const journal: Journal = raw ? JSON.parse(raw) : { version: 1, baseline: null }
  if (journal.version !== 1) throw new Error('Unsupported sync recovery state. Export device data before recovery.')
  const resumed = resumePending && journal.pending?.acknowledged
    ? mergeSyncLibrary(local, journal.pending.merged, journal.pending.before) : local
  const baseline = journal.pending?.acknowledged ? journal.pending.merged : journal.baseline
  return {
    local: resumed, baseline,
    archive(remote: SyncLibrary | null) {
      // Prune older recovery entries to keep at most MAX_RECOVERY_SNAPSHOTS - 1 before adding new
      pruneRecoverySnapshots(storage, account, Math.max(0, MAX_RECOVERY_SNAPSHOTS - 1))
      const prefix = `gtar_sync_recovery:${account}:`
      const recovery = `${prefix}${Date.now()}_${crypto.randomUUID()}`
      const minimalSnapshot = JSON.stringify({
        timestamp: Date.now(),
        local,
        remote,
        journal: { version: journal.version, baseline: journal.baseline }
      })
      try {
        storage.setItem(recovery, minimalSnapshot)
      } catch (e) {
        if (isQuotaError(e)) {
          console.warn('Initial recovery snapshot save failed (quota exceeded). Purging older snapshots down to 0.', e)
          pruneRecoverySnapshots(storage, account, 0)
          try {
            storage.setItem(recovery, minimalSnapshot)
          } catch (retryErr) {
            // Gracefully degrade local backup journal caching without crashing the sync process
            console.warn('Unable to persist recovery snapshot to storage (quota exceeded). Proceeding with sync with degraded journal caching.', retryErr)
          }
        } else {
          throw e
        }
      }
    },
    prepare(before: SyncLibrary, merged: SyncLibrary) {
      journal.baseline = baseline
      journal.pending = { before, merged, acknowledged: false }
      try {
        storage.setItem(key(account), JSON.stringify(journal))
      } catch (err) {
        if (isQuotaError(err)) {
          // Free recovery snapshots if quota is hit when updating the journal
          pruneRecoverySnapshots(storage, account, 0)
          try {
            storage.setItem(key(account), JSON.stringify(journal))
          } catch (retryErr) {
            console.warn('Unable to persist sync journal pending state (quota exceeded). Proceeding in-memory.', retryErr)
          }
        } else {
          throw err
        }
      }
    },
    complete() {
      if (!journal.pending?.acknowledged) throw new Error('Upload is not acknowledged')
      journal.baseline = journal.pending.merged
      delete journal.pending
      try {
        storage.setItem(key(account), JSON.stringify(journal))
      } catch (err) {
        if (isQuotaError(err)) {
          pruneRecoverySnapshots(storage, account, 0)
          try {
            storage.setItem(key(account), JSON.stringify(journal))
          } catch (retryErr) {
            console.warn('Unable to persist sync journal completed state (quota exceeded). Proceeding in-memory.', retryErr)
          }
        } else {
          throw err
        }
      }
    },
    acknowledge() {
      if (!journal.pending) throw new Error('Missing prepared sync journal')
      journal.pending.acknowledged = true
      try {
        storage.setItem(key(account), JSON.stringify(journal))
      } catch (err) {
        if (isQuotaError(err)) {
          pruneRecoverySnapshots(storage, account, 0)
          try {
            storage.setItem(key(account), JSON.stringify(journal))
          } catch (retryErr) {
            console.warn('Unable to persist sync journal acknowledge state (quota exceeded). Proceeding in-memory.', retryErr)
          }
        } else {
          throw err
        }
      }
    },
  }
}

export const LIBRARY_KEY = 'gtar_library_v1'
export function persistLibrary(library: SyncLibrary, storage: Storage = localStorage) {
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library))
  } catch (err) {
    if (isQuotaError(err)) {
      pruneAllRecoverySnapshots(storage, 0)
      try {
        storage.setItem(LIBRARY_KEY, JSON.stringify(library))
        return
      } catch (retryErr) {
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