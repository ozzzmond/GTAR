import { enforceAbuseLimit } from '../../lib/abuseProtection.ts'
import {
  jsonResponse,
  errorResponse,
  verifySessionToken,
  isValidAuthSecret,
  hashSessionToken,
  revokeSessionByTokenHash,
  findSessionByTokenHash,
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
 * POST /api/auth/logout
 * Revokes the authenticated caller's current session.
 * Safe and idempotent.
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
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

  // 1. Verify session token
  const sessionData = await verifySessionToken(token, env.AUTH_SECRET)
  if (!sessionData) {
    return errorResponse('Invalid or expired session token', 401)
  }

  // 2. Enforce abuse limit (bound to authenticated account)
  const rejection = await enforceAbuseLimit(env, 'session-revoke', sessionData.uid)
  if (rejection) return rejection

  // 3. Compute hash and revoke session in D1
  const nowIso = new Date().toISOString()
  try {
    const tokenHash = await hashSessionToken(token)
    if (!tokenHash || typeof tokenHash !== 'string' || !tokenHash.trim()) {
      return errorResponse('Session revocation failed', 500)
    }

    const revoked = await revokeSessionByTokenHash(env.DB, tokenHash, nowIso, {
      userId: sessionData.uid,
      createdAt: sessionData.iat ? new Date(sessionData.iat * 1000).toISOString() : nowIso,
      expiresAt: sessionData.exp ? new Date(sessionData.exp * 1000).toISOString() : undefined,
    })

    if (!revoked) {
      return errorResponse('Session revocation failed', 500)
    }

    // Durably confirm revocation via authoritative D1 lookup before reporting success
    const verifiedSession = await findSessionByTokenHash(env.DB, tokenHash)
    if (!verifiedSession || verifiedSession.is_revoked !== 1) {
      return errorResponse('Session revocation failed', 500)
    }

    return jsonResponse({
      success: true,
      revoked: true,
      message: 'Session revoked successfully',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/no such table/i.test(msg)) {
      return errorResponse('Database schema migration required', 500)
    }
    console.error('Session revocation error:', err instanceof Error ? err.name : 'UnknownError')
    return errorResponse('Session revocation failed', 500)
  }
}

