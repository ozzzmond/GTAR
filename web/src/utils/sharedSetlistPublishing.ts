import { catalogFetch, getAuthenticatedSessionToken } from './sharedCatalogClient'
import { CatalogApiError } from '../types/sharedCatalog'
import { getStoredSessionStatus } from './googleAuth'
import { computeSongbookChecksum, type CloudSongbookRecord } from './cloudSongbookSync'
import { readPersistedLibrary } from './syncJournal'
import type { SyncLibrary } from './syncMerge'
import { snapshotFromSongbook } from './sharedSetlistSnapshot'
import { generateUUID } from './uuid'

export type SetlistSnapshot = ReturnType<typeof snapshotFromSongbook>
export interface PublishedSetlist { id: string; revision: number; name: string; occurrences: number; updated_at: string }
export interface PublicationResult { id: string; revision: number; unpublished: boolean }
export interface SourcePreview { account: string; token: string; sourceId: string | number; version: number; checksum: string; snapshot: SetlistSnapshot }
export interface PublicationIntent { method: 'POST' | 'PUT' | 'DELETE'; id?: string; key: string; body: Record<string, unknown> }
export interface PublicationLink { publicationKey: string; result?: PublicationResult; pending?: PublicationIntent; snapshot?: SetlistSnapshot }

const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(id)
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0
// Theme settings do not enter setlist snapshots. The cloud record still verifies
// its complete stored checksum below; source comparison uses the personal library.
const sourceChecksum = (library: SyncLibrary) => computeSongbookChecksum({ songs: library.songs, setlists: library.setlists })
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)

export function publisherSession() {
  const identity = getAuthenticatedSessionToken()
  const { session, isExpired } = getStoredSessionStatus()
  const role = session?.role || session?.user?.role
  const status = session?.access_status || session?.user?.access_status
  if (!session || isExpired || !session.user.id || (role !== 'admin' && role !== 'member') || status !== 'active') {
    throw new CatalogApiError('An active approved session is required. Sign in again if your access changed.', 403)
  }
  return identity
}

function assertAccount(account: string, token: string, admin = false) {
  const current = admin ? publisherSession() : getAuthenticatedSessionToken()
  if (current.accountId !== account || current.token !== token) throw new Error('Account or session changed. Reopen and review again.')
}

// A successful, validated response from the gated route is the capability proof.
// 404 (including arbitrary proxy 404s), malformed responses and auth errors never enable UI.
export async function listPublishedSetlists(offset = 0, signal?: AbortSignal): Promise<PublishedSetlist[]> {
  const { token, accountId } = getAuthenticatedSessionToken()
  const response = await catalogFetch<{ setlists: PublishedSetlist[] }>(`/api/catalog/setlists?limit=20&offset=${offset}`, { token, signal })
  assertAccount(accountId, token)
  if (!response || !Array.isArray(response.setlists) || response.setlists.some(s => !validId(s.id) || !positive(s.revision) ||
    typeof s.name !== 'string' || !positive(s.occurrences) || typeof s.updated_at !== 'string')) throw new Error('Invalid catalog response')
  return response.setlists
}

export function publicationError(error: unknown): string {
  if (error instanceof CatalogApiError) {
    const messages: Record<number, string> = {
      0: 'Connection failed. Retry the same confirmed request to recover its result.',
      401: 'Session expired. Sign in again, then reopen this setlist.',
      403: 'An active account and original publisher are required for this action.',
      404: 'Shared Setlists is unavailable in this environment.',
      408: 'Result unknown after timeout. Retry the same confirmed request; do not create another publication.',
      409: 'Publication or source conflict. Refresh and review again. An existing publication key cannot create another copy.',
      410: 'This publication was unpublished and cannot be republished with the same key.',
      422: 'The cloud source contains missing, ambiguous or unsupported songs. Fix it and sync before reviewing again.',
      429: 'Publication quota or rate limit reached. Wait before retrying; retained storage quotas may require operator help.',
      503: 'Catalog storage is unavailable. Retry the same request later.',
    }
    return messages[error.status] || error.message
  }
  return error instanceof Error ? error.message : 'Publication could not be verified.'
}

export async function preparePublication(sourceId: string | number, getLocal: () => SyncLibrary, blocked: () => boolean): Promise<SourcePreview> {
  const { token, accountId } = publisherSession()
  const local = getLocal()
  if (blocked()) throw new Error('Save your edits and resolve local recovery or cross-tab conflicts before publishing.')
  const persisted = readPersistedLibrary()
  if (!persisted || sourceChecksum(local) !== sourceChecksum(persisted) ||
    canonical(snapshotFromSongbook(local, sourceId)) !== canonical(snapshotFromSongbook(persisted, sourceId))) {
    throw new Error('Local edits are not safely persisted. Save and resolve storage/recovery errors first.')
  }
  const response = await catalogFetch<{ success: boolean; userId: string; cloudRecord: CloudSongbookRecord | null }>('/api/songbook/sync', { token })
  assertAccount(accountId, token, true)
  const cloud = response?.cloudRecord
  if (!response?.success || response.userId !== accountId || !cloud || cloud.userId !== accountId || !positive(cloud.version)) {
    throw new Error('Exact cloud source unavailable. Use Cloud Sync for this account, then retry preview.')
  }
  const current = getLocal()
  const latestPersisted = readPersistedLibrary()
  const snapshot = snapshotFromSongbook(cloud.data, sourceId)
  if (blocked() || !latestPersisted || sourceChecksum(current) !== sourceChecksum(latestPersisted) ||
    canonical(snapshotFromSongbook(latestPersisted, sourceId)) !== canonical(snapshot) ||
    cloud.checksum !== computeSongbookChecksum(cloud.data) || sourceChecksum(current) !== sourceChecksum(local) ||
    sourceChecksum(current) !== sourceChecksum(cloud.data) ||
    canonical(snapshotFromSongbook(current, sourceId)) !== canonical(snapshot)) {
    throw new Error('Local and cloud versions differ. Use existing Cloud Sync and resolve any conflict, then retry preview. Nothing was published.')
  }
  return { account: accountId, token, sourceId, version: cloud.version, checksum: sourceChecksum(current), snapshot }
}

export async function verifyPreview(preview: SourcePreview, getLocal: () => SyncLibrary, blocked: () => boolean) {
  assertAccount(preview.account, preview.token, true)
  const fresh = await preparePublication(preview.sourceId, getLocal, blocked)
  if (fresh.version !== preview.version || fresh.checksum !== preview.checksum || canonical(fresh.snapshot) !== canonical(preview.snapshot)) {
    throw new Error('Preview is stale. Refresh and explicitly review the new source before publishing.')
  }
}

function linkKey(account: string, sourceId: string | number) {
  // localStorage is origin-isolated: DEV/PROD never share this operational journal.
  return `gtar_setlist_publication_v1:${encodeURIComponent(account)}:${encodeURIComponent(String(sourceId))}`
}
export function readPublicationLink(account: string, sourceId: string | number): PublicationLink | null {
  const raw = localStorage.getItem(linkKey(account, sourceId))
  if (!raw) return null
  const link = JSON.parse(raw) as PublicationLink
  if (!link || !validId(link.publicationKey) || (link.result && (!validId(link.result.id) || !positive(link.result.revision) || typeof link.result.unpublished !== 'boolean')) ||
    (link.pending && (!validId(link.pending.key) || !['POST', 'PUT', 'DELETE'].includes(link.pending.method) || !link.pending.body))) {
    throw new Error('Publication recovery record is invalid. Preserve browser data and contact the operator; do not publish another copy.')
  }
  return link
}
export function savePublicationLink(account: string, sourceId: string | number, link: PublicationLink) {
  const key = linkKey(account, sourceId)
  const raw = JSON.stringify(link)
  localStorage.setItem(key, raw)
  if (localStorage.getItem(key) !== raw) throw new Error('Publication recovery record could not be saved. Free browser storage before retrying.')
}

export async function newPublicationLink(account: string, sourceId: string | number): Promise<PublicationLink> {
  // Deterministic opaque key prevents duplicate creates even if the journal was lost.
  const bytes = new TextEncoder().encode(JSON.stringify(['setlist-v1', account, String(sourceId)]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return { publicationKey: Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') }
}

export function makePublicationIntent(link: PublicationLink, preview?: SourcePreview, unpublish = false): PublicationIntent {
  if (link.pending) throw new Error('Recover the pending request before starting another mutation.')
  if (link.result?.unpublished) throw new Error('This publication is permanently unpublished.')
  const result = link.result
  if (!preview && !unpublish) throw new Error('Verified preview required')
  if (unpublish && !result) throw new Error('Verified publication required')
  return { method: unpublish ? 'DELETE' : result ? 'PUT' : 'POST', id: result?.id, key: generateUUID(),
    body: unpublish ? { expected_revision: result!.revision } : {
      snapshot_version: 1, source_setlist_id: preview!.sourceId, source_version: preview!.version,
      ...(result ? { expected_revision: result.revision } : { publication_key: link.publicationKey }),
    } }
}

export async function sendPublicationIntent(account: string, sourceId: string | number, link: PublicationLink): Promise<{ result: PublicationResult; saved: boolean }> {
  const { token, accountId } = publisherSession()
  if (account !== accountId || !link.pending) throw new Error('Account changed or request unavailable. Reopen and review again.')
  const existing = readPublicationLink(account, sourceId)
  if (existing && canonical(existing) !== canonical(link) &&
    (existing.pending || canonical(existing.result) !== canonical(link.result) || existing.publicationKey !== link.publicationKey)) {
    throw new Error('Publication changed in another tab. Reopen and recover its saved request before continuing.')
  }
  // Must be durable BEFORE any request. On timeout/reload the identical request survives.
  savePublicationLink(account, sourceId, link)
  const intent = link.pending
  const result = await catalogFetch<PublicationResult>(`/api/catalog/setlists${intent.id ? `/${encodeURIComponent(intent.id)}` : ''}`, {
    token, method: intent.method, body: intent.body, idempotencyKey: intent.key,
  })
  assertAccount(account, token, true)
  if (!result || !validId(result.id) || !positive(result.revision) || result.unpublished !== (intent.method === 'DELETE') ||
    (intent.id && result.id !== intent.id) || result.revision !== (intent.method === 'POST' ? 1 : Number(intent.body.expected_revision) + 1)) {
    throw new Error('Invalid server confirmation. Recover the same request before taking another action.')
  }
  try {
    savePublicationLink(account, sourceId, {
      publicationKey: link.publicationKey,
      result,
      snapshot: intent.method === 'DELETE' ? undefined : link.snapshot,
    })
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const EventCtor = (window as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : undefined)
      if (EventCtor) {
        window.dispatchEvent(new EventCtor('gtar-setlist-publication-updated', { detail: { account, sourceId } }))
      }
    }
  } catch { return { result, saved: false } }
  return { result, saved: true }
}

export async function refreshPublication(link: PublicationLink): Promise<PublicationLink> {
  const { token, accountId } = publisherSession()
  if (!link.result || link.pending) return link
  // List has the current revision; exact revision reads alone cannot prove the head.
  for (let offset = 0; offset < 1000; offset += 20) {
    const page = await listPublishedSetlists(offset)
    assertAccount(accountId, token, true)
    const head = page.find(s => s.id === link.result!.id)
    if (head) return { ...link, result: { id: head.id, revision: head.revision, unpublished: false } }
    if (page.length < 20) break
  }
  throw new Error('Publication is unavailable or unpublished. No mutation was sent.')
}
