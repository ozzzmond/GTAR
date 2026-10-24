/**
 * RFC #188 S4: per-record songbook sync API.
 *
 * GET  /api/songbook/records?since=<seq>&limit=<n>  -> records changed after `since`, oldest first
 * POST /api/songbook/records { changes: RecordChange[] } -> accepted / conflicts (per-record CAS)
 *
 * Enabled only when SONGBOOK_RECORDS_SYNC = "records-v1" (DEV preview). Otherwise 404, so the
 * client keeps using /api/songbook/sync. Strictly scoped to the authenticated caller.
 */
import { enforceAbuseLimit } from '../../lib/abuseProtection.ts'
import {
  JSON_HEADERS,
  authenticateUserRequest,
  errorResponse,
  jsonResponse,
  readBoundedJson,
  type AuthEnv,
} from '../../lib/authCore.ts'
import { pullRecords, pushRecords } from '../../lib/songbookRecordsCore.ts'
import {
  MAX_PUSH_CHANGES,
  MAX_PULL_RECORDS,
  MAX_RECORD_BYTES,
  MAX_RECORD_ID_LENGTH,
  RECORDS_FLAG_VALUE,
  RECORD_KINDS,
  recordDataError,
  recordKey,
  type RecordChange,
  type RecordKind,
} from '../../../src/utils/songbookRecords.ts'
import { validateCloudThemeSettings } from '../../../src/utils/backupSettings.ts'

export const MAX_RECORDS_PUSH_BYTES = 2 * 1024 * 1024

export interface RecordsEnv extends AuthEnv { SONGBOOK_RECORDS_SYNC?: string }
interface PagesContext { request: Request; env: RecordsEnv }

const disabled = () => jsonResponse({ success: false, code: 'RECORDS_SYNC_DISABLED', error: 'Not found' }, 404)

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { status: 204, headers: JSON_HEADERS })
}

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  if (env.SONGBOOK_RECORDS_SYNC !== RECORDS_FLAG_VALUE) return disabled()
  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) return errorResponse(auth.error, auth.status)
  const rejection = await enforceAbuseLimit(env, 'sync-read', auth.user.id)
  if (rejection) return rejection

  const url = new URL(request.url)
  const since = Number(url.searchParams.get('since') ?? '0')
  const limit = Number(url.searchParams.get('limit') ?? String(MAX_PULL_RECORDS))
  if (!Number.isSafeInteger(since) || since < 0) return errorResponse('Invalid since', 400)
  if (!Number.isSafeInteger(limit) || limit < 1) return errorResponse('Invalid limit', 400)
  try {
    const page = await pullRecords(env.DB!, auth.user.id, since, limit, new Date().toISOString())
    return jsonResponse({ success: true, userId: auth.user.id, ...page })
  } catch (err) {
    console.error('Failed to read songbook records:', err instanceof Error ? err.name : 'UnknownError')
    return errorResponse('Failed to read songbook records', 500)
  }
}

/** Returns the validated changes, or the first problem found. */
export function validateChanges(value: unknown): { changes?: RecordChange[]; error?: string } {
  if (!Array.isArray(value)) return { error: 'changes must be an array' }
  if (value.length === 0) return { error: 'changes is empty' }
  if (value.length > MAX_PUSH_CHANGES) return { error: `At most ${MAX_PUSH_CHANGES} changes per request` }
  const seen = new Set<string>()
  const changes: RecordChange[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Invalid change' }
    const item = raw as Record<string, unknown>
    const kind = item.kind as RecordKind
    if (!RECORD_KINDS.includes(kind)) return { error: 'Invalid record kind' }
    if (typeof item.id !== 'string' || !item.id || item.id.length > MAX_RECORD_ID_LENGTH) return { error: 'Invalid record id' }
    const key = recordKey(kind, item.id)
    if (seen.has(key)) return { error: `Duplicate change for ${key}` }
    seen.add(key)
    if (!Number.isSafeInteger(item.baseRev) || (item.baseRev as number) < 0) return { error: `${key}: invalid baseRev` }
    const removed = item.removed === true
    if (item.removed !== undefined && typeof item.removed !== 'boolean') return { error: `${key}: invalid removed flag` }
    if (removed) {
      if (item.data !== undefined && item.data !== null) return { error: `${key}: removed records carry no data` }
      if (item.baseRev === 0) return { error: `${key}: cannot remove a record the server never stored` }
    } else {
      const problem = recordDataError(kind, item.id, item.data)
      if (problem) return { error: problem }
      if (kind === 'theme') {
        const themeErrors = validateCloudThemeSettings(item.data)
        if (themeErrors.length) return { error: `theme: ${themeErrors.join('; ')}` }
      }
      if (new TextEncoder().encode(JSON.stringify(item.data)).byteLength > MAX_RECORD_BYTES) return { error: `${key}: record too large` }
    }
    changes.push({ kind, id: item.id, baseRev: item.baseRev as number, ...(removed ? { removed: true } : { data: item.data }) })
  }
  return { changes }
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (env.SONGBOOK_RECORDS_SYNC !== RECORDS_FLAG_VALUE) return disabled()
  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) return errorResponse(auth.error, auth.status)
  const rejection = await enforceAbuseLimit(env, 'sync-write', auth.user.id)
  if (rejection) return rejection

  const body = await readBoundedJson(request, MAX_RECORDS_PUSH_BYTES, { requireObject: true })
  if (body.error) return body.status === 413 ? errorResponse('Payload exceeds maximum allowed size of 2MB', 413) : errorResponse('Malformed JSON request body', 400)
  const { changes, error } = validateChanges((body.data as { changes?: unknown }).changes)
  if (error || !changes) return errorResponse(`Records validation failed: ${error}`, 400)
  try {
    const result = await pushRecords(env.DB!, auth.user.id, changes, new Date().toISOString())
    return jsonResponse({ success: true, userId: auth.user.id, ...result })
  } catch (err) {
    console.error('Failed to write songbook records:', err instanceof Error ? err.name : 'UnknownError')
    return errorResponse('Failed to write songbook records', 500)
  }
}
