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
