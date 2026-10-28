import { validateCatalogLineage } from './catalogSetlistLineage'
import type { SyncLibrary } from './syncMerge'
import { appLogger, prunePersistedLogs } from './logger'
import { RESTORE_SNAPSHOT_KEY } from './jsonBackup'
import { canonicalSongKey } from './musicalKey'
import { validateCloudThemeSettings } from './backupSettings'
import { recoverySourceDigest } from './recoverySourceDigest'
import { ARCHIVE_PREFIX, IDB_RECOVERY_MAX_BYTES, IDB_RECOVERY_MAX_COUNT, getRetiredLibrary, putRecoveryArchive, putRetiredLibrary, recoveryArchiveEntries,
  recoveryArchiveGet, recoveryArchivesInIndexedDb, removeRecoveryArchive } from './recoveryArchiveStore'
import { LIBRARY_B1_KEY, LIBRARY_B1_OPTOUT_KEY, LIBRARY_V2_KEY, confirmPendingLibraryBodies, decodeLibraryIndex, encodeLibraryIndex,
  loadLibraryIndexBodies, rememberLibraryBodies, waitForLibraryBodyBackend } from './libraryIndex'
import { B2StaleWriteError, b2Active, b2Decode, b2Enabled, b2HeadKey, b2Identity, b2LoadRevision, b2Matches, b2Persist, b2Read, b2Restore,
  b2Status, disableB2, enableB2, isB2HeadKey, isB2Token, prepareB2, readB2Hold, type B2Preparation, type B2Source, type B2Status,
  LibraryPartitionBlockedError, LibraryPartitionError, LibraryOwnershipError, StaleSyncRoundError, type SessionGeneration,
  b2Stale, anyB2Hold, legacyAccessBlocked, legacyWritesAllowed, libraryClosedForSignIn,
  readStoredOwner, readSessionUserId, readSessionGeneration, readSessionToken, sameUser } from './libraryB2'

const ownerKey = 'gtar_sync_library_owner'

export const LIBRARY_KEY = 'gtar_library_v1'
export const SYNC_RETIRED_KEY = 'gtar_sync_retired_v1'
export { RESTORE_SNAPSHOT_KEY }

import { generateUUID } from './uuid'
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

// Compatibility entry point: background callers must never delete recovery history.
export function pruneAllRecoverySnapshots(storage: Storage, maxAllowed = 0) {
  void storage; void maxAllowed
  // Cleanup is available only through the confirmed recovery review below.
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

/*
 * #258 F6: recovery data is scoped by account partition. Archives written by a B2 partition other than
 * the earlier library's own are tagged with that partition (ARCHIVE_SCOPES_KEY); untagged archives and
 * the legacy keys belong to the earlier library's owner. Nothing is relabelled, moved or deleted: a
 * view only leaves out what is not this account's. Unknown ownership sees nothing.
 */
export const ARCHIVE_SCOPES_KEY = 'gtar_recovery_scopes_v1'
interface RecoveryView { legacy: boolean; scope: string | null }
export function recoveryView(storage: Storage = localStorage): RecoveryView {
  if (isLibraryB2Active(storage)) { const id = b2Identity()!; return { legacy: id.legacy, scope: id.scope } }
  if (legacyAccessBlocked(storage)) return { legacy: false, scope: null }
  return { legacy: true, scope: null }
}
function readArchiveScopes(storage: Storage): Record<string, string> {
  const raw = storage.getItem(ARCHIVE_SCOPES_KEY)
  if (raw === null) return {}
  const value = JSON.parse(raw) as unknown // unreadable: throws, the caller fails closed
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unreadable recovery scope index')
  return value as Record<string, string>
}
/** Recovery tag for archives written now: the open partition, unless it is the earlier library's own. */
function currentArchiveScope(storage: Storage): string | null {
  return isLibraryB2Active(storage) && !b2Identity()!.legacy ? b2Identity()!.scope : null
}
/** Records the archive's partition before the archive is written (a failed tag writes no archive). */
function tagArchive(key: string, scope: string | null, storage: Storage): void {
  if (scope === null) return
  const scopes = readArchiveScopes(storage)
  scopes[key] = scope
  const payload = JSON.stringify(scopes)
  storage.setItem(ARCHIVE_SCOPES_KEY, payload)
  if (storage.getItem(ARCHIVE_SCOPES_KEY) !== payload) throw new Error('Recovery scope could not be recorded. Nothing was archived.')
}
function archiveVisible(key: string, view: RecoveryView, scopes: Record<string, string>): boolean {
  const tag = Object.hasOwn(scopes, key) ? scopes[key] : null
  return tag === null ? view.legacy : tag === view.scope
}

export function recoveryData(storage: Storage = localStorage): Record<string, string> {
  const data: Record<string, string> = {}
  const view = recoveryView(storage)
  let scopes: Record<string, string>
  try { scopes = readArchiveScopes(storage) } catch { return data } // fail closed
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (!k) continue
    if (k.startsWith('gtar_sync_recovery:')) { if (archiveVisible(k, view, scopes)) data[k] = storage.getItem(k) ?? ''; continue }
    if (view.legacy && (k === LIBRARY_KEY || k === ownerKey || k === RECOVERY_DECISIONS_KEY || legacyKeys.includes(k) || k.startsWith('gtar_sync_v1:'))) data[k] = storage.getItem(k) ?? ''
  }
  // #167 B1c: archives held in IndexedDB are part of the same recovery set.
  if (usesIdbArchives(storage)) for (const [key, raw] of recoveryArchiveEntries()) if (!(key in data) && archiveVisible(key, view, scopes)) data[key] = raw
  if (!view.legacy) return data
  // #171 B1: exports always carry the full current library, never the slim index alone.
  const indexRaw = storage.getItem(LIBRARY_V2_KEY)
  if (indexRaw !== null) {
    let full: string | null = null
    if (legacyLibraryKey(storage) === LIBRARY_V2_KEY) {
      try { full = JSON.stringify(decodeLibraryIndex(JSON.parse(indexRaw))) } catch { /* bodies unavailable: keep both raw forms */ }
    }
    if (full !== null) data[LIBRARY_KEY] = full
    else data[LIBRARY_V2_KEY] = indexRaw
  }
  return data
}

// Decisions preserve the chosen library and bind untouched archives to exact source bytes.
export const RECOVERY_DECISIONS_KEY = 'gtar_recovery_decisions_v1'
export interface RecoveryRecordDifference {
  kind: 'song' | 'setlist'
  id: string
  title: string
  deleted: boolean
  difference: 'missing' | 'divergent'
  record: unknown
  /** #240 P1-F2: cloud revision, for a cloud record archived by a conflict choice. */
  revision?: number
}
export interface RecoverySourceReview {
  key: string
  raw: string
  status: 'represented' | 'actionable' | 'invalid' | 'resolved'
  differences: RecoveryRecordDifference[]
  canKeepCurrent: boolean
  /** #240: parts of this archive that are not a valid library and were left out of the review (still in the archive and in exports). */
  unreadable?: Array<'cloud copy' | 'journal baseline'>
  /** #240 P1-F2: the archive holds cloud records saved by a conflict choice; they can be exported but not restored from the review. */
  cloudRecordsOnly?: boolean
}
interface RecoveryDecision {
  choice: 'keep-current' | 'reopen'
  libraryRaw?: string
  library?: RecoveryLibrarySummary
  sources: Record<string, string | RecoverySourceReference>
}
interface RecoverySourceReference {
  sourceKey: string
  rawLength: number
  digest: string
}
export interface RecoveryReview {
  libraryRaw: string | null
  decisionRaw: string | null
  invalid: boolean
  sources: RecoverySourceReview[]
  missingRecords: number
  divergentVersions: number
}

function isValidLibrary(value: unknown): value is SyncLibrary {
  try { validateLibrary(value); return true } catch { return false }
}

interface ArchivedCloudRecord { kind: string; id: string; rev?: number; removed?: boolean; data?: unknown }
function recoveryCandidates(key: string, raw: string): { candidates: SyncLibrary[]; pending: boolean; unreadable?: Array<'cloud copy' | 'journal baseline'>; cloudRecords?: ArchivedCloudRecord[] } {
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
    // #240: the device half must be a valid library. A cloud copy or journal baseline that is not
    // (e.g. a cloud setlist listing deleted songs, saved by an older build just before its sync
    // failed) is left out of the review and reported, instead of making the whole archive unreadable.
    validateLibrary(snapshot.local)
    const unreadable: Array<'cloud copy' | 'journal baseline'> = []
    candidates = [snapshot.local]
    if (snapshot.remote != null) { if (isValidLibrary(snapshot.remote)) candidates.push(snapshot.remote); else unreadable.push('cloud copy') }
    if (snapshot.journal?.baseline != null) { if (isValidLibrary(snapshot.journal.baseline)) candidates.push(snapshot.journal.baseline); else unreadable.push('journal baseline') }
    // #240 P1-F2: cloud records a conflict choice archived (the versions it did not keep).
    const cloudRecords = Array.isArray(snapshot.remoteRecords)
      ? (snapshot.remoteRecords as unknown[]).filter((record): record is ArchivedCloudRecord => !!record && typeof record === 'object' &&
        ((record as ArchivedCloudRecord).kind === 'song' || (record as ArchivedCloudRecord).kind === 'setlist') && typeof (record as ArchivedCloudRecord).id === 'string')
      : []
    return { candidates, pending: Boolean(snapshot.journal?.pending), ...(unreadable.length ? { unreadable } : {}), ...(cloudRecords.length ? { cloudRecords } : {}) }
  }
  candidates.forEach(validateLibrary)
  return { candidates, pending: Boolean(snapshot.journal?.pending) }
}

interface RecoveryLibrarySummary { digest: string; rawLength: number; songs: number; setlists: number; timestamp: number }
function librarySummary(raw: string): RecoveryLibrarySummary {
  const library = decodeLibraryRevision(raw); validateLibrary(library)
  return { digest: recoverySourceDigest(raw), rawLength: raw.length, songs: library.songs.length, setlists: library.setlists.length, timestamp: Date.now() }
}
function readRecoveryDecisions(raw: string | null, depth = 0): RecoveryDecision[] {
  if (raw === null) return []
  if (depth > 2) throw new Error('Invalid nested recovery decisions')
  const value = JSON.parse(raw)
  if (![1, 2, 3].includes(value?.version) || !Array.isArray(value.decisions)) throw new Error('Invalid recovery decisions')
  let historical: RecoveryDecision[] = []
  if (value.version !== 1) {
    const legacyKey = value.version === 2 ? 'legacyV1Raw' : 'legacyRaw'
    if (Object.keys(value).length !== 3 || !Object.hasOwn(value, legacyKey)) throw new Error('Invalid recovery decisions')
    if (value[legacyKey] !== null) {
      if (typeof value[legacyKey] !== 'string' || ![1, 2].includes(JSON.parse(value[legacyKey])?.version)) throw new Error('Invalid historical recovery decisions')
      historical = readRecoveryDecisions(value[legacyKey], depth + 1)
    }
  }
  for (const decision of value.decisions) {
    if (!decision || !['keep-current', 'reopen'].includes(decision.choice) ||
        !decision.sources || typeof decision.sources !== 'object' || Array.isArray(decision.sources)) throw new Error('Invalid recovery decision')
    if (value.version === 3) {
      const m = decision.library
      if (Object.keys(decision).length !== 3 || !m || Object.keys(m).length !== 5 ||
          !/^sha256-utf16le:[a-f0-9]{64}$/.test(m.digest) ||
          ![m.rawLength, m.songs, m.setlists, m.timestamp].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid library summary')
    } else {
      if (typeof decision.libraryRaw !== 'string' || (value.version === 2 && Object.keys(decision).length !== 3)) throw new Error('Invalid recovery decision')
      validateLibrary(JSON.parse(decision.libraryRaw))
    }
    for (const [key, source] of Object.entries(decision.sources)) {
      if (!key.startsWith('gtar_sync_recovery:') && !key.startsWith('gtar_sync_v1:') && key !== 'legacy') throw new Error('Invalid decision source')
      if (typeof source === 'string' && value.version !== 2) continue
      if (value.version === 1) throw new Error('Invalid decision source')
      const ref = source as RecoverySourceReference
      if (!ref || typeof ref !== 'object' || Array.isArray(ref) || ref.sourceKey !== key ||
          !Number.isSafeInteger(ref.rawLength) || ref.rawLength < 0 || typeof ref.digest !== 'string' ||
          !/^sha256-utf16le:[a-f0-9]{64}$/.test(ref.digest) || Object.keys(ref).length !== 3) throw new Error('Invalid decision source reference')
    }
  }
  return [...historical, ...value.decisions]
}

export function localStorageBytes(storage: Storage): number {
  let bytes = 0
  for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key) bytes += 2 * (key.length + (storage.getItem(key)?.length ?? 0)) }
  return bytes
}
export const RECOVERY_MAX_COUNT = 32
export const RECOVERY_MAX_BYTES = 3 * 1024 * 1024

/** Retention cap reached; undecided archives are protected, so the user must decide and clean up. */
export class RecoveryRetentionError extends Error {
  readonly maxCount: number
  readonly maxBytes: number
  constructor(maxCount = RECOVERY_MAX_COUNT, maxBytes = RECOVERY_MAX_BYTES) {
    super('Recovery retention limit reached. Export a backup and Review local recovery to confirm cleanup; undecided archives are protected.')
    this.name = 'RecoveryRetentionError'; this.maxCount = maxCount; this.maxBytes = maxBytes
  }
}

/** #167 B1c: archives live in IndexedDB (mirrored in memory) for the app's own localStorage once loaded. */
function usesIdbArchives(storage: Storage): boolean {
  return recoveryArchivesInIndexedDb() && typeof localStorage !== 'undefined' && storage === localStorage
}
/** Reads one archive from wherever it is held. */
export function readRecoveryArchive(key: string, storage: Storage = localStorage): string | null {
  // #258: a direct lookup obeys the same ownership and partition scope as the listings.
  let scopes: Record<string, string>
  try { scopes = readArchiveScopes(storage) } catch { return null }
  if (!archiveVisible(key, recoveryView(storage), scopes)) return null
  return (usesIdbArchives(storage) ? recoveryArchiveGet(key) : null) ?? storage.getItem(key)
}

export function recoveryRetentionUsage(storage: Storage): { count: number; bytes: number; maxCount: number; maxBytes: number; indexedDb: boolean } {
  let count = 0, bytes = 0
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(ARCHIVE_PREFIX)) { count++; bytes += 2 * (k.length + (storage.getItem(k)?.length ?? 0)) }
  }
  if (usesIdbArchives(storage)) {
    for (const [k, raw] of recoveryArchiveEntries()) { count++; bytes += 2 * (k.length + raw.length) }
    return { count, bytes, maxCount: IDB_RECOVERY_MAX_COUNT, maxBytes: IDB_RECOVERY_MAX_BYTES, indexedDb: true }
  }
  return { count, bytes, maxCount: RECOVERY_MAX_COUNT, maxBytes: RECOVERY_MAX_BYTES, indexedDb: false }
}

/** User-facing reason for a failed safety snapshot. Callers only use it before any change is made. */
export function recoverySnapshotFailureMessage(error: unknown, retry: 'sync' | 'download' | 'replacing the cloud songbook'): string {
  const steps = `open Review local recovery, export recovery data, choose the current library, then review decided archive cleanup before retrying ${retry}.`
  if (error instanceof RecoveryRetentionError) return `Recovery storage is full (limit ${error.maxCount} archives / ${error.maxBytes / 1024 / 1024} MiB), so the safety snapshot was not saved. Nothing was changed. To free space, ${steps}`
  if (isQuotaError(error)) return `Device storage is full, so the safety snapshot could not be saved. Nothing was changed. Export a backup, then ${steps}`
  return `Recovery snapshot could not be verified after saving. Nothing was changed. Export a backup, then ${steps}`
}

export interface LinkingSnapshotAuthorization {
  key: string
  expectedRaw: string
}

const activeLinkingAuthorizations = new WeakMap<Storage, LinkingSnapshotAuthorization>()

export function beginLinkingSnapshotAuthorization(
  storage: Storage,
  key: string,
  expectedRaw: string
): void {
  activeLinkingAuthorizations.set(storage, { key, expectedRaw })
}

export function clearLinkingSnapshotAuthorization(storage: Storage): void {
  activeLinkingAuthorizations.delete(storage)
}

function assertRecoveryMutationAllowed(key: string, raw: string, storage: Storage): void {
  if (isUnboundDeviceLibraryReadOnly(storage)) {
    if (readRecoveryArchive(key, storage) !== null) {
      throw new LibraryOwnershipError(
        'unbound',
        'Cannot overwrite recovery archives for an unlinked songbook.'
      )
    }
    const auth = activeLinkingAuthorizations.get(storage)
    if (auth && auth.key === key && auth.expectedRaw === raw) {
      activeLinkingAuthorizations.delete(storage)
      return
    }
    throw new LibraryOwnershipError(
      'unbound',
      'Cannot create recovery snapshots for an unlinked songbook.'
    )
  }
}

// Estimates cover the whole origin, not Safari's separate localStorage limit.
// Always attempt the actual guarded write unless retention or reported quota blocks it.
export async function writeRecoverySnapshot(key: string, raw: string, storage: Storage, scope: string | null = currentArchiveScope(storage)): Promise<void> {
  assertRecoveryMutationAllowed(key, raw, storage)
  tagArchive(key, scope, storage) // #258 F6
  let estimate: StorageEstimate | undefined
  try { estimate = await navigator.storage?.estimate?.() } catch { /* advisory only */ }
  if (usesIdbArchives(storage)) {
    // #167 B1c: IndexedDB, resolved only after a verified readback.
    const usage = recoveryRetentionUsage(storage)
    const attemptedBytes = 2 * (key.length + raw.length)
    try {
      if (usage.count >= usage.maxCount || usage.bytes + attemptedBytes > usage.maxBytes) throw new RecoveryRetentionError(usage.maxCount, usage.maxBytes)
      if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.usage + attemptedBytes > estimate.quota) throw new DOMException('Origin quota estimate exceeded', 'QuotaExceededError')
      await putRecoveryArchive(key, raw)
      notifyRecoveryChanged()
    } catch (error) {
      appLogger.error('RecoverySnapshot', isQuotaError(error) ? 'Recovery snapshot quota exceeded' : error instanceof RecoveryRetentionError ? 'Recovery retention limit reached' : 'Recovery snapshot failed', undefined,
        JSON.stringify({ key, store: 'indexeddb', attemptedBytes, recoveryCount: usage.count, recoveryBytes: usage.bytes, originUsage: estimate?.usage, originQuota: estimate?.quota }))
      throw error
    }
    return
  }
  writeRecoverySnapshotCheckedTagged(key, raw, storage, estimate)
  notifyRecoveryChanged()
}
/** writeRecoverySnapshotChecked for an archive that writeRecoverySnapshot has already tagged. */
function writeRecoverySnapshotCheckedTagged(key: string, raw: string, storage: Storage, estimate?: StorageEstimate): void {
  skipTag = true
  try { writeRecoverySnapshotChecked(key, raw, storage, estimate) } finally { skipTag = false }
}
let skipTag = false
/** #181: same-tab signal for the recovery attention dot (other tabs get `storage` or the archive channel). */
function notifyRecoveryChanged(): void {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new window.Event('gtar-recovery-changed')) } catch { /* ignore */ }
}

/** Archives held in this Storage itself (localStorage), excluding the IndexedDB mirror. */
function storageArchiveUsage(storage: Storage): { count: number; bytes: number } {
  let count = 0, bytes = 0
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(ARCHIVE_PREFIX)) { count++; bytes += 2 * (k.length + (storage.getItem(k)?.length ?? 0)) }
  }
  return { count, bytes }
}

/**
 * Synchronous snapshot (callers run it in a no-await section right before a library write), so it
 * always goes to `storage`; startup later moves it to IndexedDB. #225: with IndexedDB archives the
 * localStorage part is held to the localStorage limits and the total to the IndexedDB limits;
 * comparing the IndexedDB total against the 3 MiB localStorage cap refused valid snapshots.
 */
function writeRecoverySnapshotChecked(key: string, raw: string, storage: Storage, estimate?: StorageEstimate): void {
  if (!skipTag) assertRecoveryMutationAllowed(key, raw, storage)
  if (!skipTag) tagArchive(key, currentArchiveScope(storage), storage) // #258 F6
  const total = recoveryRetentionUsage(storage)
  const local = total.indexedDb ? storageArchiveUsage(storage) : { count: total.count, bytes: total.bytes }
  const { count, bytes } = total
  const attemptedBytes = 2 * (key.length + raw.length)
  try {
    if (local.count >= RECOVERY_MAX_COUNT || local.bytes + attemptedBytes > RECOVERY_MAX_BYTES) throw new RecoveryRetentionError()
    if (total.indexedDb && (total.count >= total.maxCount || total.bytes + attemptedBytes > total.maxBytes)) throw new RecoveryRetentionError(total.maxCount, total.maxBytes)
    if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.usage + attemptedBytes > estimate.quota) throw new DOMException('Origin quota estimate exceeded', 'QuotaExceededError')
    storage.setItem(key, raw)
    if (storage.getItem(key) !== raw) throw new Error('Snapshot readback failed')
  } catch (error) {
    appLogger.error('RecoverySnapshot', isQuotaError(error) ? 'Recovery snapshot quota exceeded' : error instanceof RecoveryRetentionError ? 'Recovery retention limit reached' : 'Recovery snapshot failed', undefined,
      JSON.stringify({ key, attemptedBytes, recoveryCount: count, recoveryBytes: bytes, totalUsedBytes: localStorageBytes(storage), originUsage: estimate?.usage, originQuota: estimate?.quota }))
    throw error
  }
}

export function planRecoveryCleanup(review: RecoveryReview): { key: string; raw: string }[] {
  if (review.invalid) return []
  const decisions = readRecoveryDecisions(review.decisionRaw)
  return review.sources.filter(source => {
    if (!source.key.startsWith('gtar_sync_recovery:') || source.status === 'invalid' || !source.canKeepCurrent) return false
    const decision = [...decisions].reverse().find(d => Object.hasOwn(d.sources, source.key))
    if (decision?.choice !== 'keep-current') return false
    const ref = decision.sources[source.key]
    const matches = typeof ref === 'string' ? ref === source.raw : ref.rawLength === source.raw.length && ref.digest === recoverySourceDigest(source.raw)
    if (!matches) appLogger.warn('RecoveryCleanup', 'Digest mismatch; archive retained', source.key)
    return matches
  }).map(({ key, raw }) => ({ key, raw })).sort((a, b) => {
    const time = (key: string) => Number(key.split(':')[2]) || 0
    return time(a.key) - time(b.key) || a.key.localeCompare(b.key)
  })
}

// Confirmed UI action only. The lock and exact preview recheck protect editor/cross-tab changes.
export async function confirmRecoveryCleanup(review: RecoveryReview, confirmed: boolean, blocked: () => boolean, storage: Storage = localStorage): Promise<void> {
  if (isUnboundDeviceLibraryReadOnly(storage)) {
    throw new LibraryOwnershipError('unbound', 'Cannot clean up recovery archives for an unlinked songbook.')
  }
  // #258 F6: decisions and cleanup act on the earlier library's archives; other partitions only export.
  if (!recoveryView(storage).legacy) throw new Error('Recovery choices and cleanup are not available for this account\'s songbook in the new device storage yet. Export recovery data instead; nothing was changed.')
  if (!confirmed) throw new Error('Explicit cleanup confirmation required.')
  if (!navigator.locks?.request) throw new Error('Safe recovery cleanup requires Web Locks support.')
  await navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock || blocked()) throw new Error('Resolve editor edits or active cross-tab conflicts before cleanup.')
    const fresh = inspectRecovery(storage)
    if (!same(review, fresh) || fresh.invalid) throw new Error('Recovery changed or is invalid. Review again.')
    const plan = planRecoveryCleanup(fresh)
    // The prior full baseline is retained verbatim until this explicit confirmation.
    // V1 historical-only source bytes remain embedded; do not discard the only copy.
    const decisions = readRecoveryDecisions(fresh.decisionRaw).map(d => ({ choice: d.choice,
      library: d.library ?? librarySummary(d.libraryRaw!), sources: Object.fromEntries(Object.entries(d.sources).map(([key, source]) =>
        [key, typeof source === 'string' && readRecoveryArchive(key, storage) === source ? { sourceKey: key, rawLength: source.length, digest: recoverySourceDigest(source) } : source])) }))
    const payload = JSON.stringify({ version: 3, legacyRaw: null, decisions })
    storage.setItem(RECOVERY_DECISIONS_KEY, payload)
    if (storage.getItem(RECOVERY_DECISIONS_KEY) !== payload) throw new Error('Decision compaction could not be verified. Archives retained.')
    for (const item of plan) {
      if (blocked() || libraryRevision(storage) !== fresh.libraryRaw || storage.getItem(RECOVERY_DECISIONS_KEY) !== payload) throw new Error('Library or decisions changed. Review remaining archives again.')
      if (storage.getItem(item.key) === item.raw) storage.removeItem(item.key)
      else if (usesIdbArchives(storage) && recoveryArchiveGet(item.key) === item.raw) {
        if (!await removeRecoveryArchive(item.key, item.raw)) appLogger.warn('RecoveryCleanup', 'Archive changed; retained', item.key)
      } else appLogger.warn('RecoveryCleanup', 'Archive changed; retained', item.key)
    }
    if (typeof window !== 'undefined' && storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted'))
  })
}

// Read-only review uses the same representation rule as the import guard.
export function inspectRecovery(storage: Storage = localStorage): RecoveryReview {
  const review: RecoveryReview = { libraryRaw: null, decisionRaw: null, invalid: false, sources: [], missingRecords: 0, divergentVersions: 0 }
  try {
    review.libraryRaw = libraryRevision(storage)
    const library = readPersistedLibrary(storage)
    // #258 F6: decisions belong to the earlier library's owner.
    review.decisionRaw = recoveryView(storage).legacy ? storage.getItem(RECOVERY_DECISIONS_KEY) : null
    let decisions: RecoveryDecision[] = []
    try { decisions = readRecoveryDecisions(review.decisionRaw) } catch { review.invalid = true }
    const sources = recoveryData(storage)
    delete sources[RECOVERY_DECISIONS_KEY]
    const entries = Object.entries(sources).filter(([key]) => key !== LIBRARY_KEY && key !== LIBRARY_V2_KEY && key !== ownerKey && !legacyKeys.includes(key))
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
        let unreadable: Array<'cloud copy' | 'journal baseline'> | undefined
        let cloudRecords: ArchivedCloudRecord[] | undefined
        if (key === 'legacy') {
          const [songRaw, trashRaw, setlistRaw] = JSON.parse(raw)
          const songs = JSON.parse(songRaw ?? '[]'), trash = JSON.parse(trashRaw ?? '[]'), setlists = JSON.parse(setlistRaw ?? '[]')
          if (!Array.isArray(songs) || !Array.isArray(trash)) throw new Error('Invalid legacy records')
          candidates = [{ songs: [...songs, ...trash.map(song => ({ ...song, isDeleted: true }))], setlists }]
          candidates.forEach(validateLibrary)
        } else ({ candidates, pending, unreadable, cloudRecords } = recoveryCandidates(key, raw))
        if (unreadable) item.unreadable = unreadable
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
        // #240 P1-F2: an archived cloud record that differs from the current library is a difference too
        // (e.g. a setlist whose entries "Download Cloud" left out). It is never counted as represented.
        if (cloudRecords) {
          item.cloudRecordsOnly = true
          for (const record of cloudRecords) {
            const kind = record.kind as 'song' | 'setlist'
            const existing = (kind === 'song' ? library.songs : library.setlists).find(value => String(value.id) === record.id)
            const data = record.removed ? null : record.data as { title?: unknown; name?: unknown } | null
            if (data ? existing && same(existing, data) : !existing || (existing as { isDeleted?: boolean }).isDeleted) continue
            item.differences.push({ kind, id: record.id, title: String((data ?? existing as { title?: unknown; name?: unknown } | undefined)?.[kind === 'song' ? 'title' : 'name'] ?? record.id),
              deleted: !data, difference: existing ? 'divergent' : 'missing', record: data ?? { id: record.id, removed: true }, ...(typeof record.rev === 'number' ? { revision: record.rev } : {}) })
            represented = false
          }
        }
        item.status = represented ? 'represented' : 'actionable'
        // Unknown/pending operations and legacy access-setting conflicts require manual recovery.
        item.canKeepCurrent = !pending && candidates.every(candidate => candidate.allowedUsers === undefined || same(library.allowedUsers, candidate.allowedUsers))
        if (item.canKeepCurrent) {
          const decision = [...decisions].reverse().find(value => {
            if (!Object.hasOwn(value.sources, key)) return false
            const source = value.sources[key]
            return typeof source === 'string' ? source === raw :
              source.sourceKey === key && source.rawLength === raw.length && source.digest === recoverySourceDigest(raw)
          })
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
// V1 history stays verbatim; new events reference sources instead of duplicating them.
export async function recordRecoveryChoice(review: RecoveryReview, choice: RecoveryDecision['choice'], blocked: () => boolean, storage: Storage = localStorage): Promise<void> {
  if (isUnboundDeviceLibraryReadOnly(storage)) {
    throw new LibraryOwnershipError('unbound', 'Cannot record recovery choices for an unlinked songbook.')
  }
  // #258 F6: decisions and cleanup act on the earlier library's archives; other partitions only export.
  if (!recoveryView(storage).legacy) throw new Error('Recovery choices and cleanup are not available for this account\'s songbook in the new device storage yet. Export recovery data instead; nothing was changed.')
  if (!navigator.locks?.request) throw new Error('Safe recovery resolution requires Web Locks support.')
  await navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock || blocked()) throw new Error('Resolve editor edits or active cross-tab conflicts before choosing a recovery version.')
    const fresh = inspectRecovery(storage)
    if (!same(review, fresh) || fresh.invalid || !fresh.libraryRaw) throw new Error('Recovery changed or is invalid. Review again.')
    const selected = fresh.sources.filter(source => choice === 'keep-current' ? (source.status === 'actionable' || (source.status === 'represented' && source.key.startsWith('gtar_sync_recovery:'))) : source.status === 'resolved')
    if (!selected.length || selected.some(source => !source.canKeepCurrent)) throw new Error('Pending or unsupported recovery requires manual recovery. Export all recovery data.')
    const previous = fresh.decisionRaw === null ? null : JSON.parse(fresh.decisionRaw)
    const decisions: RecoveryDecision[] = previous?.version === 3 ? previous.decisions : []
    decisions.push({ choice, library: librarySummary(fresh.libraryRaw), sources: Object.fromEntries(selected.map(source => [source.key, {
      sourceKey: source.key, rawLength: source.raw.length, digest: recoverySourceDigest(source.raw),
    }])) })
    const payload = JSON.stringify({ version: 3, legacyRaw: previous?.version === 3 ? previous.legacyRaw : fresh.decisionRaw, decisions })
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
  // #252: legacy journals and archives belong to the legacy library, never to a B2 partition.
  if (isLibraryB2Active(storage)) return false
  try {
    // Explicit historical-version choices must not be undone by legacy startup migration.
    // Decision sources and their baseline also remain available for export and reopening.
    if (storage.getItem(RECOVERY_DECISIONS_KEY) !== null) return false
    const expectedRaw = libraryRevision(storage)
    let library = readPersistedLibrary(storage)
    if (!library) return false
    const superseded: SyncLibrary[] = []
    const sources = recoveryData(storage)
    const keys = Object.keys(sources).filter(k => k !== LIBRARY_KEY && k !== LIBRARY_V2_KEY && k !== ownerKey && k !== RECOVERY_DECISIONS_KEY)
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
    for (const k of [...keys, ownerKey]) if (!k.startsWith('gtar_sync_recovery:') && storage.getItem(k) !== null) storage.removeItem(k)
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

export interface OperationContext {
  readonly id: string
  readonly userId: string | null
  readonly token: string | null
  readonly generation: string | null
}

export interface PersistLibraryOptions {
  expectedRaw?: string | null
  force?: boolean
  generation?: SessionGeneration | null
  context?: OperationContext | null
}

const ONBOARDING_CREATOR_KEY = 'gtar_unbound_onboarding_v1'

export interface OnboardingCreatorProvenance {
  v: 1
  userId: string
  headRevision: string
  createdAt: number
}

export function readOnboardingCreator(storage: Pick<Storage, 'getItem'> = localStorage): OnboardingCreatorProvenance | null {
  try {
    const raw = storage.getItem(ONBOARDING_CREATOR_KEY)
    if (!raw) return null
    const val = JSON.parse(raw) as Partial<OnboardingCreatorProvenance> | null
    if (!val || val.v !== 1 || typeof val.userId !== 'string' || !val.userId.trim() || typeof val.headRevision !== 'string') return null
    return {
      v: 1,
      userId: val.userId.trim(),
      headRevision: val.headRevision,
      createdAt: typeof val.createdAt === 'number' ? val.createdAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function recordOnboardingCreator(storage: Storage = localStorage, userId: string): void {
  const rev = libraryRevision(storage)
  const wasEmpty = !hasPersistedContent(storage)
  if (!wasEmpty && !readOnboardingCreator(storage)) {
    throw new LibraryOwnershipError(
      'unbound',
      'Cannot establish onboarding provenance on a pre-existing populated library.'
    )
  }
  if (!rev) return
  const record: OnboardingCreatorProvenance = {
    v: 1,
    userId: userId.trim(),
    headRevision: rev,
    createdAt: Date.now(),
  }
  storage.setItem(ONBOARDING_CREATOR_KEY, JSON.stringify(record))
}

export function clearOnboardingCreator(storage: Storage = localStorage): void {
  if (storage.getItem(ONBOARDING_CREATOR_KEY) !== null) {
    storage.removeItem(ONBOARDING_CREATOR_KEY)
  }
}

function updateOnboardingCreatorProvenance(
  storage: Storage,
  wasEmpty: boolean,
  currentRevisionBeforeWrite: string | null
): void {
  const sessionUserId = readSessionUserId(storage)
  if (!sessionUserId || readStoredOwner(storage)) {
    if (!sessionUserId) {
      clearOnboardingCreator(storage)
    }
    return
  }

  const hasContentNow = hasPersistedContent(storage)
  const newRevision = libraryRevision(storage)
  if (!newRevision) return

  if (wasEmpty) {
    if (hasContentNow) {
      const record: OnboardingCreatorProvenance = {
        v: 1,
        userId: sessionUserId.trim(),
        headRevision: newRevision,
        createdAt: Date.now(),
      }
      storage.setItem(ONBOARDING_CREATOR_KEY, JSON.stringify(record))
    }
  } else {
    const existing = readOnboardingCreator(storage)
    if (
      existing &&
      sameUser(existing.userId, sessionUserId) &&
      existing.headRevision === currentRevisionBeforeWrite
    ) {
      const record: OnboardingCreatorProvenance = {
        ...existing,
        headRevision: newRevision,
      }
      storage.setItem(ONBOARDING_CREATOR_KEY, JSON.stringify(record))
    }
  }
}

export function hasPersistedContent(storage: Storage = localStorage): boolean {
  if (isLibraryB2Active(storage)) {
    try {
      const lib = b2Read()
      return !!lib && (lib.songs.length > 0 || lib.setlists.length > 0)
    } catch {
      return true
    }
  }
  const raw = libraryRevision(storage)
  if (!raw) return false
  try {
    const lib = readPersistedLibrary(storage)
    return !!lib && (lib.songs.length > 0 || lib.setlists.length > 0)
  } catch {
    return true
  }
}

/**
 * #247 (Option A): An unbound populated device library encountered by a signed-in session
 * is read-only until explicitly linked to the account.
 */
export function isUnboundDeviceLibraryReadOnly(storage: Storage = localStorage): boolean {
  const sessionUserId = readSessionUserId(storage)
  if (!sessionUserId) return false
  if (isLibraryB2Active(storage)) {
    const identity = b2Identity()
    if (identity?.kind === 'account') return false
    return hasPersistedContent(storage)
  }
  const owner = readStoredOwner(storage)
  if (owner) return false
  if (!hasPersistedContent(storage)) return false

  const provenance = readOnboardingCreator(storage)
  if (provenance && sameUser(provenance.userId, sessionUserId)) {
    const currentRev = libraryRevision(storage)
    if (currentRev && currentRev === provenance.headRevision) {
      return false
    }
  }

  return true
}

export function captureOperationContext(storage: Storage = localStorage): OperationContext {
  const userId = readSessionUserId(storage)
  const token = readSessionToken(storage)
  const generation = readSessionGeneration(storage)
  return { id: generateUUID(), userId, token, generation }
}

const activeContextsByStorage = new WeakMap<Storage, OperationContext[]>()

export function beginAsyncMutation(storage: Storage = localStorage): OperationContext {
  const context = captureOperationContext(storage)
  let list = activeContextsByStorage.get(storage)
  if (!list) {
    list = []
    activeContextsByStorage.set(storage, list)
  }
  list.push(context)
  return context
}

export function endAsyncMutation(
  contextOrStorage?: OperationContext | Storage,
  storage: Storage = localStorage
): void {
  const targetStorage = contextOrStorage && typeof (contextOrStorage as Storage).getItem === 'function'
    ? (contextOrStorage as Storage)
    : storage
  const targetContext = contextOrStorage && typeof (contextOrStorage as OperationContext).id === 'string'
    ? (contextOrStorage as OperationContext)
    : undefined

  const list = activeContextsByStorage.get(targetStorage)
  if (!list || list.length === 0) return

  if (targetContext) {
    const idx = list.findIndex(c => c.id === targetContext.id)
    if (idx !== -1) list.splice(idx, 1)
  } else {
    list.pop()
  }
}

export function assertOperationContextValid(
  context: OperationContext | SessionGeneration | null | undefined,
  storage: Storage = localStorage
): void {
  if (context === undefined || context === null) return

  const currentUserId = readSessionUserId(storage)
  const currentToken = readSessionToken(storage)
  const currentGen = readSessionGeneration(storage)

  if (context.userId) {
    if (!currentUserId) {
      throw new StaleSyncRoundError('signed-out', 0)
    }
    const expectedGen = `${context.userId.trim().toLowerCase()}\u0000${context.token ?? ''}`
    if (
      !sameUser(currentUserId, context.userId) ||
      currentGen !== expectedGen ||
      (context.token !== undefined && context.token !== null && currentToken !== context.token)
    ) {
      throw new StaleSyncRoundError('session-changed', 0)
    }
  } else {
    if (currentUserId) {
      throw new StaleSyncRoundError('session-changed', 0)
    }
  }
}

/**
 * #247 (Option A): Assert that personal-library mutation is allowed.
 * Blocks writes when a signed-in account encounters an unbound populated library,
 * or when an asynchronous account switch occurred.
 */
export function assertLibraryMutationAllowed(
  storage: Storage = localStorage,
  contextOrGeneration?: OperationContext | SessionGeneration | null
): void {
  const list = activeContextsByStorage.get(storage)
  let contextToValidate: OperationContext | SessionGeneration | null = null
  let matchedActiveContext: OperationContext | null = null

  if (contextOrGeneration) {
    contextToValidate = contextOrGeneration
    if (typeof (contextOrGeneration as OperationContext).id === 'string' && list) {
      const found = list.find(c => c.id === (contextOrGeneration as OperationContext).id)
      if (found) matchedActiveContext = found
    }
  } else if (list && list.length > 0) {
    matchedActiveContext = list[list.length - 1]
    contextToValidate = matchedActiveContext
  }

  try {
    if (contextToValidate) {
      assertOperationContextValid(contextToValidate, storage)
    }

    if (isUnboundDeviceLibraryReadOnly(storage)) {
      throw new LibraryOwnershipError(
        'unbound',
        'This device\'s songbook is stored on this browser and is not yet linked to an account. Linking or verified ownership is required before editing.'
      )
    }
  } finally {
    if (matchedActiveContext && list) {
      const idx = list.indexOf(matchedActiveContext)
      if (idx !== -1) list.splice(idx, 1)
    }
  }
}

const lastKnownLibraryRawByStorage = new WeakMap<Storage, string | null>()

/*
 * #171 storage seam. Everything outside this module reads and restores the persisted library
 * only through these helpers. With B1 off (default) the revision token is the raw
 * `gtar_library_v1` JSON. With B1 on it is the `gtar_library_v2` slim index and v1 is frozen.
 */
/** B1 is active only when toggled on and its index exists; otherwise v1 stays the source of truth. */
function activeLibraryKey(storage: Storage): string {
  // #252 B2: the head token of the open partition is the revision (unless a legacy read is requested).
  // #258: a partition opened for an account that is no longer signed in is closed until reload.
  if (!legacyOnly && b2Stale(storage)) throw new LibraryPartitionError()
  if (!legacyOnly && b2Active(storage)) return b2HeadKey(b2Identity()!.scope)
  // #258 F5: with B2 enabled, the earlier library opens only for its own partition.
  if (!legacyOnly && legacyAccessBlocked(storage)) throw new LibraryPartitionBlockedError()
  return legacyLibraryKey(storage)
}
function legacyLibraryKey(storage: Storage): string {
  return storage.getItem(LIBRARY_B1_KEY) === '1' && storage.getItem(LIBRARY_V2_KEY) !== null ? LIBRARY_V2_KEY : LIBRARY_KEY
}
/** #252: set only while reading or writing the frozen legacy source with B2 bypassed. */
let legacyOnly = false
function withLegacySource<T>(run: () => T): T {
  const previous = legacyOnly
  legacyOnly = true
  try { return run() } finally { legacyOnly = previous }
}
/** #252: B2 per-record IndexedDB storage is the active library storage of this tab. */
export function isLibraryB2Active(storage: Storage = localStorage): boolean {
  return !legacyOnly && b2Active(storage)
}
export function isLibraryIndexActive(storage: Storage = localStorage): boolean {
  return activeLibraryKey(storage) === LIBRARY_V2_KEY
}
/** Opaque revision token of the persisted library, for revision gates and change checks. Throws like `Storage.getItem`. */
export function libraryRevision(storage: Storage = localStorage): string | null {
  return storage.getItem(activeLibraryKey(storage))
}
/** Restores a revision read earlier with `libraryRevision` (rollback after a failed follow-up write). */
export function restoreLibraryRevision(
  revision: string | null,
  storage: Storage = localStorage,
  context?: OperationContext | SessionGeneration | null
): void {
  assertLibraryMutationAllowed(storage, context)
  if (isLibraryB2Active(storage)) { b2Restore(revision); return }
  const key = activeLibraryKey(storage)
  if (revision === null) storage.removeItem(key)
  else storage.setItem(key, revision)
}
/** True when a `storage` event key signals a library change in another tab. */
export function isLibraryStorageKey(key: string | null): boolean {
  return key === LIBRARY_KEY || key === LIBRARY_V2_KEY || isB2HeadKey(key)
}
/** Full (unvalidated) library object from a revision token. Throws MissingLibraryBodyError when a body is not loaded. */
export function decodeLibraryRevision(raw: string): unknown {
  if (isB2Token(raw)) return b2Decode(raw)
  return decodeLibraryIndex(JSON.parse(raw))
}
/** Loads whatever a revision token needs before it can be decoded here (B1 bodies, another tab's B2 save). */
export async function loadLibraryRevision(raw: string, timeoutMs = 5000): Promise<void> {
  if (isB2Token(raw)) await b2LoadRevision(raw, timeoutMs)
  else await loadLibraryIndexBodies(raw, timeoutMs)
}
/**
 * True when `candidate` equals the library stored at revision `raw`. With B2 this compares records
 * by identity (no library stringify); otherwise it decodes and compares the JSON representation.
 */
export function libraryMatchesRevision(candidate: SyncLibrary, raw: string | null): boolean {
  if (raw === null) return false
  if (isB2Token(raw)) return b2Matches(candidate, raw)
  try { return same(decodeLibraryRevision(raw), JSON.parse(JSON.stringify(candidate))) } catch { return false }
}
/** Parses the persisted library without validation or moving the cross-tab baseline (diagnostics, shadow copy). */
export function peekPersistedLibrary(storage: Storage = localStorage): unknown {
  const raw = libraryRevision(storage)
  return raw ? decodeLibraryRevision(raw) : null
}

export function getPersistedLibraryRaw(storage: Storage = localStorage): string | null {
  try {
    return libraryRevision(storage)
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
    writeRecoverySnapshotChecked(key, payload, storage)
  } catch (err) {
    if (isQuotaError(err)) {
      prunePersistedLogs(storage, 10)
      writeRecoverySnapshotChecked(key, payload, storage)
    } else throw err
  }
  if (storage.getItem(key) !== payload) throw new Error('Recovery snapshot could not be verified. Keep this tab open and export your draft.')
  return key
}

// Preserve exact stored bytes, including damaged data, before an authorized replacement.
export function preserveStoredLibrary(raw: string | null, storage: Storage = localStorage): void {
  if (raw === null) return
  if (isB2Token(raw)) { preserveB2Revision(raw, storage); return }
  const key = `gtar_sync_recovery:replacement:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const payload = JSON.stringify({ raw })
  writeRecoverySnapshotChecked(key, payload, storage)
  if (storage.getItem(key) !== payload) throw new Error('Current stored version could not be preserved. Replacement cancelled.')
}

/**
 * #252: a B2 revision token is not the library. Archive the full library it stands for; when that
 * does not fit the synchronous localStorage archive, it must already be covered by a verified
 * pre-restore safety snapshot of the same revision (backupExport.ensureRestoreSafetySnapshot).
 */
let safetySnapshotRevision: string | null = null
export function noteSafetySnapshotRevision(raw: string | null): void { safetySnapshotRevision = raw }
function preserveB2Revision(raw: string, storage: Storage): void {
  const key = `gtar_sync_recovery:replacement:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const payload = JSON.stringify({ local: decodeLibraryRevision(raw) })
  try {
    writeRecoverySnapshotChecked(key, payload, storage)
    if (storage.getItem(key) !== payload) throw new Error('Current stored version could not be preserved. Replacement cancelled.')
  } catch (error) {
    if (safetySnapshotRevision !== raw) throw error instanceof RecoveryRetentionError || isQuotaError(error)
      ? new Error('Current library is too large to preserve here without a verified safety snapshot. Replacement cancelled.', { cause: error })
      : error
    appLogger.info('LibraryB2', 'Replacement covered by the verified pre-restore safety snapshot of this revision')
  }
}

// Legacy compatibility hook: represented archives also require a recorded decision and confirmation.
export function retireRepresentedCloudSnapshots(storage: Storage = localStorage): void {
  void storage // Only a recorded decision plus explicit cleanup may remove archives.
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
  const context = options?.context ?? options?.generation
  assertLibraryMutationAllowed(storage, context)
  const wasEmpty = !hasPersistedContent(storage)
  const revBefore = libraryRevision(storage)
  validateLibrary(library)
  if (!legacyOnly && b2Stale(storage)) throw new LibraryPartitionError()
  if (isLibraryB2Active(storage)) { persistB2(library, storage, options, wasEmpty, revBefore); return }
  // #258 F1: the frozen legacy source is not saved into by a tab that did not open B2 (or opened it).
  if (!legacyOnly && !legacyWritesAllowed(storage)) {
    throw new StaleWriteConflictError('The songbook moved to the new device storage in another tab. Reload this tab; your edits are kept in recovery data.', null, library)
  }
  const { themeSettings: _ignoredTheme, ...libraryWithoutTheme } = library
  void _ignoredTheme
  const canonicalized: SyncLibrary = {
    ...libraryWithoutTheme,
    songs: library.songs.map(song => ({
      ...song,
      ...(song.key === undefined ? {} : { key: canonicalSongKey(song.key) })
    }))
  }

  const key = activeLibraryKey(storage)
  const indexed = key === LIBRARY_V2_KEY
  const encoded = indexed ? encodeLibraryIndex(canonicalized) : null
  const payload = encoded ? encoded.payload : JSON.stringify(canonicalized)
  const currentRaw = storage.getItem(key)
  const hasExpected = options?.expectedRaw !== undefined
  const expectedRaw = options?.expectedRaw
  let isIdentical = currentRaw === payload
  let sameContent = isIdentical
  if (!isIdentical && currentRaw !== null) {
    try {
      // Compare the persisted representation: optional undefined fields are omitted.
      sameContent = same(decodeLibraryRevision(currentRaw), JSON.parse(JSON.stringify(canonicalized)))
      // B1: same content but a newly confirmed body hash still rewrites (drops the inline copy).
      isIdentical = sameContent && !indexed
    } catch { /* Unparseable external storage must not bypass the revision gate. */ }
  }

  if (!options?.force && hasExpected && currentRaw !== expectedRaw && !sameContent) {
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
    storage.setItem(key, payload)
  } catch (err) {
    if (!isQuotaError(err)) throw err
    // Logs are disposable. Journals, snapshots and legacy stores are not.
    try { prunePersistedLogs(storage, 10) } catch { /* Log cleanup must not mask the write error. */ }
    const retryRaw = storage.getItem(key)
    if (retryRaw !== currentRaw) {
      throw new StaleWriteConflictError('Songbook library changed while retrying persistence.', retryRaw, canonicalized)
    }
    try { storage.setItem(key, payload) }
    catch (retryErr) {
      if (!isQuotaError(retryErr)) throw retryErr
      throw new Error('Local browser storage quota exceeded. Free up device storage or export a backup.', { cause: retryErr })
    }
  }

  if (storage.getItem(key) !== payload) {
    throw new Error('Songbook save could not be verified. Keep this tab open and export your draft.')
  }
  updateOnboardingCreatorProvenance(storage, wasEmpty, revBefore)
  lastKnownLibraryRawByStorage.set(storage, payload)
  if (encoded?.pending.length) {
    void confirmPendingLibraryBodies(encoded.pending, error =>
      appLogger.warn('LibraryIndex', 'Chart body not yet in IndexedDB; kept inline (library unaffected)', error instanceof Error ? error.message : String(error)))
  }
  // Recovery archives remain exportable even when represented by the saved library.
  if (typeof window !== 'undefined') {
    try {
      if (storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted'))
    } catch { /* Notification failure cannot invalidate a verified save. */ }
  }
}

function persistB2(library: SyncLibrary, storage: Storage, options?: PersistLibraryOptions, wasEmpty = false, revBefore: string | null = null): void {
  let result: 'saved' | 'unchanged'
  try {
    result = b2Persist(library, { ...(options?.expectedRaw !== undefined ? { expectedRaw: options.expectedRaw } : {}), ...(options?.force ? { force: true } : {}) })
  } catch (error) {
    if (error instanceof B2StaleWriteError) throw new StaleWriteConflictError(error.message, error.currentRaw, library)
    throw error
  }
  if (result === 'saved') {
    updateOnboardingCreatorProvenance(storage, wasEmpty, revBefore)
  }
  lastKnownLibraryRawByStorage.set(storage, libraryRevision(storage))
  if (result === 'saved' && typeof window !== 'undefined') {
    try { if (storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted')) } catch { /* verified save stands */ }
  }
}

export function readPersistedLibrary(storage: Storage = localStorage): SyncLibrary | null {
  if (isLibraryB2Active(storage)) {
    lastKnownLibraryRawByStorage.set(storage, libraryRevision(storage))
    return b2Read()
  }
  const raw = libraryRevision(storage)
  lastKnownLibraryRawByStorage.set(storage, raw)
  if (!raw) return null
  const library: unknown = decodeLibraryRevision(raw)
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
    if (!isLibraryStorageKey(storageEvent.key)) return
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
  const library = decodeLibraryRevision(raw) as SyncLibrary
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
    const raw = libraryRevision(storage)
    if (raw === null) return null
    return { raw, references: danglingReferenceCandidate(raw).references }
  } catch { return null }
}

/** Explicit caller confirmation only. Refuse stale previews and preserve exact input first. */
export function applyDanglingReferenceRepair(
  plan: DanglingReferenceRepair,
  storage: Storage = localStorage,
  context?: OperationContext | SessionGeneration | null
): void {
  assertLibraryMutationAllowed(storage, context)
  if (libraryRevision(storage) !== plan.raw) throw new Error('Library changed. Preview repair again.')
  const { repaired, references } = danglingReferenceCandidate(plan.raw)
  if (JSON.stringify(references) !== JSON.stringify(plan.references)) throw new Error('Repair preview does not match current references.')
  validateLibrary(repaired)
  // Invalid raw archive fails strict snapshot validation and remains exportable.
  const archive = 'gtar_sync_recovery:dangling-references:' + Date.now() + ':' + Math.random().toString(36).slice(2)
  // B1: archive the full library, not the slim index, so the archive stays reviewable.
  const original = isLibraryIndexActive(storage) || isB2Token(plan.raw) ? JSON.stringify(decodeLibraryRevision(plan.raw)) : plan.raw
  writeRecoverySnapshotChecked(archive, original, storage)
  if (storage.getItem(archive) !== original) throw new Error('Could not preserve original recovery data.')
  if (libraryRevision(storage) !== plan.raw) throw new Error('Library changed. Preview repair again.')
  const activeKey = activeLibraryKey(storage)
  if (isLibraryB2Active(storage)) b2Persist(repaired, { expectedRaw: plan.raw })
  else storage.setItem(activeKey, activeKey === LIBRARY_V2_KEY ? encodeLibraryIndex(repaired).payload : JSON.stringify(repaired))
  readPersistedLibrary(storage)
  if (typeof window !== 'undefined' && storage === window.localStorage) window.dispatchEvent(new window.Event('gtar-library-persisted'))
}

/*
 * #171 B1 (DEV toggle, off by default). Enabling writes every chart body to IndexedDB first, then
 * the slim index, then the toggle. Disabling materializes the full library back into v1 before the
 * toggle is cleared. Neither path deletes gtar_library_v1.
 */
function canonicalLibrary(library: SyncLibrary): SyncLibrary {
  const { themeSettings: _ignoredTheme, ...rest } = library
  void _ignoredTheme
  return { ...rest, songs: library.songs.map(song => ({ ...song, ...(song.key === undefined ? {} : { key: canonicalSongKey(song.key) }) })) }
}

export async function enableLibraryIndex(storage: Storage = localStorage, timeoutMs = 5000): Promise<void> {
  if (isLibraryIndexActive(storage)) return
  if (b2Enabled(storage)) throw new Error('Library storage B2 is on. Turn B2 off before changing B1.')
  // A stale index from an earlier fallback is kept as a reviewable archive before it is replaced.
  const stale = storage.getItem(LIBRARY_V2_KEY)
  if (stale !== null) preserveStoredLibrary(stale, storage)
  const revision = libraryRevision(storage)
  const library = readPersistedLibrary(storage)
  if (!library) throw new Error('No library to move. Nothing was changed.')
  const store = await waitForLibraryBodyBackend(timeoutMs)
  const stored = await store.store([...new Set(library.songs.map(song => song.rawContent))])
  rememberLibraryBodies([...stored].map(([body, hash]) => [hash, body] as const))
  if (libraryRevision(storage) !== revision) throw new Error('Library changed while enabling. Nothing was changed; try again.')
  const { payload, pending } = encodeLibraryIndex(canonicalLibrary(library))
  if (pending.length) throw new Error('Some chart bodies were not confirmed in IndexedDB. Nothing was changed.')
  storage.setItem(LIBRARY_V2_KEY, payload)
  if (storage.getItem(LIBRARY_V2_KEY) !== payload || !same(decodeLibraryRevision(payload), JSON.parse(JSON.stringify(canonicalLibrary(library))))) {
    storage.removeItem(LIBRARY_V2_KEY)
    throw new Error('Library index could not be verified. Nothing was changed.')
  }
  storage.setItem(LIBRARY_B1_KEY, '1')
  storage.removeItem(LIBRARY_B1_OPTOUT_KEY)
  appLogger.info('LibraryIndex', `B1 on: ${library.songs.length} songs, ${stored.size} chart bodies in IndexedDB; gtar_library_v1 frozen`)
}

export function disableLibraryIndex(storage: Storage = localStorage): void {
  if (b2Enabled(storage)) throw new Error('Library storage B2 is on. Turn B2 off before changing B1.')
  storage.setItem(LIBRARY_B1_OPTOUT_KEY, '1') // an explicit "off" is not undone by DEV auto-enable
  if (!isLibraryIndexActive(storage)) { storage.removeItem(LIBRARY_B1_KEY); return }
  const library = readPersistedLibrary(storage)
  if (!library) throw new Error('Library unavailable. B1 stays on; export recovery data.')
  const payload = JSON.stringify(canonicalLibrary(library))
  storage.setItem(LIBRARY_KEY, payload)
  if (storage.getItem(LIBRARY_KEY) !== payload) throw new Error('Library could not be written back. B1 stays on.')
  storage.removeItem(LIBRARY_B1_KEY)
  if (!same(readPersistedLibrary(storage), library)) {
    storage.setItem(LIBRARY_B1_KEY, '1')
    throw new Error('Written-back library did not verify. B1 stays on.')
  }
  storage.removeItem(LIBRARY_V2_KEY)
  appLogger.info('LibraryIndex', `B1 off: ${library.songs.length} songs written back to gtar_library_v1`)
}

export interface LibraryStoragePreparation { indexed: boolean; fellBack: boolean }
/**
 * Startup step before the library renders. With B1 on, loads every referenced body from IndexedDB.
 * Any missing or corrupt body: keep the index as a recovery archive and return to frozen v1.
 */
/**
 * #208 F1: set when the B1 index falls back to an older v1 copy. While set, per-record sync never
 * infers cloud deletions from the (older) local library: records it knew but no longer finds here
 * are restored from the cloud instead. Cleared by the first per-record sync that completes.
 */
export const RECORDS_DELETE_HOLD_KEY = 'gtar_records_delete_hold_v1'
export function recordsDeleteHoldActive(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try { return storage.getItem(RECORDS_DELETE_HOLD_KEY) !== null } catch { return true }
}

export async function prepareLibraryStorage(storage: Storage = localStorage, timeoutMs = 5000): Promise<LibraryStoragePreparation> {
  // #258: nothing of an owner-bound library is loaded or restored for another (or no) sign-in.
  if (isLegacyLibraryBlocked(storage)) return { indexed: false, fellBack: false }
  if (storage.getItem(LIBRARY_B1_KEY) !== '1') return { indexed: false, fellBack: false }
  const raw = storage.getItem(LIBRARY_V2_KEY)
  try {
    if (raw === null) throw new Error('Library index missing')
    await loadLibraryIndexBodies(raw, timeoutMs)
    validateLibrary(decodeLibraryRevision(raw))
    return { indexed: true, fellBack: false }
  } catch (error) {
    if (raw !== null) {
      try { preserveStoredLibrary(raw, storage) } catch { /* gtar_library_v2 itself is kept below */ }
    }
    // #167: after v1 retirement the fallback is the retired copy (newer edits stay in the kept index and the cloud).
    const retired = storage.getItem(LIBRARY_KEY) === null ? getRetiredLibrary() : null
    if (retired !== null) {
      storage.setItem(LIBRARY_KEY, retired)
      appLogger.warn('LibraryIndex', 'Restored the retired gtar_library_v1 copy for fallback; use Cloud Sync to bring back newer edits')
    }
    storage.removeItem(LIBRARY_B1_KEY)
    try { storage.setItem(RECORDS_DELETE_HOLD_KEY, JSON.stringify({ at: Date.now(), reason: 'b1-fallback' })) } catch { /* sync then refuses to run without storage */ }
    appLogger.error('LibraryIndex', 'B1 index unusable; using gtar_library_v1. Index kept for recovery review.', undefined,
      error instanceof Error ? error.message : String(error))
    return { indexed: false, fellBack: true }
  }
}

/*
 * #167 v1 retirement (DEV, owner-approved 2026-10-24). Startup turns B1 on automatically unless the
 * owner turned it off by hand, then retires gtar_library_v1: the exact bytes move to IndexedDB
 * (`gtar_library_v1_retired`, verified) and only then leave localStorage. PROD is unchanged.
 */
export async function autoEnableLibraryIndex(storage: Storage = localStorage, timeoutMs = 5000): Promise<boolean> {
  // #252: the legacy source stays frozen while B2 is enabled.
  if (b2Enabled(storage)) return false
  if (isLibraryIndexActive(storage) || storage.getItem(LIBRARY_B1_OPTOUT_KEY) === '1' || storage.getItem(LIBRARY_KEY) === null) return false
  await enableLibraryIndex(storage, timeoutMs)
  return true
}

export async function retireLibraryV1(storage: Storage = localStorage): Promise<number> {
  if (b2Enabled(storage)) return 0 // #252: legacy source frozen and undeleted while B2 is enabled
  const raw = storage.getItem(LIBRARY_KEY)
  if (raw === null || !isLibraryIndexActive(storage) || !usesIdbArchives(storage)) return 0
  // Only retire a v1 the index can fully replace: every body must be loaded and the library valid.
  validateLibrary(decodeLibraryRevision(libraryRevision(storage)!))
  await putRetiredLibrary(raw)
  if (getRetiredLibrary() !== raw) throw new Error('Retired library copy could not be verified')
  if (storage.getItem(LIBRARY_KEY) !== raw) return 0 // changed meanwhile: keep it, retry next startup
  storage.removeItem(LIBRARY_KEY)
  const freed = 2 * (LIBRARY_KEY.length + raw.length)
  appLogger.info('LibraryIndex', `gtar_library_v1 retired: copy kept in IndexedDB; ${freed} bytes freed in localStorage`)
  return freed
}

/*
 * #252 Cloud V2 P1: B2 per-record IndexedDB storage (DEV toggle, off by default). See libraryB2.ts.
 * The legacy library (v1 or B1) is read only through the helpers below, with B2 bypassed.
 */
function legacySource(storage: Storage): B2Source {
  return withLegacySource(() => {
    const revision = libraryRevision(storage)
    if (revision === null) return { key: 'empty', revision: null, library: { songs: [], setlists: [] } }
    const library = decodeLibraryRevision(revision)
    validateLibrary(library)
    return { key: legacyLibraryKey(storage), revision, library }
  })
}
function legacyRevision(storage: Storage): string | null { return withLegacySource(() => libraryRevision(storage)) }
const archiveRecovery = (storage: Storage) => (key: string, raw: string, scope: string | null) => writeRecoverySnapshot(key, raw, storage, scope)

export async function prepareLibraryB2(storage: Storage = localStorage, options: { factory?: IDBFactory | null; failAt?: Parameters<typeof prepareB2>[0]['failAt']; verifyBodies?: boolean } = {}): Promise<B2Preparation> {
  return prepareB2({
    storage,
    factory: options.factory !== undefined ? options.factory : typeof indexedDB !== 'undefined' ? indexedDB : null,
    readSource: () => legacySource(storage),
    sourceRevision: () => legacyRevision(storage),
    archive: archiveRecovery(storage),
    archiveExists: key => readRecoveryArchive(key, storage) !== null,
    validate: library => validateLibrary(library),
    ...(options.failAt ? { failAt: options.failAt } : {}),
    ...(options.verifyBodies !== undefined ? { verifyBodies: options.verifyBodies } : {}),
  })
}
/** Turns B2 on for the next start; the page then reloads (migration runs before the library renders). */
export function enableLibraryB2(storage: Storage = localStorage): void {
  enableB2(storage)
}
/** Turns B2 off: the B2 library is written back to the legacy source (verified) and the B2 copy is kept. */
export async function disableLibraryB2(storage: Storage = localStorage): Promise<void> {
  await disableB2({
    storage,
    sourceRevision: () => legacyRevision(storage),
    readSource: () => legacySource(storage),
    writeSource: (library, expectedRaw) => withLegacySource(() => {
      const opContext = beginAsyncMutation(storage)
      try {
        persistLibrary(library, storage, { expectedRaw, context: opContext })
      } finally {
        endAsyncMutation(opContext, storage)
      }
      if (!same(readPersistedLibrary(storage), JSON.parse(JSON.stringify(canonicalLibrary(library))))) throw new Error('Written-back library did not verify. B2 stays on.')
    }),
    archive: archiveRecovery(storage),
  })
}
export function libraryB2Status(storage: Storage = localStorage): B2Status { return b2Status(storage) }
/** Recovery export: recoveryData plus, with B2 active, the full current library of the open partition. */
export function recoveryExportData(storage: Storage = localStorage): Record<string, string> {
  const data = recoveryData(storage)
  if (isLibraryB2Active(storage)) data[`gtar_library_b2::${b2Identity()!.scope}`] = JSON.stringify(b2Read())
  return data
}
export { readB2Hold }

/** Personal cloud sync (Cloud V1) never runs against B2 data or a held fallback. */
export const B2_SYNC_PAUSED_MESSAGE = 'Personal cloud sync is paused while the new device storage (B2) is on. Your songbook stays on this device; use Backup to keep a copy elsewhere.'
export function personalSyncPausedByB2(storage: Pick<Storage, 'getItem' | 'key' | 'length'> = localStorage): boolean {
  return b2Enabled(storage) || anyB2Hold(storage as Storage)
}
/** #258 F5: the earlier library is closed for this sign-in (another account's, or owner unknown). */
export function isLegacyLibraryBlocked(storage: Storage = localStorage): boolean {
  try { return legacyAccessBlocked(storage) } catch { return true }
}
/** App startup gate (#258): the library is shown only to its verified owner; signed out included. */
export function isLibraryClosedForSignIn(storage: Storage = localStorage): boolean {
  try { return libraryClosedForSignIn(storage) } catch { return true }
}
/** #258 F7: shared setlist create/update builds its snapshot from the paused personal cloud copy. */
export const B2_SETLIST_PUBLISH_MESSAGE = 'Publishing or updating a shared setlist is not available while the new device storage (B2) is on: the shared copy is built from your personal cloud songbook, which is paused. Song publishing, QR sharing and unpublishing still work. Nothing was published.'
