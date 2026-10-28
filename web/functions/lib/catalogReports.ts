// #253 reactive moderation: members report catalog songs/setlists; admins resolve them.
// No auto-hide and no approval queue. Reports are retained history (never deleted).
import {
  authenticateAdminRequest, authenticateUserRequest, errorResponse, jsonResponse, readBoundedJson,
  type AuthEnv, type D1Database,
} from './authCore.ts'
import { inspectCatalogSchema } from './catalogSchema.ts'

export interface ReportContext { request: Request; env: AuthEnv; params: { id?: string } }

export const REPORT_REASONS = ['copyright', 'wrong_content', 'spam_abuse', 'other'] as const
export const REPORT_NOTE_MAX = 500
const REPORT_BODY_BYTES = 2048
const targetId = /^[A-Za-z0-9_-]{1,128}$/
const idempotency = /^[A-Za-z0-9_-]{16,128}$/
export const MODERATION_ACTIONS = ['dismiss', 'remove', 'close_removed'] as const

/** #253 B1: reports and moderation need the reviewed 0010 protections (fail closed otherwise). */
async function reportsAvailable(db: D1Database) {
  return (await inspectCatalogSchema(db)).reports
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

interface ModerationRow { report_id: number; action: string; request_digest: string; created_at: string }

/**
 * POST /api/admin/catalog-reports/:id — atomic moderation (#253 B2).
 * Body: { action: 'dismiss' | 'remove' | 'close_removed', expected_revision? (remove), note? } + Idempotency-Key.
 * One INSERT into catalog_moderation_actions validates the open report and the active admin, removes the
 * target with revision CAS and resolves the report(s); any failure rolls everything back.
 */
export async function handleAdminReportResolve(context: ReportContext): Promise<Response> {
  const { request, env, params } = context
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405)
  try {
    const auth = await authenticateAdminRequest(request, env)
    if ('error' in auth) return errorResponse(auth.error, auth.status)
    const db = env.DB!
    if (!await reportsAvailable(db)) return errorResponse('Reporting unavailable', 501)
    if (!/^\d{1,15}$/.test(String(params.id ?? ''))) return errorResponse('Invalid report ID', 400)
    const key = request.headers.get('Idempotency-Key') ?? ''
    if (!idempotency.test(key)) return errorResponse('Valid Idempotency-Key required', 400)
    const parsed = await readBoundedJson(request, REPORT_BODY_BYTES, { requireObject: true })
    if (parsed.error) return errorResponse('Invalid request body', parsed.status)
    const body = parsed.data as Record<string, unknown>
    const note = optionalNote(body.note)
    const action = String(body.action)
    const remove = action === 'remove'
    if (!isObject(body) || Object.keys(body).some(k => !['action', 'expected_revision', 'note'].includes(k)) ||
      !(MODERATION_ACTIONS as readonly string[]).includes(action) || note === undefined ||
      (remove ? !Number.isSafeInteger(body.expected_revision) || Number(body.expected_revision) < 1 : body.expected_revision !== undefined)) {
      return errorResponse('Invalid moderation request', 400)
    }
    const reportId = Number(params.id)
    const canonical = JSON.stringify({ report_id: reportId, action, expected_revision: remove ? body.expected_revision : null, note })
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))),
      b => b.toString(16).padStart(2, '0')).join('')
    const prior = () => db.prepare(`SELECT report_id, action, request_digest, created_at FROM catalog_moderation_actions
      WHERE admin_user_id = ? AND idempotency_key = ?`).bind(auth.user.id, key).first<ModerationRow>()
    const outcome = (row: ModerationRow) => row.request_digest !== digest || row.report_id !== reportId
      ? errorResponse('Idempotency key content conflict', 409)
      : jsonResponse({ success: true, id: reportId, action: row.action, status: row.action === 'dismiss' ? 'dismissed' : 'actioned' })
    const replay = await prior()
    if (replay) return outcome(replay)
    const report = await db.prepare('SELECT target_kind, target_id FROM catalog_reports WHERE id = ?').bind(reportId)
      .first<{ target_kind: string; target_id: string }>()
    if (!report) return errorResponse('Not found', 404)
    try {
      await db.prepare(`INSERT INTO catalog_moderation_actions(report_id,admin_user_id,idempotency_key,request_digest,action,
        target_kind,target_id,expected_revision,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(admin_user_id,idempotency_key) DO NOTHING`)
        .bind(reportId, auth.user.id, key, digest, action, report.target_kind, report.target_id,
          remove ? body.expected_revision : null, note, new Date().toISOString()).run()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/MODERATION_RESOLVED/.test(message)) return errorResponse('Report already resolved', 409)
      if (/MODERATION_CONFLICT|SETLIST_REVISION_CONFLICT/.test(message)) return errorResponse('Content changed or already removed. Refresh and review again.', 409)
      if (/MODERATION_IDEMPOTENCY/.test(message)) return errorResponse('Idempotency key content conflict', 409)
      if (/MODERATION_FORBIDDEN|SETLIST_FORBIDDEN/.test(message)) return errorResponse('Forbidden', 403)
      throw error
    }
    // Includes the ON CONFLICT zero-change retry path; success is read back from the ledger.
    const stored = await prior()
    if (!stored) return errorResponse('Reporting unavailable', 503)
    return outcome(stored)
  } catch {
    return errorResponse('Reporting unavailable', 503)
  }
}
