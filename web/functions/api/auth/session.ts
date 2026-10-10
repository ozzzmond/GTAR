import {
  jsonResponse,
  errorResponse,
  verifyGoogleIdToken,
  isBootstrapAdmin,
  createSessionToken,
  verifySessionToken,
  isValidAuthSecret,
  findUserByGoogleSub,
  findUserById,
  insertUser,
  updateUserLoginProfile,
  type AuthEnv,
  type UserRecord,
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
 * POST /api/auth/session
 * Authenticates or registers a user via verified Google identity credential (ID Token JWT).
 * Server is authoritative for role and access_status.
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context
  if (!env.DB) {
    return errorResponse('Database binding DB is missing or unconfigured', 500)
  }
  if (!isValidAuthSecret(env.AUTH_SECRET)) {
    return errorResponse('Authentication service is unavailable', 503)
  }

  let body: { idToken?: string; credential?: string }
  try {
    body = await request.json()
  } catch {
    return errorResponse('Malformed JSON body', 400)
  }

  const token = body.idToken || body.credential
  if (!token || typeof token !== 'string') {
    return errorResponse('Missing required Google identity token in request body', 400)
  }

  try {
    const verified = await verifyGoogleIdToken(token, env)
    const nowIso = new Date().toISOString()

    let user = await findUserByGoogleSub(env.DB, verified.sub)

    if (!user) {
      // First-login-wins is forbidden: check explicit server-configured bootstrap admin
      const isAdmin = isBootstrapAdmin(verified, env)
      const internalId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `usr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

      const newUser: UserRecord = {
        id: internalId,
        google_sub: verified.sub,
        email: verified.email,
        display_name: verified.name || null,
        picture_url: verified.picture || null,
        role: isAdmin ? 'admin' : 'member',
        access_status: isAdmin ? 'active' : 'pending',
        created_at: nowIso,
        updated_at: nowIso,
        last_login_at: nowIso,
      }

      await insertUser(env.DB, newUser)
      user = newUser
    } else {
      // Existing user: update safe profile attributes and last login
      await updateUserLoginProfile(
        env.DB,
        user.id,
        {
          email: verified.email,
          display_name: verified.name || user.display_name,
          picture_url: verified.picture || user.picture_url,
        },
        nowIso
      )
      user = {
        ...user,
        email: verified.email,
        display_name: verified.name || user.display_name,
        picture_url: verified.picture || user.picture_url,
        last_login_at: nowIso,
        updated_at: nowIso,
      }
    }

    const sessionToken = await createSessionToken(user, env.AUTH_SECRET)

    return jsonResponse({
      success: true,
      user: {
        id: user.id,
        google_sub: user.google_sub,
        email: user.email,
        display_name: user.display_name,
        picture_url: user.picture_url,
        role: user.role,
        access_status: user.access_status,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: user.last_login_at,
      },
      sessionToken,
    })
  } catch {
    return errorResponse('Authentication failed', 401)
  }
}

/**
 * GET /api/auth/session
 * Rechecks current user status against authoritative D1 database.
 * Requires Bearer token (session token or Google ID token).
 */
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context
  if (!env.DB) {
    return errorResponse('Database binding DB is missing or unconfigured', 500)
  }
  if (!isValidAuthSecret(env.AUTH_SECRET)) {
    return errorResponse('Authentication service is unavailable', 503)
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('Missing or invalid Authorization header', 401)
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return errorResponse('Empty bearer token', 401)
  }

  let user: UserRecord | null = null

  // 1. Session token
  const sessionData = await verifySessionToken(token, env.AUTH_SECRET)
  if (sessionData) {
    user = await findUserById(env.DB, sessionData.uid)
    if (user && user.google_sub !== sessionData.sub) user = null
  } else {
    // 2. Google ID token fallback
    try {
      const verified = await verifyGoogleIdToken(token, env)
      user = await findUserByGoogleSub(env.DB, verified.sub)
    } catch {
      // Invalid
    }
  }

  if (!user) {
    return errorResponse('Session expired or user not found', 401)
  }

  return jsonResponse({
    success: true,
    user: {
      id: user.id,
      google_sub: user.google_sub,
      email: user.email,
      display_name: user.display_name,
      picture_url: user.picture_url,
      role: user.role,
      access_status: user.access_status,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_login_at: user.last_login_at,
    },
  })
}
