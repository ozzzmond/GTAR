/**
 * #304 item 8 (owner-approved follow-up): "Delete recovery data" after "Save recovery data".
 * Removes every recovery copy covered by the save — readable or not — by compare-and-delete: a key
 * goes only while its current value is still exactly the saved one. Hard allowlist; the current
 * library, B2 data, backups, settings, owner keys and debug logs are never touched. Anything else
 * listed as a recovery source stays and is reported.
 */
import { RECOVERY_DECISIONS_KEY, RESTORE_SNAPSHOT_KEY } from './syncJournal'
import { ARCHIVE_PREFIX, recoveryArchiveGet, recoveryArchivesInIndexedDb, removeRecoveryArchive } from './recoveryArchiveStore'
import type { SavedRecoveryData } from './recoveryDataSummary'

export class RecoveryDataChangedError extends Error {
  constructor() { super('Recovery data changed since you saved it. Save it again first.'); this.name = 'RecoveryDataChangedError' }
}

/** Recovery-copy keys this action may remove (the decision file is handled separately). */
export function isDeletableRecoveryKey(key: string): boolean {
  return key.startsWith(ARCHIVE_PREFIX) || key === RESTORE_SNAPSHOT_KEY
}

type Location = 'storage' | 'archive-store'
/** Where the saved value currently lives, or null when it changed or is gone. */
function locate(key: string, raw: string, storage: Storage): Location | null {
  if (storage.getItem(key) === raw) return 'storage'
  if (key.startsWith(ARCHIVE_PREFIX) && recoveryArchivesInIndexedDb() && recoveryArchiveGet(key) === raw) return 'archive-store'
  return null
}

/** Decision file without references to `removed` keys; null when nothing is left in it. Throws if unreadable. */
export function pruneRecoveryDecisions(raw: string, removed: Set<string>, depth = 0): string | null {
  if (depth > 2) throw new Error('Invalid nested recovery decisions')
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !Array.isArray(value.decisions)) throw new Error('Invalid recovery decisions')
  const decisions = value.decisions
    .map((decision: { sources: Record<string, unknown> }) => ({ ...decision, sources: Object.fromEntries(Object.entries(decision.sources ?? {}).filter(([key]) => !removed.has(key))) }))
    .filter((decision: { sources: Record<string, unknown> }) => Object.keys(decision.sources).length > 0)
  const legacyField = value.version === 2 ? 'legacyV1Raw' : value.version === 3 ? 'legacyRaw' : null
  const next: Record<string, unknown> = { ...value, decisions }
  if (legacyField && typeof value[legacyField] === 'string') next[legacyField] = pruneRecoveryDecisions(value[legacyField], removed, depth + 1)
  if (!decisions.length && (!legacyField || next[legacyField] === null)) return null
  return JSON.stringify(next)
}

export interface RecoveryDeleteResult { removed: string[]; kept: string[] }

/**
 * Deletes the saved recovery copies. Every allowlisted copy is checked against its saved value
 * first; if any changed, nothing is deleted. A change found midway stops the run.
 */
export async function deleteSavedRecoveryData(saved: SavedRecoveryData, blocked: () => boolean, storage: Storage = localStorage): Promise<RecoveryDeleteResult> {
  if (!navigator.locks?.request) throw new Error('Deleting recovery data requires Web Locks support.')
  return navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock || blocked()) throw new Error('Close the editor and any other GTAR tabs, then try again.')
    const targets = saved.sources.filter(([key]) => isDeletableRecoveryKey(key))
    const kept = saved.sources.filter(([key]) => !isDeletableRecoveryKey(key)).map(([key]) => key)
    const planned = targets.map(([key, raw]) => ({ key, raw, at: locate(key, raw, storage) }))
    if (planned.some(item => item.at === null) || storage.getItem(RECOVERY_DECISIONS_KEY) !== saved.decisionRaw) throw new RecoveryDataChangedError()

    const removed: string[] = []
    try {
      for (const item of planned) {
        if (blocked()) throw new Error('Close the editor and any other GTAR tabs, then try again.')
        if (item.at === 'storage') {
          if (storage.getItem(item.key) !== item.raw) throw new RecoveryDataChangedError()
          storage.removeItem(item.key)
          if (storage.getItem(item.key) !== null) throw new Error('Recovery copy could not be removed.')
        } else if (!await removeRecoveryArchive(item.key, item.raw)) throw new RecoveryDataChangedError()
        removed.push(item.key)
      }
      // The decision file must no longer point at removed copies; an unreadable one is in the saved file and goes.
      if (saved.decisionRaw !== null && removed.length) {
        if (storage.getItem(RECOVERY_DECISIONS_KEY) !== saved.decisionRaw) throw new RecoveryDataChangedError()
        let next: string | null
        try { next = kept.length ? pruneRecoveryDecisions(saved.decisionRaw, new Set(removed)) : null }
        catch { next = null }
        if (next === null) storage.removeItem(RECOVERY_DECISIONS_KEY)
        else storage.setItem(RECOVERY_DECISIONS_KEY, next)
        if (storage.getItem(RECOVERY_DECISIONS_KEY) !== next) throw new Error('Recovery decisions could not be updated.')
      }
    } finally {
      if (removed.length && typeof window !== 'undefined' && storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted'))
    }
    return { removed, kept }
  })
}
