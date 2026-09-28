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
 * POST /api/admin/restore
 * Restores a denied user back to active status (sets access_status = 'active').
 * Server enforces admin authority.
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

  const targetUser = await findUserById(env.DB!, userId)
  if (!targetUser) {
    return errorResponse('Target user not found', 404)
  }

  const nowIso = new Date().toISOString()
  await updateUserAccessStatus(env.DB!, userId, 'active', nowIso)

  return jsonResponse({
    success: true,
    message: `User ${targetUser.email} has been restored to active status.`,
    userId,
    access_status: 'active',
  })
}
