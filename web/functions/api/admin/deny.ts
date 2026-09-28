import {
  authenticateAdminRequest,
  findUserById,
  updateUserAccessStatus,
  jsonResponse,
  errorResponse,
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

  let body: { userId?: string }
  try {
    body = await request.json()
  } catch {
    return errorResponse('Malformed JSON body', 400)
  }

  const userId = body.userId?.trim()
  if (!userId) {
    return errorResponse('Missing required userId parameter', 400)
  }

  if (userId === auth.user.id) {
    return errorResponse('Self-denial forbidden: Administrators cannot revoke their own access', 400)
  }

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
}
