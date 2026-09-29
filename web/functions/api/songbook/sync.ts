import {
  jsonResponse,
  errorResponse,
  authenticateUserRequest,
  findUserSongbook,
  upsertUserSongbook,
  type AuthEnv,
  JSON_HEADERS,
} from '../../lib/authCore.ts'

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
  const obj = data as { songs?: unknown; setlists?: unknown }
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

  return { isValid: true }
}

/**
 * Deterministic checksum computation
 */
function computeChecksum(content: string): string {
  // 32-bit FNV-1a hash formatted as 8-character hex string
  let h1 = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    h1 ^= content.charCodeAt(i)
    h1 = Math.imul(h1, 0x01000193)
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0')

  // Second pass with djb2 for 16-character combined collision-resistant fingerprint
  let h2 = 5381
  for (let i = 0; i < content.length; i++) {
    h2 = ((h2 << 5) + h2 + content.charCodeAt(i)) | 0
  }
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0')

  return `ck_${part1}${part2}`
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
    const record = await findUserSongbook(env.DB!, auth.user.id)
    if (!record) {
      return jsonResponse({
        success: true,
        cloudRecord: null,
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
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to retrieve cloud songbook: ${msg}`, 500)
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

  let body: {
    action?: string
    data?: unknown
    clientChecksum?: string
    clientVersion?: number
  }

  try {
    body = await request.json()
  } catch {
    return errorResponse('Malformed JSON request body', 400)
  }

  if (!body || !body.data) {
    return errorResponse('Missing required data in sync payload', 400)
  }

  const validation = validateSongbookPayload(body.data)
  if (!validation.isValid) {
    return errorResponse(`Songbook validation failed: ${validation.error}`, 400)
  }

  try {
    const serialized = JSON.stringify(body.data)
    const checksum = computeChecksum(serialized)
    const nowIso = new Date().toISOString()

    const result = await upsertUserSongbook(env.DB!, auth.user.id, serialized, checksum, nowIso)

    return jsonResponse({
      success: true,
      cloudRecord: {
        userId: auth.user.id,
        version: result.version,
        checksum: result.checksum,
        updatedAt: result.updated_at,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to persist cloud songbook: ${msg}`, 500)
  }
}
