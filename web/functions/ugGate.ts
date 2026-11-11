import { enforceAbuseLimit, abuseResponse, type AbuseEnv } from './lib/abuseProtection.ts'
import { JSON_HEADERS } from './lib/authCore.ts'

export interface UgEnv extends AbuseEnv {
  /** `disabled` turns the Ultimate Guitar proxy off for a deployment (e.g. the public GTAR1 copy). */
  UG_PROXY_MODE?: string
}

const WINDOW_MS = 60_000
const PER_WINDOW = 60
let windowStart = 0
let used = 0

/** Per-isolate fallback; applies even when the optional distributed limiter is not configured. */
function isolateLimit(now = Date.now()): boolean {
  if (now - windowStart >= WINDOW_MS) { windowStart = now; used = 0 }
  return ++used <= PER_WINDOW
}

export function _resetUgGateForTesting(): void {
  windowStart = 0
  used = 0
}

/**
 * Online song sources are opt-in and need no account (#453 N1). The gate is a deployment kill switch plus an
 * anonymous rate limit; the caller identity is never trusted.
 */
export async function ugGate(env: UgEnv): Promise<Response | null> {
  if (env.UG_PROXY_MODE === 'disabled') {
    return new Response(JSON.stringify({ success: false, error: 'ONLINE_SOURCES_DISABLED' }), { status: 503, headers: JSON_HEADERS })
  }
  const rejection = await enforceAbuseLimit(env, 'ug-anonymous')
  if (rejection) return rejection
  return isolateLimit() ? null : abuseResponse(429, 60)
}
