const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)
const { persistLibrary, LIBRARY_KEY, getLastKnownPersistedLibraryRaw, performStorageHousekeeping, StaleWriteConflictError, isQuotaError } = require('../src/utils/syncJournal.ts')
const base = { songs: [{ id: 'song', title: 'Original', key: 'C', rawContent: '[C]text' }], setlists: [] }
const changed = { songs: [{ ...base.songs[0], title: 'Changed' }], setlists: [] }
const quota = () => Object.assign(new Error('full'), { name: 'QuotaExceededError' })
function storage() {
  const data = new Map([[LIBRARY_KEY, JSON.stringify(base)]])
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), key: index => [...data.keys()][index] ?? null, get length() { return data.size } }
}
test('identical canonical library skips writes without rewriting pretty JSON or advancing stale content', () => {
  const store = storage(), raw = JSON.stringify(base, null, 2)
  store.data.set(LIBRARY_KEY, raw)
  store.setItem = () => { throw new Error('must not write') }
  persistLibrary(base, store, { expectedRaw: 'older but identical desired content' })
  assert.equal(store.getItem(LIBRARY_KEY), raw)
  assert.equal(getLastKnownPersistedLibraryRaw(store), raw)
  assert.throws(() => persistLibrary(changed, store, { expectedRaw: 'stale' }), StaleWriteConflictError)
})
test('successful saves retain represented archives, restore snapshots and tombstones', () => {
  const store = storage()
  const archived = JSON.stringify(base)
  for (const key of ['gtar_sync_recovery:plain', 'gtar_restore_safety_snapshot_v1', 'gtar_sync_recovery:replacement:1']) store.setItem(key, archived)
  const deleted = { ...base.songs[0], id: 'deleted', isDeleted: true }
  persistLibrary({ ...changed, songs: [...changed.songs, deleted] }, store)
  for (const [key, value] of store.data) if (key !== LIBRARY_KEY) assert.equal(value, archived)
  assert.deepEqual(JSON.parse(store.getItem(LIBRARY_KEY)).songs[1], deleted)
})
for (const failure of ['quota', 'security', 'silent', 'readback']) test(`${failure} save failure never advances baseline or removes recovery`, () => {
  const store = storage()
  persistLibrary(base, store)
  const baseline = getLastKnownPersistedLibraryRaw(store)
  store.setItem('gtar_sync_recovery:plain', JSON.stringify(base))
  const before = new Map(store.data), write = store.setItem, read = store.getItem
  let attempted = false
  store.setItem = (key, value) => {
    if (key !== LIBRARY_KEY) return write(key, value)
    attempted = true
    if (failure === 'quota') throw quota()
    if (failure === 'security') throw Object.assign(new Error('denied'), { name: 'SecurityError' })
    // Simulate a silently discarded write; readback can also be denied.
  }
  store.getItem = key => { if (failure === 'readback' && attempted && key === LIBRARY_KEY) throw new Error('read denied'); return read(key) }
  let error
  try { persistLibrary(changed, store, { expectedRaw: baseline }) } catch (err) { error = err }
  assert.ok(error)
  assert.equal(isQuotaError(error), failure === 'quota')
  assert.equal(getLastKnownPersistedLibraryRaw(store), baseline)
  assert.deepEqual(store.data, before)
})
test('quota retry preserves a subsequent non-quota failure', () => {
  const store = storage(), denied = Object.assign(new Error('denied'), { name: 'SecurityError' })
  let attempts = 0
  store.setItem = () => { if (++attempts === 1) throw quota(); throw denied }
  assert.throws(() => persistLibrary(changed, store), error => error === denied)
  assert.equal(attempts, 2)
})
test('quota relief retry checks for intervening external changes', () => {
  const store = storage(), external = JSON.stringify({ songs: [], setlists: [] })
  let attempts = 0
  store.setItem = () => { attempts++; store.data.set(LIBRARY_KEY, external); throw quota() }
  assert.throws(() => persistLibrary(changed, store), StaleWriteConflictError)
  assert.equal(attempts, 1)
  assert.equal(store.getItem(LIBRARY_KEY), external)
})
test('read access failure fails closed without attempting a write', () => {
  const store = storage()
  store.getItem = () => { throw new Error('read blocked') }
  store.setItem = () => assert.fail('must not write')
  assert.throws(() => persistLibrary(changed, store), /read blocked/)
})

test('startup housekeeping retains plain recovery archives and restore snapshots', () => {
  const store = storage()
  store.setItem('gtar_sync_recovery:plain', JSON.stringify(base))
  store.setItem('gtar_restore_safety_snapshot_v1', JSON.stringify(base))
  const before = new Map(store.data)
  performStorageHousekeeping(store)
  assert.deepEqual(store.data, before)
})

test('optional undefined editor fields do not cause a second synchronous library write', () => {
  const store = storage(), write = store.setItem
  let writes = 0
  store.setItem = (key, value) => { writes++; return write(key, value) }
  const candidate = { songs: [{ ...changed.songs[0], originalKey: undefined, time: undefined, year: undefined }], setlists: [] }
  persistLibrary(candidate, store)
  assert.equal(writes, 1)
  persistLibrary(candidate, store)
  assert.equal(writes, 1, 'React effect after explicit save must not rewrite the same serialized payload')
})
