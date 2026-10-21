import { validateCatalogLineage } from './catalogSetlistLineage'
import type { SyncLibrary } from './syncMerge'
import { prunePersistedLogs } from './logger'
import { RESTORE_SNAPSHOT_KEY } from './jsonBackup'
import { canonicalSongKey } from './musicalKey'
import { validateCloudThemeSettings } from './backupSettings'

const ownerKey = 'gtar_sync_library_owner'

export const LIBRARY_KEY = 'gtar_library_v1'
export const SYNC_RETIRED_KEY = 'gtar_sync_retired_v1'
export { RESTORE_SNAPSHOT_KEY }

import { STAGE_SESSION_KEY } from './stageSession'

export const STAGE_DOCK_POSITION_KEY = 'gtar_stage_dock_pos'
export const STAGE_CONTROLS_AUTO_HIDE_KEY = 'gtar_stage_controls_auto_hide'

export const CANONICAL_STORAGE_PREFIXES = [
  LIBRARY_KEY,
  'gtar_recovery_decisions_v1',
  SYNC_RETIRED_KEY,
  RESTORE_SNAPSHOT_KEY,
  STAGE_SESSION_KEY,
  STAGE_DOCK_POSITION_KEY,
  STAGE_CONTROLS_AUTO_HIDE_KEY,
  ownerKey,
  'gtar_sync_v1:',
  'gtar_songs_store',
  'gtar_trash_songs_store',
  'gtar_setlists_store',
  'gtar_active_setlist_id',
  'gtar_theme_store',
  'gtar_theme_mode',
  'gtar_custom_theme_colors',
  'gtar_factory_theme_overrides',
  'gtar_standalone_custom_theme_colors',
  'gtar_font_style_store',
  'gtar_font_style',
  'gtar_twocolumn_store',
  'gtar_is_two_column',
  'gtar_stage_font_size',
  'gtar_stage_scroll_speed',
  'gtar_edge_swipe_panel',
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
      try {
        const library = readPersistedLibrary(storage)
        const snapshot = JSON.parse(storage.getItem(oldest) ?? 'null')
        if (!library || !snapshot?.local || !Object.hasOwn(snapshot, 'remote') || snapshot.journal?.pending) continue
        let checked = reconcile(library, snapshot.local)
        if (snapshot.remote) checked = reconcile(checked, snapshot.remote)
        if (snapshot.journal?.baseline) checked = reconcile(checked, snapshot.journal.baseline)
        if (same(library, checked)) storage.removeItem(oldest)
      } catch { /* Ambiguous snapshots remain available for export. */ }
    }
  }
}

const legacyKeys = ['gtar_songs_store', 'gtar_trash_songs_store', 'gtar_setlists_store']
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k => Object.hasOwn(y, k) && same(x[k], y[k]))
}
const validId = (id: unknown) => (typeof id === 'string' && id.trim() !== '') || (typeof id === 'number' && Number.isFinite(id))

export function validateLibrary(value: unknown): asserts value is SyncLibrary {
  const fail = () => { throw new Error('Device library is damaged or ambiguous. Export recovery data before restoring.') }
  if (!value || typeof value !== 'object') return fail()
  const lib = value as SyncLibrary
  if (!Array.isArray(lib.songs) || !Array.isArray(lib.setlists)) return fail()
  const ids = new Set<string>(), lists = new Set<string>()
  for (const song of lib.songs) {
    if (!song || !validId(song.id) || typeof song.title !== 'string' || typeof song.rawContent !== 'string' || ids.has(String(song.id))) return fail()
    if (song.isDeleted !== undefined && typeof song.isDeleted !== 'boolean') return fail()
    ids.add(String(song.id))
  }
  for (const list of lib.setlists) {
    if (!list || !validId(list.id) || typeof list.name !== 'string' || !Array.isArray(list.songs) || lists.has(String(list.id))) return fail()
    if (list.catalogSource !== undefined) validateCatalogLineage(list.catalogSource)
    lists.add(String(list.id))
    for (const ref of list.songs) {
      if (!ref || !validId(ref.id) || !ids.has(String(ref.id)) || typeof ref.title !== 'string') return fail()
    }
  }
  if (lib.allowedUsers !== undefined && (!Array.isArray(lib.allowedUsers) || !lib.allowedUsers.every(x => typeof x === 'string'))) return fail()
  if (lib.themeSettings !== undefined && validateCloudThemeSettings(lib.themeSettings).length > 0) return fail()
}

// Only choose a changed record when the other side still equals the known base.
// Conflicting edits, unknown formats and uncertain uploads retain all sources.
function reconcile(local: SyncLibrary, incoming: SyncLibrary, base?: SyncLibrary): SyncLibrary {
  validateLibrary(incoming)
  if (base) validateLibrary(base)
  function records<T extends { id?: string | number }>(left: T[], right: T[], prior?: T[]): T[] {
    const l = new Map(left.map(x => [String(x.id), x])), r = new Map(right.map(x => [String(x.id), x]))
    const b = new Map((prior ?? []).map(x => [String(x.id), x]))
    const result: T[] = []
    for (const id of new Set([...l.keys(), ...r.keys()])) {
      const x = l.get(id), y = r.get(id), old = b.get(id)
      let chosen: T | undefined
      if (same(x, y)) chosen = x
      else if (prior && same(x, old)) chosen = y
      else if (prior && same(y, old)) chosen = x
      else if (!prior && (!x || !y)) chosen = x ?? y
      else throw new Error('Conflicting recovery records')
      if (chosen) result.push(chosen)
    }
    if (prior && same(left.map(x => String(x.id)), prior.map(x => String(x.id)))) {
      const byId = new Map(result.map(x => [String(x.id), x]))
      const ordered = right.map(x => byId.get(String(x.id))).filter((x): x is T => x !== undefined)
      const included = new Set(ordered.map(x => String(x.id)))
      return [...ordered, ...result.filter(x => !included.has(String(x.id)))]
    }
    return result
  }
  const result = { ...local, songs: records(local.songs, incoming.songs, base?.songs), setlists: records(local.setlists, incoming.setlists, base?.setlists) }
  if (incoming.allowedUsers !== undefined && !same(local.allowedUsers, incoming.allowedUsers)) throw new Error('Conflicting legacy access settings')
  validateLibrary(result)
  return result
}

function resolvePending(base: SyncLibrary | null, value: unknown): SyncLibrary {
  if (!value || typeof value !== 'object') throw new Error('Missing pending library')
  if ('songs' in value) { validateLibrary(value); return value }
  const d = value as { changedSongs: SyncLibrary['songs']; deletedSongIds: unknown[]; songIdsOrder?: unknown[]; setlists: SyncLibrary['setlists']; allowedUsers?: string[] }
  if (!Array.isArray(d.changedSongs) || !Array.isArray(d.deletedSongIds) || !d.deletedSongIds.every(validId)) throw new Error('Invalid pending delta')
  validateLibrary({ songs: d.changedSongs, setlists: [] })
  const songs = new Map((base?.songs ?? []).map(x => [String(x.id), x]))
  for (const id of d.deletedSongIds) songs.delete(String(id))
  for (const song of d.changedSongs) songs.set(String(song.id), song)
  let ordered = [...songs.values()]
  if (d.songIdsOrder !== undefined) {
    if (!Array.isArray(d.songIdsOrder) || d.songIdsOrder.length !== songs.size || new Set(d.songIdsOrder.map(String)).size !== songs.size || !d.songIdsOrder.every(id => validId(id) && songs.has(String(id)))) throw new Error('Invalid delta ordering')
    ordered = d.songIdsOrder.map(id => songs.get(String(id))!)
  }
  const result = { songs: ordered, setlists: d.setlists, ...(d.allowedUsers === undefined ? {} : { allowedUsers: d.allowedUsers }) }
  validateLibrary(result)
  return result
}

export function recoveryData(storage: Storage = localStorage): Record<string, string> {
  const data: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && (k === LIBRARY_KEY || k === ownerKey || k === RECOVERY_DECISIONS_KEY || legacyKeys.includes(k) || k.startsWith('gtar_sync_v1:') || k.startsWith('gtar_sync_recovery:'))) data[k] = storage.getItem(k) ?? ''
  }
  return data
}

// Decisions preserve exact source bytes and the chosen library. They never remove archives.
export const RECOVERY_DECISIONS_KEY = 'gtar_recovery_decisions_v1'
export interface RecoveryRecordDifference {
  kind: 'song' | 'setlist'
  id: string
  title: string
  deleted: boolean
  difference: 'missing' | 'divergent'
  record: unknown
}
export interface RecoverySourceReview {
  key: string
  raw: string
  status: 'represented' | 'actionable' | 'invalid' | 'resolved'
  differences: RecoveryRecordDifference[]
  canKeepCurrent: boolean
}
interface RecoveryDecision {
  choice: 'keep-current' | 'reopen'
  libraryRaw: string
  sources: Record<string, string>
}
export interface RecoveryReview {
  libraryRaw: string | null
  decisionRaw: string | null
  invalid: boolean
  sources: RecoverySourceReview[]
  missingRecords: number
  divergentVersions: number
}

function recoveryCandidates(key: string, raw: string): { candidates: SyncLibrary[]; pending: boolean } {
  const snapshot = JSON.parse(raw)
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Unknown recovery format')
  if (key.startsWith('gtar_sync_v1:')) {
    if (snapshot.version !== 1) throw new Error('Unknown journal version')
    const candidates = snapshot.baseline ? [snapshot.baseline] : []
    candidates.forEach(validateLibrary)
    return { candidates, pending: Boolean(snapshot.pending) }
  }
  let candidates: SyncLibrary[]
  if (Object.hasOwn(snapshot, 'raw')) {
    if (Object.keys(snapshot).length !== 1 || typeof snapshot.raw !== 'string') throw new Error('Unknown raw envelope')
    candidates = [JSON.parse(snapshot.raw)]
  } else if (Object.hasOwn(snapshot, 'songs')) candidates = [snapshot]
  else {
    if (!snapshot.local) throw new Error('Unknown recovery format')
    candidates = [snapshot.local, snapshot.remote, snapshot.journal?.baseline].filter(value => value != null)
  }
  candidates.forEach(validateLibrary)
  return { candidates, pending: Boolean(snapshot.journal?.pending) }
}

function readRecoveryDecisions(raw: string | null): RecoveryDecision[] {
  if (raw === null) return []
  const value = JSON.parse(raw)
  if (value?.version !== 1 || !Array.isArray(value.decisions)) throw new Error('Invalid recovery decisions')
  for (const decision of value.decisions) {
    if (!decision || !['keep-current', 'reopen'].includes(decision.choice) || typeof decision.libraryRaw !== 'string' ||
        !decision.sources || typeof decision.sources !== 'object' || Array.isArray(decision.sources)) throw new Error('Invalid recovery decision')
    validateLibrary(JSON.parse(decision.libraryRaw))
    for (const [key, source] of Object.entries(decision.sources)) {
      if ((!key.startsWith('gtar_sync_recovery:') && !key.startsWith('gtar_sync_v1:') && key !== 'legacy') || typeof source !== 'string') throw new Error('Invalid decision source')
    }
  }
  return value.decisions
}

// Read-only review uses the same representation rule as the import guard.
export function inspectRecovery(storage: Storage = localStorage): RecoveryReview {
  const review: RecoveryReview = { libraryRaw: null, decisionRaw: null, invalid: false, sources: [], missingRecords: 0, divergentVersions: 0 }
  try {
    review.libraryRaw = storage.getItem(LIBRARY_KEY)
    const library = readPersistedLibrary(storage)
    review.decisionRaw = storage.getItem(RECOVERY_DECISIONS_KEY)
    let decisions: RecoveryDecision[] = []
    try { decisions = readRecoveryDecisions(review.decisionRaw) } catch { review.invalid = true }
    const sources = recoveryData(storage)
    delete sources[RECOVERY_DECISIONS_KEY]
    const entries = Object.entries(sources).filter(([key]) => key !== LIBRARY_KEY && key !== ownerKey && !legacyKeys.includes(key))
    if (legacyKeys.some(key => key in sources)) {
      // Preserve the original bytes too: a legacy source changes if any constituent changes.
      entries.push(['legacy', JSON.stringify(legacyKeys.map(key => sources[key] ?? null))])
    }
    if (!library) review.invalid = true
    for (const [key, raw] of entries) {
      const item: RecoverySourceReview = { key, raw, status: 'represented', differences: [], canKeepCurrent: false }
      review.sources.push(item)
      try {
        let candidates: SyncLibrary[], pending = false
        if (key === 'legacy') {
          const [songRaw, trashRaw, setlistRaw] = JSON.parse(raw)
          const songs = JSON.parse(songRaw ?? '[]'), trash = JSON.parse(trashRaw ?? '[]'), setlists = JSON.parse(setlistRaw ?? '[]')
          if (!Array.isArray(songs) || !Array.isArray(trash)) throw new Error('Invalid legacy records')
          candidates = [{ songs: [...songs, ...trash.map(song => ({ ...song, isDeleted: true }))], setlists }]
          candidates.forEach(validateLibrary)
        } else ({ candidates, pending } = recoveryCandidates(key, raw))
        if (!library) throw new Error('Canonical library unavailable')
        let represented = !pending
        for (const candidate of candidates) {
          for (const kind of ['song', 'setlist'] as const) {
            const records = kind === 'song' ? candidate.songs : candidate.setlists
            const current = new Map((kind === 'song' ? library.songs : library.setlists).map(record => [String(record.id), record]))
            for (const record of records) {
              const existing = current.get(String(record.id))
              if (!existing || !same(existing, record)) item.differences.push({
                kind, id: String(record.id), title: 'title' in record ? String(record.title) : record.name,
                deleted: Boolean(record.isDeleted), difference: existing ? 'divergent' : 'missing', record,
              })
            }
          }
          try { if (!same(library, reconcile(library, candidate))) represented = false }
          catch { represented = false }
        }
        item.status = represented ? 'represented' : 'actionable'
        // Unknown/pending operations and legacy access-setting conflicts require manual recovery.
        item.canKeepCurrent = !represented && !pending && candidates.every(candidate => candidate.allowedUsers === undefined || same(library.allowedUsers, candidate.allowedUsers))
        if (item.canKeepCurrent) {
          const decision = [...decisions].reverse().find(value => value.sources[key] === raw)
          if (decision?.choice === 'keep-current') item.status = 'resolved'
        }
      } catch { item.status = 'invalid'; review.invalid = true }
    }
    const differences = review.sources.flatMap(source => source.differences)
    review.missingRecords = new Set(differences.filter(record => record.difference === 'missing').map(record => JSON.stringify([record.kind, record.id]))).size
    review.divergentVersions = differences.filter((record, index) => record.difference === 'divergent' &&
      differences.findIndex(other => other.kind === record.kind && other.id === record.id && same(other.record, record.record)) === index).length
  } catch { review.invalid = true }
  return review
}

export function hasActionableRecovery(storage: Storage = localStorage): boolean {
  const review = inspectRecovery(storage)
  return review.invalid || review.sources.some(source => source.status === 'actionable' || source.status === 'invalid')
}

// Explicit operator choice only. No library write, source replacement, pruning or cloud action.
// The append-only decision preserves the pre-choice library and exact historical sources.
export async function recordRecoveryChoice(review: RecoveryReview, choice: RecoveryDecision['choice'], blocked: () => boolean, storage: Storage = localStorage): Promise<void> {
  if (!navigator.locks?.request) throw new Error('Safe recovery resolution requires Web Locks support.')
  await navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock || blocked()) throw new Error('Resolve editor edits or active cross-tab conflicts before choosing a recovery version.')
    const fresh = inspectRecovery(storage)
    if (!same(review, fresh) || fresh.invalid || !fresh.libraryRaw) throw new Error('Recovery changed or is invalid. Review again.')
    const selected = fresh.sources.filter(source => choice === 'keep-current' ? source.status === 'actionable' : source.status === 'resolved')
    if (!selected.length || selected.some(source => !source.canKeepCurrent)) throw new Error('Pending or unsupported recovery requires manual recovery. Export all recovery data.')
    const decisions = readRecoveryDecisions(fresh.decisionRaw)
    decisions.push({ choice, libraryRaw: fresh.libraryRaw, sources: Object.fromEntries(selected.map(source => [source.key, source.raw])) })
    const payload = JSON.stringify({ version: 1, decisions })
    // No awaits between revalidation and this single-key transaction.
    try { storage.setItem(RECOVERY_DECISIONS_KEY, payload) }
    catch (err) {
      if (isQuotaError(err)) throw new Error('Not enough browser storage to preserve this decision. Export recovery data; no sources were removed.', { cause: err })
      throw err
    }
    if (storage.getItem(RECOVERY_DECISIONS_KEY) !== payload) throw new Error('Recovery decision could not be verified. Export recovery data and review again.')
    if (typeof window !== 'undefined' && storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted'))
  })
}

export function retireDriveSyncState(storage: Storage = localStorage): boolean {
  try {
    // Explicit historical-version choices must not be undone by legacy startup migration.
    // Decision sources and their baseline also remain available for export and reopening.
    if (storage.getItem(RECOVERY_DECISIONS_KEY) !== null) return false
    const expectedRaw = storage.getItem(LIBRARY_KEY)
    let library = readPersistedLibrary(storage)
    if (!library) return false
    const superseded: SyncLibrary[] = []
    const sources = recoveryData(storage)
    const keys = Object.keys(sources).filter(k => k !== LIBRARY_KEY && k !== ownerKey && k !== RECOVERY_DECISIONS_KEY)
    for (const k of keys.filter(k => k.startsWith('gtar_sync_v1:'))) {
      const journal = JSON.parse(sources[k])
      if (journal.version !== 1) return false
      if (journal.baseline != null) validateLibrary(journal.baseline)
      if (journal.pending) {
        if (journal.pending.acknowledged !== true) return false
        const before = resolvePending(journal.baseline, journal.pending.beforeDelta ?? journal.pending.before)
        const merged = resolvePending(journal.baseline, journal.pending.mergedDelta ?? journal.pending.merged)
        library = reconcile(library, merged, before)
        superseded.push(before)
        if (journal.baseline) superseded.push(journal.baseline)
      } else if (journal.baseline) {
        library = reconcile(library, journal.baseline)
      }
    }
    const absorb = (incoming: SyncLibrary) => {
      validateLibrary(incoming)
      if (!superseded.some(old => same(old, incoming))) library = reconcile(library!, incoming)
    }
    for (const k of keys.filter(k => k.startsWith('gtar_sync_recovery:'))) {
      const snapshot = JSON.parse(sources[k])
      if (!snapshot.local || !Object.hasOwn(snapshot, 'remote')) return false
      absorb(snapshot.local)
      if (snapshot.remote !== null) absorb(snapshot.remote)
      if (snapshot.journal?.baseline) absorb(snapshot.journal.baseline)
      if (snapshot.journal?.pending) return false
    }
    if (legacyKeys.some(k => k in sources)) {
      const songs = JSON.parse(sources[legacyKeys[0]] ?? '[]')
      const trash = JSON.parse(sources[legacyKeys[1]] ?? '[]')
      const setlists = JSON.parse(sources[legacyKeys[2]] ?? '[]')
      if (!Array.isArray(songs) || !Array.isArray(trash)) return false
      absorb({ songs: [...songs, ...trash.map(song => ({ ...song, isDeleted: true }))], setlists })
    }
    // Commit and read back before deleting anything, including the retirement marker.
    persistLibrary(library, storage, { expectedRaw })
    if (!same(readPersistedLibrary(storage), library)) return false
    storage.setItem(SYNC_RETIRED_KEY, 'true')
    for (const k of [...keys, ownerKey]) if (storage.getItem(k) !== null) storage.removeItem(k)
    return true
  } catch { return false }
}

export class StaleWriteConflictError extends Error {
  readonly code = 'STALE_WRITE_CONFLICT' as const
  readonly currentPersistedRaw: string | null
  readonly localLibrary: SyncLibrary

  constructor(message: string, currentPersistedRaw: string | null, localLibrary: SyncLibrary) {
    super(message)
    this.name = 'StaleWriteConflictError'
    this.currentPersistedRaw = currentPersistedRaw
    this.localLibrary = localLibrary
  }
}

export function isStaleWriteConflictError(err: unknown): err is StaleWriteConflictError {
  if (!err || typeof err !== 'object') return false
  return (
    err instanceof StaleWriteConflictError ||
    (err as { code?: string }).code === 'STALE_WRITE_CONFLICT' ||
    (err as { name?: string }).name === 'StaleWriteConflictError'
  )
}

export interface PersistLibraryOptions {
  expectedRaw?: string | null
  force?: boolean
}

const lastKnownLibraryRawByStorage = new WeakMap<Storage, string | null>()

export function getPersistedLibraryRaw(storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(LIBRARY_KEY)
  } catch {
    return null
  }
}

export function getLastKnownPersistedLibraryRaw(storage: Storage = localStorage): string | null | undefined {
  return lastKnownLibraryRawByStorage.get(storage)
}

export function setLastKnownPersistedLibraryRaw(raw: string | null, storage: Storage = localStorage): void {
  lastKnownLibraryRawByStorage.set(storage, raw)
}

export function saveCrossTabConflictSnapshot(draft: SyncLibrary, storage: Storage = localStorage): string {
  validateLibrary(draft)
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  const key = `gtar_sync_recovery:cross-tab-conflict:${Date.now()}:${id}`
  const payload = JSON.stringify(draft)
  try {
    storage.setItem(key, payload)
  } catch (err) {
    if (isQuotaError(err)) {
      prunePersistedLogs(storage, 10)
      storage.setItem(key, payload)
    } else throw err
  }
  if (storage.getItem(key) !== payload) throw new Error('Recovery snapshot could not be verified. Keep this tab open and export your draft.')
  return key
}

// Preserve exact stored bytes, including damaged data, before an authorized replacement.
export function preserveStoredLibrary(raw: string | null, storage: Storage = localStorage): void {
  if (raw === null) return
  const key = `gtar_sync_recovery:replacement:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const payload = JSON.stringify({ raw })
  storage.setItem(key, payload)
  if (storage.getItem(key) !== payload) throw new Error('Current stored version could not be preserved. Replacement cancelled.')
}

// Cloud download/merge saves plain-library snapshots, unlike legacy Drive envelopes.
// Retire only archives whose records are already covered by durable canonical storage.
// Conflicts, unknown formats and pre-restore safety snapshots remain untouched.
export function retireRepresentedCloudSnapshots(storage: Storage = localStorage): void {
  try {
    const library = readPersistedLibrary(storage)
    if (!library) return
    const sources = recoveryData(storage)
    for (const [key, raw] of Object.entries(sources)) {
      if (!key.startsWith('gtar_sync_recovery:')) continue
      try {
        const snapshot = JSON.parse(raw)
        if (!snapshot || !Object.hasOwn(snapshot, 'songs')) continue
        validateLibrary(snapshot)
        if (same(library, reconcile(library, snapshot))) storage.removeItem(key)
      } catch { /* Ambiguous or conflicting archives remain exportable. */ }
    }
  } catch { /* Canonical storage must be readable before retirement. */ }
}

export function performStorageHousekeeping(storage: Storage = localStorage) {
  const retired = retireDriveSyncState(storage)
  try { prunePersistedLogs(storage, 30) } catch { /* Storage unavailable */ }
  return retired
}

export function persistLibrary(
  library: SyncLibrary,
  storage: Storage = localStorage,
  options?: PersistLibraryOptions
) {
  validateLibrary(library)
  const { themeSettings: _ignoredTheme, ...libraryWithoutTheme } = library
  void _ignoredTheme
  const canonicalized: SyncLibrary = {
    ...libraryWithoutTheme,
    songs: library.songs.map(song => ({
      ...song,
      ...(song.key === undefined ? {} : { key: canonicalSongKey(song.key) })
    }))
  }

  const payload = JSON.stringify(canonicalized)
  const currentRaw = storage.getItem(LIBRARY_KEY)
  const hasExpected = options?.expectedRaw !== undefined
  const expectedRaw = options?.expectedRaw
  let isIdentical = currentRaw === payload
  if (!isIdentical && currentRaw !== null) {
    try {
      // Compare the persisted representation: optional undefined fields are omitted.
      isIdentical = same(JSON.parse(currentRaw), JSON.parse(payload))
    } catch { /* Unparseable external storage must not bypass the revision gate. */ }
  }

  if (!options?.force && hasExpected && currentRaw !== expectedRaw && !isIdentical) {
    throw new StaleWriteConflictError(
      'Songbook library was updated in another tab or instance. Persistence rejected to prevent data loss.',
      currentRaw,
      canonicalized
    )
  }

  // Compare after the revision gate: identical saves need neither a write nor cleanup.
  if (isIdentical) {
    lastKnownLibraryRawByStorage.set(storage, currentRaw)
    return
  }

  try {
    storage.setItem(LIBRARY_KEY, payload)
  } catch (err) {
    if (!isQuotaError(err)) throw err
    // Logs are disposable. Journals, snapshots and legacy stores are not.
    try { prunePersistedLogs(storage, 10) } catch { /* Log cleanup must not mask the write error. */ }
    const retryRaw = storage.getItem(LIBRARY_KEY)
    if (retryRaw !== currentRaw) {
      throw new StaleWriteConflictError('Songbook library changed while retrying persistence.', retryRaw, canonicalized)
    }
    try { storage.setItem(LIBRARY_KEY, payload) }
    catch (retryErr) {
      if (!isQuotaError(retryErr)) throw retryErr
      throw new Error('Local browser storage quota exceeded. Free up device storage or export a backup.', { cause: retryErr })
    }
  }

  if (storage.getItem(LIBRARY_KEY) !== payload) {
    throw new Error('Songbook save could not be verified. Keep this tab open and export your draft.')
  }
  lastKnownLibraryRawByStorage.set(storage, payload)
  // Recovery archives remain exportable even when represented by the saved library.
  if (typeof window !== 'undefined') {
    try {
      if (storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted'))
    } catch { /* Notification failure cannot invalidate a verified save. */ }
  }
}

export function readPersistedLibrary(storage: Storage = localStorage): SyncLibrary | null {
  const raw = storage.getItem(LIBRARY_KEY)
  lastKnownLibraryRawByStorage.set(storage, raw)
  if (!raw) return null
  const library: unknown = JSON.parse(raw)
  validateLibrary(library)
  return { ...library, songs: library.songs.map(song => ({ ...song, ...(song.key === undefined ? {} : { key: canonicalSongKey(song.key) }) })) }
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

export async function requestDurableStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
    return false
  }
  try {
    if (typeof navigator.storage.persisted === 'function') {
      const alreadyPersisted = await navigator.storage.persisted()
      if (alreadyPersisted) return true
    }
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function setupCrossTabLibraryConflictGuard(
  onConflict: (externalRaw: string | null) => void,
  targetWindow: Window | EventTarget = typeof window !== 'undefined' ? window : ({} as unknown as EventTarget)
): () => void {
  if (!targetWindow || typeof (targetWindow as EventTarget).addEventListener !== 'function') {
    return () => {}
  }
  const handler = (event: Event) => {
    const storageEvent = event as StorageEvent
    if (storageEvent.key !== LIBRARY_KEY) return
    onConflict(storageEvent.newValue ?? null)
  }
  ;(targetWindow as EventTarget).addEventListener('storage', handler as EventListener)
  return () => {
    if (typeof (targetWindow as EventTarget).removeEventListener === 'function') {
      ;(targetWindow as EventTarget).removeEventListener('storage', handler as EventListener)
    }
  }
}
export interface DanglingReferenceRepair {
  raw: string
  references: Array<{ setlistId: string | number; name: string; position: number; songId: string | number; title: string }>
}

/** Strict validation of the copied remainder proves missing IDs are the sole defect. */
function danglingReferenceCandidate(raw: string) {
  const library = JSON.parse(raw) as SyncLibrary
  if (!library || !Array.isArray(library.songs) || !Array.isArray(library.setlists)) throw new Error('Unsupported recovery data.')
  // Validate songs, duplicates and top-level fields before considering references.
  validateLibrary({ ...library, setlists: [] })
  const ids = new Set(library.songs.map(song => String(song.id)))
  const references: DanglingReferenceRepair['references'] = []
  const repaired = { ...library, setlists: library.setlists.map(list => {
    if (!list || !Array.isArray(list.songs)) throw new Error('Unsupported setlist record.')
    return { ...list, songs: list.songs.filter((ref, position) => {
      if (!ref || !validId(ref.id) || typeof ref.title !== 'string') throw new Error('Unsupported song reference.')
      if (ids.has(String(ref.id))) return true
      references.push({ setlistId: list.id, name: list.name, position, songId: ref.id!, title: ref.title })
      return false
    }) }
  }) }
  validateLibrary(repaired)
  if (!references.length) throw new Error('No dangling references to repair.')
  return { repaired, references }
}

export function planDanglingReferenceRepair(storage: Storage = localStorage): DanglingReferenceRepair | null {
  try {
    const raw = storage.getItem(LIBRARY_KEY)
    if (raw === null) return null
    return { raw, references: danglingReferenceCandidate(raw).references }
  } catch { return null }
}

/** Explicit caller confirmation only. Refuse stale previews and preserve exact input first. */
export function applyDanglingReferenceRepair(plan: DanglingReferenceRepair, storage: Storage = localStorage): void {
  if (storage.getItem(LIBRARY_KEY) !== plan.raw) throw new Error('Library changed. Preview repair again.')
  const { repaired, references } = danglingReferenceCandidate(plan.raw)
  if (JSON.stringify(references) !== JSON.stringify(plan.references)) throw new Error('Repair preview does not match current references.')
  validateLibrary(repaired)
  // Invalid raw archive fails strict snapshot validation and remains exportable.
  const archive = 'gtar_sync_recovery:dangling-references:' + Date.now() + ':' + Math.random().toString(36).slice(2)
  storage.setItem(archive, plan.raw)
  if (storage.getItem(archive) !== plan.raw) throw new Error('Could not preserve original recovery data.')
  if (storage.getItem(LIBRARY_KEY) !== plan.raw) throw new Error('Library changed. Preview repair again.')
  storage.setItem(LIBRARY_KEY, JSON.stringify(repaired))
  readPersistedLibrary(storage)
  if (typeof window !== 'undefined' && storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted'))
}
