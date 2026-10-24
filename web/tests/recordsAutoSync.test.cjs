// RFC #188 S6: automatic per-record sync — one leader tab, paused while blocked, catches up after.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!DOCTYPE html><div id="a"></div><div id="b"></div>', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })

// Minimal exclusive Web Locks: queued requests are granted when the holder's promise settles.
function lockManager() {
  const held = new Map()
  return {
    request(name, ...args) {
      const fn = args[args.length - 1]
      const run = async () => { try { return await fn({ name }) } finally {
        const queue = held.get(name); queue.shift(); if (queue.length) queue[0]() ; else held.delete(name) } }
      return new Promise((resolve, reject) => {
        const start = () => run().then(resolve, reject)
        if (!held.has(name)) { held.set(name, [start]); start() } else held.get(name).push(start)
      })
    },
  }
}
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', onLine: true, locks: lockManager() }, configurable: true, writable: true })

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { useRecordsAutoSync } = require('../src/utils/useRecordsAutoSync.ts')
const { setRecordsSyncEnabled } = require('../src/utils/recordsSync.ts')

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let roots = []
beforeEach(() => { localStorage.clear(); setRecordsSyncEnabled(true); roots = [] })
afterEach(() => { for (const root of roots) act(() => root.unmount()) })

function mount(el, props) {
  const root = createRoot(document.getElementById(el))
  roots.push(root)
  function Probe(p) { useRecordsAutoSync(p); return null }
  act(() => root.render(React.createElement(Probe, props)))
  return { root, rerender: next => act(() => root.render(React.createElement(Probe, next))) }
}
const result = (extra = {}) => ({ success: true, status: 'IN_SYNC', state: 'SAME_STATE', actionTaken: 'NONE', ...extra })

test('only the leader tab syncs; a save schedules one debounced run', async () => {
  const calls = { a: 0, b: 0 }
  mount('a', { enabled: true, token: 't', blocked: false, debounceMs: 20, sync: async () => { calls.a++; return result() } })
  mount('b', { enabled: true, token: 't', blocked: false, debounceMs: 20, sync: async () => { calls.b++; return result() } })
  await act(async () => { await wait(60) })
  assert.equal(calls.a, 1, 'leader runs once on taking the lead')
  assert.equal(calls.b, 0, 'follower never runs')
  await act(async () => { for (let i = 0; i < 3; i++) window.dispatchEvent(new window.Event('gtar-library-persisted')); await wait(60) })
  assert.equal(calls.a, 2, 'three saves, one debounced run')
})

test('when the leader tab goes away, another tab takes over', async () => {
  const calls = { a: 0, b: 0 }
  mount('a', { enabled: true, token: 't', blocked: false, debounceMs: 10, sync: async () => { calls.a++; return result() } })
  mount('b', { enabled: true, token: 't', blocked: false, debounceMs: 10, sync: async () => { calls.b++; return result() } })
  await act(async () => { await wait(40) })
  act(() => roots[0].unmount()); roots.shift()
  await act(async () => { await wait(40) })
  assert.equal(calls.b, 1)
})

test('blocked (editor open / conflict): no run; unblocking catches up', async () => {
  let calls = 0
  const props = { enabled: true, token: 't', blocked: true, debounceMs: 10, sync: async () => { calls++; return result() } }
  const view = mount('a', props)
  await act(async () => { window.dispatchEvent(new window.Event('gtar-library-persisted')); await wait(40) })
  assert.equal(calls, 0)
  view.rerender({ ...props, blocked: false })
  await act(async () => { await wait(40) })
  assert.equal(calls, 1)
})

test('applied remote changes reach the app; status is reported', async () => {
  const applied = [], states = []
  const library = { songs: [], setlists: [] }
  mount('a', { enabled: true, token: 't', blocked: false, debounceMs: 10, onApplied: lib => applied.push(lib),
    onState: (status, busy) => states.push(`${status}:${busy}`), sync: async () => result({ actionTaken: 'DOWNLOADED', updatedLibrary: library }) })
  await act(async () => { await wait(40) })
  assert.deepEqual(applied, [library])
  assert.deepEqual(states, ['SYNCING:true', 'IN_SYNC:false'])
})

test('off when the per-record engine is off, signed out or offline', async () => {
  let calls = 0
  const sync = async () => { calls++; return result() }
  setRecordsSyncEnabled(false)
  mount('a', { enabled: true, token: 't', blocked: false, debounceMs: 10, sync })
  await act(async () => { await wait(40) })
  act(() => roots[0].unmount()); roots.shift()
  setRecordsSyncEnabled(true)
  mount('a', { enabled: true, token: null, blocked: false, debounceMs: 10, sync })
  await act(async () => { await wait(40) })
  act(() => roots[0].unmount()); roots.shift()
  navigator.onLine = false
  mount('a', { enabled: true, token: 't', blocked: false, debounceMs: 10, sync })
  await act(async () => { await wait(40) })
  navigator.onLine = true
  assert.equal(calls, 0)
})

// #208 F6: the editor opening while a sync is in flight must not receive that sync's result.
test('#208 F6: a result arriving while blocked is held, then delivered once the block ends', async () => {
  const applied = []
  let release
  const lib = { songs: [{ id: 'x', title: 'Remote edit', artist: '', rawContent: '' }], setlists: [] }
  const props = { enabled: true, token: 't', blocked: false, debounceMs: 10, onApplied: l => applied.push(l),
    sync: () => new Promise(resolve => { release = () => resolve(result({ actionTaken: 'DOWNLOADED', updatedLibrary: lib })) }) }
  const view = mount('a', props)
  await act(async () => { await wait(30) })
  view.rerender({ ...props, blocked: true }) // editor opens mid-flight
  await act(async () => { release(); await wait(10) })
  assert.equal(applied.length, 0, 'nothing applied under the open editor')
  view.rerender({ ...props, blocked: false, sync: async () => result() })
  await act(async () => { await wait(30) })
  assert.deepEqual(applied, [lib], 'delivered after the editor closes')
})

test('#208 F6: the sync is told to defer applying while blocked', async () => {
  let canApply
  const props = { enabled: true, token: 't', blocked: false, debounceMs: 10,
    sync: async (_token, options) => { canApply = options.canApply; return result({ deferred: true, status: 'IDLE' }) } }
  const view = mount('a', props)
  await act(async () => { await wait(30) })
  assert.equal(canApply(), true)
  view.rerender({ ...props, blocked: true })
  assert.equal(canApply(), false, 'reads the live block state')
})

// #208 F6 (re-audit): results are delivered only while the revision they wrote is still current.
test('#208 F6: a stale result (newer local save since) is not delivered, and sync runs again', async () => {
  const applied = []
  let revision = 'r2-newer-save', runs = 0
  const lib = { songs: [{ id: 'x', title: 'Stale', artist: '', rawContent: '' }], setlists: [] }
  mount('a', { enabled: true, token: 't', blocked: false, debounceMs: 10, revision: () => revision, onApplied: l => applied.push(l),
    sync: async () => { runs++; return runs === 1 ? result({ actionTaken: 'DOWNLOADED', updatedLibrary: lib, appliedRevision: 'r1-sync-write' }) : result() } })
  await act(async () => { await wait(80) })
  assert.equal(applied.length, 0, 'stale library never handed to the app')
  assert.ok(runs >= 2, 'a fresh sync follows')
  revision = 'r3'
})

test('#208 F6: a result held while blocked is dropped if a newer save lands before the block ends', async () => {
  const applied = []
  let revision = 'r1', release
  const lib = { songs: [], setlists: [] }
  const props = { enabled: true, token: 't', blocked: false, debounceMs: 10, revision: () => revision, onApplied: l => applied.push(l),
    sync: () => new Promise(resolve => { release = () => resolve(result({ actionTaken: 'DOWNLOADED', updatedLibrary: lib, appliedRevision: 'r1' })) }) }
  const view = mount('a', props)
  await act(async () => { await wait(30) })
  view.rerender({ ...props, blocked: true })
  await act(async () => { release(); await wait(10) })
  revision = 'r2' // the editor saved
  view.rerender({ ...props, blocked: false, sync: async () => result() })
  await act(async () => { await wait(30) })
  assert.equal(applied.length, 0)
})

test('#208 F6: App adopts the stored library on a sync result, never the sync copy over a newer save', () => {
  const app = fs.readFileSync(require('node:path').join(__dirname, '../src/App.tsx'), 'utf8')
  const handler = app.slice(app.indexOf('onCloudSyncApplied={(updated) => {'), app.indexOf("setToastMessage('Songbook synced with Cloud')"))
  assert.match(handler, /const stored = readPersistedLibrary\(\) \?\? updated/)
  assert.match(handler, /partitionSongs\(stored\.songs\)/)
  assert.match(handler, /setSetlists\(stored\.setlists\)/)
})
