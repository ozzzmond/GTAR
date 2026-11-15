interface Env { BANDSYNC_WORKER?: { fetch(request: Request): Promise<Response> } }
export const onRequest = (context: { request: Request; env: Env }): Promise<Response> => {
  if (!context.env.BANDSYNC_WORKER) return Promise.resolve(Response.json({ error: 'DISABLED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }))
  // needs live DEV check: CF-Connecting-IP, Origin and WebSocket upgrade survive the service binding.
  // Cookie stripped (verified by test); IP/Origin survival still live-only.
  // Only transport headers cross this boundary; Cookie, Authorization, Proxy-Authorization and every Cf-Access-* header are dropped.
  const headers = new Headers()
  for (const name of ['Origin', 'Content-Type', 'Accept', 'Upgrade', 'Connection', 'Sec-WebSocket-Key',
    'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol', 'Sec-WebSocket-Extensions', 'CF-Connecting-IP']) {
    const value = context.request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const url = new URL(context.request.url)
  url.pathname = url.pathname.replace(/^\/bandsync-api(?=\/|$)/, '') || '/'
  return context.env.BANDSYNC_WORKER.fetch(new Request(url, {
    method: context.request.method, headers, body: context.request.body, duplex: 'half',
  } as RequestInit & { duplex: 'half' }))
}
