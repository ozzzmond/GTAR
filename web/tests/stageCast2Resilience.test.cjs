const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

function loadModule(entryContents) {
  const bundled = buildSync({
    stdin: {
      contents: entryContents,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: {
      'import.meta.env.DEV': 'true',
      'import.meta.env.VITE_CAST2_LOCAL_REVIEW': '"true"',
    },
  })
  const mod = new Module(path.join(__dirname, 'resilience-temp.cjs'), module)
  mod.paths = module.paths
  mod._compile(bundled.outputFiles[0].text, path.join(__dirname, 'resilience-temp.cjs'))
  return mod.exports
}

const {
  StageCast2Hub, POLICY, digest,
  Cast2Client,
  stageCast2Controller,
  projectCast2Presentation,
  createWakeLockController,
  StageCast2Panel,
} = loadModule(`
  export { StageCast2Hub, POLICY, digest } from './workers/stageCast2Backend.ts';
  export { Cast2Client } from './src/utils/stageCast2Client.ts';
  export { stageCast2Controller } from './src/utils/stageCast2Controller.ts';
  export { projectCast2Presentation } from './src/utils/stageCast2Projection.ts';
  export { createWakeLockController } from './src/utils/stagePerformance.ts';
  export { StageCast2Panel } from './src/components/StageCast2Panel.tsx';
`)

class MemoryStorage {
  data = new Map()
  async get(key) { return structuredClone(this.data.get(key)) }
  async put(key, value) { this.data.set(key, structuredClone(value)) }
  async setAlarm(time) { this.alarm = time }
}

class FakeSocket {
  events = {}; sent = []; closed = false; closeReason = ''
  accept() { this.accepted = true }
  addEventListener(type, fn) { this.events[type] = fn }
  send(text) { if (this.closed) throw Error('closed'); this.sent.push(JSON.parse(text)) }
  close(code, reason) { this.closed = true; this.closeReason = reason; this.events.close?.({ code, reason }) }
  emit(data) { this.events.message({ data }) }
}

async function fixture(initialTime = 1_000_000) {
  let now = initialTime
  const storage = new MemoryStorage()
  const sockets = []
  const rt = {
    now: () => now,
    upgrade: () => {
      const server = new FakeSocket()
      sockets.push(server)
      return { server, response: new Response(null, { status: 200 }) }
    },
  }
  const hub = new StageCast2Hub({ storage }, undefined, rt)
  const ip = await digest('resilience-test-ip')

  const call = async (path, data = {}, owner = '') => {
    const response = await hub.fetch(new Request('https://internal' + path, {
      method: 'POST',
      headers: { 'x-cast-client': ip, 'x-cast-owner': owner },
      body: JSON.stringify(data),
    }))
    return { status: response.status, ...await response.json() }
  }

  const create = () => call('/create')
  const claim = (s, owner = 'owner-1') => call('/claim', { ref: s.ref, pin: s.pin }, owner)
  const receiver = s => ({ ref: s.ref, role: 'receiver', credential: s.receiverCredential })
  const controller = (s, c) => ({ ref: s.ref, role: 'controller', credential: c.controllerCredential })

  const paired = async (owner = 'owner-1') => {
    const s = await create()
    const c = await claim(s, owner)
    return { s, c }
  }

  const connect = async (scope, owner = '') => {
    const ticket = await call('/ticket', scope, owner)
    assert.equal(ticket.status, 200)
    const response = await hub.fetch(new Request('https://internal/socket', {
      headers: { 'x-cast-client': ip, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `cast2, ticket.${ticket.ticket}` },
    }))
    assert.equal(response.status, 200)
    return sockets.at(-1)
  }

  const flush = () => hub.alarm()

  return {
    storage, rt, hub, ip, call, create, claim, receiver, controller, paired, connect, flush,
    now: () => now,
    advance: ms => { now += ms },
  }
}

const sampleSnapshot = (title = 'Sample Song') => ({
  songId: 'song-1',
  displayTitle: title,
  lines: [{ type: 'LYRIC', lyrics: 'Amazing grace how sweet the sound' }],
  chordsVisible: false,
  transpose: { offset: 0, effectiveKey: 'G' },
  position: { lineIndex: 0 },
  scroll: { top: 0, fraction: 0 },
  mode: { columns: 1, notation: 'chords', fontSize: 32 },
})

test('SESSION_ACTIVE_OVER_60_MIN', async () => {
  const f = await fixture()
  const { s, c } = await f.paired()
  const receiverScope = f.receiver(s)

  // 70 minutes with periodic active status touches every 5 minutes (300,000ms)
  const interval = 300_000
  const totalElapsed = 70 * 60_000 // 70 min = 4,200,000ms > 60 min
  const steps = Math.floor(totalElapsed / interval)

  for (let i = 0; i < steps; i++) {
    f.advance(interval)
    const status = await f.call('/status', receiverScope)
    assert.equal(status.state, 'PAIRED', `Session should remain PAIRED at step ${i} (${(i + 1) * 5} min)`)
    assert.ok(status.expiresAt > f.now(), 'Renewed lease should be strictly in the future')
  }

  assert.ok(totalElapsed > 60 * 60_000, 'Tested duration strictly exceeds 60 minutes')
  const finalStatus = await f.call('/status', receiverScope)
  assert.equal(finalStatus.state, 'PAIRED')
})

test('SESSION_IDLE_EXPIRY', async () => {
  const f = await fixture()
  const { s } = await f.paired()
  const receiverScope = f.receiver(s)

  // Leave completely idle for POLICY.idleTimeoutMs (10 min) + 1s
  f.advance(POLICY.idleTimeoutMs + 1000)
  await f.flush()

  const status = await f.call('/status', receiverScope)
  assert.equal(status.status, 403, 'Idle abandoned session must be expired and denied')
})

test('SESSION_ABSOLUTE_EXPIRY', async () => {
  const f = await fixture()
  const { s } = await f.paired()
  const receiverScope = f.receiver(s)

  // Even with active renewal every 5 minutes, session must not exceed POLICY.maxLifetimeMs (90 min)
  const interval = 300_000
  const maxLifetime = POLICY.maxLifetimeMs
  const steps = Math.ceil(maxLifetime / interval)

  for (let i = 0; i < steps; i++) {
    f.advance(interval)
    const res = await f.call('/status', receiverScope)
    if (f.now() >= 1_000_000 + maxLifetime) {
      assert.equal(res.status, 403, 'Session must expire once maxLifetime is exceeded')
      break
    } else {
      assert.equal(res.state, 'PAIRED')
    }
  }
})

test('SESSION_RENEWAL_SECURITY', async () => {
  const f = await fixture()
  const { s } = await f.paired()

  // Forged or missing credentials cannot touch/renew session
  const forged = { ref: s.ref, role: 'receiver', credential: 'f'.repeat(64) }
  const res = await f.call('/status', forged)
  assert.equal(res.status, 403)

  // Controller scope without owner cannot touch/renew session
  const controllerScope = { ref: s.ref, role: 'controller', credential: 'c'.repeat(64) }
  const res2 = await f.call('/status', controllerScope, '')
  assert.equal(res2.status, 403)
})

test('TRANSIENT_WIFI_DROP_PRESERVES_LAST_SNAPSHOT', () => {
  let emitted = null
  const client = new Cast2Client('receiver', {
    now: () => 1000,
    post: async () => ({}),
    socket: () => ({}),
  }, view => { emitted = view })

  const initial = sampleSnapshot('Preserved Song')
  client.publish(initial)
  client.view.snapshot = initial

  // Simulate network failure via fail()
  client['fail'](Error('Network timeout'))

  assert.equal(client.view.state, 'DISCONNECTED')
  assert.equal(client.view.error, 'Connection interrupted. Retrying…')
  assert.deepEqual(client.view.snapshot, initial, 'Snapshot must be preserved during recoverable disconnection')
})

test('AUTHORITATIVE_END_CLEARS_SESSION', async () => {
  let emitted = null
  const client = new Cast2Client('receiver', {
    now: () => 1000,
    post: async () => ({}),
    socket: () => ({}),
  }, view => { emitted = view })

  client.view.snapshot = sampleSnapshot()
  client.view.ref = 'a'.repeat(64)
  client['credential'] = 'b'.repeat(64)

  await client.end()

  assert.equal(client.view.state, 'ENDED')
  assert.equal(client.view.snapshot, null, 'Snapshot must be cleared on authoritative end')
  assert.equal(client['credential'], '')
})

test('RECONNECT_BACKOFF', () => {
  let currentTime = 1000
  const client = new Cast2Client('controller', {
    now: () => currentTime,
    post: async () => { throw Error('ECONNREFUSED') },
    socket: () => ({}),
  }, () => {}, { maxFailures: 10, backoff: true, initialBackoffMs: 1000, maxBackoffMs: 8000 })

  client['credential'] = 'c'.repeat(64)
  client.view.ref = 'r'.repeat(64)
  client.view.state = 'PAIRED'

  // First failure
  client['fail'](Error('ECONNREFUSED'))
  const retry1 = client['nextRetryAt']
  assert.ok(retry1 >= currentTime + 1000, 'Backoff 1 should be >= 1000ms')

  // Second failure
  currentTime = retry1 + 10
  client['fail'](Error('ECONNREFUSED'))
  const retry2 = client['nextRetryAt']
  assert.ok(retry2 >= currentTime + 1500, 'Backoff 2 should increase with exponential factor')
})

test('RECONNECT_AFTER_TEMPORARY_FAILURE', async () => {
  let networkFailing = true
  let currentTime = 1000
  const client = new Cast2Client('controller', {
    now: () => currentTime,
    post: async path => {
      if (networkFailing) throw Error('UNAVAILABLE')
      if (path === '/status') return { sessionId: 'a'.repeat(64), state: 'PAIRED', inboundSequence: 0, expiresAt: currentTime + 600000 }
      if (path === '/ticket') return { ticket: 'b'.repeat(64) }
      return {}
    },
    socket: () => ({}),
  }, () => {}, { maxFailures: 10, backoff: true })

  client['credential'] = 'c'.repeat(64)
  client.view.ref = 'a'.repeat(64)
  client.view.state = 'PAIRED'

  // Trigger 1 failure
  await client.tick()
  assert.equal(client.failures, 1)

  // Network recovers and tick executes after retry time
  networkFailing = false
  currentTime += 5000
  await client.tick()

  assert.equal(client.failures, 0, 'Failures should reset to 0 after recovery')
  assert.equal(client.view.state, 'PAIRED')
})

test('CONTROLLER_REFRESH_RECOVERY', async () => {
  const fakeSessionStorage = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: k => fakeSessionStorage.get(k) || null,
      setItem: (k, v) => fakeSessionStorage.set(k, String(v)),
      removeItem: k => fakeSessionStorage.delete(k),
    },
  }

  try {
    const client1 = new Cast2Client('controller', {
      now: () => 1000,
      post: async path => {
        if (path === '/claim') return { sessionId: 'a'.repeat(64), controllerCredential: 'c'.repeat(64), state: 'PAIRED', expiresAt: 600000 }
        return {}
      },
      socket: () => ({}),
    }, () => {})

    await client1.start('a'.repeat(64), '123456')
    assert.ok(fakeSessionStorage.has('gtar_cast2_controller_session'), 'Session info saved to sessionStorage')

    // Simulate tab refresh: new Cast2Client instance in same tab
    const client2 = new Cast2Client('controller', {
      now: () => 2000,
      post: async path => {
        if (path === '/status') return { sessionId: 'a'.repeat(64), state: 'PAIRED', inboundSequence: 0, expiresAt: 800000 }
        if (path === '/ticket') return { ticket: 'b'.repeat(64) }
        return {}
      },
      socket: () => ({ onopen: null, onclose: null, onerror: null, onmessage: null, close: () => {} }),
    }, () => {})

    const restored = client2.restore()
    assert.equal(restored, true, 'Controller session restored from sessionStorage')
    assert.equal(client2.view.ref, 'a'.repeat(64))
    assert.equal(client2.view.state, 'DISCONNECTED')

    // Validate with server
    await client2.tick()
    assert.equal(client2.view.state, 'PAIRED', 'Restored session validated with server')
  } finally {
    delete globalThis.window
  }
})

test('RECEIVER_REFRESH_RECOVERY', async () => {
  const fakeSessionStorage = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: k => fakeSessionStorage.get(k) || null,
      setItem: (k, v) => fakeSessionStorage.set(k, String(v)),
      removeItem: k => fakeSessionStorage.delete(k),
    },
  }

  try {
    const client1 = new Cast2Client('receiver', {
      now: () => 1000,
      post: async path => {
        if (path === '/create') return { ref: 'a'.repeat(64), receiverCredential: 'c'.repeat(64), pin: '123456', expiresAt: 600000, pairingExpiresAt: 120000 }
        return {}
      },
      socket: () => ({}),
    }, () => {})

    await client1.start()
    assert.ok(fakeSessionStorage.has('gtar_cast2_receiver_session'))

    // Simulate page reload
    const client2 = new Cast2Client('receiver', {
      now: () => 2000,
      post: async path => {
        if (path === '/status') return { sessionId: 'a'.repeat(64), state: 'PAIRED', inboundSequence: 0, expiresAt: 800000 }
        if (path === '/ticket') return { ticket: 'b'.repeat(64) }
        return {}
      },
      socket: () => ({ onopen: null, onclose: null, onerror: null, onmessage: null, close: () => {} }),
    }, () => {})

    const restored = client2.restore()
    assert.equal(restored, true)
    await client2.tick()
    assert.equal(client2.view.state, 'PAIRED')
  } finally {
    delete globalThis.window
  }
})

test('CREDENTIAL_REVOCATION', async () => {
  const fakeSessionStorage = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: k => fakeSessionStorage.get(k) || null,
      setItem: (k, v) => fakeSessionStorage.set(k, String(v)),
      removeItem: k => fakeSessionStorage.delete(k),
    },
  }

  try {
    const client = new Cast2Client('controller', {
      now: () => 1000,
      post: async () => ({ sessionId: 'a'.repeat(64), controllerCredential: 'c'.repeat(64), state: 'PAIRED', expiresAt: 600000 }),
      socket: () => ({}),
    }, () => {})

    await client.start('a'.repeat(64), '123456')
    assert.ok(fakeSessionStorage.has('gtar_cast2_controller_session'))

    await client.end()
    assert.equal(fakeSessionStorage.has('gtar_cast2_controller_session'), false, 'Credentials must be removed on end/revocation')
  } finally {
    delete globalThis.window
  }
})

test('SESSION_ISOLATION', async () => {
  const f = await fixture()
  const sessionA = await f.paired('owner-A')
  const sessionB = await f.paired('owner-B')

  // Using sessionA credential with sessionB reference fails
  const cross = { ref: sessionB.s.ref, role: 'controller', credential: sessionA.c.controllerCredential }
  const res = await f.call('/status', cross, 'owner-A')
  assert.equal(res.status, 403, 'Cross-session control must fail closed')
})

test('WAKE_LOCK_ACQUIRE_RELEASE', async () => {
  let requested = false
  let released = false
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
  }
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      wakeLock: {
        request: async type => {
          if (type === 'screen') {
            requested = true
            return {
              release: async () => { released = true },
              addEventListener: () => {},
              removeEventListener: () => {},
            }
          }
          throw Error('unsupported')
        },
      },
    },
  })

  try {
    const lock = createWakeLockController()
    assert.equal(lock.isSupported, true)
    await lock.acquire()
    assert.equal(requested, true)

    await lock.cleanup()
    assert.equal(released, true)
  } finally {
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav)
    delete globalThis.document
  }
})

test('WAKE_LOCK_UNSUPPORTED', async () => {
  const lock = createWakeLockController()
  assert.equal(lock.isSupported, false)
  await lock.acquire()
  await lock.cleanup()
})

test('MULTI_RECEIVER_REPLACEMENT_FEEDBACK', async () => {
  const f = await fixture()
  const { s, c } = await f.paired()

  const r1 = await f.connect(f.receiver(s))
  assert.equal(r1.closed, false)

  // Second receiver connects
  const r2 = await f.connect(f.receiver(s))
  assert.equal(r1.closed, true)
  assert.equal(r1.closeReason, 'REPLACED', 'First receiver must receive REPLACED close reason')
  assert.equal(r2.closed, false)
})

test('INVALID_PROJECTION_FEEDBACK', () => {
  stageCast2Controller.resetForTesting()
  try {
    // Malformed song state (missing required fields)
    const invalidState = {
      song: null,
      transposeOffset: 0,
      effectiveKey: 'C',
      isTwoColumn: false,
    }
    const result = projectCast2Presentation(invalidState, {
      lineIndex: 0,
      scrollTop: 0,
      scrollFraction: 0,
      chordsVisible: false,
      fontSize: 32,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'INVALID_PRESENTATION_STATE')
  } finally {
    stageCast2Controller.resetForTesting()
  }
})

test('NO_DUPLICATE_LISTENERS', () => {
  stageCast2Controller.resetForTesting()
  try {
    let calls = 0
    const listener = () => { calls++ }
    const unsub = stageCast2Controller.subscribe(listener)
    stageCast2Controller.setChords(true)
    assert.equal(calls, 1)

    unsub()
    stageCast2Controller.setChords(false)
    assert.equal(calls, 1, 'Unsubscribed listener must not be called')
  } finally {
    stageCast2Controller.resetForTesting()
  }
})

test('NO_PERSISTENCE_WRITE_STORM', () => {
  let writes = 0
  globalThis.localStorage = {
    getItem: () => '36',
    setItem: () => { writes++ },
  }
  globalThis.window = {}

  try {
    stageCast2Controller.resetForTesting()
    // Setting identical font size
    stageCast2Controller.setTvFontSize(36)
    assert.equal(writes, 0, 'No write if value is unchanged')

    // Setting new font size
    stageCast2Controller.setTvFontSize(40)
    assert.equal(writes, 1, 'Single write on value change')

    // Setting same new font size again
    stageCast2Controller.setTvFontSize(40)
    assert.equal(writes, 1, 'No duplicate write for same value')
  } finally {
    delete globalThis.localStorage
    delete globalThis.window
    stageCast2Controller.resetForTesting()
  }
})

test('LEGACY_SESSION_WITHOUT_MAX_DEADLINE', async () => {
  const ref = 'a'.repeat(64), receiverCredential = 'b'.repeat(64)
  const legacySession = {
    ref,
    state: 'WAITING_FOR_CONTROLLER',
    deadline: 1_000_000 + 600_000,
    pairingDeadline: 1_000_000 + 120_000,
    pinHash: await digest(ref + '123456'),
    receiverHash: await digest(receiverCredential),
    owner: '',
    controllerHash: '',
    requestId: '',
    guesses: 0,
    sequence: 0,
    inbound: { controller: 0, receiver: 0 },
  }
  const storage = new MemoryStorage()
  await storage.put('hub', { sessions: [legacySession], tickets: [], buckets: [] })
  let currentTime = 1_000_000
  const hub = new StageCast2Hub({ storage }, undefined, {
    now: () => currentTime,
    upgrade: () => ({ server: new FakeSocket(), response: new Response(null, { status: 101 }) }),
  })
  const req = new Request('https://cast.gtar.internal/status', {
    method: 'POST',
    headers: { 'x-cast-client': '1'.repeat(64), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, role: 'receiver', credential: receiverCredential }),
  })
  const res = await hub.fetch(req)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(Number.isFinite(body.expiresAt), 'expiresAt must be a finite number')
  assert.ok(Number.isFinite(body.maxExpiresAt), 'maxExpiresAt must be a finite number')
  assert.equal(body.maxExpiresAt, 1_000_000 + 5_400_000)
})

test('LEGACY_SESSION_FINITE_EXPIRY', async () => {
  const storage = new MemoryStorage()
  const ref = 'a'.repeat(64), receiverCredential = 'b'.repeat(64), controllerCredential = 'c'.repeat(64)
  const legacySession = {
    ref,
    state: 'PAIRED',
    deadline: 1_000_000 + 600_000,
    pairingDeadline: 1_000_000 + 120_000,
    pinHash: '',
    receiverHash: await digest(receiverCredential),
    owner: 'owner-1',
    controllerHash: await digest(controllerCredential),
    requestId: 'r'.repeat(64),
    guesses: 0,
    sequence: 0,
    inbound: { controller: 0, receiver: 0 },
  }
  await storage.put('hub', { sessions: [legacySession], tickets: [], buckets: [] })
  let currentTime = 1_000_000
  const hub = new StageCast2Hub({ storage }, undefined, {
    now: () => currentTime,
    upgrade: () => ({ server: new FakeSocket(), response: new Response(null, { status: 101 }) }),
  })
  const makeReq = () => new Request('https://cast.gtar.internal/status', {
    method: 'POST',
    headers: { 'x-cast-client': '1'.repeat(64), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, role: 'receiver', credential: receiverCredential }),
  })

  // Advance with regular active touches up to 85 minutes
  for (let i = 0; i < 17; i++) {
    currentTime += 300_000
    const res = await hub.fetch(makeReq())
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.expiresAt <= 1_000_000 + 5_400_000, 'Renewal must never exceed maxDeadline ceiling')
  }
  const finalRes = await hub.fetch(makeReq())
  const finalBody = await finalRes.json()
  assert.equal(finalBody.expiresAt, 1_000_000 + 5_400_000)
})

test('LEGACY_SESSION_SURVIVES_SWEEP', async () => {
  const storage = new MemoryStorage()
  const ref = 'a'.repeat(64), receiverCredential = 'b'.repeat(64)
  const legacySession = {
    ref,
    state: 'WAITING_FOR_CONTROLLER',
    deadline: 1_000_000 + 600_000,
    pairingDeadline: 1_000_000 + 120_000,
    pinHash: await digest(ref + '123456'),
    receiverHash: await digest(receiverCredential),
    owner: '',
    controllerHash: '',
    requestId: '',
    guesses: 0,
    sequence: 0,
    inbound: { controller: 0, receiver: 0 },
  }
  await storage.put('hub', { sessions: [legacySession], tickets: [], buckets: [] })
  let currentTime = 1_000_000 + 30_000
  const hub = new StageCast2Hub({ storage }, undefined, {
    now: () => currentTime,
    upgrade: () => ({ server: new FakeSocket(), response: new Response(null, { status: 101 }) }),
  })
  const makeReq = () => new Request('https://cast.gtar.internal/status', {
    method: 'POST',
    headers: { 'x-cast-client': '1'.repeat(64), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, role: 'receiver', credential: receiverCredential }),
  })
  const res1 = await hub.fetch(makeReq())
  assert.equal(res1.status, 200)

  const res2 = await hub.fetch(makeReq())
  assert.equal(res2.status, 200, 'Legacy session must survive sweep and subsequent requests')
})

test('LEGACY_SESSION_ABSOLUTE_EXPIRY', async () => {
  const storage = new MemoryStorage()
  const ref = 'a'.repeat(64), receiverCredential = 'b'.repeat(64)
  const legacySession = {
    ref,
    state: 'WAITING_FOR_CONTROLLER',
    deadline: 1_000_000 + 600_000,
    pairingDeadline: 1_000_000 + 120_000,
    pinHash: await digest(ref + '123456'),
    receiverHash: await digest(receiverCredential),
    owner: '',
    controllerHash: '',
    requestId: '',
    guesses: 0,
    sequence: 0,
    inbound: { controller: 0, receiver: 0 },
  }
  await storage.put('hub', { sessions: [legacySession], tickets: [], buckets: [] })
  let currentTime = 1_000_000 + 5_400_001
  const hub = new StageCast2Hub({ storage }, undefined, {
    now: () => currentTime,
    upgrade: () => ({ server: new FakeSocket(), response: new Response(null, { status: 101 }) }),
  })
  const req = new Request('https://cast.gtar.internal/status', {
    method: 'POST',
    headers: { 'x-cast-client': '1'.repeat(64), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, role: 'receiver', credential: receiverCredential }),
  })
  const res = await hub.fetch(req)
  assert.equal(res.status, 403, 'Session past maxDeadline must expire')
})

test('WAITING_RECEIVER_RELOAD', async () => {
  const fakeSessionStorage = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: k => fakeSessionStorage.get(k) || null,
      setItem: (k, v) => fakeSessionStorage.set(k, String(v)),
      removeItem: k => fakeSessionStorage.delete(k),
    },
  }

  let revoked = false
  let createCalls = 0
  try {
    const client1 = new Cast2Client('receiver', {
      now: () => 1000,
      post: async (path, body) => {
        if (path === '/create') {
          createCalls++
          return { ref: '1'.repeat(64), receiverCredential: 'b'.repeat(64), pin: '111111', expiresAt: 600000, pairingExpiresAt: 120000 }
        }
        return {}
      },
      socket: () => ({}),
    }, () => {})

    await client1.start()
    assert.equal(createCalls, 1)
    assert.ok(fakeSessionStorage.has('gtar_cast2_receiver_session'))

    // Simulate page reload while session was still WAITING_FOR_CONTROLLER
    const client2 = new Cast2Client('receiver', {
      now: () => 2000,
      post: async (path, body) => {
        if (path === '/status') return { sessionId: '1'.repeat(64), state: 'WAITING_FOR_CONTROLLER', inboundSequence: 0, expiresAt: 600000 }
        if (path === '/revoke') {
          revoked = true
          return { state: 'REVOKED' }
        }
        if (path === '/create') {
          createCalls++
          return { ref: '2'.repeat(64), receiverCredential: 'c'.repeat(64), pin: '222222', expiresAt: 600000, pairingExpiresAt: 120000 }
        }
        return {}
      },
      socket: () => ({ onopen: null, onclose: null, onerror: null, onmessage: null, close: () => {} }),
    }, () => {})

    const restored = client2.restore()
    assert.equal(restored, true)
    await client2.tick()

    assert.equal(revoked, true, 'Old incomplete session must be revoked on server')
    assert.equal(createCalls, 2, 'Fresh session must be created with new PIN')
    assert.equal(client2.view.ref, '2'.repeat(64))
    assert.equal(client2.view.pin, '222222')
    assert.equal(client2.view.state, 'WAITING_FOR_CONTROLLER')
  } finally {
    delete globalThis.window
  }
})

test('PAIRING_DEADLINE_VALIDATION', async () => {
  const client = new Cast2Client('receiver', {
    now: () => 1000,
    post: async () => ({ sessionId: 'a'.repeat(64), state: 'WAITING_FOR_CONTROLLER', inboundSequence: 0, expiresAt: 600000 }),
    socket: () => ({}),
  }, () => {})

  client.view.state = 'WAITING_FOR_CONTROLLER'
  client.view.expiresAt = 600000
  client.view.pairingExpiresAt = 0
  client['credential'] = 'c'.repeat(64)

  // tick() must NOT immediately expire when pairingExpiresAt is 0
  await client.tick()
  assert.notEqual(client.view.state, 'EXPIRED', 'Must not falsely expire when pairingExpiresAt is 0')

  // When pairingExpiresAt is set and now exceeds it
  client.view.state = 'WAITING_FOR_CONTROLLER'
  client.view.pairingExpiresAt = 500
  await client.tick()
  assert.equal(client.view.state, 'EXPIRED', 'Must expire when pairing deadline is exceeded')
})

test('PAIRED_RECEIVER_RELOAD', async () => {
  const fakeSessionStorage = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: k => fakeSessionStorage.get(k) || null,
      setItem: (k, v) => fakeSessionStorage.set(k, String(v)),
      removeItem: k => fakeSessionStorage.delete(k),
    },
  }

  try {
    fakeSessionStorage.set('gtar_cast2_receiver_session', JSON.stringify({
      ref: 'a'.repeat(64),
      credential: 'c'.repeat(64),
      expiresAt: 600000,
    }))

    let ticketRequested = false
    const client = new Cast2Client('receiver', {
      now: () => 2000,
      post: async path => {
        if (path === '/status') return { sessionId: 'a'.repeat(64), state: 'PAIRED', inboundSequence: 0, expiresAt: 700000 }
        if (path === '/ticket') {
          ticketRequested = true
          return { ticket: 'b'.repeat(64) }
        }
        return {}
      },
      socket: () => ({ onopen: null, onclose: null, onerror: null, onmessage: null, close: () => {} }),
    }, () => {})

    assert.equal(client.restore(), true)
    await client.tick()
    assert.equal(ticketRequested, true)
    assert.equal(client.view.state, 'PAIRED')
  } finally {
    delete globalThis.window
  }
})

test('CONTROLLER_RELOAD', async () => {
  const fakeSessionStorage = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: k => fakeSessionStorage.get(k) || null,
      setItem: (k, v) => fakeSessionStorage.set(k, String(v)),
      removeItem: k => fakeSessionStorage.delete(k),
    },
  }

  try {
    fakeSessionStorage.set('gtar_cast2_controller_session', JSON.stringify({
      ref: 'c'.repeat(64),
      credential: 'b'.repeat(64),
      expiresAt: 600000,
    }))

    const client = new Cast2Client('controller', {
      now: () => 2000,
      post: async path => {
        if (path === '/status') return { sessionId: 'c'.repeat(64), state: 'PAIRED', inboundSequence: 0, expiresAt: 700000 }
        if (path === '/ticket') return { ticket: 'b'.repeat(64) }
        return {}
      },
      socket: () => ({ onopen: null, onclose: null, onerror: null, onmessage: null, close: () => {} }),
    }, () => {})

    assert.equal(client.restore(), true)
    await client.tick()
    assert.equal(client.view.state, 'PAIRED')
  } finally {
    delete globalThis.window
  }
})

test('STRICTMODE_DOUBLE_MOUNT', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/tv' })
  const keys = ['window', 'document', 'history', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', 'setInterval', 'clearInterval', 'WebSocket']
  const prior = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const timers = new Map()
  let nextTimer = 0
  const calls = []

  for (const [k, value] of Object.entries({
    window: dom.window, document: dom.window.document, history: dom.window.history,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearInterval: id => timers.delete(id),
    WebSocket: class {
      readyState = 0; send() {} close() {}
      constructor() { queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
    },
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (url.endsWith('/create')) return Response.json({ ref: 'a'.repeat(64), pin: '123456', receiverCredential: 'b'.repeat(64), expiresAt: Date.now() + 600000, pairingExpiresAt: Date.now() + 120000 })
      if (url.endsWith('/status')) return Response.json({ sessionId: 'a'.repeat(64), state: 'WAITING_FOR_CONTROLLER', requestId: 'r'.repeat(64), inboundSequence: 0, expiresAt: Date.now() + 600000 })
      if (url.endsWith('/revoke')) return Response.json({ state: 'REVOKED' })
      return Response.json({})
    },
  })) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })
  }

  const root = createRoot(dom.window.document.getElementById('root'))
  try {
    await act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(StageCast2Panel, { receiver: true })))
    })

    const revokeCalls = calls.filter(c => c.url.endsWith('/revoke'))
    assert.equal(revokeCalls.length, 0, 'StrictMode double-mount must not invoke server /revoke')
  } finally {
    try { await act(async () => root.unmount()) } catch { /* best effort */ }
    for (const [k, desc] of Object.entries(prior)) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }
})

test('SPA_UNMOUNT_NO_UNINTENDED_REVOKE', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/tv' })
  const keys = ['window', 'document', 'history', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', 'setInterval', 'clearInterval', 'WebSocket']
  const prior = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const timers = new Map()
  let nextTimer = 0
  const calls = []

  for (const [k, value] of Object.entries({
    window: dom.window, document: dom.window.document, history: dom.window.history,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearInterval: id => timers.delete(id),
    WebSocket: class {
      readyState = 0; send() {} close() {}
      constructor() { queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
    },
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (url.endsWith('/create')) return Response.json({ ref: 'a'.repeat(64), pin: '123456', receiverCredential: 'b'.repeat(64), expiresAt: Date.now() + 600000, pairingExpiresAt: Date.now() + 120000 })
      if (url.endsWith('/status')) return Response.json({ sessionId: 'a'.repeat(64), state: 'WAITING_FOR_CONTROLLER', requestId: 'r'.repeat(64), inboundSequence: 0, expiresAt: Date.now() + 600000 })
      if (url.endsWith('/revoke')) return Response.json({ state: 'REVOKED' })
      return Response.json({})
    },
  })) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })
  }

  const root = createRoot(dom.window.document.getElementById('root'))
  try {
    await act(async () => {
      root.render(React.createElement(StageCast2Panel, { receiver: true }))
    })

    await act(async () => {
      root.unmount()
    })

    const revokeCalls = calls.filter(c => c.url.endsWith('/revoke'))
    assert.equal(revokeCalls.length, 0, 'Component unmount must not trigger server revocation')
  } finally {
    for (const [k, desc] of Object.entries(prior)) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }
})

test('EXPLICIT_END_REVOKES', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/tv' })
  const keys = ['window', 'document', 'history', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', 'setInterval', 'clearInterval', 'WebSocket']
  const prior = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const timers = new Map()
  let nextTimer = 0
  const calls = []

  for (const [k, value] of Object.entries({
    window: dom.window, document: dom.window.document, history: dom.window.history,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearInterval: id => timers.delete(id),
    WebSocket: class {
      readyState = 0; send() {} close() {}
      constructor() { queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
    },
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (url.endsWith('/create')) return Response.json({ ref: 'a'.repeat(64), pin: '123456', receiverCredential: 'b'.repeat(64), expiresAt: Date.now() + 600000, pairingExpiresAt: Date.now() + 120000 })
      if (url.endsWith('/status')) return Response.json({ sessionId: 'a'.repeat(64), state: 'WAITING_FOR_CONTROLLER', requestId: 'r'.repeat(64), inboundSequence: 0, expiresAt: Date.now() + 600000 })
      if (url.endsWith('/revoke')) return Response.json({ state: 'REVOKED' })
      return Response.json({})
    },
  })) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })
  }

  const root = createRoot(dom.window.document.getElementById('root'))
  try {
    await act(async () => {
      root.render(React.createElement(StageCast2Panel, { receiver: true }))
    })

    // Click "Create TV pairing" first
    await act(async () => {
      const createBtn = [...dom.window.document.querySelectorAll('button')].find(b => /Create TV/.test(b.textContent))
      if (createBtn) createBtn.click()
    })

    // Click "End session" button
    await act(async () => {
      const endBtn = [...dom.window.document.querySelectorAll('button')].find(b => /End session/.test(b.textContent))
      if (endBtn) endBtn.click()
    })

    const revokeCalls = calls.filter(c => c.url.endsWith('/revoke'))
    assert.equal(revokeCalls.length, 1, 'Explicit button click must call server /revoke')
  } finally {
    try { await act(async () => root.unmount()) } catch { /* best effort */ }
    for (const [k, desc] of Object.entries(prior)) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }
})

test('NO_TIMER_OR_SOCKET_LEAK', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/tv' })
  const keys = ['window', 'document', 'history', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', 'setInterval', 'clearInterval', 'WebSocket']
  const prior = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const timers = new Map()
  let nextTimer = 0

  for (const [k, value] of Object.entries({
    window: dom.window, document: dom.window.document, history: dom.window.history,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearInterval: id => timers.delete(id),
    WebSocket: class {
      readyState = 0; send() {}
      close() {}
      constructor() { queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
    },
    fetch: async () => Response.json({}),
  })) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })
  }

  const root = createRoot(dom.window.document.getElementById('root'))
  try {
    await act(async () => {
      root.render(React.createElement(StageCast2Panel, { receiver: true }))
    })

    assert.ok(timers.size >= 2, 'Timers must be started on mount')

    await act(async () => {
      root.unmount()
    })

    assert.equal(timers.size, 0, 'All interval timers must be cleared on unmount')
  } finally {
    for (const [k, desc] of Object.entries(prior)) {
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  }
})
