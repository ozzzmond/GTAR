import { snapshotFromSongbook, validateSnapshot, normalizeSnapshot } from '../../src/utils/sharedSetlistSnapshot.ts'
export { snapshotFromSongbook, validateSnapshot, SETLIST_LIMITS } from '../../src/utils/sharedSetlistSnapshot.ts'
import {
  authenticateUserRequest, errorResponse, findUserSongbook,
  jsonResponse,
  type AuthEnv, type D1Database,
} from './authCore.ts'
import { inspectCatalogSchema } from './catalogSchema.ts'

export interface SetlistCatalogEnv extends AuthEnv { SHARED_SETLISTS_ENABLED?: string }
/**
 * Exact server flag values (anything else, including unset, keeps every route at 404).
 * - `phase-a-v1`: DEV Preview. Works on legacy (pre-0010) or Catalog V2 schemas.
 * - `catalog-v2`: production activation value (#253). Serves only when the reviewed migration 0010
 *   protections are present; on a legacy, partial or unknown schema every route fails closed (503).
 *   Legacy request bodies from older clients are still accepted once 0010 is present.
 */
export const SHARED_SETLIST_FLAGS = { preview: 'phase-a-v1', production: 'catalog-v2' } as const
export interface SetlistContext {
  request: Request
  env: SetlistCatalogEnv
  params: { id?: string }
}

const encoder = new TextEncoder()
/** Legacy (songbook-reference) bodies keep their original 4 KB cap. */
export const LEGACY_BODY_BYTES = 4096
/** #253 client snapshot bodies: 256 KB snapshot plus a small envelope. Only on setlist writes. */
export const CLIENT_SNAPSHOT_BODY_BYTES = 266240
const token = /^[A-Za-z0-9_-]{16,128}$/

function fail(message = 'Invalid setlist snapshot'): never { throw new Error(message) }
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) fail()
}
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}
function identity(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) ||
      !String(value).trim() || String(value).length > 128) fail('Invalid source identity')
  return String(value)
}

async function protect(db: D1Database, userId: string, write: boolean, requireV2: boolean): Promise<{ allowed: boolean; clientSnapshots: boolean }> {
  // #253 B1: every protection trigger must match a reviewed definition (formatting-insensitive).
  // Missing, unknown or weakened protections fail closed: no capability, no read or write path.
  const schema = await inspectCatalogSchema(db)
  // `catalog-v2` (production) additionally requires the complete, verified reporting/moderation schema,
  // so publishing never goes live without its moderation path.
  if (!schema.setlists || (requireV2 && (schema.setlists !== 'v2' || !schema.reports))) fail('Protection unavailable')
  const clientSnapshots = schema.setlists === 'v2'
  const minute = Math.floor(Date.now() / 60000)
  const day = Math.floor(minute / 1440)
  const result = await db.prepare(`INSERT INTO catalog_setlist_rates(user_id,kind,minute,minute_count,day,day_count)
    VALUES(?,?,?,1,?,1) ON CONFLICT(user_id,kind) DO UPDATE SET
    minute = excluded.minute, minute_count = CASE WHEN minute = excluded.minute THEN minute_count + 1 ELSE 1 END,
    day = excluded.day, day_count = CASE WHEN day = excluded.day THEN day_count + 1 ELSE 1 END
    WHERE (minute <> excluded.minute OR minute_count < ?) AND (day <> excluded.day OR day_count < ?)
    RETURNING user_id`).bind(userId, write ? 'write' : 'read', minute, day, write ? 30 : 120, write ? 200 : 10000).first()
  return { allowed: !!result, clientSnapshots }
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes)).map(v => v.toString(16).padStart(2, '0')).join('')
const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))

/** Bounded raw read. Never buffers more than `max` bytes of a streamed body. */
async function readBoundedText(request: Request, max: number): Promise<{ text?: string; bytes: number; tooLarge?: boolean }> {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > max) return { bytes: declared, tooLarge: true }
  if (!request.body) return { text: '', bytes: 0 }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > max) { await reader.cancel().catch(() => {}); return { bytes, tooLarge: true } }
    chunks.push(value)
  }
  const all = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength }
  return { text: new TextDecoder('utf-8', { fatal: true }).decode(all), bytes }
}

type Body = Record<string, unknown>
/** Parse a setlist write body. Only bodies carrying a client `snapshot` may exceed the legacy cap. */
async function readWriteBody(request: Request): Promise<{ body?: Body; status?: number }> {
  let raw: Awaited<ReturnType<typeof readBoundedText>>
  try { raw = await readBoundedText(request, CLIENT_SNAPSHOT_BODY_BYTES) } catch { return { status: 400 } }
  if (raw.tooLarge) return { status: 413 }
  let value: unknown
  try { value = JSON.parse(raw.text ?? '') } catch { return { status: raw.bytes > LEGACY_BODY_BYTES ? 413 : 400 } }
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value)
  if (raw.bytes > LEGACY_BODY_BYTES && !(isObject && Object.hasOwn(value as Body, 'snapshot'))) return { status: 413 }
  if (!isObject) return { status: 400 }
  return { body: value as Body }
}

interface Mutation {
  request_digest: string; setlist_id: string; expected_revision: number; operation: string
}
async function previous(db: D1Database, user: string, key: string) {
  return db.prepare(`SELECT request_digest,setlist_id,expected_revision,operation FROM catalog_setlist_mutations
    WHERE editor_user_id = ? AND idempotency_key = ?`).bind(user, key).first<Mutation>()
}
async function mutationResponse(db: D1Database, mutation: Mutation, digest: string) {
  if (mutation.request_digest !== digest) return errorResponse('Idempotency key content conflict', 409)
  const head = await db.prepare('SELECT is_deleted FROM catalog_setlist_heads WHERE id = ?').bind(mutation.setlist_id).first<{ is_deleted: number }>()
  if (!head) fail('Persistence unavailable')
  if (head.is_deleted && mutation.operation !== 'unpublish') return errorResponse('Publication unpublished', 410)
  return jsonResponse({ id: mutation.setlist_id, revision: mutation.expected_revision + 1, unpublished: mutation.operation === 'unpublish' })
}

/** Only the existing environment DB is consulted. No alternate DB, Worker or network path. */
export async function handleSetlistCatalog(context: SetlistContext): Promise<Response> {
  const { request, env, params } = context
  const flag = env.SHARED_SETLISTS_ENABLED
  if (flag !== SHARED_SETLIST_FLAGS.preview && flag !== SHARED_SETLIST_FLAGS.production) return errorResponse('Not found', 404)
  const method = request.method
  const write = ['POST', 'PUT', 'DELETE'].includes(method)
  if ((!params.id && !['GET', 'POST'].includes(method)) || (params.id && !['GET', 'PUT', 'DELETE'].includes(method))) {
    return errorResponse('Method not allowed', 405)
  }
  try {
    const auth = await authenticateUserRequest(request, env)
    if ('error' in auth) return errorResponse(auth.error, auth.status)
    const db = env.DB!
    const protection = await protect(db, auth.user.id, write, flag === SHARED_SETLIST_FLAGS.production)
    if (!protection.allowed) return errorResponse('Rate limit exceeded', 429)
    if (params.id && !token.test(params.id)) return errorResponse('Invalid publication ID', 400)
    const url = new URL(request.url)
    if (!write) {
      if (!params.id && url.searchParams.has('publication_key')) {
        // #253 lost-journal recovery: the caller's OWN head for a publication key (never another
        // publisher's). Lets a client adopt an existing publication instead of re-creating it (409).
        const publicationKey = url.searchParams.get('publication_key') ?? ''
        if ([...url.searchParams.keys()].some(k => k !== 'publication_key') || !token.test(publicationKey)) return errorResponse('Invalid lookup', 400)
        const head = await db.prepare(`SELECT id, current_revision AS revision, is_deleted FROM catalog_setlist_heads
          WHERE publisher_user_id = ? AND publication_key = ?`).bind(auth.user.id, publicationKey)
          .first<{ id: string; revision: number; is_deleted: number }>()
        return jsonResponse({ publication: head ? { id: head.id, revision: head.revision, unpublished: head.is_deleted === 1 } : null })
      }
      if (!params.id) {
        const limit = url.searchParams.get('limit') ?? '25'
        const offset = url.searchParams.get('offset') ?? '0'
        if (!/^\d{1,7}$/.test(limit) || !/^\d{1,7}$/.test(offset) || Number(limit) < 1 || Number(limit) > 50) return errorResponse('Invalid pagination', 400)
        const rows = await db.prepare(`SELECT h.id,h.current_revision AS revision,json_extract(m.snapshot_json,'$.name') AS name,
          json_array_length(m.snapshot_json,'$.entries') AS occurrences,m.created_at AS updated_at
          FROM catalog_setlist_heads h JOIN catalog_setlist_revisions r ON r.setlist_id=h.id AND r.revision=h.current_revision
          JOIN catalog_setlist_mutations m ON m.id=r.mutation_id WHERE h.is_deleted=0 ORDER BY h.id LIMIT ? OFFSET ?`)
          .bind(Number(limit), Number(offset)).all()
        if (!rows.success) fail()
        // `capabilities` is additive; old clients ignore it.
        return jsonResponse({ setlists: rows.results, capabilities: { client_snapshots: protection.clientSnapshots } })
      }
      const revision = Number(url.searchParams.get('revision'))
      if (!positive(revision)) return errorResponse('Exact revision required', 400)
      const row = await db.prepare(`SELECT m.snapshot_json FROM catalog_setlist_heads h
        JOIN catalog_setlist_revisions r ON r.setlist_id=h.id JOIN catalog_setlist_mutations m ON m.id=r.mutation_id
        WHERE h.id=? AND h.is_deleted=0 AND r.revision=?`).bind(params.id, revision).first<{ snapshot_json: string }>()
      if (!row) return errorResponse('Not found', 404)
      const snapshot: unknown = JSON.parse(row.snapshot_json)
      validateSnapshot(snapshot)
      return jsonResponse({ id: params.id, revision, snapshot })
    }

    const key = request.headers.get('Idempotency-Key') ?? ''
    if (!token.test(key)) return errorResponse('Valid Idempotency-Key required', 400)
    const parsed = await readWriteBody(request)
    if (!parsed.body) return errorResponse('Invalid request body', parsed.status ?? 400)
    const body = parsed.body
    const operation = method === 'POST' ? 'create' : method === 'PUT' ? 'update' : 'unpublish'
    // #253: a client snapshot is self-contained and needs no personal cloud songbook.
    const client = operation !== 'unpublish' && Object.hasOwn(body, 'snapshot')
    let canonical: Record<string, unknown>
    try {
      exactKeys(body, operation === 'unpublish' ? ['expected_revision'] :
        client ? (operation === 'create' ? ['snapshot_version', 'publication_key', 'snapshot'] : ['snapshot_version', 'expected_revision', 'snapshot']) :
        operation === 'create' ? ['snapshot_version', 'publication_key', 'source_setlist_id', 'source_version'] :
          ['snapshot_version', 'expected_revision', 'source_setlist_id', 'source_version'])
      if (operation !== 'create' && !positive(body.expected_revision)) fail()
      if (operation === 'create' && (typeof body.publication_key !== 'string' || !token.test(body.publication_key))) fail()
      if (operation === 'unpublish') canonical = { operation, id: params.id, expected_revision: body.expected_revision }
      else if (client) {
        if (body.snapshot_version !== 1) fail()
        canonical = { operation, id: params.id ?? null, expected_revision: body.expected_revision ?? 0,
          publication_key: body.publication_key ?? null, snapshot_version: 1, source_kind: 'client' }
      } else {
        if (body.snapshot_version !== 1 || !positive(body.source_version)) fail()
        const sourceId = identity(body.source_setlist_id)
        canonical = { operation, id: params.id ?? null, expected_revision: body.expected_revision ?? 0,
          publication_key: body.publication_key ?? null, snapshot_version: 1, source_version: body.source_version, source_setlist_id: sourceId }
      }
    } catch { return errorResponse('Invalid mutation contract', 400) }

    let snapshotJson: string | null = null
    let sourceChecksum: string | null = null
    let sourceVersion: number | null = null
    if (client) {
      // Validate shape, content and size before any write; store one canonical field order.
      try { snapshotJson = JSON.stringify(normalizeSnapshot(body.snapshot)) } catch (error) {
        const tooLarge = error instanceof Error && error.message.startsWith('Snapshot too large')
        return errorResponse(tooLarge ? 'Snapshot too large' : 'Invalid setlist snapshot', tooLarge ? 413 : 422)
      }
      if (!protection.clientSnapshots) return errorResponse('Client snapshot publishing unavailable', 501)
      sourceChecksum = await sha256(snapshotJson)
      sourceVersion = 1
      canonical.snapshot_sha256 = sourceChecksum
    }
    const digest = await sha256(JSON.stringify(canonical))
    const prior = await previous(db, auth.user.id, key)
    if (prior) return await mutationResponse(db, prior, digest)

    if (operation !== 'unpublish' && !client) {
      const source = await findUserSongbook(db, auth.user.id)
      if (!source || source.version !== body.source_version) return errorResponse('Source songbook version conflict', 409)
      try { snapshotJson = JSON.stringify(snapshotFromSongbook(JSON.parse(source.data_json), body.source_setlist_id)) }
      catch { return errorResponse('Source setlist cannot be published', 422) }
      sourceChecksum = source.checksum
      sourceVersion = Number(body.source_version)
    }
    const id = params.id ?? crypto.randomUUID()
    let publicationKey = body.publication_key as string
    if (operation !== 'create') {
      const head = await db.prepare('SELECT publication_key, publisher_user_id FROM catalog_setlist_heads WHERE id = ?')
        .bind(id).first<{ publication_key: string; publisher_user_id: string }>()
      if (!head) return errorResponse('Publication unavailable', 409)
      if (head.publisher_user_id !== auth.user.id) {
        // #253: only active admins (server role) may edit or unpublish another publisher's setlist,
        // and only once 0010 is applied. Members keep the original non-disclosing 409.
        if (auth.user.role !== 'admin' || !protection.clientSnapshots) return errorResponse('Publication unavailable', 409)
        if (operation === 'update' && !client) return errorResponse('Publishing forbidden', 403)
      }
      publicationKey = head.publication_key
    }
    try {
      // Legacy rows omit source_kind (column default 'songbook'), so this path also runs before 0010.
      const values = [auth.user.id, key, digest, operation, id, publicationKey, body.expected_revision ?? 0,
        sourceVersion, sourceChecksum, snapshotJson, snapshotJson ? encoder.encode(snapshotJson).length : 0, new Date().toISOString()]
      const result = await db.prepare(`INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,
        operation,setlist_id,publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at${client ? ',source_kind' : ''})
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?${client ? ",'client'" : ''}) ON CONFLICT(editor_user_id,idempotency_key) DO NOTHING`)
        .bind(...values).run()
      if (!result.success) fail('Persistence unavailable')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/SETLIST_QUOTA/.test(message)) return errorResponse('Publication quota exceeded', 429)
      if (/SETLIST_(IDEMPOTENCY|SOURCE_CONFLICT|PUBLICATION_CONFLICT|REVISION_CONFLICT)/.test(message)) return errorResponse('Publication conflict', 409)
      if (/SETLIST_FORBIDDEN/.test(message)) return errorResponse('Publishing forbidden', 403)
      throw error
    }
    // Includes the ON CONFLICT zero-change retry path. Never infer success from meta.changes.
    const persisted = await previous(db, auth.user.id, key)
    if (!persisted) fail('Persistence unavailable')
    return await mutationResponse(db, persisted, digest)
  } catch {
    return errorResponse('Setlist catalog unavailable', 503)
  }
}
