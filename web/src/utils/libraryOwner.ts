/**
 * #247 (P0): the personal library is one per browser origin (until per-account storage exists).
 * It is bound to exactly one verified owner: the account id the GTAR server returned for an
 * authenticated request, plus this environment. Cloud writes and other uploads of personal content
 * are allowed only for that owner.
 *
 * - No owner and an empty library: bound to the signed-in account on its first verified sync.
 * - No owner and a library with content (older builds): uploads stay blocked until the user
 *   explicitly links it to the signed-in account; a recovery copy is saved and read back first.
 * - Another owner: blocked. Nothing on the device is relabelled, moved, cleared or deleted.
 * Ownership is never inferred from last-synced metadata.
 */
import { libraryRevision, readPersistedLibrary, recoveryData, writeRecoverySnapshot } from './syncJournal'
import { generateUUID } from './uuid'

export const LIBRARY_OWNER_KEY = 'gtar_library_owner_v1'

export interface LibraryOwner { v: 1; userId: string; env: string; boundAt: number; reason: 'empty-library' | 'confirmed' }
export type LibraryOwnership = 'owned' | 'unbound-empty' | 'unbound' | 'mismatch'

/** Environment identity: the origin's host (DEV and PROD are different hosts and storages). */
export function libraryEnv(): string {
  try { return typeof location !== 'undefined' && location.host ? location.host : 'unknown' } catch { return 'unknown' }
}

const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function readLibraryOwner(storage: Pick<Storage, 'getItem'> = localStorage): LibraryOwner | null {
  try {
    const value = JSON.parse(storage.getItem(LIBRARY_OWNER_KEY) ?? 'null') as Partial<LibraryOwner> | null
    if (!value || value.v !== 1 || typeof value.userId !== 'string' || !value.userId.trim() || typeof value.env !== 'string') return null
    return value as LibraryOwner
  } catch { return null }
}

function hasContent(storage: Storage): boolean {
  const library = readPersistedLibrary(storage)
  return !!library && (library.songs.length > 0 || library.setlists.length > 0)
}

export function libraryOwnership(userId: string | null | undefined, storage: Storage = localStorage): LibraryOwnership {
  const owner = readLibraryOwner(storage)
  if (owner) return userId && sameUser(owner.userId, userId) && owner.env === libraryEnv() ? 'owned' : 'mismatch'
  return hasContent(storage) ? 'unbound' : 'unbound-empty'
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

function writeOwner(userId: string, reason: LibraryOwner['reason'], storage: Storage): void {
  const owner: LibraryOwner = { v: 1, userId: userId.trim(), env: libraryEnv(), boundAt: Date.now(), reason }
  storage.setItem(LIBRARY_OWNER_KEY, JSON.stringify(owner))
  const back = readLibraryOwner(storage)
  if (!back || !sameUser(back.userId, owner.userId)) throw new Error('Could not save the songbook owner on this device')
}

/**
 * Allows cloud writes of personal content for `userId` (a server-verified account id) or throws.
 * An unbound empty library is bound to `userId` here: it holds nothing that could leak.
 */
export function assertLibraryOwner(userId: string | null | undefined, storage: Storage = localStorage): void {
  if (!userId) throw new LibraryOwnershipError('unbound')
  const ownership = libraryOwnership(userId, storage)
  if (ownership === 'owned') return
  if (ownership === 'unbound-empty') { writeOwner(userId, 'empty-library', storage); return }
  throw new LibraryOwnershipError(ownership)
}

/** #247: the signed-in account stored by AuthGate (same key as googleAuth's SESSION_STORAGE_KEY). */
const SESSION_KEY = 'gtar_auth_session'
function storedSession(storage?: Pick<Storage, 'getItem'>): { userId: string | null; token: string | null } | null {
  try {
    let raw = storage ? storage.getItem(SESSION_KEY) : null
    if (!raw && typeof localStorage !== 'undefined') raw = localStorage.getItem(SESSION_KEY)
    const value = raw ? JSON.parse(raw) as { user?: { id?: unknown }; sessionToken?: unknown; token?: unknown } | null : null
    if (!value || typeof value !== 'object') return null
    const id = value.user?.id
    const token = typeof value.sessionToken === 'string' && value.sessionToken ? value.sessionToken : typeof value.token === 'string' && value.token ? value.token : null
    return { userId: typeof id === 'string' && id.trim() ? id : null, token }
  } catch { return null }
}
function storedSessionUserId(storage?: Pick<Storage, 'getItem'>): string | null { return storedSession(storage)?.userId ?? null }

/**
 * #247 F3: the sign-in a sync round started under (account + session token). Captured when the round
 * starts; null when no session is stored then (nothing to compare against).
 */
export interface SessionGeneration { userId: string | null; token: string | null }
export function captureSessionGeneration(storage?: Pick<Storage, 'getItem'>): SessionGeneration | null { return storedSession(storage) }

/** The sign-in a round started under ended (logout) or was replaced (other account, new token). */
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

/**
 * #247 F3: right before a sync writes into the library (or reports it in step): the library still
 * belongs to the account the round was verified for, and the signed-in session (when one is stored)
 * is still that account. When generation is supplied (or required), revalidate that the session
 * that started the round has not signed out, switched accounts, or rotated tokens.
 */
export function assertCommitAllowed(userId: string | null | undefined, storage: Storage = localStorage,
  generation?: SessionGeneration | null): void {
  assertLibraryOwner(userId, storage)
  const session = storedSessionUserId(storage)
  if (session && userId && !sameUser(session, userId)) throw new LibraryOwnershipError('mismatch')
  if (generation !== undefined && generation !== null) {
    const now = storedSession(storage)
    if (!now || !now.userId) throw new StaleSyncRoundError('signed-out', 0)
    if (!sameUser(now.userId, generation.userId ?? '') || now.token !== generation.token) {
      throw new StaleSyncRoundError('session-changed', 0)
    }
  }
}

/**
 * #247 F3 (late response): after a sync round's last network wait, before it saves sync metadata or
 * reports success. Uploads the server already accepted stay in that account's cloud and are not
 * described as undone; nothing of the round is recorded on this device.
 */
export function assertRoundStillCurrent(userId: string | null | undefined, storage: Storage = localStorage, uploaded = 0,
  generation: SessionGeneration | null = null): void {
  try {
    assertCommitAllowed(userId, storage, generation)
  } catch (error) {
    if (error instanceof StaleSyncRoundError) {
      throw new StaleSyncRoundError(error.reason, uploaded)
    }
    if (!(error instanceof LibraryOwnershipError)) throw error
    throw new LibraryOwnershipError(error.ownership, `The signed-in account or this songbook's owner changed while syncing. ${uploaded
      ? `${uploaded} ${uploaded === 1 ? 'change' : 'changes'} already accepted by the cloud stay in the account that started the sync. `
      : ''}Nothing from that sync was saved on this device and it was not marked as synced. Sync again with the account that owns this songbook.`)
  }
}

/** Same check for direct actions (publish, QR share) where the session's account id is known. */
export function personalContentBlockReason(userId: string | null | undefined, storage: Storage = localStorage): string | null {
  try { assertLibraryOwner(userId, storage); return null } catch (error) { return error instanceof Error ? error.message : String(error) }
}

/**
 * Explicit "link this songbook to my account" for a library without an owner. A full copy of the
 * library is saved as a recovery archive and read back before the owner is written.
 */
export async function confirmLibraryOwner(userId: string, storage: Storage = localStorage): Promise<void> {
  if (!userId.trim()) throw new Error('Sign in first')
  // #247 F2: one confirmation at a time in this browser, and compare-and-set: the owner record, the
  // library revision and the signed-in account must be what they were when this confirmation began.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const run = async () => {
    const ownership = libraryOwnership(userId, storage)
    if (ownership === 'owned') return
    if (ownership === 'mismatch') throw new LibraryOwnershipError('mismatch')
    const ownerAtStart = storage.getItem(LIBRARY_OWNER_KEY)
    const revisionAtStart = libraryRevision(storage)
    const library = readPersistedLibrary(storage)
    if (library) {
      const key = `gtar_sync_recovery:owner-confirm:${Date.now()}:${generateUUID()}`
      const raw = JSON.stringify({ local: library })
      await writeRecoverySnapshot(key, raw, storage)
      if (recoveryData(storage)[key] !== raw) throw new Error('Could not verify the recovery copy; the songbook was not linked')
    }
    const session = storedSessionUserId()
    if (storage.getItem(LIBRARY_OWNER_KEY) !== ownerAtStart || libraryRevision(storage) !== revisionAtStart || (session && !sameUser(session, userId))) {
      throw new Error('The songbook or the signed-in account changed while linking; nothing was linked. Review and try again.')
    }
    writeOwner(userId, 'confirmed', storage)
  }
  if (locks?.request) await locks.request('gtar-library-owner', run)
  else await run()
}
