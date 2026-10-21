const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

function loadModule(entryContents) {
  const bundled = buildSync({
    stdin: {
      contents: entryContents,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
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
} = loadModule(`
  export { StageCast2Hub, POLICY, digest } from './workers/stageCast2Backend.ts';
  export { Cast2Client } from './src/utils/stageCast2Client.ts';
  export { stageCast2Controller } from './src/utils/stageCast2Controller.ts';
  export { projectCast2Presentation } from './src/utils/stageCast2Projection.ts';
  export { createWakeLockController } from './src/utils/stagePerformance.ts';
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
