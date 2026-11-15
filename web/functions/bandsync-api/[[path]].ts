interface Env { BANDSYNC_WORKER?: { fetch(request: Request): Promise<Response> } }
export const onRequest = (context: { request: Request; env: Env }): Promise<Response> => {
  if (!context.env.BANDSYNC_WORKER) return Promise.resolve(Response.json({ error: 'DISABLED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }))
  // needs live DEV check: CF-Connecting-IP, Origin and WebSocket upgrade survive the service binding.
  // Only the route prefix changes; Upgrade headers/body are passed through unchanged.
  const url = new URL(context.request.url)
  url.pathname = url.pathname.replace(/^\/bandsync-api(?=\/|$)/, '') || '/'
  return context.env.BANDSYNC_WORKER.fetch(new Request(url, context.request))
}
