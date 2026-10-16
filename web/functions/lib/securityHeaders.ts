/**
 * GTAR Browser & API Security Headers
 *
 * Implements safe, production-grade security headers across static Cloudflare Pages assets
 * and Cloudflare Pages Functions API responses.
 *
 * Directives:
 * - X-Content-Type-Options: nosniff
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - X-Frame-Options: DENY (GTAR does not permit third-party iframe embedding)
 * - Content-Security-Policy-Report-Only (initially Report-Only, non-enforced foundation)
 * - Permissions-Policy (restrict unused browser APIs while preserving camera, clipboard, fullscreen, wake-lock)
 */

export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy':
    'camera=(self), clipboard-read=(self), clipboard-write=(self), fullscreen=(self), screen-wake-lock=(self), geolocation=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Content-Security-Policy-Report-Only':
    "default-src 'self'; script-src 'self' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.googleusercontent.com https://accounts.google.com https://ssl.gstatic.com; connect-src 'self' https://accounts.google.com https://www.googleapis.com ws: wss:; frame-src https://accounts.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:; manifest-src 'self'",
}

export const API_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
}

/**
 * Merges API security headers into an outgoing headers object,
 * preserving any already-defined application headers (CORS, Cache-Control, Content-Type, Retry-After).
 */
export function withApiSecurityHeaders(headers: HeadersInit = {}): Headers {
  const merged = new Headers(headers)
  for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) {
    if (!merged.has(key)) {
      merged.set(key, value)
    }
  }
  return merged
}

/**
 * Ensures a Response object carries canonical API security headers
 * without clobbering existing response status, headers, or body.
 */
export function applySecurityHeadersToResponse(response: Response): Response {
  const headers = withApiSecurityHeaders(response.headers)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
