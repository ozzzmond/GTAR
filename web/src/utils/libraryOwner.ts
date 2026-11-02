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
import { isLibraryB2Active, readPersistedLibrary } from './syncJournal'
import { b2Identity } from './libraryB2'

export const LIBRARY_OWNER_KEY = 'gtar_library_owner_v1'

export interface LibraryOwner { v: 1; userId: string; env: string; boundAt: number; reason: 'empty-library' | 'confirmed' }
export type LibraryOwnership = 'owned' | 'unbound-empty' | 'unbound' | 'mismatch'

/** Environment identity: the origin's host (DEV and PROD are different hosts and storages). */
export function libraryEnv(): string {
  try { return typeof location !== 'undefined' && location.host ? location.host : 'unknown' } catch { return 'unknown' }
}

export const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

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
  // #252 B2: the open partition is the library. An account partition belongs to its account; the
  // device partition (a library never linked) stays unbound and is never claimed automatically.
  if (isLibraryB2Active(storage)) {
    const partition = b2Identity()
    if (partition?.kind === 'account') return userId && partition.userId && sameUser(partition.userId, userId) && partition.env === libraryEnv() ? 'owned' : 'mismatch'
    return 'unbound'
  }
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

/** Same check for direct actions (publish, QR share) where the session's account id is known. */
export function personalContentBlockReason(userId: string | null | undefined, storage: Storage = localStorage): string | null {
  try { assertLibraryOwner(userId, storage); return null } catch (error) { return error instanceof Error ? error.message : String(error) }
}
