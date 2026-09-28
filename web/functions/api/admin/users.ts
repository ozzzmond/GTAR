import {
  authenticateAdminRequest,
  listAllUsers,
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
 * GET /api/admin/users
 * Lists all registered users. Server enforces admin authority.
 */
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context
  const auth = await authenticateAdminRequest(request, env)
  if ('error' in auth) {
    return errorResponse(auth.error, auth.status)
  }

  try {
    const users = await listAllUsers(env.DB!)
    return jsonResponse({
      success: true,
      users,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to list users: ${msg}`, 500)
  }
}
