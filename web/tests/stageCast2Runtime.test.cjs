const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require('miniflare')

test('local workerd: isolated Worker/DO, real WebSocket upgrade, delivery, reconnect and revocation', { timeout: 30_000 }, async () => {
  const bundled = await build({ stdin: { contents: `
    import { createStageCast2Worker } from './workers/stageCast2Worker.ts';
    export { StageCast2Hub } from './workers/stageCast2Backend.ts';
    export default createStageCast2Worker(async request => request.headers.get('Authorization') === 'Bearer local-test'
      ? { user: { id: 'test-owner', access_status: 'active' } } : { error: 'AUTH_REQUIRED', status: 401 });`,
    resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:crypto'], target: 'es2022' })
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR),
    bindings: { CAST2_MODE: 'reviewed-v1', CAST2_ORIGIN: 'https://gtar.test' },
    durableObjects: { CAST2_HUB: { className: 'StageCast2Hub', useSQLite: true } },
  }))
  const sockets = []
  try {
    const call = async (route, data, auth = false) => {
      const response = await mf.dispatchFetch('https://local.test' + route, { method: 'POST', headers: {
        Origin: 'https://gtar.test', 'CF-Connecting-IP': '127.0.0.1', ...(auth ? { Authorization: 'Bearer local-test' } : {}),
      }, body: JSON.stringify(data) })
      return { status: response.status, ...await response.json() }
    }
    const s = await call('/create', {})
    assert.equal(s.status, 200)
    assert.equal((await call('/claim', { ref: s.ref, pin: s.pin })).status, 401)
    const c = await call('/claim', { ref: s.ref, pin: s.pin }, true)
    const receiver = { ref: s.ref, role: 'receiver', credential: s.receiverCredential }
    const controller = { ref: s.ref, role: 'controller', credential: c.controllerCredential }
    assert.equal((await call('/ticket', controller, true)).status, 403)
    assert.equal((await call('/decide', { ...receiver, requestId: c.requestId, approve: true })).state, 'PAIRED')
    const connect = async scope => {
      const ticket = await call('/ticket', scope, scope.role === 'controller')
      const response = await mf.dispatchFetch('https://local.test/socket', { headers: { Origin: 'https://gtar.test',
        'CF-Connecting-IP': '127.0.0.1', Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `cast2, ticket.${ticket.ticket}` } })
      assert.equal(response.status, 101)
      assert.equal(response.headers.get('Sec-WebSocket-Protocol'), 'cast2')
      const ws = response.webSocket; ws.accept(); sockets.push(ws)
      return ws
    }
    const next = ws => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('WebSocket delivery deadline')), 3000)
      ws.addEventListener('message', event => { clearTimeout(timer); resolve(JSON.parse(event.data)) }, { once: true })
    })
    const r = await connect(receiver), ctl = await connect(controller)
    const delivery = next(r)
    ctl.send(JSON.stringify({ version: 1, type: 'PRESENTATION_SNAPSHOT', direction: 'CONTROLLER_TO_SERVER', sessionId: s.ref,
      timestamp: 0, sequence: 40, payload: { snapshot: { songId: null, displayTitle: 'Runtime', lines: [], chordsVisible: false,
        transpose: { offset: 0, effectiveKey: 'C' }, position: { lineIndex: 0 }, scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } } } }))
    const delivered = await delivery
    assert.equal(delivered.direction, 'SERVER_TO_RECEIVER'); assert.equal(delivered.sequence, 1)
    const r2 = await connect(receiver)
    const resynced = await next(r2)
    assert.equal(resynced.type, 'PRESENTATION_SNAPSHOT'); assert.equal(resynced.sequence, 2)
    const revoked = next(r2)
    assert.equal((await call('/revoke', controller, true)).state, 'REVOKED')
    assert.equal((await revoked).type, 'SESSION_REVOKED')
    assert.equal((await call('/ticket', receiver)).status, 403)
  } finally {
    for (const ws of sockets) try { ws.close() } catch { /* Already closed by server. */ }
    await mf.dispose()
  }
})
