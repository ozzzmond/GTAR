import {
  jsonResponse,
  errorResponse,
  authenticateUserRequest,
  JSON_HEADERS,
} from '../../../lib/authCore.ts'
import {
  type PagesContext,
  type SharedCatalogSongRecord,
  type SharedCatalogRevisionRecord,
  validateSongInput,
  readJsonBody,
  computeSongChecksum,
  canModifySong,
  sanitizeCatalogSong,
  sanitizeCatalogRevision,
} from '../../../lib/catalogCore.ts'

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    },
  })
}

/**
 * GET /api/catalog/songs/:id
 * Retrieve a specific non-deleted catalog song with its revision history.
 * Authenticated active members and admins only.
 */
export async function onRequestGet(context: PagesContext<{ id: string }>): Promise<Response> {
  const { request, env, params } = context

  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  if (!env.DB) {
    return errorResponse('Database service is unavailable', 500)
  }

  const songId = params?.id
  if (!songId || typeof songId !== 'string' || !songId.trim()) {
    return errorResponse('Song ID is required', 400)
  }

  try {
    const song = await env.DB.prepare(
      `SELECT id, title, artist, key, original_key, capo, bpm, time_signature, year,
              raw_content, format, checksum, publisher_user_id, last_editor_user_id,
              current_revision, is_deleted, deleted_at, deleted_by_user_id, created_at, updated_at
       FROM shared_catalog_songs
       WHERE id = ? AND is_deleted = 0
       LIMIT 1`
    ).bind(songId.trim()).first<SharedCatalogSongRecord>()

    if (!song) {
      return errorResponse('Song not found', 404)
    }

    const revisionsRes = await env.DB.prepare(
      `SELECT id, song_id, revision, title, artist, key, original_key, capo, bpm, time_signature, year,
              raw_content, format, checksum, editor_user_id, change_summary, created_at
       FROM shared_catalog_revisions
       WHERE song_id = ?
       ORDER BY revision ASC`
    ).bind(songId.trim()).all<SharedCatalogRevisionRecord>()

    const revisions = (revisionsRes.results || []).map(sanitizeCatalogRevision)

    return jsonResponse({
      success: true,
      song: sanitizeCatalogSong(song),
      revisions,
    })
  } catch {
    return errorResponse('Failed to retrieve catalog song', 500)
  }
}

/**
 * PUT /api/catalog/songs/:id
 * Update an existing catalog song with optimistic concurrency control (CAS).
 * Original publisher or admin only.
 * Requires expected_revision.
 * Atomically updates snapshot and creates revision N+1.
 */
export async function onRequestPut(context: PagesContext<{ id: string }>): Promise<Response> {
  const { request, env, params } = context

  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  const { user } = auth

  if (!env.DB) {
    return errorResponse('Database service is unavailable', 500)
  }

  const songId = params?.id
  if (!songId || typeof songId !== 'string' || !songId.trim()) {
    return errorResponse('Song ID is required', 400)
  }

  const readRes = await readJsonBody(request)
  if (readRes.error) {
    return errorResponse(readRes.error, readRes.status || 400)
  }

  const body = readRes.body as Record<string, unknown>
  if (!body || typeof body !== 'object') {
    return errorResponse('Request body must be a JSON object', 400)
  }

  // Validate expected_revision
  const expectedRevision = body.expected_revision
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    return errorResponse('expected_revision is required and must be a positive integer', 400)
  }

  const validated = validateSongInput(body)
  if (!validated.isValid || !validated.data) {
    return errorResponse(validated.error || 'Invalid song payload', 400)
  }

  const songData = validated.data
  const checksum = computeSongChecksum(songData)
  const trimmedSongId = songId.trim()

  try {
    // 1. Fetch current song record to verify existence and check authorization
    const current = await env.DB.prepare(
      `SELECT id, title, artist, key, original_key, capo, bpm, time_signature, year,
              raw_content, format, checksum, publisher_user_id, last_editor_user_id,
              current_revision, is_deleted, deleted_at, deleted_by_user_id, created_at, updated_at
       FROM shared_catalog_songs
       WHERE id = ?
       LIMIT 1`
    ).bind(trimmedSongId).first<SharedCatalogSongRecord>()

    if (!current || current.is_deleted === 1) {
      return errorResponse('Song not found', 404)
    }

    // 2. Authorization: original publisher or admin only
    if (!canModifySong(current, user)) {
      return errorResponse('Forbidden: Only original publisher or admin can update this song', 403)
    }

    // 3. Check expected_revision against current_revision
    if (current.current_revision !== expectedRevision) {
      return jsonResponse({
        success: false,
        error: 'REVISION_CONFLICT',
        message: `Expected revision ${expectedRevision} but current revision is ${current.current_revision}`,
        current_revision: current.current_revision,
      }, 409)
    }

    const nextRevision = expectedRevision + 1
    const revisionId = `scr_${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()

    // 4. Conditional insert of immutable revision N+1 only if matching song revision exists
    const revisionInsertStmt = env.DB.prepare(
      `INSERT INTO shared_catalog_revisions (
        id, song_id, revision, title, artist, key, original_key, capo, bpm, time_signature, year,
        raw_content, format, checksum, editor_user_id, change_summary, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM shared_catalog_songs
        WHERE id = ? AND current_revision = ? AND is_deleted = 0
      )`
    ).bind(
      revisionId,
      trimmedSongId,
      nextRevision,
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
      songData.change_summary || null,
      nowIso,
      trimmedSongId,
      expectedRevision
    )

    // 5. Atomic compare-and-swap update on shared_catalog_songs
    const updateStmt = env.DB.prepare(
      `UPDATE shared_catalog_songs
       SET title = ?, artist = ?, key = ?, original_key = ?, capo = ?, bpm = ?,
           time_signature = ?, year = ?, raw_content = ?, format = ?, checksum = ?,
           last_editor_user_id = ?, current_revision = ?, updated_at = ?
       WHERE id = ? AND current_revision = ? AND is_deleted = 0`
    ).bind(
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
      nextRevision,
      nowIso,
      trimmedSongId,
      expectedRevision
    )

    if (typeof env.DB.batch !== 'function') {
      return errorResponse('Database service does not support atomic batch operations', 500)
    }

    const batchRes = await env.DB.batch([revisionInsertStmt, updateStmt])
    if (!batchRes || !Array.isArray(batchRes) || batchRes.length < 2) {
      return errorResponse('Failed to execute atomic batch update', 500)
    }

    const revMeta = batchRes[0]?.meta as { changes?: number } | undefined
    const updateMeta = batchRes[1]?.meta as { changes?: number } | undefined
    if (
      !revMeta ||
      typeof revMeta.changes !== 'number' ||
      !updateMeta ||
      typeof updateMeta.changes !== 'number'
    ) {
      return errorResponse('Database service returned ambiguous update metadata', 500)
    }

    if (updateMeta.changes === 0 || revMeta.changes === 0) {
      return jsonResponse({
        success: false,
        error: 'REVISION_CONFLICT',
        message: 'Concurrent update conflict detected',
        current_revision: current.current_revision,
      }, 409)
    }

    const updatedRecord: SharedCatalogSongRecord = {
      ...current,
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
      last_editor_user_id: user.id,
      current_revision: nextRevision,
      updated_at: nowIso,
    }

    return jsonResponse({
      success: true,
      song: sanitizeCatalogSong(updatedRecord),
    }, 200)
  } catch {
    return errorResponse('Failed to update catalog song', 500)
  }
}

/**
 * DELETE /api/catalog/songs/:id
 * Soft delete an existing catalog song (sets is_deleted=1, deleted_at, deleted_by_user_id).
 * Original publisher or admin only.
 * Supports optional expected_revision for revision-aware deletes.
 * Preserves all revision history for future recovery.
 */
export async function onRequestDelete(context: PagesContext<{ id: string }>): Promise<Response> {
  const { request, env, params } = context

  const auth = await authenticateUserRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  const { user } = auth

  if (!env.DB) {
    return errorResponse('Database service is unavailable', 500)
  }

  const songId = params?.id
  if (!songId || typeof songId !== 'string' || !songId.trim()) {
    return errorResponse('Song ID is required', 400)
  }

  const trimmedSongId = songId.trim()

  // Optional expected_revision from query or JSON body
  let expectedRevision: number | null = null
  const url = new URL(request.url)
  const revQuery = url.searchParams.get('expected_revision')
  if (revQuery !== null) {
    const parsed = parseInt(revQuery, 10)
    if (isNaN(parsed) || parsed < 1) {
      return errorResponse('Invalid expected_revision parameter', 400)
    }
    expectedRevision = parsed
  } else {
    // Check if body is supplied
    try {
      const text = await request.text()
      if (text.trim()) {
        const body = JSON.parse(text)
        if (body && typeof body.expected_revision === 'number') {
          if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1) {
            return errorResponse('Invalid expected_revision: must be a positive integer', 400)
          }
          expectedRevision = body.expected_revision
        }
      }
    } catch {
      // Ignore empty or non-JSON body for DELETE
    }
  }

  try {
    const current = await env.DB.prepare(
      `SELECT id, title, artist, key, original_key, capo, bpm, time_signature, year,
              raw_content, format, checksum, publisher_user_id, last_editor_user_id,
              current_revision, is_deleted, deleted_at, deleted_by_user_id, created_at, updated_at
       FROM shared_catalog_songs
       WHERE id = ?
       LIMIT 1`
    ).bind(trimmedSongId).first<SharedCatalogSongRecord>()

    if (!current) {
      return errorResponse('Song not found', 404)
    }

    // 2. Authorization: original publisher or admin only MUST be verified FIRST
    // Unauthorized members must never learn tombstone state through mutation responses.
    if (!canModifySong(current, user)) {
      return errorResponse('Forbidden: Only original publisher or admin can delete this song', 403)
    }

    // 3. Already soft-deleted: idempotent response (only for authorized users)
    if (current.is_deleted === 1) {
      return jsonResponse({
        success: true,
        message: 'Song is already deleted',
        id: trimmedSongId,
      }, 200)
    }

    // 4. Revision check if specified
    if (expectedRevision !== null && current.current_revision !== expectedRevision) {
      return jsonResponse({
        success: false,
        error: 'REVISION_CONFLICT',
        message: `Expected revision ${expectedRevision} but current revision is ${current.current_revision}`,
        current_revision: current.current_revision,
      }, 409)
    }

    const nowIso = new Date().toISOString()

    let deleteStmt
    if (expectedRevision !== null) {
      deleteStmt = env.DB.prepare(
        `UPDATE shared_catalog_songs
         SET is_deleted = 1, deleted_at = ?, deleted_by_user_id = ?, updated_at = ?
         WHERE id = ? AND current_revision = ? AND is_deleted = 0`
      ).bind(nowIso, user.id, nowIso, trimmedSongId, expectedRevision)
    } else {
      deleteStmt = env.DB.prepare(
        `UPDATE shared_catalog_songs
         SET is_deleted = 1, deleted_at = ?, deleted_by_user_id = ?, updated_at = ?
         WHERE id = ? AND is_deleted = 0`
      ).bind(nowIso, user.id, nowIso, trimmedSongId)
    }

    const res = await deleteStmt.run()
    const meta = res?.meta as { changes?: number } | undefined
    if (!meta || typeof meta.changes !== 'number') {
      return errorResponse('Database service returned ambiguous delete metadata', 500)
    }

    if (meta.changes === 0) {
      // Possible race: recheck state to distinguish already deleted vs concurrent revision change
      const recheck = await env.DB.prepare(
        `SELECT is_deleted, current_revision, publisher_user_id FROM shared_catalog_songs WHERE id = ?`
      ).bind(trimmedSongId).first<SharedCatalogSongRecord>()

      if (!recheck) {
        return errorResponse('Song not found', 404)
      }

      if (!canModifySong(recheck, user)) {
        return errorResponse('Forbidden: Only original publisher or admin can delete this song', 403)
      }

      if (recheck.is_deleted === 1) {
        return jsonResponse({
          success: true,
          message: 'Song is already deleted',
          id: trimmedSongId,
        }, 200)
      }

      return jsonResponse({
        success: false,
        error: 'REVISION_CONFLICT',
        message: 'Concurrent revision conflict on delete',
        current_revision: recheck.current_revision,
      }, 409)
    }

    return jsonResponse({
      success: true,
      message: 'Song successfully deleted',
      id: trimmedSongId,
    }, 200)
  } catch {
    return errorResponse('Failed to delete catalog song', 500)
  }
}
