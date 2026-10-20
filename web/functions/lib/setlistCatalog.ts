import { snapshotFromSongbook, validateSnapshot } from '../../src/utils/sharedSetlistSnapshot.ts'
export { snapshotFromSongbook, validateSnapshot, SETLIST_LIMITS } from '../../src/utils/sharedSetlistSnapshot.ts'
import {
  authenticateAdminRequest, authenticateUserRequest, errorResponse, findUserSongbook,
  jsonResponse, readBoundedJson,
  type AuthEnv, type D1Database,
} from './authCore.ts'

export interface SetlistCatalogEnv extends AuthEnv { SHARED_SETLISTS_ENABLED?: string }
export interface SetlistContext {
  request: Request
  env: SetlistCatalogEnv
  params: { id?: string }
}

const encoder = new TextEncoder()
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

const protectionTriggers = [
  'catalog_setlist_guard', 'catalog_setlist_apply', 'catalog_setlist_mutation_no_update',
  'catalog_setlist_mutation_no_delete', 'catalog_setlist_revision_no_update',
  'catalog_setlist_revision_no_delete', 'catalog_setlist_head_no_delete', 'catalog_setlist_head_guard',
]

async function protect(db: D1Database, userId: string, write: boolean) {
  // Missing schema/protections must never silently downgrade to an unprotected path.
  const inventory = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
    AND name IN (${protectionTriggers.map(() => '?').join(',')})`).bind(...protectionTriggers).all<{ name: string }>()
  if (!inventory.success || inventory.results.length !== protectionTriggers.length) fail('Protection unavailable')
  const minute = Math.floor(Date.now() / 60000)
  const day = Math.floor(minute / 1440)
  const result = await db.prepare(`INSERT INTO catalog_setlist_rates(user_id,kind,minute,minute_count,day,day_count)
    VALUES(?,?,?,1,?,1) ON CONFLICT(user_id,kind) DO UPDATE SET
    minute = excluded.minute, minute_count = CASE WHEN minute = excluded.minute THEN minute_count + 1 ELSE 1 END,
    day = excluded.day, day_count = CASE WHEN day = excluded.day THEN day_count + 1 ELSE 1 END
    WHERE (minute <> excluded.minute OR minute_count < ?) AND (day <> excluded.day OR day_count < ?)
    RETURNING user_id`).bind(userId, write ? 'write' : 'read', minute, day, write ? 30 : 120, write ? 200 : 10000).first()
  return !!result
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
  if (env.SHARED_SETLISTS_ENABLED !== 'phase-a-v1') return errorResponse('Not found', 404)
  const method = request.method
  const write = ['POST', 'PUT', 'DELETE'].includes(method)
  if ((!params.id && !['GET', 'POST'].includes(method)) || (params.id && !['GET', 'PUT', 'DELETE'].includes(method))) {
    return errorResponse('Method not allowed', 405)
  }
  try {
    const auth = await (write ? authenticateAdminRequest : authenticateUserRequest)(request, env)
    if ('error' in auth) return errorResponse(auth.error, auth.status)
    const db = env.DB!
    if (!await protect(db, auth.user.id, write)) return errorResponse('Rate limit exceeded', 429)
    if (params.id && !token.test(params.id)) return errorResponse('Invalid publication ID', 400)
    const url = new URL(request.url)
    if (!write) {
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
        return jsonResponse({ setlists: rows.results })
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
    const parsed = await readBoundedJson(request, 4096, { requireObject: true })
    if (parsed.error) return errorResponse('Invalid request body', parsed.status)
    const body = parsed.data as Record<string, unknown>
    const operation = method === 'POST' ? 'create' : method === 'PUT' ? 'update' : 'unpublish'
    let canonical: Record<string, unknown>
    try {
      exactKeys(body, operation === 'unpublish' ? ['expected_revision'] :
        operation === 'create' ? ['snapshot_version', 'publication_key', 'source_setlist_id', 'source_version'] :
          ['snapshot_version', 'expected_revision', 'source_setlist_id', 'source_version'])
      if (operation !== 'create' && !positive(body.expected_revision)) fail()
      if (operation === 'unpublish') canonical = { operation, id: params.id, expected_revision: body.expected_revision }
      else {
        if (body.snapshot_version !== 1 || !positive(body.source_version)) fail()
        const sourceId = identity(body.source_setlist_id)
        if (operation === 'create' && (typeof body.publication_key !== 'string' || !token.test(body.publication_key))) fail()
        canonical = { operation, id: params.id ?? null, expected_revision: body.expected_revision ?? 0,
          publication_key: body.publication_key ?? null, snapshot_version: 1, source_version: body.source_version, source_setlist_id: sourceId }
      }
    } catch { return errorResponse('Invalid mutation contract', 400) }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(canonical)))))
      .map(v => v.toString(16).padStart(2, '0')).join('')
    const prior = await previous(db, auth.user.id, key)
    if (prior) return await mutationResponse(db, prior, digest)

    let snapshotJson: string | null = null
    let sourceChecksum: string | null = null
    if (operation !== 'unpublish') {
      const source = await findUserSongbook(db, auth.user.id)
      if (!source || source.version !== body.source_version) return errorResponse('Source songbook version conflict', 409)
      try { snapshotJson = JSON.stringify(snapshotFromSongbook(JSON.parse(source.data_json), body.source_setlist_id)) }
      catch { return errorResponse('Source setlist cannot be published', 422) }
      sourceChecksum = source.checksum
    }
    const id = params.id ?? crypto.randomUUID()
    let publicationKey = body.publication_key as string
    if (operation !== 'create') {
      const head = await db.prepare('SELECT publication_key FROM catalog_setlist_heads WHERE id = ? AND publisher_user_id = ?')
        .bind(id, auth.user.id).first<{ publication_key: string }>()
      if (!head) return errorResponse('Publication unavailable', 409)
      publicationKey = head.publication_key
    }
    try {
      const result = await db.prepare(`INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,
        operation,setlist_id,publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(editor_user_id,idempotency_key) DO NOTHING`)
        .bind(auth.user.id, key, digest, operation, id, publicationKey, body.expected_revision ?? 0,
          operation === 'unpublish' ? null : body.source_version, sourceChecksum, snapshotJson,
          snapshotJson ? encoder.encode(snapshotJson).length : 0, new Date().toISOString()).run()
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
