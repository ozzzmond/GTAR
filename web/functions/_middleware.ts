import { applySecurityHeadersToResponse } from './lib/securityHeaders.ts'

interface PagesContext {
  request: Request
  next: () => Promise<Response>
}

/**
 * Cloudflare Pages Functions Middleware
 * Ensures all Pages Functions responses uniformly carry safe API security headers.
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const response = await context.next()
  return applySecurityHeadersToResponse(response)
}
