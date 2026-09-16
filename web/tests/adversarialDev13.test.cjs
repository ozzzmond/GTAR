const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const { persistLibrary } = require('../src/utils/syncJournal.ts')

function mockStorage() {
  const values = new Map()
  const log = []
  return {
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => {
      log.push({ op: 'set', key: k, size: (k.length + String(v).length) * 2 })
      values.set(k, String(v))
    },
    removeItem: k => {
      log.push({ op: 'remove', key: k })
      values.delete(k)
    },
    key: i => [...values.keys()][i] ?? null,
    get length() { return values.size },
    values,
    log,
  }
}

// =========================================================================
// SCENARIO 5: Near-Quota Migration Edge Case (Legacy stores are sole source)
// =========================================================================
test('Adversarial 5: Near-quota migration edge case where legacy stores are sole source never deletes gtar_songs_store', () => {
  const store = mockStorage()
  const soleSourceSongs = [
    { id: 'legacy-1', title: 'Irreplaceable Song 1', rawContent: 'chords 1' },
    { id: 'legacy-2', title: 'Irreplaceable Song 2', rawContent: 'chords 2' },
  ]
  store.setItem('gtar_songs_store', JSON.stringify(soleSourceSongs))
  store.setItem('gtar_setlists_store', JSON.stringify([{ id: 'set-1', name: 'Main', songIds: ['legacy-1'] }]))

  // Storage is at quota: writing gtar_library_v1 throws QuotaExceededError permanently
  const quotaStore = {
    ...store,
    setItem(k, v) {
      if (k === 'gtar_library_v1') {
        const err = new Error('QuotaExceededError: storage limit reached')
        err.name = 'QuotaExceededError'
        err.code = 22
        throw err
      }
      store.setItem(k, v)
    },
  }

  assert.throws(() => {
    persistLibrary({ songs: soleSourceSongs, setlists: [] }, quotaStore)
  }, /quota exceeded/i)

  // CRITICAL VERIFICATION: gtar_songs_store MUST STILL EXIST and be 100% intact!
  const surviving = store.getItem('gtar_songs_store')
  assert.ok(surviving, 'gtar_songs_store must NEVER be deleted when it is sole source!')
  assert.deepEqual(JSON.parse(surviving), soleSourceSongs)
  assert.ok(store.getItem('gtar_setlists_store'), 'gtar_setlists_store must also be preserved')
})

// =========================================================================
// SCENARIO 6: Near-Quota Cleanup Precedence
// =========================================================================
test('Adversarial 6: Near-quota cleanup precedence prunes expendables first and records exact order', () => {
  const store = mockStorage()
  const validLib = { songs: [{ id: '1', title: 'Saved Song', rawContent: 'content' }], setlists: [] }
  store.setItem('gtar_library_v1', JSON.stringify(validLib))
  store.setItem('gtar_sync_recovery:acc:1_snap', 'snap1')
  store.setItem('gtar_sync_recovery:acc:2_snap', 'snap2')
  store.setItem('gtar_sync_recovery:other:3_snap', 'snap3')
  store.setItem('gtar_web_debug_logs', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, message: `log ${i}` }))))
  store.setItem('gtar_songs_store', 'duplicate legacy data')
  store.setItem('gtar_trash_songs_store', 'duplicate legacy trash')
  store.setItem('gtar_setlists_store', 'duplicate legacy setlists')
  store.setItem('gtar_theme_mode', '"dark"')
  store.setItem('gtar_sync_library_owner', 'acc')

  const removedKeys = []
  let throwCount = 1
  const quotaStore = {
    ...store,
    removeItem(k) {
      removedKeys.push(k)
      store.removeItem(k)
    },
    setItem(k, v) {
      if (k === 'gtar_library_v1' && throwCount > 0) {
        throwCount--
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        err.code = 22
        throw err
      }
      store.setItem(k, v)
    },
  }

  persistLibrary({ songs: [{ id: '1', title: 'Saved Song Edited', rawContent: 'content 2' }], setlists: [] }, quotaStore)

  // Only disposable logs are trimmed; every recovery source survives.
  assert.deepEqual(removedKeys, [])
  const logs = JSON.parse(store.getItem('gtar_web_debug_logs'))
  assert.equal(logs.length, 10)
  for (const key of ['gtar_songs_store', 'gtar_trash_songs_store', 'gtar_setlists_store', 'gtar_sync_recovery:acc:1_snap', 'gtar_sync_recovery:acc:2_snap', 'gtar_sync_recovery:other:3_snap']) assert.ok(store.getItem(key))
  // 4. Canonical user data keys were preserved
  assert.ok(store.getItem('gtar_library_v1'))
  assert.equal(store.getItem('gtar_theme_mode'), '"dark"')
  assert.equal(store.getItem('gtar_sync_library_owner'), 'acc')
})
