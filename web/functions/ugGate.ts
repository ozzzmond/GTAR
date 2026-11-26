import { enforceAbuseLimit, abuseResponse, type AbuseEnv } from './lib/abuseProtection.ts'
import { JSON_HEADERS } from './lib/authCore.ts'

export interface UgEnv extends AbuseEnv {
  /** `enabled` allows the proxy; `disabled` (or any non-`enabled` value) turns it off per deployment. */
  UG_PROXY_MODE?: string
  CF_PAGES?: string
  CF_PAGES_BRANCH?: string
}

function disabledResponse(): Response {
  return new Response(JSON.stringify({ success: false, error: 'ONLINE_SOURCES_DISABLED' }), { status: 503, headers: JSON_HEADERS })
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
 * Online song sources are opt-in and need no account (#453 N1). The gate enforces deployment-level
 * environment policy plus an anonymous rate limit; the caller identity is never trusted.
 */
export async function ugGate(env: UgEnv): Promise<Response | null> {
  if (env.CF_PAGES_BRANCH === 'demo') {
    return disabledResponse()
  }
  if (env.UG_PROXY_MODE !== undefined && env.UG_PROXY_MODE !== 'enabled') {
    return disabledResponse()
  }
  if (env.CF_PAGES === '1' && env.UG_PROXY_MODE === 'enabled' && env.CF_PAGES_BRANCH !== 'main') {
    return disabledResponse()
  }
  const rejection = await enforceAbuseLimit(env, 'ug-anonymous')
  if (rejection) return rejection
  return isolateLimit() ? null : abuseResponse(429, 60)
}
