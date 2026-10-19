import { applySecurityHeadersToResponse } from './lib/securityHeaders.ts'

interface PagesContext {
  request: Request
  next: () => Promise<Response>
}

/**
 * Cloudflare Pages Functions Middleware
 * Ensures all Pages Functions responses uniformly carry safe API security headers.
 * Preserves WebSocket upgrade responses (status 101) directly.
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const response = await context.next()
  if (response.status === 101) return response
  return applySecurityHeadersToResponse(response)
}
