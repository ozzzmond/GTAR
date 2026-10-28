// #253 reactive moderation: members report catalog songs/setlists; admins resolve them.
// No auto-hide and no approval queue. Reports are retained history (never deleted).
import {
  authenticateAdminRequest, authenticateUserRequest, errorResponse, jsonResponse, readBoundedJson,
  type AuthEnv, type D1Database,
} from './authCore.ts'

export interface ReportContext { request: Request; env: AuthEnv; params: { id?: string } }

export const REPORT_REASONS = ['copyright', 'wrong_content', 'spam_abuse', 'other'] as const
export const REPORT_NOTE_MAX = 500
const REPORT_BODY_BYTES = 2048
const reportTriggers = ['catalog_report_guard', 'catalog_report_resolve', 'catalog_report_no_delete']
const targetId = /^[A-Za-z0-9_-]{1,128}$/

async function reportsAvailable(db: D1Database) {
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
    AND name IN (${reportTriggers.map(() => '?').join(',')})`).bind(...reportTriggers).all<{ name: string }>()
  return rows.success && rows.results.length === reportTriggers.length
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const optionalNote = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > REPORT_NOTE_MAX) return undefined
  return value.trim() || null
}

/** POST /api/catalog/reports — any active member/admin; one open report per target; rate limited in SQL. */
export async function handleCatalogReport(context: ReportContext): Promise<Response> {
  const { request, env } = context
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405)
  try {
    const auth = await authenticateUserRequest(request, env)
    if ('error' in auth) return errorResponse(auth.error, auth.status)
    const db = env.DB!
    if (!await reportsAvailable(db)) return errorResponse('Reporting unavailable', 501)
    const parsed = await readBoundedJson(request, REPORT_BODY_BYTES, { requireObject: true })
    if (parsed.error) return errorResponse('Invalid request body', parsed.status)
    const body = parsed.data as Record<string, unknown>
    const note = optionalNote(body.note)
    if (Object.keys(body).some(key => !['target_kind', 'target_id', 'target_revision', 'reason', 'note'].includes(key)) ||
      !['song', 'setlist'].includes(String(body.target_kind)) || typeof body.target_id !== 'string' || !targetId.test(body.target_id) ||
      !Number.isSafeInteger(body.target_revision) || Number(body.target_revision) < 1 ||
      !(REPORT_REASONS as readonly string[]).includes(String(body.reason)) || note === undefined) {
      return errorResponse('Invalid report', 400)
    }
    try {
      const row = await db.prepare(`INSERT INTO catalog_reports(target_kind,target_id,target_revision,reporter_user_id,reason,note,created_at)
        VALUES(?,?,?,?,?,?,?) RETURNING id`).bind(body.target_kind, body.target_id, body.target_revision, auth.user.id,
        body.reason, note, new Date().toISOString()).first<{ id: number }>()
      if (!row) return errorResponse('Reporting unavailable', 503)
      return jsonResponse({ success: true, id: row.id, status: 'open' }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/UNIQUE/i.test(message)) return errorResponse('You already have an open report for this item', 409)
      if (/REPORT_RATE/.test(message)) return errorResponse('Report limit reached. Try again later.', 429)
      if (/REPORT_TARGET/.test(message)) return errorResponse('Item not found', 404)
      if (/REPORT_FORBIDDEN/.test(message)) return errorResponse('Forbidden', 403)
      throw error
    }
  } catch {
    return errorResponse('Reporting unavailable', 503)
  }
}

/** GET /api/admin/catalog-reports — moderation queue (admin only). */
export async function handleAdminReportList(context: ReportContext): Promise<Response> {
  const { request, env } = context
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405)
  try {
    const auth = await authenticateAdminRequest(request, env)
    if ('error' in auth) return errorResponse(auth.error, auth.status)
    const db = env.DB!
    if (!await reportsAvailable(db)) return errorResponse('Reporting unavailable', 501)
    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? 'open'
    const limit = url.searchParams.get('limit') ?? '50'
    const offset = url.searchParams.get('offset') ?? '0'
    if (!['open', 'dismissed', 'actioned', 'all'].includes(status) || !/^\d{1,7}$/.test(limit) || !/^\d{1,7}$/.test(offset) ||
      Number(limit) < 1 || Number(limit) > 50) return errorResponse('Invalid query', 400)
    const rows = await db.prepare(`SELECT r.id,r.target_kind,r.target_id,r.target_revision,r.reason,r.note,r.status,
        r.created_at,r.resolved_at,r.resolution_note,u.email AS reporter_email,u.display_name AS reporter_name,
        CASE r.target_kind WHEN 'song' THEN s.title ELSE json_extract(m.snapshot_json,'$.name') END AS target_title,
        CASE r.target_kind WHEN 'song' THEN s.artist ELSE NULL END AS target_artist,
        CASE r.target_kind WHEN 'song' THEN s.current_revision ELSE h.current_revision END AS target_current_revision,
        CASE r.target_kind WHEN 'song' THEN s.is_deleted ELSE h.is_deleted END AS target_deleted,
        (SELECT count(*) FROM catalog_reports o WHERE o.target_kind = r.target_kind AND o.target_id = r.target_id
          AND o.status = 'open') AS open_reports
      FROM catalog_reports r JOIN users u ON u.id = r.reporter_user_id
      LEFT JOIN shared_catalog_songs s ON r.target_kind = 'song' AND s.id = r.target_id
      LEFT JOIN catalog_setlist_heads h ON r.target_kind = 'setlist' AND h.id = r.target_id
      LEFT JOIN catalog_setlist_revisions sr ON sr.setlist_id = h.id AND sr.revision = r.target_revision
      LEFT JOIN catalog_setlist_mutations m ON m.id = sr.mutation_id
      WHERE (? = 'all' OR r.status = ?) ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .bind(status, status, Number(limit), Number(offset)).all()
    if (!rows.success) return errorResponse('Reporting unavailable', 503)
    return jsonResponse({ success: true, reports: rows.results })
  } catch {
    return errorResponse('Reporting unavailable', 503)
  }
}

/** POST /api/admin/catalog-reports/:id — resolve once: { status: 'dismissed' | 'actioned', note? }. */
export async function handleAdminReportResolve(context: ReportContext): Promise<Response> {
  const { request, env, params } = context
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405)
  try {
    const auth = await authenticateAdminRequest(request, env)
    if ('error' in auth) return errorResponse(auth.error, auth.status)
    const db = env.DB!
    if (!await reportsAvailable(db)) return errorResponse('Reporting unavailable', 501)
    if (!/^\d{1,15}$/.test(String(params.id ?? ''))) return errorResponse('Invalid report ID', 400)
    const parsed = await readBoundedJson(request, REPORT_BODY_BYTES, { requireObject: true })
    if (parsed.error) return errorResponse('Invalid request body', parsed.status)
    const body = parsed.data as Record<string, unknown>
    const note = optionalNote(body.note)
    if (!isObject(body) || Object.keys(body).some(key => !['status', 'note'].includes(key)) ||
      !['dismissed', 'actioned'].includes(String(body.status)) || note === undefined) return errorResponse('Invalid resolution', 400)
    try {
      const row = await db.prepare(`UPDATE catalog_reports SET status = ?, resolver_user_id = ?, resolution_note = ?, resolved_at = ?
        WHERE id = ? AND status = 'open' RETURNING id,status`).bind(body.status, auth.user.id, note, new Date().toISOString(), Number(params.id))
        .first<{ id: number; status: string }>()
      if (row) return jsonResponse({ success: true, ...row })
    } catch (error) {
      if (!/REPORT_IMMUTABLE/.test(error instanceof Error ? error.message : '')) throw error
    }
    const exists = await db.prepare('SELECT status FROM catalog_reports WHERE id = ?').bind(Number(params.id)).first()
    return exists ? errorResponse('Report already resolved', 409) : errorResponse('Not found', 404)
  } catch {
    return errorResponse('Reporting unavailable', 503)
  }
}
