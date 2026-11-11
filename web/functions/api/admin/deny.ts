import {
  authenticateAdminRequest,
  findUserById,
  updateUserAccessStatus,
  jsonResponse,
  errorResponse,
  readBoundedJson,
  MAX_ADMIN_PAYLOAD_BYTES,
  type AuthEnv,
  JSON_HEADERS,
} from '../../lib/authCore.ts'

export { MAX_ADMIN_PAYLOAD_BYTES }

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
 * POST /api/admin/deny
 * Denies user access (sets access_status = 'denied').
 * Server enforces admin authority. Prevents self-denial.
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context
  const auth = await authenticateAdminRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  const readRes = await readBoundedJson(request, MAX_ADMIN_PAYLOAD_BYTES, { requireObject: true })
  if (readRes.error) {
    if (readRes.status === 413) {
      return errorResponse('Request body exceeds allowed size', 413)
    }
    return errorResponse('Malformed JSON body', 400)
  }

  const body = (readRes.data || {}) as Record<string, unknown>
  if (typeof body.userId !== 'string') {
    return errorResponse('Missing required userId parameter', 400)
  }

  const userId = body.userId.trim()
  if (!userId) {
    return errorResponse('Missing required userId parameter', 400)
  }

  if (userId === auth.user.id) {
    return errorResponse('Self-denial forbidden: Administrators cannot revoke their own access', 400)
  }

  try {
    const targetUser = await findUserById(env.DB!, userId)
    if (!targetUser) {
      return errorResponse('Target user not found', 404)
    }

    const nowIso = new Date().toISOString()
    await updateUserAccessStatus(env.DB!, userId, 'denied', nowIso)

    return jsonResponse({
      success: true,
      message: `Access denied for user ${targetUser.email}.`,
      userId,
      access_status: 'denied',
    })
  } catch (err) {
    console.error('Failed to deny user:', err instanceof Error ? err.name : 'UnknownError')
    return errorResponse('Failed to deny user', 500)
  }
}
