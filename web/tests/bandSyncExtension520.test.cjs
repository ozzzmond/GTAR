const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false })'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename)
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
const { ExtensionHostContext } = require('../src/extensions/host/ExtensionHostContext.ts')
const { ExtensionRows } = require('../src/extensions/host/ExtensionRows.tsx')
const { registry } = require('../src/extensions/registry.ts')
const { bandSyncAvailability } = require('../src/extensions/band-sync/manifest.ts')
const { useBandSyncGate } = require('../src/extensions/host/useBandSyncGate.ts')
const song = { id: 'local', title: 'Local song', artist: '', key: 'C', capo: '', bpm: '', transposeOffset: 3,
  format: 'CHORDPRO', rawContent: '{title: Local song}\n{key: C}\n{original_key: C}\n[C]Local words' }
const caps = ['net:https', 'ui:panel', 'events:song', 'events:transpose', 'events:section', 'events:setlist']
async function ui(run, options = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test/' + (options.hash ?? ''), pretendToBeVisual: true })
  const keys = ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'CustomEvent',
    'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'isSecureContext', 'WebSocket', 'fetch', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const sockets = [], calls = [], subscriptions = [], logs = []
  class Socket {
    readyState = 0; sent = []; closed = false
    constructor(url, protocols) { this.url = url; this.protocols = protocols; sockets.push(this) }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.closed = true }
    open() { this.readyState = 1; this.onopen?.() }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }) }
  }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    location: dom.window.location, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLSelectElement: dom.window.HTMLSelectElement, Node: dom.window.Node, CustomEvent: dom.window.CustomEvent,
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 16), cancelAnimationFrame: id => clearTimeout(id),
    isSecureContext: true, WebSocket: Socket, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), credentials: init.credentials })
      if (options.response) return options.response(url, init)
      return Response.json(url.endsWith('/create') ? { roomCode: 'ABCDEFGH', leaderCredential: 'c'.repeat(64), expiresAt: Date.now() + 21600000 } :
        url.endsWith('/end') ? { ended: true } : { roomCode: 'ABCDEFGH', ticket: 'b'.repeat(64), expiresAt: Date.now() + 15000 })
    } })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  dom.window.HTMLElement.prototype.scrollBy = function () {}
  dom.window.HTMLElement.prototype.scrollTo = function () {}
  localStorage.setItem('fixture_library', JSON.stringify([song]))
  const library = localStorage.getItem('fixture_library'), originalSong = JSON.stringify(song)
  const host = new ExtensionHost(registry, localStorage, { capabilities: caps }, message => logs.push(message))
  if (options.enabled) localStorage.setItem('gtar_ext_band-sync_v1', JSON.stringify({ enabled: true, settings: {} }))
  if (options.session) sessionStorage.setItem('gtar_band_sync_session_v1', JSON.stringify(options.session))
  if (options.strictStart) { const first = host.start(); host.dispose(); await Promise.all([first, host.start()]) } else await host.start()
  const { StageView } = require('../src/components/StageView.tsx')
  const { StageToolsModal } = require('../src/components/StageToolsModal.tsx')
  function Harness() {
    const [open, setOpen] = React.useState(false)
    return React.createElement(React.Fragment, null,
      React.createElement(StageView, { song, songs: [song], activeSongIndex: 0, onSelectSongIndex() {}, transposeOffset: 3, onTransposeChange() {}, onOpenBandSync: () => setOpen(true), ...options.stage }),
      React.createElement(StageToolsModal, { isOpen: open, onClose: () => setOpen(false) }),
      React.createElement(ExtensionRows, { host, rowClass: 'p-2' }))
  }
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(ExtensionHostContext.Provider, { value: host }, React.createElement(Harness))))
  const click = async button => { assert.ok(button); await act(async () => button.click()) }
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  const turnOn = async () => {
    await click(document.querySelector('[data-testid="extension-band-sync"] > button'))
    const toggle = document.querySelector('[data-testid="extension-band-sync"] input[type="checkbox"]')
    await click(toggle); assert.equal(toggle.checked, true)
  }
  try { await run({ host, sockets, calls, subscriptions, logs, root, click, button, turnOn, library, originalSong, dom }) }
  finally {
    await act(async () => { host.dispose(); root.unmount() })
    dom.window.close()
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
}
test('Stage Tools button/modal is the same ON or OFF (metronome/tuner only); OFF has no listener/network; ON/OFF persists', async () => {
  await ui(async ({ host, calls, sockets, subscriptions, click, button, turnOn }) => {
    assert.equal(host.getSnapshot('band-sync').state, 'disabled')
    assert.ok(document.querySelector('[data-testid="extension-band-sync"]'))
    assert.ok(document.body.textContent.includes('Turn on to see Band Sync on Stage.'))
    assert.equal(document.querySelector('[aria-label="Band Sync"]'), null)
    assert.ok(document.querySelector('[aria-label="Stage Tools"]'))
    assert.equal(document.querySelector('[aria-label="Stage Tools"]').textContent.trim(), 'Stage Tools')
    assert.equal(button('Push setlist to Band Sync'), undefined)
    await click(document.querySelector('[aria-label="Stage Tools"]'))
    assert.ok(button('Metronome')); await click(button('Guitar Tuner'))
    assert.ok(document.body.textContent.includes('E2 (6th)'))
    assert.equal(button('Band Sync'), undefined)
    assert.equal(calls.length, 0); assert.equal(sockets.length, 0); assert.deepEqual(subscriptions, [])
    await turnOn()
    assert.equal(document.querySelector('[aria-label="Band Sync"]'), null); assert.ok(document.querySelector('[aria-label="Stage Tools"]'))
    await click(document.querySelector('[aria-label="Stage Tools"]')); assert.ok(button('Metronome')); assert.ok(button('Guitar Tuner')); assert.equal(button('Band Sync'), undefined)
    assert.ok(document.body.textContent.includes('STAGE TOOLS')); assert.equal(document.body.textContent.includes('Sync & '), false)
    await click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close'))
    assert.equal(JSON.parse(localStorage.getItem('gtar_ext_band-sync_v1')).enabled, true)
    assert.equal(calls.length, 0); assert.equal(sockets.length, 0)
    await act(async () => host.disable('band-sync'))
    assert.equal(JSON.parse(localStorage.getItem('gtar_ext_band-sync_v1')).enabled, false)
    assert.equal(button('Band Sync'), undefined); assert.ok(document.querySelector('[aria-label="Stage Tools"]'))
    const restored = new ExtensionHost(registry, localStorage, { capabilities: caps }); await restored.start()
    assert.equal(restored.getSnapshot('band-sync').state, 'disabled'); restored.dispose()
  })
})
test('leader panel starts room and publishes projected song + transpose without key metadata', async () => {
  await ui(async ({ turnOn, click, button, sockets, calls, logs }) => {
    await turnOn(); await click(button('Start room'))
    assert.equal(sockets.length, 1); await act(async () => sockets[0].open())
    // SHA-256 publisher may finish after the socket opens.
    for (let i = 0; i < 100 && !(sockets[0].sent.some(m => m.type === 'STATE') && sockets[0].sent.some(m => m.type === 'CONTENT')); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 20)))
    const frames = sockets[0].sent
    assert.ok(frames.some(m => m.type === 'STATE' && m.payload.state.transposeOffset === 3))
    const content = frames.find(m => m.type === 'CONTENT'); assert.ok(content)
    assert.equal(content.payload.snapshot.transpose.effectiveKey, 'Eb')
    assert.ok(!JSON.stringify(frames).includes('original_key')); assert.ok(!JSON.stringify(frames).includes('ORIGINAL_KEY'))
    assert.ok(document.body.textContent.includes('ABCDEFGH')); assert.ok(button('End room'))
    await click(button('End room')); assert.equal(calls.at(-1).url, '/bandsync-api/end')
    assert.equal(sockets[0].closed, true); assert.deepEqual(logs, [])
  })
})
test('follower read-only overlay uses transposed chart once; disable clears it and never writes saved keys/library', async () => {
  await ui(async ({ host, turnOn, sockets, calls, library, originalSong }) => {
    await turnOn()
    const input = host.getSnapshot('band-sync').panel.inputs[0]
    await act(async () => input.change('ABCDEFGH'))
    await act(async () => host.getSnapshot('band-sync').panel.actions.find(a => a.label === 'Join with code').run())
    await act(async () => sockets[0].open())
    const chart = { songId: 'remote', displayTitle: 'Leader song', lines: [{ type: 'CHORD_PRO', raw: '[D]Remote words', segments: [{ chord: 'D', text: 'Remote words' }] }],
      chordsVisible: true, transpose: { offset: 2, effectiveKey: 'D' }, position: { lineIndex: 0 }, scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } }
    const state = { songId: 'remote', displayTitle: 'Leader song', contentHash: 'a'.repeat(64), transposeOffset: 2, effectiveKey: 'D', chordsVisible: true,
      setlist: { id: null, index: 0, count: 0 }, lineIndex: 0, scrollFraction: 0, autoscroll: { on: false, speed: 0 }, notation: 'chords' }
    await act(async () => sockets[0].receive({ version: 1, roomCode: 'ABCDEFGH', direction: 'SERVER_TO_CLIENT', sequence: 1, timestamp: 0, type: 'SNAPSHOT',
      payload: { state, content: { contentHash: state.contentHash, snapshot: chart }, leaderOnline: false } }))
    const overlay = document.querySelector('[aria-label="Band Sync read-only view"]')
    assert.ok(overlay); assert.ok(overlay.textContent.includes('Leader song')); assert.ok(overlay.textContent.includes('Key: D'))
    assert.ok(overlay.textContent.includes('Remote'), overlay.textContent); assert.ok(overlay.textContent.includes('words'), overlay.textContent)
    assert.equal(overlay.querySelectorAll('input,[role=button],[tabindex]').length, 0); assert.deepEqual([...overlay.querySelectorAll('button')].map(b => b.textContent.trim()), ['Full screen'])
    assert.equal(overlay.querySelector('.stage-chord-token').textContent, 'D')
    assert.ok(overlay.textContent.includes('Leader offline')); assert.equal(localStorage.getItem('fixture_library'), library); assert.equal(JSON.stringify(song), originalSong)
    const before = calls.length
    await act(async () => host.disable('band-sync'))
    assert.equal(sockets[0].closed, true); assert.equal(host.getBandRemote(), null)
    assert.equal(document.querySelector('[aria-label="Band Sync read-only view"]'), null)
    assert.equal(localStorage.getItem('fixture_library'), library); assert.equal(JSON.stringify(song), originalSong); assert.equal(calls.length, before)
  })
})
test('only band-sync can activate event capabilities; availability requires secure fetch + WebSocket; push entry is gated', async () => {
  const entry = { manifest: { id: 'unapproved', name: 'No', contractVersion: 1, capabilities: ['events:song'], settings: [] },
    checkAvailability: () => ({ available: true }), load: () => { throw Error('must not load') } }
  const host = new ExtensionHost([entry], { getItem: () => null, setItem() {} }, { capabilities: caps })
  await host.enable('unapproved'); assert.equal(host.getSnapshot('unapproved').state, 'unavailable')
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
  assert.equal(bandSyncAvailability().available, false)
  if (prior) Object.defineProperty(globalThis, 'isSecureContext', prior); else delete globalThis.isSecureContext
  const app = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
  for (const legacy of ['handlePushSetlistToMembers', 'onPushSetlistToBandSync', 'utils/bandSync\'', 'BandSyncModal', 'bandSync.onMessage']) assert.equal(app.includes(legacy), false, legacy)
  for (const gone of ['bandSync.ts', 'bandSyncAddress.ts', 'bandSetlistImport.ts', '../components/BandSyncModal.tsx']) assert.equal(fs.existsSync(require.resolve('../src/App.tsx').replace(/App\.tsx$/, gone)), false, gone)
})
test('QR hash OFF is scrubbed with zero transport and never joins after a later enable; ON joins once', async () => {
  await ui(async ({ calls, sockets, turnOn, dom }) => {
    assert.equal(dom.window.location.hash, ''); assert.equal(calls.length, 0); assert.equal(sockets.length, 0)
    await turnOn(); assert.equal(calls.length, 0); assert.equal(sockets.length, 0)
  }, { hash: '#bandsync=ABCDEFGH' })
  await ui(async ({ calls, sockets, dom, host }) => {
    assert.equal(dom.window.location.hash, '')
    assert.deepEqual(calls.map(c => c.url), ['/bandsync-api/join'])
    assert.deepEqual(calls[0].body, { roomCode: 'ABCDEFGH' }); assert.equal(sockets.length, 1)
    assert.equal(host.getSnapshot('band-sync').state, 'active')
  }, { hash: '#bandsync=ABCDEFGH', enabled: true, strictStart: true })
})
test('Stage publishes only setlist id/index/count and leader memory-only reload notice; QR contains no secrets', async t => {
  const encoded = []
  t.mock.method(require('qrcode'), 'toDataURL', async value => { encoded.push(value); return 'data:image/png;base64,cXJ0ZXN0' })
  await ui(async ({ turnOn, click, button, sockets, host }) => {
    await turnOn(); await click(button('Start room')); await act(async () => sockets[0].open())
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)))
    const state = sockets[0].sent.find(m => m.type === 'STATE').payload.state
    assert.deepEqual(state.setlist, { id: 'setlist-test', index: 1, count: 2 })
    assert.equal(JSON.stringify(sockets[0].sent).includes('Private setlist name'), false)
    assert.match(host.getSnapshot('band-sync').panel.fields.find(f => f.label === 'Room control').value, /keeps it after a refresh/)
    const qr = document.querySelector('img[alt="Band Sync join QR"]')
    assert.ok(qr); assert.match(qr.src, /^data:image\/png;base64,/)
    assert.deepEqual(encoded, ['https://gtar.test/#bandsync=ABCDEFGH'])
    assert.equal(encoded.join('').includes('c'.repeat(64)), false); assert.equal(encoded.join('').includes('b'.repeat(64)), false)
  }, { stage: { queueMode: 'setlist', isInSetlistMode: true, activeSetlistId: 'setlist-test', activeSetlistName: 'Private setlist name', activeSetlistSongIndex: 1, activeSetlistSongs: [song, { ...song, id: 'other' }] } })
})
test('create failures display fixed panel Status text; cookies are same-origin and details never reach the panel/log', async () => {
  for (const [response, expected] of [
    [() => Response.json({ error: 'synthetic-private-body' }, { status: 403 }), 'Rejected by server'],
    [() => Response.json({ error: 'synthetic-private-body' }, { status: 503 }), 'Band Sync is unavailable'],
    [() => { throw new TypeError('synthetic-private-network-detail') }, 'Could not reach Band Sync (network or sign-in)'],
  ]) await ui(async ({ turnOn, click, button, host, calls, sockets, logs }) => {
    assert.equal(calls.length, 0); assert.equal(sockets.length, 0)
    await turnOn(); await click(button('Start room'))
    assert.equal(host.getSnapshot('band-sync').panel.fields.find(f => f.label === 'Status').value, expected)
    assert.ok(document.body.textContent.includes(expected)); assert.equal(calls[0].credentials, 'same-origin')
    assert.equal(sockets.length, 0); assert.deepEqual(logs, [])
    assert.equal(document.body.textContent.includes('synthetic-private'), false)
  }, { response })
})
test('join input: normalizes typed codes, sets mobile keyboard attributes, Enter handler submits, button stays enabled, invalid code shows a message without network', async () => {
  await ui(async ({ host, turnOn, click, button, sockets, calls }) => {
    await turnOn()
    const field = () => document.querySelector('input[aria-label="Room code"]')
    assert.equal(field().getAttribute('autocapitalize'), 'characters'); assert.equal(field().getAttribute('autocorrect'), 'off')
    assert.equal(field().getAttribute('spellcheck'), 'false'); assert.equal(field().getAttribute('enterkeyhint'), 'go')
    assert.equal(button('Join with code').disabled, false)
    await click(button('Join with code'))
    assert.ok(document.body.textContent.includes('Enter the 8-character code'))
    assert.equal(calls.length, 0); assert.equal(sockets.length, 0)
    await act(async () => host.getSnapshot('band-sync').panel.inputs[0].change(' abcd-efgh '))
    assert.equal(field().value, 'ABCDEFGH')
    // React loads before this harness installs a DOM, so synthetic keydown is unavailable here: exercise the submit action and guard the handler source.
    const rows = fs.readFileSync(require.resolve('../src/extensions/host/ExtensionRows.tsx'), 'utf8')
    assert.match(rows, /event\.key === 'Enter' && input\.submit\) \{ event\.preventDefault\(\); input\.submit\(\)/)
    await act(async () => host.getSnapshot('band-sync').panel.inputs[0].submit())
    assert.equal(calls.at(-1).url, '/bandsync-api/join'); assert.equal(calls.at(-1).body.roomCode, 'ABCDEFGH'); assert.equal(sockets.length, 1)
  })
})

test('refresh keeps the room: extension ON resumes a saved leader or follower session; OFF does nothing', async () => {
  const leader = { v: 1, role: 'leader', roomCode: 'ABCDEFGH', savedAt: Date.now(), leaderCredential: 'c'.repeat(64) }
  await ui(async ({ calls, sockets }) => {
    assert.deepEqual(calls.map(c => [c.url, c.body]), [['/bandsync-api/ticket', { roomCode: 'ABCDEFGH', leaderCredential: 'c'.repeat(64) }]])
    assert.equal(sockets.length, 1); assert.equal(sessionStorage.getItem('gtar_band_sync_session_v1') !== null, true)
  }, { enabled: true, session: leader })
  await ui(async ({ calls, sockets }) => {
    assert.deepEqual(calls.map(c => [c.url, c.body]), [['/bandsync-api/join', { roomCode: 'ABCDEFGH' }]]); assert.equal(sockets.length, 1)
  }, { enabled: true, session: { v: 1, role: 'follower', roomCode: 'ABCDEFGH', savedAt: Date.now() } })
  await ui(async ({ calls, sockets }) => {
    assert.equal(calls.length, 0); assert.equal(sockets.length, 0)
  }, { session: leader })
})
test('turning the extension off ends and forgets the tab session', async () => {
  await ui(async ({ host, calls }) => {
    assert.equal(calls.length, 1); assert.ok(sessionStorage.getItem('gtar_band_sync_session_v1'))
    await act(async () => host.disable('band-sync'))
    assert.equal(sessionStorage.getItem('gtar_band_sync_session_v1'), null)
  }, { enabled: true, session: { v: 1, role: 'follower', roomCode: 'ABCDEFGH', savedAt: Date.now() } })
})
