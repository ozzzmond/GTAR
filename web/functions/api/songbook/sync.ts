import { enforceAbuseLimit } from '../../lib/abuseProtection.ts'
import {
  jsonResponse,
  errorResponse,
  authenticateUserRequest,
  findUserSongbook,
  upsertUserSongbook,
  readBoundedJson,
  type AuthEnv,
  JSON_HEADERS,
} from '../../lib/authCore.ts'
import { computeSongbookChecksum } from '../../../src/utils/cloudSongbookSync.ts'
import {
  validateCloudThemeSettings,
  normalizeCloudThemeSettings,
} from '../../../src/utils/backupSettings.ts'
import type { SyncLibrary } from '../../../src/utils/syncMerge.ts'
import { recordsActiveForUser } from '../../lib/songbookRecordsCore.ts'

/** #208 F2: returned to classic writers once the user's songbook lives in per-record records. */
export const RECORDS_ACTIVE_CODE = 'SONGBOOK_RECORDS_ACTIVE'

export const MAX_SONGBOOK_PAYLOAD_BYTES = 2 * 1024 * 1024 // 2 MB

interface PagesContext {
  request: Request
  env: AuthEnv
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: JSON_HEADERS,
  })
}

/**
 * Validates canonical Songbook dataset structure on the server
 */
function validateSongbookPayload(data: unknown): { isValid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { isValid: false, error: 'Songbook payload must be a non-empty object' }
  }
  const obj = data as { songs?: unknown; setlists?: unknown; themeSettings?: unknown }
  if (!Array.isArray(obj.songs)) {
    return { isValid: false, error: 'Songbook payload missing songs array' }
  }
  if (!Array.isArray(obj.setlists)) {
    return { isValid: false, error: 'Songbook payload missing setlists array' }
  }

  // Verify song objects have required string properties
  for (let i = 0; i < obj.songs.length; i++) {
    const s = obj.songs[i]
    if (!s || typeof s !== 'object') {
      return { isValid: false, error: `Invalid song at index ${i}` }
    }
    const song = s as Record<string, unknown>
    if (typeof song.title !== 'string' || !song.title.trim()) {
      return { isValid: false, error: `Song at index ${i} is missing a title` }
    }
    if (typeof song.rawContent !== 'string') {
      return { isValid: false, error: `Song "${song.title}" is missing rawContent` }
    }
  }

  // Verify setlist objects have valid id, name, songs array, and optional tombstone
  for (let i = 0; i < obj.setlists.length; i++) {
    const sl = obj.setlists[i]
    if (!sl || typeof sl !== 'object') {
      return { isValid: false, error: `Invalid setlist at index ${i}` }
    }
    const setlist = sl as Record<string, unknown>
    if (typeof setlist.name !== 'string' || !setlist.name.trim()) {
      return { isValid: false, error: `Setlist at index ${i} is missing a valid name` }
    }
    if (setlist.id !== undefined && setlist.id !== null) {
      if (typeof setlist.id !== 'string' && typeof setlist.id !== 'number') {
        return { isValid: false, error: `Setlist at index ${i} has invalid id type` }
      }
    }
    if (!Array.isArray(setlist.songs)) {
      return { isValid: false, error: `Setlist "${setlist.name}" is missing songs array` }
    }
    for (let j = 0; j < setlist.songs.length; j++) {
      const ref = setlist.songs[j]
      if (!ref || typeof ref !== 'object') {
        return { isValid: false, error: `Setlist "${setlist.name}" has invalid song reference at index ${j}` }
      }
      const refObj = ref as Record<string, unknown>
      if (typeof refObj.title !== 'string') {
        return { isValid: false, error: `Setlist "${setlist.name}" song ref at index ${j} missing title` }
      }
    }
    if (setlist.isDeleted !== undefined && typeof setlist.isDeleted !== 'boolean') {
      return { isValid: false, error: `Setlist "${setlist.name}" has non-boolean isDeleted flag` }
    }
  }

  const recordObj = data as Record<string, unknown>
  if ('themeSettings' in recordObj && recordObj.themeSettings !== undefined) {
    const themeErrors = validateCloudThemeSettings(recordObj.themeSettings)
    if (themeErrors.length > 0) {
      return { isValid: false, error: themeErrors.join('; ') }
    }
  }

  return { isValid: true }
}


/**
 * GET /api/songbook/sync
 * Retrieves the authenticated user's current cloud Songbook record.
 * Strictly scoped to the authenticated caller's user.id.
 */
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context

  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  try {
    const rejection = await enforceAbuseLimit(env, 'sync-read', auth.user.id)
    if (rejection) return rejection
    const record = await findUserSongbook(env.DB!, auth.user.id)
    if (!record) {
      return jsonResponse({
        success: true,
        cloudRecord: null,
        userId: auth.user.id,
      })
    }

    let parsedData: unknown
    try {
      parsedData = JSON.parse(record.data_json)
    } catch {
      return errorResponse('Corrupted cloud songbook payload in database', 500)
    }

    return jsonResponse({
      success: true,
      cloudRecord: {
        userId: record.user_id,
        version: record.version,
        checksum: record.checksum,
        updatedAt: record.updated_at,
        data: parsedData,
      },
      userId: auth.user.id,
    })
  } catch (err) {
    console.error('Failed to retrieve cloud songbook:', err instanceof Error ? err.name : 'UnknownError')
    return errorResponse('Failed to retrieve cloud songbook', 500)
  }
}

/**
 * POST /api/songbook/sync
 * Uploads or resolves cloud Songbook state for the authenticated user.
 * Strictly scoped to the authenticated caller's user.id.
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context

  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  const rejection = await enforceAbuseLimit(env, 'sync-write', auth.user.id)
  if (rejection) return rejection
  // #247 writer fence (additive): a client that states the library owner must state the signed-in
  // account. Older clients send no header and are still accepted on this classic route (PROD
  // compatibility); per-record uploads require the header.
  const owner = request.headers.get('X-GTAR-Library-Owner')
  if (owner !== null && owner.trim().toLowerCase() !== String(auth.user.id).trim().toLowerCase()) {
    return jsonResponse({ success: false, code: 'LIBRARY_OWNER_MISMATCH', error: "Upload refused: this device's songbook belongs to another account." }, 409)
  }

  const readRes = await readBoundedJson(request, MAX_SONGBOOK_PAYLOAD_BYTES, { requireObject: true })
  if (readRes.error) {
    if (readRes.status === 413) {
      return errorResponse('Payload exceeds maximum allowed size of 2MB', 413)
    }
    return errorResponse('Malformed JSON request body', 400)
  }

  const body = (readRes.data || {}) as {
    action?: string
    data?: unknown
    clientChecksum?: string
    clientVersion?: number
    expectedVersion?: number
    expectedChecksum?: string | null
  }

  if (!body || !body.data) {
    return errorResponse('Missing required data in sync payload', 400)
  }

  const validation = validateSongbookPayload(body.data)
  if (!validation.isValid) {
    return errorResponse(`Songbook validation failed: ${validation.error}`, 400)
  }

  try {
    const rawLibrary = body.data as SyncLibrary
    const libraryData: SyncLibrary =
      rawLibrary.themeSettings !== undefined
        ? { ...rawLibrary, themeSettings: normalizeCloudThemeSettings(rawLibrary.themeSettings) }
        : rawLibrary
    const checksum = computeSongbookChecksum(libraryData)
    const serialized = JSON.stringify(libraryData)
    const nowIso = new Date().toISOString()

    // Legacy clientChecksum describes the uploaded content, not its cloud base.
    // Missing/invalid bases fail closed, including on the first write.
    const version = body.expectedVersion
    const expectedChecksum = body.expectedChecksum
    if (!Number.isSafeInteger(version) || typeof version !== 'number' || version < 0 ||
        (version === 0 ? expectedChecksum !== null :
          typeof expectedChecksum !== 'string' || !/^ck_[0-9a-f]{16}$/.test(expectedChecksum))) {
      return jsonResponse({ success: false, code: 'SONGBOOK_REVISION_CONFLICT',
        error: 'Missing or invalid cloud revision. Update the app, fetch cloud state and merge before retrying.' }, 409)
    }
    if (body.clientChecksum !== undefined && body.clientChecksum !== checksum) {
      return errorResponse('Client checksum does not match canonical payload checksum', 400)
    }
    // #208 F2: a classic write would silently diverge from (and later be overwritten by) the records.
    // The "no records cursor" condition is part of the write itself, so a seed that lands between a
    // separate check and the write cannot be missed (seeding is in turn conditional on this document's
    // version, see ensureRecordsSeeded). Databases without 0009 (PROD today) use the plain write.
    const recordsActive = () => jsonResponse({ success: false, code: RECORDS_ACTIVE_CODE,
      error: 'This account now syncs song by song. Turn on per-record sync in Sync Center or reload the app to update, then sync again. Your edits are kept on this device.' }, 409)
    let hasRecordsTables = true
    let result: Awaited<ReturnType<typeof upsertUserSongbook>>
    try {
      result = await upsertUserSongbook(env.DB!, auth.user.id, serialized, checksum, nowIso,
        { version, checksum: expectedChecksum as string | null }, { unlessRecordsActive: true })
    } catch (err) {
      if (!(err instanceof Error && /no such table: user_songbook_cursors/.test(err.message))) throw err
      hasRecordsTables = false
      result = await upsertUserSongbook(env.DB!, auth.user.id, serialized, checksum, nowIso,
        { version, checksum: expectedChecksum as string | null })
    }
    if (!result && hasRecordsTables && await recordsActiveForUser(env.DB!, auth.user.id)) return recordsActive()
    if (!result) {
      return jsonResponse({ success: false, code: 'SONGBOOK_REVISION_CONFLICT',
        error: 'Cloud songbook changed. Fetch cloud state and reconcile before retrying.' }, 409)
    }

    return jsonResponse({
      success: true,
      cloudRecord: {
        userId: auth.user.id,
        version: result.version,
        checksum: result.checksum,
        updatedAt: result.updated_at,
      },
      userId: auth.user.id,
    })
  } catch (err) {
    console.error('Failed to persist cloud songbook:', err instanceof Error ? err.name : 'UnknownError')
    return errorResponse('Failed to persist cloud songbook', 500)
  }
}
