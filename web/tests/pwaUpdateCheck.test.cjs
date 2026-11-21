// #562: About "Check for updates" — worker update, release.json comparison, Stage-guarded reload.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { checkForUpdates, describeUpdateCheck, isStageActive } = require('../src/utils/pwaUpdate.ts')

const RUNNING = '1.2.3'
const json = body => ({ type: 'basic', redirected: false, ok: true, status: 200, text: async () => JSON.stringify(body) })
const release = version => json({ version, sourceTag: 'v1.1.2-dev.1', sha: 'a'.repeat(40) })

function worker(state) {
  const listeners = new Set()
  return {
    state,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    become(next) { this.state = next; for (const listener of [...listeners]) listener() },
    listenerCount: () => listeners.size,
  }
}

function harness({ reply = release(RUNNING), update = async () => {}, incoming = null, stage = false, runningVersion = RUNNING, registration, online = true } = {}) {
  const calls = { fetch: [], update: 0, reload: 0, warn: [] }
  const reg = registration !== undefined ? registration : {
    installing: null,
    waiting: null,
    async update() { calls.update++; await update(); this.installing = incoming },
  }
  const deps = {
    runningVersion,
    online,
    now: () => 1234567,
    activationTimeoutMs: 20,
    stageActive: () => stage,
    warn: (message, error) => { calls.warn.push({ message, name: error?.name }) },
    reload: () => { calls.reload++ },
    serviceWorker: { getRegistration: async () => reg ?? undefined },
    fetchImpl: async (url, init) => {
      calls.fetch.push({ url, init })
      if (reply instanceof Error) throw reply
      return reply
    },
  }
  return { calls, deps }
}

test('update check: same release.json version and no new worker reports up to date, without reload', async () => {
  const { calls, deps } = harness()
  assert.deepEqual(await checkForUpdates(deps), { status: 'up-to-date', latestVersion: RUNNING })
  assert.equal(calls.update, 1, 'registration.update() must run')
  assert.equal(calls.reload, 0)
})

test('update check: release.json is fetched past every cache and redirects are not followed', async () => {
  const { calls, deps } = harness()
  await checkForUpdates(deps)
  assert.deepEqual(calls.fetch, [{ url: '/release.json?check=1234567', init: { cache: 'no-store', redirect: 'manual' } }])
})

test('update check: a redirect or non-JSON reply is blocked, never up to date', async () => {
  const replies = {
    'manual redirect (sign-in)': { type: 'opaqueredirect', redirected: false, ok: false, status: 0, text: async () => '' },
    'followed redirect': { ...release(RUNNING), redirected: true },
    'sign-in HTML with 200': { type: 'basic', redirected: false, ok: true, status: 200, text: async () => '<!doctype html><title>Sign in</title>' },
    'SPA fallback index.html': { type: 'basic', redirected: false, ok: true, status: 200, text: async () => '<!doctype html><div id="root"></div>' },
    '403': { type: 'basic', redirected: false, ok: false, status: 403, text: async () => JSON.stringify({ version: RUNNING }) },
    'JSON without version': json({ ok: true }),
    'JSON null': json(null),
    'JSON with non-version string': json({ version: 'latest' }),
  }
  for (const [name, reply] of Object.entries(replies)) {
    const { calls, deps } = harness({ reply })
    const result = await checkForUpdates(deps)
    assert.equal(result.status, 'blocked', name)
    assert.equal(describeUpdateCheck(result), 'Update check blocked. Sign-in needed.', name)
    assert.equal(calls.reload, 0, name)
  }
})

test('update check: a refused worker script is its own result, with the error name, and is logged', async () => {
  const { calls, deps } = harness({ update: async () => { throw new TypeError('script redirect') } })
  const result = await checkForUpdates(deps)
  assert.deepEqual(result, { status: 'worker-failed', latestVersion: RUNNING, detail: 'TypeError' })
  assert.equal(describeUpdateCheck(result), 'Update worker could not run (TypeError). Close and reopen GTAR, then try again.')
  assert.deepEqual(calls.warn, [{ message: 'GTAR update check: service worker update failed', name: 'TypeError' }])
  assert.equal(calls.reload, 0)
})

test('update check: newer release.json with a failing worker says the update is stuck, never blocked or up to date', async () => {
  const { calls, deps } = harness({ reply: release('1.2.6'), update: async () => { throw new TypeError('script redirect') } })
  const result = await checkForUpdates(deps)
  assert.deepEqual(result, { status: 'update-stuck', latestVersion: '1.2.6', detail: 'TypeError' })
  assert.match(describeUpdateCheck(result), /^Update v1\.2\.6 found but could not be installed \(TypeError\)\. Close and reopen GTAR\./)
  assert.equal(calls.reload, 0)
})

test('update check: a blocked release.json is still blocked when the worker also fails', async () => {
  const { deps } = harness({ reply: { type: 'opaqueredirect', redirected: false, ok: false, status: 0, text: async () => '' }, update: async () => { throw new TypeError('x') } })
  assert.equal((await checkForUpdates(deps)).status, 'blocked')
})

test('update check: offline and unreachable server never report up to date', async () => {
  const offline = harness({ online: false })
  assert.deepEqual(await checkForUpdates(offline.deps), { status: 'offline' })
  assert.equal(offline.calls.fetch.length + offline.calls.update, 0, 'offline makes no requests')

  const down = harness({ reply: new TypeError('Failed to fetch'), update: async () => { throw new TypeError('Failed to fetch') } })
  assert.deepEqual(await checkForUpdates(down.deps), { status: 'offline' })

  const partial = harness({ reply: new TypeError('Failed to fetch') })
  assert.deepEqual(await checkForUpdates(partial.deps), { status: 'failed' })
})

test('update check: a newer release reloads only when Stage is not active', async () => {
  const idle = harness({ reply: release('1.2.4') })
  assert.deepEqual(await checkForUpdates(idle.deps), { status: 'reloading', latestVersion: '1.2.4' })
  assert.equal(idle.calls.reload, 1)

  const onStage = harness({ reply: release('1.2.4'), stage: true })
  const result = await checkForUpdates(onStage.deps)
  assert.deepEqual(result, { status: 'next-launch', latestVersion: '1.2.4' })
  assert.equal(onStage.calls.reload, 0, 'Stage must never be reloaded')
  assert.equal(describeUpdateCheck(result), 'Update v1.2.4 applies on next launch.')
})

test('update check: a new worker is awaited until activated, then reloads off Stage only', async () => {
  for (const stage of [false, true]) {
    const incoming = worker('installing')
    const { calls, deps } = harness({ reply: release('1.2.4'), incoming, stage })
    deps.activationTimeoutMs = 5000
    const pending = checkForUpdates(deps)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(calls.reload, 0, 'no reload while the worker is still installing')
    incoming.become('installed')
    incoming.become('activated')
    assert.equal((await pending).status, stage ? 'next-launch' : 'reloading')
    assert.equal(calls.reload, stage ? 0 : 1)
    assert.equal(incoming.listenerCount(), 0)
  }
})

test('update check: a worker still downloading or failing to install does not reload', async () => {
  const slow = harness({ reply: release('1.2.4'), incoming: worker('installing') })
  assert.equal((await checkForUpdates(slow.deps)).status, 'next-launch')
  assert.equal(slow.calls.reload, 0)

  const broken = harness({ reply: release('1.2.4'), incoming: worker('redundant') })
  assert.equal((await checkForUpdates(broken.deps)).status, 'update-stuck')
  assert.equal(broken.calls.reload, 0)
})

test('update check: builds without release.json (DEV, preview) rely on the worker and never fetch release.json', async () => {
  const current = harness({ runningVersion: '0.0.0-unversioned' })
  assert.deepEqual(await checkForUpdates(current.deps), { status: 'no-new-build' })
  assert.equal(current.calls.fetch.length, 0)

  const updated = harness({ runningVersion: '0.0.0-unversioned', incoming: worker('activated') })
  assert.equal((await checkForUpdates(updated.deps)).status, 'reloading')
  assert.equal(updated.calls.reload, 1)

  const refused = harness({ runningVersion: '0.0.0-unversioned', update: async () => { throw new TypeError('redirect') } })
  assert.deepEqual(await checkForUpdates(refused.deps), { status: 'worker-failed', detail: 'TypeError' })

  const noWorker = harness({ runningVersion: '0.0.0-unversioned', registration: null })
  assert.deepEqual(await checkForUpdates(noWorker.deps), { status: 'unavailable' })
})

test('update check: status copy is short and plain', () => {
  const copy = Object.fromEntries(['up-to-date', 'no-new-build', 'reloading', 'next-launch', 'blocked', 'worker-failed', 'update-stuck', 'offline', 'failed', 'unavailable']
    .map(status => [status, describeUpdateCheck({ status })]))
  assert.deepEqual(copy, {
    'up-to-date': 'Up to date.',
    'no-new-build': 'No new build found.',
    reloading: 'Updating…',
    'next-launch': 'Update applies on next launch.',
    blocked: 'Update check blocked. Sign-in needed.',
    'worker-failed': 'Update worker could not run. Close and reopen GTAR, then try again.',
    'update-stuck': 'Update found but could not be installed. Close and reopen GTAR. If it repeats, back up, remove GTAR from the Home Screen and add it again.',
    offline: 'Offline. Try again when connected.',
    failed: 'Update check failed. Try again.',
    unavailable: 'Update check is not available here.',
  })
  assert.equal(describeUpdateCheck({ status: 'reloading', latestVersion: '1.2.4' }), 'Updating to v1.2.4…')
})

test('stage guard: any of the four Stage signals blocks a reload', () => {
  const original = global.window
  const at = (location, flag) => { global.window = { location: { pathname: '/', search: '', hash: '', ...location }, __GTAR_STAGE_ACTIVE__: flag } }
  try {
    at({}, false); assert.equal(isStageActive(), false)
    at({ pathname: '/stage' }, false); assert.equal(isStageActive(), true)
    at({ search: '?view=present' }, false); assert.equal(isStageActive(), true)
    at({ hash: '#present' }, false); assert.equal(isStageActive(), true)
    at({}, true); assert.equal(isStageActive(), true)
  } finally {
    if (original === undefined) delete global.window; else global.window = original
  }
})
