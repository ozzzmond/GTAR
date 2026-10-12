import {
  jsonResponse,
  errorResponse,
  authenticateUserRequest,
  JSON_HEADERS,
} from '../../lib/authCore.ts'
import {
  type PagesContext,
  type SharedCatalogSongRecord,
  validateSongInput,
  readJsonBody,
  computeSongChecksum,
  sanitizeCatalogSong,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../../lib/catalogCore.ts'

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  })
}

/**
 * GET /api/catalog/songs
 * List active (non-deleted) catalog songs with bounded pagination.
 * Authenticated active members and admins only.
 */
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context

  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  if (!env.DB) {
    return errorResponse('Database service is unavailable', 500)
  }

  try {
    const url = new URL(request.url)
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')

    let limit = DEFAULT_PAGE_LIMIT
    if (limitParam !== null) {
      const parsedLimit = parseInt(limitParam, 10)
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return errorResponse('Invalid limit parameter: must be a positive integer', 400)
      }
      limit = Math.min(parsedLimit, MAX_PAGE_LIMIT)
    }

    let offset = 0
    if (offsetParam !== null) {
      const parsedOffset = parseInt(offsetParam, 10)
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return errorResponse('Invalid offset parameter: must be a non-negative integer', 400)
      }
      offset = parsedOffset
    }

    // Query non-deleted songs with deterministic ordering (updated_at DESC, id ASC)
    const listStmt = env.DB.prepare(
      `SELECT id, title, artist, key, original_key, capo, bpm, time_signature, year,
              raw_content, format, checksum, publisher_user_id, last_editor_user_id,
              current_revision, is_deleted, deleted_at, deleted_by_user_id, created_at, updated_at
       FROM shared_catalog_songs
       WHERE is_deleted = 0
       ORDER BY updated_at DESC, id ASC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset)

    const countStmt = env.DB.prepare(
      `SELECT count(*) as total FROM shared_catalog_songs WHERE is_deleted = 0`
    )

    const [listRes, countRes] = await Promise.all([
      listStmt.all<SharedCatalogSongRecord>(),
      countStmt.first<{ total: number }>(),
    ])

    const total = Number(countRes?.total || 0)
    const songs = (listRes.results || []).map(sanitizeCatalogSong)

    return jsonResponse({
      success: true,
      songs,
      pagination: {
        limit,
        offset,
        total,
        has_more: offset + songs.length < total,
      },
    })
  } catch {
    return errorResponse('Failed to retrieve catalog songs', 500)
  }
}

/**
 * POST /api/catalog/songs
 * Publish a new song to the shared catalog with initial revision 1.
 * Atomic creation of song snapshot and immutable revision 1.
 * Idempotent retry: if exact song with same title, content, format was published by same user recently.
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context

  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  const { user } = auth

  if (!env.DB) {
    return errorResponse('Database service is unavailable', 500)
  }

  const readRes = await readJsonBody(request)
  if (readRes.error) {
    return errorResponse(readRes.error, readRes.status || 400)
  }

  const validated = validateSongInput(readRes.body)
  if (!validated.isValid || !validated.data) {
    return errorResponse(validated.error || 'Invalid song payload', 400)
  }

  const songData = validated.data
  const checksum = computeSongChecksum(songData)

  try {
    // Idempotent retry check:
    // If the publisher already created an identical active song (same publisher, checksum, is_deleted=0),
    // return the existing song to prevent duplicate publication.
    const existing = await env.DB.prepare(
      `SELECT id, title, artist, key, original_key, capo, bpm, time_signature, year,
              raw_content, format, checksum, publisher_user_id, last_editor_user_id,
              current_revision, is_deleted, deleted_at, deleted_by_user_id, created_at, updated_at
       FROM shared_catalog_songs
       WHERE publisher_user_id = ? AND checksum = ? AND is_deleted = 0
       LIMIT 1`
    ).bind(user.id, checksum).first<SharedCatalogSongRecord>()

    if (existing) {
      return jsonResponse({
        success: true,
        song: sanitizeCatalogSong(existing),
        deduplicated: true,
      }, 200)
    }

    // Generate server-controlled IDs
    const songId = `scs_${crypto.randomUUID()}`
    const revisionId = `scr_${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()

    const songInsertStmt = env.DB.prepare(
      `INSERT INTO shared_catalog_songs (
        id, title, artist, key, original_key, capo, bpm, time_signature, year,
        raw_content, format, checksum, publisher_user_id, last_editor_user_id,
        current_revision, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
    ).bind(
      songId,
      songData.title,
      songData.artist,
      songData.key,
      songData.original_key,
      songData.capo,
      songData.bpm,
      songData.time_signature,
      songData.year,
      songData.raw_content,
      songData.format,
      checksum,
      user.id,
      user.id,
      nowIso,
      nowIso
    )

    const revisionInsertStmt = env.DB.prepare(
      `INSERT INTO shared_catalog_revisions (
        id, song_id, revision, title, artist, key, original_key, capo, bpm, time_signature, year,
        raw_content, format, checksum, editor_user_id, change_summary, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      revisionId,
      songId,
      songData.title,
      songData.artist,
      songData.key,
      songData.original_key,
      songData.capo,
      songData.bpm,
      songData.time_signature,
      songData.year,
      songData.raw_content,
      songData.format,
      checksum,
      user.id,
      songData.change_summary || 'Initial publication',
      nowIso
    )

    // Atomic execution using batch()
    if (typeof env.DB.batch !== 'function') {
      return errorResponse('Database service does not support atomic batch operations', 500)
    }
    await env.DB.batch([songInsertStmt, revisionInsertStmt])

    const createdRecord: SharedCatalogSongRecord = {
      id: songId,
      title: songData.title,
      artist: songData.artist,
      key: songData.key,
      original_key: songData.original_key,
      capo: songData.capo,
      bpm: songData.bpm,
      time_signature: songData.time_signature,
      year: songData.year,
      raw_content: songData.raw_content,
      format: songData.format,
      checksum,
      publisher_user_id: user.id,
      last_editor_user_id: user.id,
      current_revision: 1,
      is_deleted: 0,
      deleted_at: null,
      deleted_by_user_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    }

    return jsonResponse({
      success: true,
      song: sanitizeCatalogSong(createdRecord),
    }, 201)
  } catch {
    return errorResponse('Failed to publish catalog song', 500)
  }
}
