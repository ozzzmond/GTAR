/**
 * #252 Cloud V2 P1, B2: per-record IndexedDB storage for the personal library (10,000+ songs).
 *
 * One database per partition, `gtar_library_b2::<scope>`: `songs` (fields without the chart body,
 * plus contentHash, rev, updatedAt), `bodies` (write-once, by SHA-256), `setlists` (+ rev) and
 * `meta` (head with a monotonic libraryRev, orders, migration receipt, owner). Trash stays the
 * `isDeleted` flag. `scope` is sha256(env:account) for an account partition, or `device` for a
 * library that has no verified owner yet; partitions are never relabelled, moved or merged.
 *
 * The synchronous storage seam in syncJournal stays: the whole library is held in memory (B2a,
 * eager bodies) and a save is synchronous. A save writes only the changed records to a small
 * write-ahead entry in localStorage (durable at once), moves the head token
 * `gtar_library_b2_head::<scope>` (the revision every gate compares; other tabs see it as a
 * `storage` event) and queues one IndexedDB transaction with a record-level compare-and-set on
 * `rev`. The write-ahead entry is removed after the transaction commits. Nothing here deletes the
 * legacy source (`gtar_library_v1` / B1); migration only reads it.
 *
 * This module has no syncJournal import so syncJournal can depend on it.
 */
import { appLogger } from './logger'
import { canonicalImportId } from './importIdentity'
import { canonicalSongKey } from './musicalKey'
import { MissingLibraryBodyError } from './libraryIndex'
import { recoverySourceDigest } from './recoverySourceDigest'
import type { SyncLibrary } from './syncMerge'

export const B2_FLAG_KEY = 'gtar_library_b2_enabled'
export const B2_OPTOUT_KEY = 'gtar_library_b2_optout'
/** Per partition: set when B2 could not be used safely; that partition stays off until the user retries. */
export const B2_HOLD_PREFIX = 'gtar_library_b2_hold::'
export const B2_HEAD_PREFIX = 'gtar_library_b2_head::'
/**
 * #258 R2: set (after the older B2 copy is archived and verified) before a re-move resets the
 * partition, removed when the re-moved partition is activated. While present and the head is still
 * the pre-reset one, the partition holds only migration output and can be rebuilt from the source.
 */
export const B2_REMIGRATE_PREFIX = 'gtar_library_b2_remigrate::'
export const B2_WAL_PREFIX = 'gtar_library_b2_wal::'
export const B2_DB_PREFIX = 'gtar_library_b2::'
export const B2_SCHEMA_VERSION = 1
export const B2_DB_VERSION = 1
export const B2_CHANNEL = 'gtar-library-b2'
/** A save whose write-ahead entry would exceed this many characters is committed without one. */
export const B2_WAL_INLINE_MAX = 1_000_000
const SNAPSHOT_LIMIT = 8
const OWNER_KEY = 'gtar_library_owner_v1' // libraryOwner.LIBRARY_OWNER_KEY (no import: libraryOwner imports syncJournal)
const SESSION_KEY = 'gtar_auth_session' // googleAuth.SESSION_STORAGE_KEY

type Song = SyncLibrary['songs'][number]
type Setlist = SyncLibrary['setlists'][number]
type Extra = Record<string, unknown>

export type B2Phase = 'source' | 'open' | 'write' | 'readback' | 'verify' | 'receipt' | 'activate'
export type B2HoldReason = 'migration-failed' | 'open-failed' | 'load-failed' | 'missing-body' | 'corrupt-body' | 'order-mismatch'
  | 'commit-failed' | 'commit-conflict' | 'wal-unreplayable' | 'head-ahead' | 'diverged' | 'quota' | 'integrity-failed' | 'source-changed' | 'remigration-unverified'

/** `legacy`: this partition is the one the earlier (v1/B1) library belongs to. */
export interface PartitionIdentity { kind: 'device' | 'account'; userId: string | null; env: string; scope: string; legacy: boolean }
export interface B2Hold { reason: B2HoldReason; at: number; scope?: string; detail?: string }
export interface B2Receipt {
  key: 'receipt'; schemaVersion: number; migratedAt: number; source: string; sourceFingerprint: string | null
  songs: number; setlists: number; bodies: number; aggregate: string; libraryRev: number; ms: number
}
export interface B2Status {
  active: boolean; identity: PartitionIdentity | null; libraryRev: number; committedRev: number; pending: number
  songs: number; setlists: number; hold: B2Hold | null; receipt: B2Receipt | null
}

/** Conflict raised by a stale save (syncJournal turns it into StaleWriteConflictError). */
export class B2StaleWriteError extends Error {
  readonly currentRaw: string | null
  constructor(currentRaw: string | null) { super('Songbook library was updated in another tab or instance. Persistence rejected to prevent data loss.'); this.name = 'B2StaleWriteError'; this.currentRaw = currentRaw }
}
/** A revision token this tab has not loaded yet; callers already treat it like a missing chart body. */
export class B2RevisionUnavailableError extends MissingLibraryBodyError {
  readonly token: string
  constructor(token: string) { super([]); this.message = 'Library revision not loaded in this tab yet'; this.name = 'B2RevisionUnavailableError'; this.token = token }
}
export class LibraryPartitionError extends Error {
  readonly code = 'LIBRARY_PARTITION_CHANGED' as const
  constructor() { super('The signed-in account changed. Nothing was saved; reload to open the songbook for this account.'); this.name = 'LibraryPartitionError' }
}
export class B2HoldError extends Error {
  readonly hold: B2Hold
  constructor(hold: B2Hold) { super(holdMessage(hold)); this.name = 'B2HoldError'; this.hold = hold }
}
/** #258 F5: the signed-in account (or an unknown one) may not open the earlier library on this device. */
export class LibraryPartitionBlockedError extends Error {
  readonly code = 'LIBRARY_PARTITION_BLOCKED' as const
  constructor() { super('This device\'s earlier songbook belongs to another account, or its owner is unknown. It stays on this device unchanged. Sign in with the account that owns it, or retry the new device storage.'); this.name = 'LibraryPartitionBlockedError' }
}
export class LibraryOwnershipError extends Error {
  readonly ownership: 'unbound' | 'mismatch'
  constructor(ownership: 'unbound' | 'mismatch', message?: string) {
    super(message ?? (ownership === 'mismatch'
      ? 'This device\'s songbook belongs to another GTAR account. Sign in with that account to sync it. Nothing was uploaded and your songbook stays on this device.'
      : 'This device\'s songbook is not linked to an account yet. Link it to this account in Sync Center to sync. Nothing was uploaded.'))
    this.ownership = ownership
    this.name = 'LibraryOwnershipError'
  }
}
export interface SessionGeneration { userId: string | null; token: string | null }
export class StaleSyncRoundError extends Error {
  readonly reason: 'signed-out' | 'session-changed'
  constructor(reason: 'signed-out' | 'session-changed', uploaded: number) {
    super(`${reason === 'signed-out' ? 'You signed out' : 'The sign-in changed'} while syncing. ${uploaded
      ? `${uploaded} ${uploaded === 1 ? 'change' : 'changes'} already accepted by the cloud stay in the account that started the sync. `
      : ''}Nothing from that sync was saved on this device and it was not marked as synced. Your songbook on this device is unchanged; sign in and sync again.`)
    this.reason = reason
    this.name = 'StaleSyncRoundError'
  }
}
export class B2MigrationError extends Error {
  readonly phase: B2Phase
  constructor(phase: B2Phase, message: string, options?: { cause?: unknown }) { super(`B2 migration stopped at ${phase}: ${message}`, options); this.name = 'B2MigrationError'; this.phase = phase }
}

export function holdMessage(hold: B2Hold): string {
  const keep = 'Nothing was deleted: the earlier library copy is in use and the B2 copy is kept on this device. Export a backup, then open Review local recovery.'
  switch (hold.reason) {
    case 'migration-failed': return `Moving the songbook to the new device storage did not finish (${hold.detail ?? 'unknown step'}). ${keep}`
    case 'source-changed': return `The earlier library changed while it was being moved, so the move was not used. ${keep}`
    case 'integrity-failed': return `The new device storage failed its integrity check (${hold.detail ?? 'record check'}). ${keep}`
    case 'diverged': return 'The new device storage and the earlier library copy were both changed. Neither was replaced. Export a backup of each before choosing one in Review local recovery.'
    case 'commit-conflict': return 'Saving is paused: another tab or window changed the same song. Your edit is kept in recovery data; export it, then reload.'
    case 'remigration-unverified': return `An interrupted move of the newer earlier library cannot be resumed: its saved copy of the older B2 songbook was not found. ${keep}`
    case 'wal-unreplayable': return `An unsaved edit from an earlier session could not be applied safely, so it was kept in recovery data and nothing was overwritten. ${keep}`
    case 'quota': return 'Saving is paused: device storage is full. Free space or export a backup, then reload.'
    default: return `The new device storage could not be read safely (${hold.reason}). ${keep}`
  }
}

// Reading identity (same keys as libraryOwner / googleAuth, parsed defensively).
function readJson(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}
/**
 * The signed-in session, read like libraryOwner.storedSession (#248): from `storage`, or from the
 * page's localStorage when `storage` holds none (the app always passes localStorage itself).
 */
function readSession(storage: Pick<Storage, 'getItem'>): unknown {
  let raw: string | null
  try { raw = storage.getItem(SESSION_KEY) } catch { raw = null }
  if (!raw) { try { if (typeof localStorage !== 'undefined' && storage !== localStorage) raw = localStorage.getItem(SESSION_KEY) } catch { raw = null } }
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}
export function readStoredOwner(storage: Pick<Storage, 'getItem'>): { userId: string; env: string } | null {
  const value = readJson(storage, OWNER_KEY) as { v?: unknown; userId?: unknown; env?: unknown } | null
  return value && value.v === 1 && typeof value.userId === 'string' && value.userId.trim() && typeof value.env === 'string'
    ? { userId: value.userId.trim(), env: value.env } : null
}
/** #258 R1: the sign-in (account + session token) an operation started under. */
export function readSessionGeneration(storage: Pick<Storage, 'getItem'>): string | null {
  const value = readSession(storage) as { user?: { id?: unknown }; sessionToken?: unknown; token?: unknown } | null
  const id = value?.user?.id
  if (typeof id !== 'string' || !id.trim()) return null
  const token = typeof value?.sessionToken === 'string' ? value.sessionToken : typeof value?.token === 'string' ? value.token : ''
  return `${id.trim().toLowerCase()}\u0000${token}`
}
export function readSessionUserId(storage: Pick<Storage, 'getItem'>): string | null {
  const value = readSession(storage) as { user?: { id?: unknown } } | null
  const id = value?.user?.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}
export function currentEnv(): string {
  try { return typeof location !== 'undefined' && location.host ? location.host : 'unknown' } catch { return 'unknown' }
}
const sameUser = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Which partition this device opens. The legacy (v1/B1) library belongs to its verified owner; it
 * is migrated only into that owner's partition, or into `device` when it was never linked.
 * Another account gets its own (initially empty) partition. Ownership is never inferred.
 */
export interface PartitionChoice { kind: 'device' | 'account'; userId: string | null; legacy: boolean; blocked: boolean }
export function resolvePartition(storage: Pick<Storage, 'getItem'>, env = currentEnv()): PartitionChoice {
  // An unreadable storage throws here: callers fail closed with the storage error itself.
  const ownerRaw = storage.getItem(OWNER_KEY)
  const owner = readStoredOwner(storage)
  const session = readSessionUserId(storage)
  // #258 F5: an owner record that cannot be read, or that names another environment, is an unknown
  // owner: the earlier library is opened for nobody (it stays on the device unchanged).
  if (ownerRaw !== null && (!owner || owner.env !== env)) {
    return session ? { kind: 'account', userId: session, legacy: false, blocked: false } : { kind: 'device', userId: null, legacy: false, blocked: true }
  }
  if (!owner) return { kind: 'device', userId: null, legacy: true, blocked: false } // never linked: the device library
  if (!session) return { kind: 'account', userId: owner.userId, legacy: false, blocked: true } // signed out: owner unknown
  if (sameUser(owner.userId, session)) return { kind: 'account', userId: owner.userId, legacy: true, blocked: false }
  return { kind: 'account', userId: session, legacy: false, blocked: false }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
/** `sha256:<hex>` of the UTF-8 body (same scheme as libraryBodyStore.bodyHash). */
export async function b2BodyHash(body: string): Promise<string> { return 'sha256:' + await sha256Hex(body) }
export async function partitionScope(kind: 'device' | 'account', userId: string | null, env: string): Promise<string> {
  if (kind === 'device') return 'device'
  return 'acct-' + (await sha256Hex(`${env}:${(userId ?? '').trim().toLowerCase()}`)).slice(0, 32)
}
export const b2DbName = (scope: string) => B2_DB_PREFIX + scope
export const b2HeadKey = (scope: string) => B2_HEAD_PREFIX + scope
export const b2WalKey = (scope: string) => B2_WAL_PREFIX + scope
export const isB2HeadKey = (key: string | null) => !!key && key.startsWith(B2_HEAD_PREFIX)

/** JSON with sorted object keys (same as contentHash.stableStringify). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, (item as Record<string, unknown>)[k]])) : item)
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
/** Persisted representation of one song: canonical key, JSON round trip (undefined fields dropped). */
function normalizeSong(song: Song): Song {
  const canonical = song.key === undefined ? song : { ...song, key: canonicalSongKey(song.key) }
  return JSON.parse(JSON.stringify(canonical)) as Song
}
function normalizeSetlist(list: Setlist): Setlist { return JSON.parse(JSON.stringify(list)) as Setlist }
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && sameValue(x[k], y[k]))
}
const titleKey = (song: Song) => `${String(song.title ?? '').trim().toLowerCase()}\u0000${String(song.artist ?? '').trim().toLowerCase()}`

// IndexedDB records. Every record carries `sum`: SHA-256 of its other fields (#258 F2), so any
// changed metadata (not only a chart body) is detected on load.
interface SongRecord { key: string; data: Record<string, unknown>; bodyAt: number; contentHash: string; rev: number; updatedAt: number; deleted: 0 | 1; titleKey: string; sum: string }
interface BodyRecord { hash: string; body: string; chars: number; storedAt: number }
interface SetlistRecord { key: string; data: Setlist; rev: number; updatedAt: number; sum: string }
/** `recent`: tokens of the last applied saves, so a journal entry is matched by identity (#258 F3). */
interface HeadRecord { key: 'head'; schemaVersion: number; libraryRev: number; updatedAt: number; recent: string[]; sum: string }
interface OrderRecord { key: 'songOrder' | 'setlistOrder'; keys: string[]; sum: string }
interface ExtraRecord { key: 'extra'; value: Extra; sum: string }
interface OwnerRecord { key: 'owner'; kind: 'device' | 'account'; userId: string | null; env: string; scope: string; legacy: boolean; createdAt: number; sum: string }
/**
 * Last revision at which this partition equalled the legacy source (migration or write-back), and
 * the digest of the legacy revision then (#258 F1/F4: any later legacy change is detected).
 */
interface SourceSyncRecord { key: 'sourceSync'; rev: number; fingerprint: string; sourceDigest: string; at: number; sum: string }
const RECENT_TOKENS = 512
type Unsealed<T> = Omit<T, 'sum'>
/** Small records: synchronous SHA-256, usable inside a transaction. */
function seal<T extends { sum: string }>(record: Unsealed<T>): T {
  return { ...record, sum: recoverySourceDigest(stableStringify(record)) } as T
}
/** Song and setlist records: Web Crypto, computed before the transaction opens. */
async function sealAsync<T extends { sum: string }>(record: Unsealed<T>): Promise<T> {
  return { ...record, sum: 'sha256:' + await sha256Hex(stableStringify(record)) } as T
}
async function sealedOk(record: { sum?: unknown } & Record<string, unknown>, sync: boolean): Promise<boolean> {
  if (typeof record.sum !== 'string') return false
  const { sum, ...rest } = record
  return sync ? recoverySourceDigest(stableStringify(rest)) === sum : 'sha256:' + await sha256Hex(stableStringify(rest)) === sum
}
/** Digest of a legacy revision token (null: no legacy library). */
export async function legacyDigest(raw: string | null): Promise<string> {
  return raw === null ? 'none' : `sha256:${raw.length}:` + await sha256Hex(raw)
}

function splitSong(song: Song): { data: Record<string, unknown>; bodyAt: number; body: string } {
  const data: Record<string, unknown> = {}
  let bodyAt = -1, i = 0
  for (const [field, value] of Object.entries(song)) {
    if (field === 'rawContent') bodyAt = i
    else data[field] = value
    i++
  }
  return { data, bodyAt, body: song.rawContent }
}
function joinSong(data: Record<string, unknown>, bodyAt: number, body: string): Song {
  const out: Record<string, unknown> = {}
  const entries = Object.entries(data)
  const at = bodyAt < 0 || bodyAt > entries.length ? entries.length : bodyAt
  entries.forEach(([field, value], i) => { if (i === at) out.rawContent = body; out[field] = value })
  if (at === entries.length) out.rawContent = body
  return out as unknown as Song
}

// Promise helpers. Callers never await anything but IndexedDB requests inside a transaction.
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })
}
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  let settled = false
  tx.oncomplete = () => { if (!settled) { settled = true; resolve() } }
  const fail = () => { if (!settled) { settled = true; reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError')) } }
  tx.onerror = fail
  tx.onabort = fail
})
const STORES = ['songs', 'bodies', 'setlists', 'meta'] as const

export function openB2Database(factory: IDBFactory, scope: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let openRequest: IDBOpenDBRequest
    try { openRequest = factory.open(b2DbName(scope), B2_DB_VERSION) } catch (error) { reject(error); return }
    openRequest.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('songs')) {
        const songs = db.createObjectStore('songs', { keyPath: 'key' })
        songs.createIndex('byDeleted', 'deleted')
        songs.createIndex('byUpdatedAt', 'updatedAt')
        songs.createIndex('byTitleKey', 'titleKey')
      }
      if (!db.objectStoreNames.contains('bodies')) db.createObjectStore('bodies', { keyPath: 'hash' })
      if (!db.objectStoreNames.contains('setlists')) db.createObjectStore('setlists', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    openRequest.onsuccess = () => {
      const db = openRequest.result
      db.onversionchange = () => { try { db.close() } catch { /* ignore */ } }
      resolve(db)
    }
    openRequest.onerror = () => reject(openRequest.error ?? new Error('Failed to open B2 library database'))
    openRequest.onblocked = () => reject(new Error('B2 library database upgrade blocked'))
  })
}

// In-memory state of the active partition.
interface SongEntry { song: Song; rev: number; updatedAt: number; sum?: string }
interface SetlistEntry { list: Setlist; rev: number; updatedAt: number; sum?: string }
interface SongOp { key: string; baseRev: number; rev: number; updatedAt: number; song: Song | null }
interface SetlistOp { key: string; baseRev: number; rev: number; updatedAt: number; list: Setlist | null }
interface WalEntry {
  v: 1; base: number; target: number; token: string; at: number
  songs: Array<{ key: string; baseRev: number; rev: number; updatedAt: number; song?: Song | null }>
  setlists: Array<{ key: string; baseRev: number; rev: number; updatedAt: number; list?: Setlist | null }>
  songOrder?: string[]; setlistOrder?: string[]; extra?: Extra; large?: true
}
interface PendingCommit { wal: WalEntry; songs: SongOp[]; setlists: SetlistOp[]; songOrder?: string[]; setlistOrder?: string[]; extra?: Extra }

interface State {
  identity: PartitionIdentity
  storage: Storage
  factory: IDBFactory
  db: IDBDatabase
  songs: Map<string, SongEntry>
  setlists: Map<string, SetlistEntry>
  songOrder: string[]
  setlistOrder: string[]
  extra: Extra
  rev: number
  token: string
  committedRev: number
  library: SyncLibrary
  snapshots: Map<string, SyncLibrary>
  inputSongs: Map<string, unknown>
  inputSetlists: Map<string, unknown>
  queue: Promise<void>
  pending: number
  failure: B2Hold | null
  receipt: B2Receipt | null
}

let state: State | null = null
/** #258 F1/F5: this tab prepared B2 for a legacy partition and is using the earlier library on hold. */
let legacyFallback = false
/** Hold of the partition this tab tried to open (shown by the UI; holds of other partitions are not). */
let currentHold: B2Hold | null = null
let channel: BroadcastChannel | null = null
let tabNonce = Math.random().toString(36).slice(2, 8)

export function makeB2Token(scope: string, rev: number): string {
  return `b2|${scope}|${rev}|${tabNonce}${Math.random().toString(36).slice(2, 6)}`
}
export function parseB2Token(raw: string | null): { scope: string; rev: number } | null {
  if (!raw || !raw.startsWith('b2|')) return null
  const [, scope, rev] = raw.split('|')
  const n = Number(rev)
  return scope && Number.isSafeInteger(n) && n >= 0 ? { scope, rev: n } : null
}
export const isB2Token = (raw: string | null | undefined) => typeof raw === 'string' && raw.startsWith('b2|')

/** B2 is the active storage of this tab for `storage` (prepared, enabled, head present). */
export function b2Active(storage: Pick<Storage, 'getItem'>): boolean {
  return b2Open(storage) && partitionIsCurrent(state!)
}
/** This tab opened B2 for `storage` (whoever is signed in now). */
function b2Open(storage: Pick<Storage, 'getItem'>): boolean {
  if (!state || state.storage !== storage) return false
  try { return storage.getItem(B2_FLAG_KEY) === '1' && storage.getItem(b2HeadKey(state.identity.scope)) !== null } catch { return false }
}
/**
 * #258 read authorization: this tab has a partition open, but the signed-in account (or sign-out)
 * no longer maps to it. Nothing of it may be read, decoded, exported or saved until a reload.
 */
export function b2Stale(storage: Pick<Storage, 'getItem'>): boolean {
  return b2Open(storage) && !partitionIsCurrent(state!)
}
export function b2Identity(): PartitionIdentity | null { return state?.identity ?? null }
export function b2Enabled(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(B2_FLAG_KEY) === '1' } catch { return false }
}
export const b2HoldKey = (scope: string) => B2_HOLD_PREFIX + scope
/** Hold of one partition, or (no scope) the hold of the partition this tab opened. */
export function readB2Hold(storage: Pick<Storage, 'getItem'>, scope?: string): B2Hold | null {
  if (scope === undefined) return state?.failure ?? currentHold
  const value = readJson(storage, b2HoldKey(scope)) as B2Hold | null
  return value && typeof value.reason === 'string' ? value : null
}
/** True when any partition on this device is on hold. */
export function anyB2Hold(storage: Pick<Storage, 'length' | 'key'>): boolean {
  try { for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith(B2_HOLD_PREFIX)) return true } catch { return true }
  return false
}
function setHold(storage: Storage, hold: B2Hold): void {
  currentHold = hold
  try { if (hold.scope) storage.setItem(b2HoldKey(hold.scope), JSON.stringify(hold)) } catch { /* the in-memory failure still blocks writes */ }
  appLogger.error('LibraryB2', holdMessage(hold), undefined, JSON.stringify(hold))
  notify('gtar-library-b2-hold')
}

/**
 * #258 F5 + legacy isolation: the earlier (v1/B1) library is origin-wide, so with B2 on, off or
 * unavailable it opens only for its verified owner (or, never linked, for this device). Another
 * account, a signed-out session or an unreadable / other-environment owner record: closed.
 * Nothing is relabelled, moved, copied or cleared; the owner reopens it by signing in.
 */
export function legacyAccessBlocked(storage: Pick<Storage, 'getItem'>): boolean {
  if (b2Active(storage)) return false
  const where = resolvePartition(storage)
  // Signed out, another account, or an owner record that cannot be verified: closed (B2 on or off).
  return where.blocked || !where.legacy
}
/**
 * App startup: the earlier library is shown only to its verified owner (or, never linked, on this
 * device). Stricter than legacyAccessBlocked: a signed-out page with an owned library shows nothing.
 */
export function libraryClosedForSignIn(storage: Pick<Storage, 'getItem'>): boolean {
  if (b2Active(storage)) return false
  const where = resolvePartition(storage)
  return where.blocked || !where.legacy
}
/**
 * #258 F1: with B2 enabled the legacy library is frozen. Only a tab that prepared B2 and fell back to
 * it on hold may save into it; a tab opened before the switch (or a B2 tab) may not.
 */
export function legacyWritesAllowed(storage: Pick<Storage, 'getItem'>): boolean {
  return !b2Enabled(storage) || (legacyFallback && !b2Active(storage))
}
/** True when the open B2 partition is the earlier library's own partition. */
export function b2PartitionIsLegacy(): boolean { return !!state?.identity.legacy }
function notify(name: string): void {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(name)) } catch { /* ignore */ }
}

/** The revision token stored for the active partition (what `libraryRevision()` returns). */
export function b2Head(storage: Pick<Storage, 'getItem'>): string | null {
  if (!state) return null
  return storage.getItem(b2HeadKey(state.identity.scope))
}

function freezeLibrary(songs: Song[], setlists: Setlist[], extra: Extra): SyncLibrary {
  return Object.freeze({ ...extra, songs: Object.freeze(songs) as Song[], setlists: Object.freeze(setlists) as Setlist[] }) as SyncLibrary
}
function remember(s: State, token: string, library: SyncLibrary): void {
  s.snapshots.delete(token)
  s.snapshots.set(token, library)
  while (s.snapshots.size > SNAPSHOT_LIMIT) s.snapshots.delete(s.snapshots.keys().next().value as string)
}
const copyOf = (library: SyncLibrary): SyncLibrary => ({ ...library, songs: [...library.songs], setlists: [...library.setlists] })

/** Full library for a revision token. Throws B2RevisionUnavailableError when this tab has not loaded it. */
export function b2Decode(raw: string): SyncLibrary {
  if (!state) throw new B2RevisionUnavailableError(raw)
  if (!partitionIsCurrent(state)) throw new LibraryPartitionError()
  const library = state.snapshots.get(raw)
  if (!library) throw new B2RevisionUnavailableError(raw)
  return copyOf(library)
}
/** Current library (records are frozen; arrays are copies). */
export function b2Read(): SyncLibrary {
  if (!state) throw new Error('B2 storage is not prepared')
  if (!partitionIsCurrent(state)) throw new LibraryPartitionError()
  return copyOf(state.library)
}

/**
 * True when `candidate` equals the library stored at revision `raw` without stringifying the
 * library: unchanged records are recognized by object identity (immutable React updates).
 */
export function b2Matches(candidate: { songs: Song[]; setlists: Setlist[] }, raw: string | null): boolean {
  if (!state || raw === null || raw !== state.token || !partitionIsCurrent(state)) return false
  try { return isEmptyDiff(diff(state, candidate)) } catch { return false }
}

interface Diff {
  songOrder: string[]; songOrderChanged: boolean; changedSongs: Array<{ key: string; input: Song; normalized: Song }>; removedSongs: string[]
  setlistOrder: string[]; setlistOrderChanged: boolean; changedSetlists: Array<{ key: string; input: Setlist; normalized: Setlist }>; removedSetlists: string[]
  extra: Extra; extraChanged: boolean; verified: Array<['song' | 'setlist', string, unknown]>
}
const isEmptyDiff = (d: Diff) => !d.songOrderChanged && !d.changedSongs.length && !d.removedSongs.length &&
  !d.setlistOrderChanged && !d.changedSetlists.length && !d.removedSetlists.length && !d.extraChanged
function extraOf(library: Record<string, unknown>): Extra {
  const extra: Extra = {}
  for (const [field, value] of Object.entries(library)) if (field !== 'songs' && field !== 'setlists' && field !== 'themeSettings' && value !== undefined) extra[field] = value
  return JSON.parse(JSON.stringify(extra)) as Extra
}
function keysOf(records: Array<{ id?: unknown }>, label: string): string[] {
  const keys = records.map(record => canonicalImportId(record.id))
  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) throw new Error(`${label}: two records share the storage key "${key}". Nothing was saved; export a backup and resolve the duplicate.`)
    seen.add(key)
  }
  return keys
}
const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((key, i) => key === b[i])

function diff(s: State, library: { songs: Song[]; setlists: Setlist[] }): Diff {
  const verified: Diff['verified'] = []
  const songOrder = keysOf(library.songs, 'Songs')
  const changedSongs: Diff['changedSongs'] = []
  library.songs.forEach((song, i) => {
    const key = songOrder[i]
    if (s.inputSongs.get(key) === song) return
    const entry = s.songs.get(key)
    const normalized = normalizeSong(song)
    if (entry && sameValue(normalized, entry.song)) { verified.push(['song', key, song]); return }
    changedSongs.push({ key, input: song, normalized })
  })
  const songOrderChanged = !sameOrder(songOrder, s.songOrder)
  let removedSongs: string[] = []
  if (songOrderChanged) { const kept = new Set(songOrder); removedSongs = s.songOrder.filter(key => !kept.has(key)) }
  const setlistOrder = keysOf(library.setlists, 'Setlists')
  const changedSetlists: Diff['changedSetlists'] = []
  library.setlists.forEach((list, i) => {
    const key = setlistOrder[i]
    if (s.inputSetlists.get(key) === list) return
    const entry = s.setlists.get(key)
    const normalized = normalizeSetlist(list)
    if (entry && sameValue(normalized, entry.list)) { verified.push(['setlist', key, list]); return }
    changedSetlists.push({ key, input: list, normalized })
  })
  const setlistOrderChanged = !sameOrder(setlistOrder, s.setlistOrder)
  let removedSetlists: string[] = []
  if (setlistOrderChanged) { const kept = new Set(setlistOrder); removedSetlists = s.setlistOrder.filter(key => !kept.has(key)) }
  const extra = extraOf(library as unknown as Record<string, unknown>)
  return { songOrder, songOrderChanged, changedSongs, removedSongs, setlistOrder, setlistOrderChanged, changedSetlists, removedSetlists,
    extra, extraChanged: !sameValue(extra, s.extra), verified }
}
function rememberInputs(s: State, d: Diff): void {
  for (const [kind, key, input] of d.verified) (kind === 'song' ? s.inputSongs : s.inputSetlists).set(key, input)
}

/** Throws unless the signed-in account still maps to the open partition (stale work fails closed). */
/** The signed-in account still maps to the open partition (#258 R1: signed out / unknown owner does not). */
function partitionIsCurrent(s: State): boolean {
  const now = resolvePartition(s.storage, s.identity.env)
  return !now.blocked && now.kind === s.identity.kind && now.legacy === s.identity.legacy &&
    (now.kind === 'device' ? now.userId === null : sameUser(now.userId, s.identity.userId))
}
function assertPartition(s: State): void {
  if (!partitionIsCurrent(s)) throw new LibraryPartitionError()
}

export type B2PersistResult = 'unchanged' | 'saved'
/**
 * Synchronous save of `library` (already validated by syncJournal). Revision gate first, then only
 * changed records are journalled, the head token moves and one IndexedDB transaction is queued.
 */
export function b2Persist(library: SyncLibrary, options: { expectedRaw?: string | null; force?: boolean } = {}): B2PersistResult {
  const s = state
  if (!s) throw new Error('B2 storage is not prepared')
  if (s.failure) throw new B2HoldError(s.failure)
  const storage = s.storage
  const headKey = b2HeadKey(s.identity.scope)
  const currentRaw = storage.getItem(headKey)
  const d = diff(s, library)
  const unchanged = isEmptyDiff(d)
  if (currentRaw !== s.token) {
    // Another tab moved the head; this tab cannot prove what it holds.
    if (!options.force) throw new B2StaleWriteError(currentRaw)
  } else if (!options.force && options.expectedRaw !== undefined && options.expectedRaw !== currentRaw && !unchanged) {
    throw new B2StaleWriteError(currentRaw)
  }
  if (unchanged && currentRaw === s.token) { rememberInputs(s, d); return 'unchanged' }
  assertPartition(s)

  const now = Date.now()
  const base = s.rev, target = s.rev + 1
  const songOps: SongOp[] = d.changedSongs.map(({ key, normalized }) => {
    const entry = s.songs.get(key)
    return { key, baseRev: entry?.rev ?? 0, rev: (entry?.rev ?? 0) + 1, updatedAt: now, song: deepFreeze(normalized) }
  })
  for (const key of d.removedSongs) { const entry = s.songs.get(key)!; songOps.push({ key, baseRev: entry.rev, rev: entry.rev + 1, updatedAt: now, song: null }) }
  const setlistOps: SetlistOp[] = d.changedSetlists.map(({ key, normalized }) => {
    const entry = s.setlists.get(key)
    return { key, baseRev: entry?.rev ?? 0, rev: (entry?.rev ?? 0) + 1, updatedAt: now, list: deepFreeze(normalized) }
  })
  for (const key of d.removedSetlists) { const entry = s.setlists.get(key)!; setlistOps.push({ key, baseRev: entry.rev, rev: entry.rev + 1, updatedAt: now, list: null }) }

  const token = makeB2Token(s.identity.scope, target)
  const wal: WalEntry = {
    v: 1, base, target, token, at: now,
    songs: songOps.map(op => ({ key: op.key, baseRev: op.baseRev, rev: op.rev, updatedAt: op.updatedAt, song: op.song })),
    setlists: setlistOps.map(op => ({ key: op.key, baseRev: op.baseRev, rev: op.rev, updatedAt: op.updatedAt, list: op.list })),
    ...(d.songOrderChanged ? { songOrder: d.songOrder } : {}),
    ...(d.setlistOrderChanged ? { setlistOrder: d.setlistOrder } : {}),
    ...(d.extraChanged ? { extra: d.extra } : {}),
  }
  const walKey = b2WalKey(s.identity.scope)
  const previousWal = storage.getItem(walKey)
  readWal(previousWal) // an unreadable journal fails the save before anything changes
  let entryJson = JSON.stringify(wal)
  if (entryJson.length + (previousWal?.length ?? 0) > B2_WAL_INLINE_MAX) {
    // Large saves (restores, imports) are not journalled; an interruption before the commit holds B2.
    entryJson = JSON.stringify({ v: 1, base, target, token, at: now, large: true,
      songs: songOps.map(op => ({ key: op.key, baseRev: op.baseRev, rev: op.rev, updatedAt: op.updatedAt })),
      setlists: setlistOps.map(op => ({ key: op.key, baseRev: op.baseRev, rev: op.rev, updatedAt: op.updatedAt })) } satisfies WalEntry)
  }
  const walPayload = '[' + [...(previousWal && previousWal !== '[]' ? [previousWal.slice(1, -1)] : []), entryJson].join(',') + ']'
  storage.setItem(walKey, walPayload) // quota errors propagate: nothing changed yet
  try {
    storage.setItem(headKey, token)
    if (storage.getItem(headKey) !== token) throw new Error('Songbook save could not be verified. Keep this tab open and export your draft.')
  } catch (error) {
    try { if (previousWal === null) storage.removeItem(walKey); else storage.setItem(walKey, previousWal) } catch { /* startup replays or holds */ }
    throw error
  }

  // In-memory apply (synchronous): later reads see the save at once.
  for (const op of songOps) {
    if (op.song) s.songs.set(op.key, { song: op.song, rev: op.rev, updatedAt: op.updatedAt })
    else s.songs.delete(op.key)
  }
  for (const op of setlistOps) {
    if (op.list) s.setlists.set(op.key, { list: op.list, rev: op.rev, updatedAt: op.updatedAt })
    else s.setlists.delete(op.key)
  }
  if (d.songOrderChanged) s.songOrder = d.songOrder
  if (d.setlistOrderChanged) s.setlistOrder = d.setlistOrder
  if (d.extraChanged) s.extra = d.extra
  for (const { key, input } of d.changedSongs) s.inputSongs.set(key, input)
  for (const { key, input } of d.changedSetlists) s.inputSetlists.set(key, input)
  for (const key of d.removedSongs) s.inputSongs.delete(key)
  for (const key of d.removedSetlists) s.inputSetlists.delete(key)
  rememberInputs(s, d)
  s.rev = target
  s.token = token
  s.library = freezeLibrary(s.songOrder.map(key => s.songs.get(key)!.song), s.setlistOrder.map(key => s.setlists.get(key)!.list), s.extra)
  remember(s, token, s.library)
  enqueue(s, { wal, songs: songOps, setlists: setlistOps,
    ...(d.songOrderChanged ? { songOrder: d.songOrder } : {}), ...(d.setlistOrderChanged ? { setlistOrder: d.setlistOrder } : {}),
    ...(d.extraChanged ? { extra: d.extra } : {}) })
  return 'saved'
}

function readWal(raw: string | null): WalEntry[] {
  if (!raw) return []
  const value = JSON.parse(raw) as unknown
  if (!Array.isArray(value)) throw new Error('Unreadable B2 write-ahead journal')
  return value as WalEntry[]
}

function enqueue(s: State, commit: PendingCommit): void {
  s.pending++
  s.queue = s.queue.then(async () => {
    if (state !== s || s.failure) return
    try {
      await commitToDb(s.db, commit, s.identity.scope)
      s.committedRev = commit.wal.target
      dropWalEntry(s.storage, s.identity.scope, commit.wal.token)
      try { channel?.postMessage({ type: 'committed', scope: s.identity.scope, rev: commit.wal.target, token: commit.wal.token }) } catch { /* other tabs poll */ }
    } catch (error) {
      const reason: B2HoldReason = error instanceof B2CommitConflict ? 'commit-conflict' : isQuota(error) ? 'quota' : 'commit-failed'
      s.failure = { reason, at: Date.now(), scope: s.identity.scope, detail: error instanceof Error ? error.message : String(error) }
      setHold(s.storage, s.failure)
    } finally { s.pending-- }
  })
}
/** #258 F3: removes exactly the committed entry (by its token), never another entry with the same revision. */
function dropWalEntry(storage: Storage, scope: string, token: string): void {
  const key = b2WalKey(scope)
  try {
    const remaining = readWal(storage.getItem(key)).filter(entry => entry.token !== token)
    if (remaining.length) storage.setItem(key, JSON.stringify(remaining))
    else storage.removeItem(key)
  } catch (error) { appLogger.warn('LibraryB2', 'Write-ahead entry not cleared (replayed safely on next start)', error instanceof Error ? error.message : String(error)) }
}
export function isQuota(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  return !!e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message ?? '')))
}

class B2CommitConflict extends Error { constructor(detail: string) { super(`B2 record changed underneath this save (${detail})`); this.name = 'B2CommitConflict' } }

/** One readwrite transaction: head, record revisions (CAS), bodies, records, orders. */
async function commitToDb(db: IDBDatabase, commit: PendingCommit, scope: string): Promise<void> {
  const hashes = new Map<string, string>()
  for (const op of commit.songs) if (op.song && !hashes.has(op.song.rawContent)) hashes.set(op.song.rawContent, await b2BodyHash(op.song.rawContent))
  // Sealed records are computed before the transaction (no other awaits are allowed inside it).
  const songPuts = new Map<string, SongRecord>()
  for (const op of commit.songs) if (op.song) songPuts.set(op.key, await songRecord(op.key, op.song, hashes.get(op.song.rawContent)!, op.rev, op.updatedAt))
  const setlistPuts = new Map<string, SetlistRecord>()
  for (const op of commit.setlists) if (op.list) setlistPuts.set(op.key, await sealAsync<SetlistRecord>({ key: op.key, data: op.list, rev: op.rev, updatedAt: op.updatedAt }))
  const tx = db.transaction([...STORES], 'readwrite')
  const finished = done(tx)
  try {
    const songs = tx.objectStore('songs'), bodies = tx.objectStore('bodies'), setlists = tx.objectStore('setlists'), meta = tx.objectStore('meta')
    const head = await request(meta.get('head')) as HeadRecord | undefined
    if (!head || head.libraryRev !== commit.wal.base) throw new B2CommitConflict(`library revision ${head?.libraryRev ?? 'missing'}, expected ${commit.wal.base} in ${scope}`)
    const [songRecords, setlistRecords, bodyRecords] = await Promise.all([
      Promise.all(commit.songs.map(op => request(songs.get(op.key)) as Promise<SongRecord | undefined>)),
      Promise.all(commit.setlists.map(op => request(setlists.get(op.key)) as Promise<SetlistRecord | undefined>)),
      Promise.all([...hashes.values()].map(hash => request(bodies.get(hash)) as Promise<BodyRecord | undefined>)),
    ])
    commit.songs.forEach((op, i) => { if ((songRecords[i]?.rev ?? 0) !== op.baseRev) throw new B2CommitConflict(`song ${op.key} rev ${songRecords[i]?.rev ?? 0}, expected ${op.baseRev}`) })
    commit.setlists.forEach((op, i) => { if ((setlistRecords[i]?.rev ?? 0) !== op.baseRev) throw new B2CommitConflict(`setlist ${op.key} rev ${setlistRecords[i]?.rev ?? 0}, expected ${op.baseRev}`) })
    const storedBodies = new Map([...hashes.values()].map((hash, i) => [hash, bodyRecords[i]]))
    const now = Date.now()
    for (const [body, hash] of hashes) {
      // Write-once by content hash; a corrupt record is replaced by its true body.
      if (storedBodies.get(hash)?.body !== body) bodies.put({ hash, body, chars: body.length, storedAt: now } satisfies BodyRecord)
    }
    for (const op of commit.songs) {
      if (!op.song) songs.delete(op.key)
      else songs.put(songPuts.get(op.key)!)
    }
    for (const op of commit.setlists) {
      if (!op.list) setlists.delete(op.key)
      else setlists.put(setlistPuts.get(op.key)!)
    }
    if (commit.songOrder) meta.put(seal<OrderRecord>({ key: 'songOrder', keys: commit.songOrder }))
    if (commit.setlistOrder) meta.put(seal<OrderRecord>({ key: 'setlistOrder', keys: commit.setlistOrder }))
    if (commit.extra) meta.put(seal<ExtraRecord>({ key: 'extra', value: commit.extra }))
    const recent = [...(Array.isArray(head.recent) ? head.recent : []), commit.wal.token].slice(-RECENT_TOKENS)
    meta.put(seal<HeadRecord>({ key: 'head', schemaVersion: B2_SCHEMA_VERSION, libraryRev: commit.wal.target, updatedAt: now, recent }))
  } catch (error) {
    try { tx.abort() } catch { /* already finished */ }
    await finished.catch(() => undefined)
    throw error
  }
  await finished
}

async function songRecord(key: string, song: Song, contentHash: string, rev: number, updatedAt: number): Promise<SongRecord> {
  const { data, bodyAt } = splitSong(song)
  return sealAsync<SongRecord>({ key, data, bodyAt, contentHash, rev, updatedAt, deleted: song.isDeleted ? 1 : 0, titleKey: titleKey(song) })
}

/** Resolves when every queued save of this tab is committed (or has failed into a hold). */
export async function flushB2(): Promise<void> {
  const s = state
  if (!s) return
  let queue: Promise<void>
  do { queue = s.queue; await queue } while (queue !== s.queue)
  if (s.failure) throw new B2HoldError(s.failure)
}

// Loading a partition
interface Loaded {
  songs: Map<string, SongEntry>; setlists: Map<string, SetlistEntry>; songOrder: string[]; setlistOrder: string[]; extra: Extra
  rev: number; receipt: B2Receipt | null; owner: OwnerRecord | null; sourceSync: SourceSyncRecord | null; bodies: number; recent: string[]
}
class B2LoadError extends Error { readonly reason: B2HoldReason; constructor(reason: B2HoldReason, message: string) { super(message); this.reason = reason; this.name = 'B2LoadError' } }

async function readAll(db: IDBDatabase) {
  const tx = db.transaction([...STORES], 'readonly')
  const finished = done(tx)
  const [songs, bodies, setlists, meta] = await Promise.all([
    request(tx.objectStore('songs').getAll()) as Promise<SongRecord[]>,
    request(tx.objectStore('bodies').getAll()) as Promise<BodyRecord[]>,
    request(tx.objectStore('setlists').getAll()) as Promise<SetlistRecord[]>,
    request(tx.objectStore('meta').getAll()) as Promise<Array<{ key: string }>>,
  ])
  await finished
  return { songs, bodies, setlists, meta: new Map(meta.map(record => [record.key, record])) }
}

/**
 * Reads and verifies a partition (#258 F2): supported schema, owner record of this partition, sealed
 * head/order/top-level/receipt records, every song and setlist record sealed and consistent (key =
 * canonical id, revision within the head revision, trash flag), every body present and matching its
 * SHA-256, orders covering exactly the stored records. Any failure throws (callers hold, fail closed).
 * `reuse` keeps already frozen, verified records whose seal is unchanged.
 */
interface LoadExpect { identity: PartitionIdentity; receipt: boolean; verifyBodies?: boolean }
async function loadPartition(db: IDBDatabase, expect: LoadExpect, reuse?: State | null): Promise<Loaded> {
  const fail = (detail: string): never => { throw new B2LoadError('integrity-failed', detail) }
  const all = await readAll(db)
  function meta<T>(key: string) { return all.meta.get(key) as (T & Record<string, unknown>) | undefined }
  const head = meta<HeadRecord>('head')
  if (!head || !await sealedOk(head, true)) fail('head record missing or changed')
  if (head!.schemaVersion !== B2_SCHEMA_VERSION) fail(`unsupported schema version ${String(head!.schemaVersion)}`)
  const rev = head!.libraryRev
  if (!Number.isSafeInteger(rev) || rev < 1 || !Array.isArray(head!.recent)) fail('head revision invalid')
  const owner = meta<OwnerRecord>('owner')
  if (!owner || !await sealedOk(owner, true)) fail('owner record missing or changed')
  const id = expect.identity
  if (owner!.scope !== id.scope || owner!.kind !== id.kind || owner!.env !== id.env || owner!.legacy !== id.legacy ||
      (owner!.userId ?? '').trim().toLowerCase() !== (id.userId ?? '').trim().toLowerCase()) fail('partition owner does not match this account')
  const receipt = meta<B2Receipt & { sum?: string }>('receipt') ?? null
  if (expect.receipt && (!receipt || !await sealedOk(receipt, true) || receipt.schemaVersion !== B2_SCHEMA_VERSION)) fail('migration receipt missing or changed')
  const sourceSync = meta<SourceSyncRecord>('sourceSync') ?? null
  if (sourceSync && (!await sealedOk(sourceSync, true) || !Number.isSafeInteger(sourceSync.rev) || sourceSync.rev > rev)) fail('source marker changed')
  const songOrderRecord = meta<OrderRecord>('songOrder'), setlistOrderRecord = meta<OrderRecord>('setlistOrder'), extraRecord = meta<ExtraRecord>('extra')
  for (const record of [songOrderRecord, setlistOrderRecord, extraRecord]) if (!record || !await sealedOk(record, true)) fail('order or top-level record missing or changed')
  const validRev = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= rev
  const canonicalKey = (value: unknown) => { try { return canonicalImportId(value) } catch { return null } }

  const bodyByHash = new Map(all.bodies.map(record => [record.hash, record.body]))
  const songs = new Map<string, SongEntry>()
  const needed = new Set<string>()
  for (const record of all.songs) {
    const kept = reuse?.songs.get(record.key)
    if (kept && kept.sum !== undefined && kept.sum === record.sum && kept.rev === record.rev) { songs.set(record.key, kept); continue }
    if (!await sealedOk(record as unknown as Record<string, unknown>, false)) fail(`song record ${record.key} changed`)
    if (!record.data || canonicalKey(record.data.id) !== record.key) fail(`song record ${record.key} does not match its id`)
    if (!validRev(record.rev)) fail(`song record ${record.key} revision ${record.rev} outside 1..${rev}`)
    if (record.deleted !== (record.data.isDeleted === true ? 1 : 0)) fail(`song record ${record.key} trash flag disagrees`)
    if (typeof record.contentHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.contentHash)) fail(`song record ${record.key} body reference invalid`)
    const body = bodyByHash.get(record.contentHash)
    if (body === undefined) throw new B2LoadError('missing-body', `Chart body missing for song ${record.key}`)
    needed.add(record.contentHash)
    songs.set(record.key, { song: deepFreeze(joinSong(record.data, record.bodyAt, body)), rev: record.rev, updatedAt: record.updatedAt, sum: record.sum })
  }
  if (expect.verifyBodies ?? true) {
    for (const hash of needed) if (await b2BodyHash(bodyByHash.get(hash)!) !== hash) throw new B2LoadError('corrupt-body', `Chart body ${hash.slice(0, 19)}… does not match its checksum`)
  }
  const setlists = new Map<string, SetlistEntry>()
  for (const record of all.setlists) {
    const kept = reuse?.setlists.get(record.key)
    if (kept && kept.sum !== undefined && kept.sum === record.sum && kept.rev === record.rev) { setlists.set(record.key, kept); continue }
    if (!await sealedOk(record as unknown as Record<string, unknown>, false)) fail(`setlist record ${record.key} changed`)
    if (!record.data || canonicalKey(record.data.id) !== record.key) fail(`setlist record ${record.key} does not match its id`)
    if (!validRev(record.rev)) fail(`setlist record ${record.key} revision outside 1..${rev}`)
    setlists.set(record.key, { list: deepFreeze(record.data), rev: record.rev, updatedAt: record.updatedAt, sum: record.sum })
  }
  const songOrder = songOrderRecord!.keys, setlistOrder = setlistOrderRecord!.keys
  const covers = (order: unknown, map: Map<string, unknown>) => Array.isArray(order) && order.length === map.size && new Set(order).size === order.length && order.every(key => map.has(key))
  if (!covers(songOrder, songs) || !covers(setlistOrder, setlists)) throw new B2LoadError('order-mismatch', 'Stored record order does not match the stored records')
  return {
    songs, setlists, songOrder, setlistOrder,
    extra: extraRecord!.value ?? {},
    rev, receipt, owner: owner!, sourceSync, bodies: all.bodies.length, recent: head!.recent,
  }
}
const libraryOf = (loaded: Pick<Loaded, 'songs' | 'setlists' | 'songOrder' | 'setlistOrder' | 'extra'>): SyncLibrary =>
  freezeLibrary(loaded.songOrder.map(key => loaded.songs.get(key)!.song), loaded.setlistOrder.map(key => loaded.setlists.get(key)!.list), loaded.extra)

// Fingerprints
/** Per-record checksums plus one aggregate over order, records and top-level fields. */
export async function libraryFingerprintB2(library: { songs: Song[]; setlists: Setlist[] } & Record<string, unknown>, normalized = false): Promise<{ aggregate: string; songs: Map<string, string>; setlists: Map<string, string> }> {
  const songs = new Map<string, string>(), setlists = new Map<string, string>()
  const lines: string[] = ['songs']
  for (const song of library.songs) {
    const key = canonicalImportId(song.id)
    const sum = await sha256Hex(stableStringify(normalized ? song : normalizeSong(song)))
    songs.set(key, sum); lines.push(`${key}\t${sum}`)
  }
  lines.push('setlists')
  for (const list of library.setlists) {
    const key = canonicalImportId(list.id)
    const sum = await sha256Hex(stableStringify(normalized ? list : normalizeSetlist(list)))
    setlists.set(key, sum); lines.push(`${key}\t${sum}`)
  }
  lines.push('extra\t' + stableStringify(extraOf(library)))
  return { aggregate: 'sha256:' + await sha256Hex(lines.join('\n')), songs, setlists }
}

// Migration
export interface B2Source {
  /** Legacy key the library came from (`gtar_library_v1`, `gtar_library_v2`) or `empty`. */
  key: string
  /** Opaque legacy revision token, re-read before activation to prove the source did not change. */
  revision: string | null
  library: SyncLibrary
}
export interface B2Deps {
  storage: Storage
  factory: IDBFactory | null
  /** Legacy source for a partition that receives it; null when this partition starts empty. */
  readSource: () => B2Source
  /** Current legacy revision token (cheap). */
  sourceRevision: () => string | null
  /** Saves a copy into recovery archives; `scope` tags it for one partition (null: the earlier library's owner). */
  archive?: (key: string, raw: string, scope: string | null) => Promise<void>
  /** True when a recovery archive with this key exists (verifies re-move evidence). */
  archiveExists?: (key: string) => boolean
  /** Full library validation (syncJournal.validateLibrary). */
  validate?: (library: SyncLibrary) => void
  env?: string
  /** Tests: fail at a migration phase. */
  failAt?: B2Phase
  verifyBodies?: boolean
}

export interface B2Preparation {
  active: boolean
  identity: PartitionIdentity | null
  migrated: boolean
  hold: B2Hold | null
  /** #258 F5: no partition may open the earlier library for this sign-in (unknown owner). */
  blocked: boolean
  ms: number
  songs: number
  setlists: number
  replayed: number
}

function check(deps: B2Deps, phase: B2Phase): void {
  if (deps.failAt === phase) throw new B2MigrationError(phase, 'injected failure')
}
const archiveTag = (identity: PartitionIdentity) => identity.legacy ? null : identity.scope

/** Writes the canonical library into a partition that has never been activated, then verifies it. */
async function migrateInto(db: IDBDatabase, identity: PartitionIdentity, source: B2Source, deps: B2Deps): Promise<B2Receipt> {
  const started = Date.now()
  const canonical = {
    ...extraOf(source.library as unknown as Record<string, unknown>),
    songs: source.library.songs.map(normalizeSong),
    setlists: source.library.setlists.map(normalizeSetlist),
  } as SyncLibrary
  const songKeys = keysOf(canonical.songs, 'Songs'), setlistKeys = keysOf(canonical.setlists, 'Setlists')
  const expected = await libraryFingerprintB2(canonical as SyncLibrary & Record<string, unknown>, true)
  const sourceDigest = await legacyDigest(source.revision)
  const hashes = new Map<string, string>()
  for (const song of canonical.songs) if (!hashes.has(song.rawContent)) hashes.set(song.rawContent, await b2BodyHash(song.rawContent))
  const now = Date.now()
  const songRecords: SongRecord[] = []
  for (let i = 0; i < canonical.songs.length; i++) songRecords.push(await songRecord(songKeys[i], canonical.songs[i], hashes.get(canonical.songs[i].rawContent)!, 1, now))
  const setlistRecords: SetlistRecord[] = []
  for (let i = 0; i < canonical.setlists.length; i++) setlistRecords.push(await sealAsync<SetlistRecord>({ key: setlistKeys[i], data: canonical.setlists[i], rev: 1, updatedAt: now }))
  check(deps, 'write')
  const tx = db.transaction([...STORES], 'readwrite')
  const finished = done(tx)
  try {
    const meta = tx.objectStore('meta')
    if (await request(meta.get('receipt'))) throw new B2MigrationError('write', 'partition already has a receipt')
    // Records left by an interrupted earlier attempt were never activated; they are rewritten here.
    for (const name of STORES) tx.objectStore(name).clear()
    const songs = tx.objectStore('songs'), bodies = tx.objectStore('bodies'), setlists = tx.objectStore('setlists')
    for (const [body, hash] of hashes) bodies.put({ hash, body, chars: body.length, storedAt: now } satisfies BodyRecord)
    for (const record of songRecords) songs.put(record)
    for (const record of setlistRecords) setlists.put(record)
    meta.put(seal<OrderRecord>({ key: 'songOrder', keys: songKeys }))
    meta.put(seal<OrderRecord>({ key: 'setlistOrder', keys: setlistKeys }))
    meta.put(seal<ExtraRecord>({ key: 'extra', value: extraOf(canonical as unknown as Record<string, unknown>) }))
    meta.put(seal<OwnerRecord>({ key: 'owner', kind: identity.kind, userId: identity.userId, env: identity.env, scope: identity.scope, legacy: identity.legacy, createdAt: now }))
    meta.put(seal<HeadRecord>({ key: 'head', schemaVersion: B2_SCHEMA_VERSION, libraryRev: 1, updatedAt: now, recent: [] }))
  } catch (error) {
    try { tx.abort() } catch { /* finished */ }
    await finished.catch(() => undefined)
    throw error instanceof B2MigrationError ? error : new B2MigrationError('write', error instanceof Error ? error.message : String(error), { cause: error })
  }
  try { await finished } catch (error) { throw new B2MigrationError('write', error instanceof Error ? error.message : String(error), { cause: error }) }

  check(deps, 'readback')
  let loaded: Loaded
  try { loaded = await loadPartition(db, { identity, receipt: false, verifyBodies: true }) } catch (error) { throw new B2MigrationError('readback', error instanceof Error ? error.message : String(error), { cause: error }) }

  check(deps, 'verify')
  const back = libraryOf(loaded)
  const actual = await libraryFingerprintB2(back as SyncLibrary & Record<string, unknown>, true)
  const mismatch = [...expected.songs].filter(([key, sum]) => actual.songs.get(key) !== sum).length +
    [...expected.setlists].filter(([key, sum]) => actual.setlists.get(key) !== sum).length
  if (back.songs.length !== canonical.songs.length || back.setlists.length !== canonical.setlists.length || mismatch || actual.aggregate !== expected.aggregate) {
    throw new B2MigrationError('verify', `read back ${back.songs.length}/${canonical.songs.length} songs, ${back.setlists.length}/${canonical.setlists.length} setlists, ${mismatch} record checksum mismatches`)
  }
  if (deps.sourceRevision() !== source.revision) throw new B2MigrationError('verify', 'the source library changed while moving; try again')

  check(deps, 'receipt')
  const receipt: B2Receipt = {
    key: 'receipt', schemaVersion: B2_SCHEMA_VERSION, migratedAt: Date.now(), source: source.key, sourceFingerprint: expected.aggregate,
    songs: back.songs.length, setlists: back.setlists.length, bodies: loaded.bodies, aggregate: actual.aggregate, libraryRev: 1, ms: Date.now() - started,
  }
  const rtx = db.transaction(['meta'], 'readwrite')
  rtx.objectStore('meta').put(seal<B2Receipt & { sum: string }>(receipt))
  rtx.objectStore('meta').put(seal<SourceSyncRecord>({ key: 'sourceSync', rev: 1, fingerprint: expected.aggregate, sourceDigest, at: receipt.migratedAt }))
  try { await done(rtx) } catch (error) { throw new B2MigrationError('receipt', error instanceof Error ? error.message : String(error), { cause: error }) }
  return receipt
}

function install(storage: Storage, factory: IDBFactory, db: IDBDatabase, identity: PartitionIdentity, loaded: Loaded, token: string): State {
  const library = libraryOf(loaded)
  const s: State = {
    identity, storage, factory, db,
    songs: loaded.songs, setlists: loaded.setlists, songOrder: loaded.songOrder, setlistOrder: loaded.setlistOrder, extra: loaded.extra,
    rev: loaded.rev, token, committedRev: loaded.rev, library, snapshots: new Map(),
    inputSongs: new Map(loaded.songOrder.map(key => [key, loaded.songs.get(key)!.song])),
    inputSetlists: new Map(loaded.setlistOrder.map(key => [key, loaded.setlists.get(key)!.list])),
    queue: Promise.resolve(), pending: 0, failure: null, receipt: loaded.receipt,
  }
  remember(s, token, library)
  return s
}

/**
 * Replays write-ahead entries left by a closed tab (#258 F3). An entry is applied only when its token
 * is not among the stored head's recent tokens, it follows the stored revision exactly and its record
 * CAS holds. Anything else is kept: the journal is archived and left in place, and B2 holds. The
 * journal is removed only when every entry is proven applied.
 */
async function replayWal(db: IDBDatabase, storage: Storage, identity: PartitionIdentity, deps: B2Deps): Promise<number> {
  const key = b2WalKey(identity.scope)
  const raw = storage.getItem(key)
  if (raw === null) return 0
  const keep = async (detail: string, reason: B2HoldReason = 'wal-unreplayable'): Promise<never> => {
    try { await deps.archive?.(`gtar_sync_recovery:b2-journal:${Date.now()}:${identity.scope}`, JSON.stringify({ b2Journal: raw, detail }), archiveTag(identity)) }
    catch (error) { appLogger.warn('LibraryB2', 'Journal archive failed; the journal itself is kept', error instanceof Error ? error.message : String(error)) }
    throw new B2LoadError(reason, detail)
  }
  let entries: WalEntry[]
  try { entries = readWal(raw) } catch { return keep('Unreadable write-ahead journal') }
  const loaded = await loadPartition(db, { identity, receipt: true, verifyBodies: false })
  const recent = new Set(loaded.recent)
  let current = loaded.rev
  let applied = 0
  for (const entry of [...entries].sort((a, b) => a.target - b.target)) {
    if (typeof entry?.token !== 'string') return keep('Journal entry without identity')
    if (recent.has(entry.token)) continue // committed before the tab closed
    if (entry.large) return keep('A large save (restore or import) was interrupted before it was stored; restore it again from its backup file')
    if (entry.base !== current) return keep(`Journal entry ${entry.target} (based on ${entry.base}) does not follow stored revision ${current}`)
    try {
      await commitToDb(db, {
        wal: entry,
        songs: entry.songs.map(op => ({ key: op.key, baseRev: op.baseRev, rev: op.rev, updatedAt: op.updatedAt, song: op.song ?? null })),
        setlists: entry.setlists.map(op => ({ key: op.key, baseRev: op.baseRev, rev: op.rev, updatedAt: op.updatedAt, list: op.list ?? null })),
        ...(entry.songOrder ? { songOrder: entry.songOrder } : {}), ...(entry.setlistOrder ? { setlistOrder: entry.setlistOrder } : {}),
        ...(entry.extra ? { extra: entry.extra } : {}),
      }, identity.scope)
    } catch (error) {
      return keep(error instanceof Error ? error.message : String(error), isQuota(error) ? 'quota' : 'wal-unreplayable')
    }
    recent.add(entry.token)
    current = entry.target
    applied++
  }
  // Every entry is applied; remove only the journal that was read (a newer one is kept).
  if (storage.getItem(key) === raw) storage.removeItem(key)
  return applied
}

function setupChannel(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  try {
    channel = new BroadcastChannel(B2_CHANNEL)
    channel.onmessage = () => notify('gtar-library-b2-committed')
    ;(channel as unknown as { unref?: () => void }).unref?.() // Node test runner: never keeps the process alive
  } catch { channel = null }
}

async function readSourceSync(db: IDBDatabase): Promise<SourceSyncRecord | null> {
  const tx = db.transaction(['meta'], 'readonly')
  const record = await request(tx.objectStore('meta').get('sourceSync')) as (SourceSyncRecord & Record<string, unknown>) | undefined
  return record && await sealedOk(record, true) ? record : null
}

/**
 * Startup. With B2 enabled (and no hold for this partition): open this account's partition, migrate
 * the legacy library into it when it has none (non-destructive, verified, receipt, then switch),
 * replay the journal, verify every record and make B2 the active storage. Any failure: hold; the
 * frozen source stays in use only for its own partition (#258 F5).
 */
export async function prepareB2(deps: B2Deps): Promise<B2Preparation> {
  const started = Date.now()
  const { storage } = deps
  const result = (extra: Partial<B2Preparation>): B2Preparation => ({ active: false, identity: null, migrated: false, hold: null, blocked: false, ms: Date.now() - started, songs: 0, setlists: 0, replayed: 0, ...extra })
  if (!b2Enabled(storage)) { legacyFallback = false; return result({}) }
  const env = deps.env ?? currentEnv()
  const where = resolvePartition(storage, env)
  if (where.blocked) { legacyFallback = false; currentHold = null; return result({ blocked: true }) }
  const identity: PartitionIdentity = { kind: where.kind, userId: where.userId, env, scope: await partitionScope(where.kind, where.userId, env), legacy: where.legacy }
  if (state) {
    if (state.identity.scope === identity.scope && state.storage === storage) return result({ active: b2Active(storage), identity, songs: state.songOrder.length, setlists: state.setlistOrder.length })
    // Another account in the same page: callers reload instead of reusing in-memory state.
    throw new LibraryPartitionError()
  }
  const existingHold = readB2Hold(storage, identity.scope)
  if (existingHold) { currentHold = existingHold; legacyFallback = identity.legacy; return result({ identity, hold: existingHold }) }
  const hold = (reason: B2HoldReason, detail: string) => {
    const value: B2Hold = { reason, at: Date.now(), scope: identity.scope, detail }
    setHold(storage, value)
    legacyFallback = identity.legacy
    return result({ identity, hold: value })
  }
  if (!deps.factory) return hold('open-failed', 'IndexedDB is not available')
  let db: IDBDatabase
  try { check(deps, 'open'); db = await openB2Database(deps.factory, identity.scope) }
  catch (error) { return hold(error instanceof B2MigrationError ? 'migration-failed' : 'open-failed', error instanceof Error ? error.message : String(error)) }

  try {
    const headKey = b2HeadKey(identity.scope)
    let headRaw = storage.getItem(headKey)
    const markerKey = B2_REMIGRATE_PREFIX + identity.scope
    let marker: RemigrateMarker | null = null
    const markerRaw = storage.getItem(markerKey)
    if (markerRaw !== null) {
      marker = readMarker(markerRaw)
      if (!marker) throw new B2LoadError('remigration-unverified', 'Unreadable re-move marker')
      if (headRaw !== null && headRaw !== marker.oldHead) {
        // The re-moved partition was activated before; the marker is only left over.
        storage.removeItem(markerKey)
        marker = null
      } else {
        // #258 R2: an interrupted re-move. Resume only with its recovery evidence present.
        if (!deps.archiveExists?.(marker.archiveKey)) throw new B2LoadError('remigration-unverified', `Recovery copy ${marker.archiveKey} not found`)
        headRaw = null // the pre-reset head names records that no longer exist
      }
    }
    let migrated = false
    let expectSource: string | null | undefined
    const hasReceipt = await (async () => {
      const tx = db.transaction(['meta'], 'readonly')
      return !!await request(tx.objectStore('meta').get('receipt'))
    })()
    const migrate = async () => {
      // A partition of another account starts empty: the legacy library is not this account's.
      check(deps, 'source')
      const source: B2Source = identity.legacy ? deps.readSource() : { key: 'empty', revision: null, library: { songs: [], setlists: [] } }
      const receipt = await migrateInto(db, identity, source, identity.legacy ? deps : { ...deps, sourceRevision: () => null })
      expectSource = identity.legacy ? source.revision : undefined
      migrated = true
      appLogger.info('LibraryB2', `Moved ${receipt.songs} songs and ${receipt.setlists} setlists into device storage B2 (${identity.kind}); source ${receipt.source} kept unchanged`, JSON.stringify({ ms: receipt.ms, aggregate: receipt.aggregate }))
    }
    if (!hasReceipt) {
      if (headRaw !== null) throw new B2LoadError('load-failed', 'Partition has a head token but no migration receipt')
      try { await migrate() } catch (error) {
        try { db.close() } catch { /* ignore */ }
        return hold('migration-failed', error instanceof Error ? error.message : String(error))
      }
    }
    const validate = (value: Loaded) => { try { deps.validate?.(libraryOf(value)) } catch (error) { throw new B2LoadError('integrity-failed', error instanceof Error ? error.message : String(error)) } }
    let replayed = 0
    let loaded: Loaded
    try {
      replayed = await replayWal(db, storage, identity, deps)
      loaded = await loadPartition(db, { identity, receipt: true, verifyBodies: deps.verifyBodies ?? true })
      validate(loaded)
    } catch (error) {
      // #258 R2: a resumed re-move holds only migration output (never activated, never edited): rebuild
      // it from the source. Anything else stays as it is and holds.
      if (!marker || migrated) throw error
      appLogger.warn('LibraryB2', 'Interrupted re-move found incomplete; rebuilding it from the earlier library', error instanceof Error ? error.message : String(error))
      await resetPartition(db)
      await migrate()
      loaded = await loadPartition(db, { identity, receipt: true, verifyBodies: deps.verifyBodies ?? true })
      validate(loaded)
    }
    if (identity.legacy && !migrated) {
      // #258 F1/F4: the legacy source must still be what this partition last equalled.
      const raw = deps.sourceRevision()
      if (!loaded.sourceSync) throw new B2LoadError('integrity-failed', 'source marker missing')
      if (await legacyDigest(raw) !== loaded.sourceSync.sourceDigest) {
        if (loaded.sourceSync.rev !== loaded.rev) throw new B2LoadError('diverged', 'Both copies changed since they were last the same')
        // B2 is unchanged since then: keep it in recovery, then move the newer legacy library in.
        if (!deps.archive) throw new B2LoadError('diverged', 'No recovery archive available to keep the older B2 copy')
        const archiveKey = `gtar_sync_recovery:b2-superseded:${Date.now()}:${identity.scope}`
        await deps.archive(archiveKey, JSON.stringify({ local: libraryOf(loaded) }), archiveTag(identity))
        if (deps.archiveExists && !deps.archiveExists(archiveKey)) throw new B2LoadError('remigration-unverified', 'The older B2 copy could not be verified in recovery')
        // #258 R2: recorded before the reset, so an interruption resumes instead of holding forever.
        const next: RemigrateMarker = { v: 1, oldHead: marker ? marker.oldHead : storage.getItem(headKey), archiveKey, at: Date.now() }
        storage.setItem(markerKey, JSON.stringify(next))
        if (readMarker(storage.getItem(markerKey))?.archiveKey !== archiveKey) throw new B2LoadError('remigration-unverified', 'Re-move marker could not be saved')
        marker = next
        headRaw = null
        await resetPartition(db)
        await migrate()
        loaded = await loadPartition(db, { identity, receipt: true, verifyBodies: deps.verifyBodies ?? true })
        validate(loaded)
      } else expectSource = raw
    }
    if (!migrated && headRaw !== null) {
      const parsed = parseB2Token(headRaw)
      if (!parsed || parsed.scope !== identity.scope) throw new B2LoadError('load-failed', 'Unreadable head token')
      if (parsed.rev > loaded.rev) throw new B2LoadError('head-ahead', `Saved revision ${parsed.rev} is newer than stored revision ${loaded.rev}`)
      if (parsed.rev < loaded.rev) appLogger.warn('LibraryB2', `Head token ${parsed.rev} older than stored ${loaded.rev}; using the stored revision`)
    }
    const existingToken = !migrated && headRaw !== null && parseB2Token(headRaw)?.rev === loaded.rev ? headRaw : undefined
    const prepared = activate(deps, db, identity, loaded, migrated, replayed, started, existingToken, expectSource)
    if (marker) storage.removeItem(markerKey)
    return prepared
  } catch (error) {
    try { db.close() } catch { /* ignore */ }
    const reason: B2HoldReason = error instanceof B2LoadError ? error.reason : error instanceof B2MigrationError ? 'migration-failed' : isQuota(error) ? 'quota' : 'load-failed'
    return hold(reason, error instanceof Error ? error.message : String(error))
  }
}

interface RemigrateMarker { v: 1; oldHead: string | null; archiveKey: string; at: number }
function readMarker(raw: string | null): RemigrateMarker | null {
  try {
    const value = raw === null ? null : JSON.parse(raw) as Partial<RemigrateMarker> | null
    return value && value.v === 1 && typeof value.archiveKey === 'string' && value.archiveKey.startsWith('gtar_sync_recovery:') &&
      (value.oldHead === null || typeof value.oldHead === 'string') && typeof value.at === 'number' ? value as RemigrateMarker : null
  } catch { return null }
}

async function resetPartition(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([...STORES], 'readwrite')
  for (const name of STORES) tx.objectStore(name).clear()
  await done(tx)
}

/**
 * Final handoff (synchronous): the legacy source must still be the revision this partition was
 * verified against (#258 F1); only then does the head token switch storage to B2.
 */
function activate(deps: B2Deps, db: IDBDatabase, identity: PartitionIdentity, loaded: Loaded, migrated: boolean, replayed: number, started: number,
  existingToken: string | undefined, expectSource: string | null | undefined): B2Preparation {
  const { storage } = deps
  check(deps, 'activate')
  if (expectSource !== undefined && deps.sourceRevision() !== expectSource) {
    throw new B2LoadError('source-changed', 'The earlier library changed after it was checked; B2 was not switched on')
  }
  const token = existingToken ?? makeB2Token(identity.scope, loaded.rev)
  if (!existingToken) {
    storage.setItem(b2HeadKey(identity.scope), token)
    if (storage.getItem(b2HeadKey(identity.scope)) !== token) throw new B2LoadError('load-failed', 'Head token could not be verified')
  }
  state = install(storage, deps.factory!, db, identity, loaded, token)
  currentHold = null
  legacyFallback = false
  setupChannel()
  return { active: true, identity, migrated, hold: null, blocked: false, ms: Date.now() - started, songs: loaded.songOrder.length, setlists: loaded.setlistOrder.length, replayed }
}

/**
 * Another tab saved `raw`: wait until its transaction is committed, then reload the changed records
 * (unchanged verified ones are reused). Resolves once `raw` can be decoded here.
 */
export async function b2LoadRevision(raw: string, timeoutMs = 5000): Promise<void> {
  const s = state
  const target = parseB2Token(raw)
  if (!s || !target || target.scope !== s.identity.scope) throw new B2RevisionUnavailableError(raw)
  if (!partitionIsCurrent(s)) throw new LibraryPartitionError()
  if (s.snapshots.has(raw)) return
  await s.queue
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const loaded = await loadPartition(s.db, { identity: s.identity, receipt: true, verifyBodies: false }, s)
    // The sign-in may have changed while waiting: never install or return another partition's records.
    if (state !== s || !partitionIsCurrent(s)) throw new LibraryPartitionError()
    if (loaded.rev >= target.rev) {
      if (state !== s || s.pending) throw new B2RevisionUnavailableError(raw)
      // Already superseded: load the newest committed revision under its own token (when the head
      // names it); the later storage event adopts that one.
      const head = s.storage.getItem(b2HeadKey(s.identity.scope))
      const token = loaded.rev === target.rev ? raw : parseB2Token(head)?.rev === loaded.rev ? head! : null
      if (token === null) throw new B2RevisionUnavailableError(raw)
      s.songs = loaded.songs; s.setlists = loaded.setlists; s.songOrder = loaded.songOrder; s.setlistOrder = loaded.setlistOrder; s.extra = loaded.extra
      s.rev = loaded.rev; s.committedRev = loaded.rev; s.token = token
      s.library = libraryOf(loaded)
      s.inputSongs = new Map(loaded.songOrder.map(key => [key, loaded.songs.get(key)!.song]))
      s.inputSetlists = new Map(loaded.setlistOrder.map(key => [key, loaded.setlists.get(key)!.list]))
      remember(s, token, s.library)
      return
    }
    if (Date.now() > deadline) throw new B2RevisionUnavailableError(raw)
    await new Promise(resolve => setTimeout(resolve, 40))
  }
}

/** Restores a revision this tab still holds as a new save (rollback after a failed follow-up write). */
export function b2Restore(raw: string | null): void {
  const s = state
  if (!s) throw new Error('B2 storage is not prepared')
  if (raw === s.token) return
  const library = raw === null ? null : s.snapshots.get(raw)
  if (!library) throw new Error('That library revision is no longer available in this tab. Nothing was changed.')
  b2Persist(copyOf(library), { force: true })
}

export function b2Status(storage: Pick<Storage, 'getItem'> = localStorage): B2Status {
  const s = state
  return {
    active: b2Active(storage), identity: s?.identity ?? null, libraryRev: s?.rev ?? 0, committedRev: s?.committedRev ?? 0, pending: s?.pending ?? 0,
    songs: s?.songOrder.length ?? 0, setlists: s?.setlistOrder.length ?? 0, hold: s?.failure ?? currentHold, receipt: s?.receipt ?? null,
  }
}

/** Turns B2 on for the next start (the page reloads to run the verified migration). */
export function enableB2(storage: Storage): void {
  storage.removeItem(B2_OPTOUT_KEY)
  storage.setItem(B2_FLAG_KEY, '1')
}

export class B2SwitchError extends Error {
  constructor(message: string) { super(message); this.name = 'B2SwitchError' }
}
const SWITCH_CHANGED = 'The songbook or the sign-in changed while turning off the new device storage. Nothing was switched; B2 stays on. Try again.'
const SWITCH_ACCOUNT = 'The signed-in account is not the one this tab opened. Nothing was changed; reload this tab.'

/**
 * Turns B2 off (#258 F4). Only the partition that owns the earlier library may do so (F5). The legacy
 * source must be exactly what this partition last equalled, and the B2 head must be this tab's,
 * unchanged, through the archived, verified write-back and the switch; otherwise B2 stays on (a
 * changed legacy source holds as diverged). The B2 partition itself is kept.
 */
export async function disableB2(deps: {
  storage: Storage
  sourceRevision: () => string | null
  /** Legacy library (frozen source) read without B2. */
  readSource: () => B2Source
  /** Writes the library into the legacy source with B2 bypassed; must verify by reading back. */
  writeSource: (library: SyncLibrary, expectedRaw: string | null) => void
  archive: (key: string, raw: string, scope: string | null) => Promise<void>
}): Promise<void> {
  const { storage } = deps
  const s = state
  if (b2Stale(storage)) throw new B2SwitchError(SWITCH_ACCOUNT) // #258 R1: opened for another sign-in
  if (!s || !b2Active(storage)) {
    // Not in use here (hold, or never opened): the earlier library may come back only for its own partition.
    const where = resolvePartition(storage)
    if (where.blocked || !where.legacy) throw new B2SwitchError('Only the account that owns this device\'s earlier songbook can turn the new device storage off. Nothing was changed.')
    storage.setItem(B2_OPTOUT_KEY, '1')
    storage.removeItem(B2_FLAG_KEY)
    legacyFallback = false
    return
  }
  if (!s.identity.legacy) throw new B2SwitchError('Only the account that owns this device\'s earlier songbook can turn the new device storage off. Your songbook stays in B2 on this device. Nothing was changed.')
  // #258 R1: this tab's partition must still be the signed-in account's, under the same sign-in
  // (no switch, sign-out or token change) from here to the final switch.
  const signIn = readSessionGeneration(storage)
  const signedIn = () => partitionIsCurrent(s) && readSessionGeneration(storage) === signIn
  if (!signedIn()) throw new B2SwitchError(SWITCH_ACCOUNT)
  await flushB2()
  const token = s.token
  const headKey = b2HeadKey(s.identity.scope)
  const current = () => signedIn() && storage.getItem(headKey) === token && s.token === token && s.pending === 0 && !s.failure && state === s
  if (!current()) throw new B2SwitchError(SWITCH_CHANGED)
  const rawBefore = deps.sourceRevision()
  const sync = await readSourceSync(s.db)
  if (!current()) throw new B2SwitchError(SWITCH_CHANGED)
  if (!sync || await legacyDigest(rawBefore) !== sync.sourceDigest) {
    if (!current()) throw new B2SwitchError(SWITCH_CHANGED)
    // The earlier library was changed while B2 was on: both copies stay; nothing is overwritten.
    try { await deps.archive(`gtar_sync_recovery:b2-diverged:${Date.now()}:${s.identity.scope}`, JSON.stringify({ local: s.library }), null) } catch { /* B2 records are kept regardless */ }
    s.failure = { reason: 'diverged', at: Date.now(), scope: s.identity.scope, detail: 'The earlier library changed while B2 was on' }
    setHold(storage, s.failure)
    throw new B2HoldError(s.failure)
  }
  const library = copyOf(s.library)
  const source = deps.readSource()
  if (source.revision !== null) await deps.archive(`gtar_sync_recovery:b2-disable-source:${Date.now()}:${s.identity.scope}`, JSON.stringify({ local: source.library }), null)
  // Synchronous handoff: nothing else in this tab runs between these checks and the write.
  if (!current() || deps.sourceRevision() !== rawBefore) throw new B2SwitchError(SWITCH_CHANGED)
  deps.writeSource(library, rawBefore)
  const rawAfter = deps.sourceRevision()
  const marker = seal<SourceSyncRecord>({ key: 'sourceSync', rev: s.rev, fingerprint: 'write-back', sourceDigest: await legacyDigest(rawAfter), at: Date.now() })
  const tx = s.db.transaction(['meta'], 'readwrite')
  tx.objectStore('meta').put(marker)
  await done(tx)
  // Final switch, synchronous: B2 head and legacy source must still be exactly what was written.
  if (!current() || deps.sourceRevision() !== rawAfter) throw new B2SwitchError(SWITCH_CHANGED)
  storage.setItem(B2_OPTOUT_KEY, '1')
  storage.removeItem(B2_FLAG_KEY)
  storage.removeItem(headKey)
  try { s.db.close() } catch { /* ignore */ }
  state = null
  legacyFallback = false
  appLogger.info('LibraryB2', `B2 off: ${library.songs.length} songs written back to the earlier storage; B2 copy kept on this device`)
}

/** Explicit retry after a hold: clears this partition's hold so the next start tries again (nothing is deleted). */
export function clearB2Hold(storage: Storage): void {
  const scope = state?.identity.scope ?? currentHold?.scope
  if (scope) storage.removeItem(b2HoldKey(scope))
  else {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(B2_HOLD_PREFIX)) keys.push(key) }
    for (const key of keys) storage.removeItem(key)
  }
  currentHold = null
}

/** Tests / diagnostics: forget the in-memory partition (does not touch any storage). */
export function resetB2ForTests(): void {
  try { state?.db.close() } catch { /* ignore */ }
  state = null
  currentHold = null
  legacyFallback = false
  try { channel?.close() } catch { /* ignore */ }
  channel = null
  tabNonce = Math.random().toString(36).slice(2, 8)
}
