const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { build } = require('esbuild')
const Module = require('node:module')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)

const { createStageCast2Worker } = require('../workers/stageCast2Worker.ts')
const { onRequest: cast2ApiHandler } = require('../functions/cast2-api/[[path]].ts')
const { onRequest: middlewareHandler } = require('../functions/_middleware.ts')

test('DEV enablement: Stage Cast 2 Worker accepts /cast2-api path prefix and matches configured DEV origin', async () => {
  let hubCalled = false
  const fakeHub = {
    idFromName: () => 'fake-id',
    get: () => ({
      fetch: async (req) => {
        hubCalled = true
        assert.equal(req.url, 'https://cast2.internal/create')
        return Response.json({ ref: 'a'.repeat(64), pin: '123456', receiverCredential: 'b'.repeat(64), expiresAt: 1000, pairingExpiresAt: 500 })
      },
    }),
  }

  const env = {
    CAST2_MODE: 'reviewed-v1',
    CAST2_ORIGIN: 'https://dev.gtar-web.pages.dev',
    CAST2_HUB: fakeHub,
  }

  const worker = createStageCast2Worker()

  // 1. Valid request to /cast2-api/create with matching Origin and CF-Connecting-IP
  const validReq = new Request('https://dev.gtar-web.pages.dev/cast2-api/create', {
    method: 'POST',
    headers: {
      Origin: 'https://dev.gtar-web.pages.dev',
      'CF-Connecting-IP': '203.0.113.1',
    },
    body: JSON.stringify({}),
  })
  const res = await worker.fetch(validReq, env)
  assert.equal(res.status, 200)
  assert.equal(hubCalled, true)

  // 2. Direct request to /create also works
  hubCalled = false
  const directReq = new Request('https://dev.gtar-web.pages.dev/create', {
    method: 'POST',
    headers: {
      Origin: 'https://dev.gtar-web.pages.dev',
      'CF-Connecting-IP': '203.0.113.1',
    },
    body: JSON.stringify({}),
  })
  const directRes = await worker.fetch(directReq, env)
  assert.equal(directRes.status, 200)
  assert.equal(hubCalled, true)

  // 3. Spoofed or untrusted origin is strictly denied
  const spoofedReq = new Request('https://dev.gtar-web.pages.dev/cast2-api/create', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.attacker.invalid',
      'CF-Connecting-IP': '203.0.113.1',
    },
    body: JSON.stringify({}),
  })
  const spoofedRes = await worker.fetch(spoofedReq, env)
  assert.equal(spoofedRes.status, 403)
  assert.deepEqual(await spoofedRes.json(), { error: 'DENIED' })

  // 4. In PROD (missing CAST2_MODE / CAST2_HUB / CAST2_ORIGIN), strictly fails closed with 503 DISABLED
  const prodRes = await worker.fetch(validReq, { DB: {} })
  assert.equal(prodRes.status, 503)
  assert.deepEqual(await prodRes.json(), { error: 'DISABLED' })
})

test('DEV enablement: Pages Function cast2-api handles routing via Worker or Service Binding', async () => {
  let serviceBindingCalled = false
  const fakeServiceBinding = {
    fetch: async () => {
      serviceBindingCalled = true
      return Response.json({ ok: true, source: 'service-binding' })
    },
  }

  // With CAST2_WORKER service binding
  const resSb = await cast2ApiHandler({
    request: new Request('https://dev.gtar-web.pages.dev/cast2-api/status'),
    env: { CAST2_WORKER: fakeServiceBinding },
  })
  assert.equal(resSb.status, 200)
  assert.equal(serviceBindingCalled, true)

  // Without CAST2_MODE (e.g. in PROD), falls through to worker and returns 503 DISABLED
  const resDisabled = await cast2ApiHandler({
    request: new Request('https://dev.gtar-web.pages.dev/cast2-api/status'),
    env: {},
  })
  assert.equal(resDisabled.status, 503)
  assert.deepEqual(await resDisabled.json(), { error: 'DISABLED' })
})

test('DEV enablement: Pages Functions middleware preserves 101 WebSocket upgrade responses', async () => {
  // Standard response gets security headers applied
  const normalCtx = {
    request: new Request('https://dev.gtar-web.pages.dev/api/test'),
    next: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  }
  const normalRes = await middlewareHandler(normalCtx)
  assert.equal(normalRes.status, 200)
  assert.equal(normalRes.headers.get('X-Content-Type-Options'), 'nosniff')

  // WebSocket 101 response is returned unmodified without attempting new Response({ status: 101 })
  const mockWsResponse = { status: 101, statusText: 'Switching Protocols', webSocket: {} }
  const wsCtx = {
    request: new Request('https://dev.gtar-web.pages.dev/cast2-api/socket', {
      headers: { Upgrade: 'websocket' },
    }),
    next: async () => mockWsResponse,
  }
  const returnedWsRes = await middlewareHandler(wsCtx)
  assert.equal(returnedWsRes, mockWsResponse)
  assert.equal(returnedWsRes.status, 101)
})

async function compileGate(define = {}) {
  const bundled = await build({
    stdin: {
      contents: `export { stageCast2Enabled, cast2LocalEnabled, cast2ReceiverRoute } from './src/utils/stageCast2Local';`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_CAST2_LOCAL_REVIEW': '"false"',
      ...define,
    },
  })
  const compiled = new Module(path.join(__dirname, 'cast2-gate-memory.cjs'), module)
  compiled.filename = path.join(__dirname, 'cast2-gate-memory.cjs')
  compiled.paths = module.paths
  compiled._compile(bundled.outputFiles[0].text, compiled.filename)
  return compiled.exports
}

test('DEV enablement: Feature gate disables Stage Cast 2 in PROD and enables in DEV without localhost check', async () => {
  // When __GTAR_STAGE_CAST2_ENABLED__ is false (PROD build)
  const prodGate = await compileGate({ '__GTAR_STAGE_CAST2_ENABLED__': 'false' })
  assert.equal(prodGate.stageCast2Enabled, false)
  assert.equal(prodGate.cast2LocalEnabled, false)

  // When __GTAR_STAGE_CAST2_ENABLED__ is true (DEV build)
  const devGate = await compileGate({ '__GTAR_STAGE_CAST2_ENABLED__': 'true' })
  assert.equal(devGate.stageCast2Enabled, true)
  assert.equal(devGate.cast2LocalEnabled, true)
})
