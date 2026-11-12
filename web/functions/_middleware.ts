import { applySecurityHeadersToResponse, CHROMECAST_RECEIVER_HEADERS } from './lib/securityHeaders.ts'

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
  if (new URL(context.request.url).pathname === '/cast-receiver.html') {
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(CHROMECAST_RECEIVER_HEADERS)) headers.set(name, value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
  return applySecurityHeadersToResponse(response)
}
