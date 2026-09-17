const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
      }).outputText,
      filename
    )
}

const {
  LIBRARY_KEY,
  CANONICAL_STORAGE_PREFIXES,
  isCanonicalKey,
  isQuotaError,
  persistLibrary,
  recoveryData,
  requestDurableStorage,
  setupCrossTabLibraryConflictGuard
} = require('../src/utils/syncJournal.ts')
const { SETTINGS_KEYS } = require('../src/utils/backupSettings.ts')

function createMockStorage() {
  const store = new Map()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size },
    store
  }
}

// ----------------------------------------------------------------------------
// GAP 4: Canonical storage prefixes align with actual settings keys
// ----------------------------------------------------------------------------
test('CANONICAL_STORAGE_PREFIXES includes current settings keys and legacy keys', () => {
  // Current settings keys from SETTINGS_KEYS
  assert.equal(isCanonicalKey(SETTINGS_KEYS.themeMode), true, 'gtar_theme_store must be canonical')
  assert.equal(isCanonicalKey(SETTINGS_KEYS.fontStyle), true, 'gtar_font_style_store must be canonical')
  assert.equal(isCanonicalKey(SETTINGS_KEYS.isTwoColumn), true, 'gtar_twocolumn_store must be canonical')
  assert.equal(isCanonicalKey(SETTINGS_KEYS.fontSizePx), true, 'gtar_stage_font_size must be canonical')
  assert.equal(isCanonicalKey(SETTINGS_KEYS.scrollSpeed), true, 'gtar_stage_scroll_speed must be canonical')
  assert.equal(isCanonicalKey(SETTINGS_KEYS.customThemeColors), true, 'gtar_custom_theme_colors must be canonical')

  // Legacy keys must still be recognized to prevent accidental purging
  assert.equal(isCanonicalKey('gtar_theme_mode'), true, 'legacy gtar_theme_mode must remain canonical')
  assert.equal(isCanonicalKey('gtar_font_style'), true, 'legacy gtar_font_style must remain canonical')
  assert.equal(isCanonicalKey('gtar_is_two_column'), true, 'legacy gtar_is_two_column must remain canonical')

  // Non-canonical random keys must not match
  assert.equal(isCanonicalKey('random_temp_key'), false, 'random key must not be canonical')
  assert.equal(isCanonicalKey('gtar_sync_recovery:some_session'), false, 'recovery key is not canonical prefix')
})

// ----------------------------------------------------------------------------
// GAP 2: Best-effort durable storage request (navigator.storage?.persist?.())
// ----------------------------------------------------------------------------
test('requestDurableStorage handles missing navigator or storage gracefully', async () => {
  // In Node environment without global navigator
  const originalNav = global.navigator
  try {
    delete global.navigator
    const result = await requestDurableStorage()
    assert.equal(result, false, 'Should return false when navigator is undefined')
  } finally {
    global.navigator = originalNav
  }
})

test('requestDurableStorage feature-detects and returns true when already persisted', async () => {
  const originalNav = global.navigator
  try {
    global.navigator = {
      storage: {
        persisted: async () => true,
        persist: async () => { throw new Error('should not be called if already persisted') }
      }
    }
    const result = await requestDurableStorage()
    assert.equal(result, true, 'Should return true when storage is already persisted')
  } finally {
    global.navigator = originalNav
  }
})

test('requestDurableStorage requests persist when not yet persisted', async () => {
  const originalNav = global.navigator
  let persistCalled = false
  try {
    global.navigator = {
      storage: {
        persisted: async () => false,
        persist: async () => {
          persistCalled = true
          return true
        }
      }
    }
    const result = await requestDurableStorage()
    assert.equal(persistCalled, true, 'persist() must be called')
    assert.equal(result, true, 'Should return true on successful persist')
  } finally {
    global.navigator = originalNav
  }
})

test('requestDurableStorage failure or denial does not throw or break startup', async () => {
  const originalNav = global.navigator
  try {
    // Simulated denial
    global.navigator = {
      storage: {
        persisted: async () => false,
        persist: async () => false
      }
    }
    const denialResult = await requestDurableStorage()
    assert.equal(denialResult, false, 'Should return false on denial without throwing')

    // Simulated error/exception
    global.navigator = {
      storage: {
        persisted: async () => { throw new Error('Storage permission error') },
        persist: async () => { throw new Error('Storage permission error') }
      }
    }
    const errorResult = await requestDurableStorage()
    assert.equal(errorResult, false, 'Should return false on error without throwing')
  } finally {
    global.navigator = originalNav
  }
})

// ----------------------------------------------------------------------------
// GAP 3: Cross-tab storage conflict protection on gtar_library_v1
// ----------------------------------------------------------------------------
class MockEventTarget {
  constructor() {
    this.listeners = new Map()
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }
  removeEventListener(type, listener) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(listener)
  }
  dispatchEvent(type, event) {
    if (!this.listeners.has(type)) return
    for (const listener of this.listeners.get(type)) {
      listener(event)
    }
  }
}

test('setupCrossTabLibraryConflictGuard detects external write on gtar_library_v1 only', () => {
  const mockWindow = new MockEventTarget()
  const conflicts = []
  const cleanup = setupCrossTabLibraryConflictGuard((raw) => {
    conflicts.push(raw)
  }, mockWindow)

  // Disrelated storage keys must be ignored
  mockWindow.dispatchEvent('storage', { key: 'gtar_theme_store', newValue: '"paper-light"' })
  mockWindow.dispatchEvent('storage', { key: 'gtar_active_setlist_id', newValue: '"set-2"' })
  assert.equal(conflicts.length, 0, 'Must not fire on keys other than gtar_library_v1')

  // External write to gtar_library_v1 is detected
  const externalData = JSON.stringify({ songs: [{ id: 'ext1', title: 'Remote Song', rawContent: '...' }], setlists: [] })
  mockWindow.dispatchEvent('storage', { key: LIBRARY_KEY, newValue: externalData })
  assert.equal(conflicts.length, 1, 'Must detect change on gtar_library_v1')
  assert.equal(conflicts[0], externalData)

  // Listener is cleanly removed on cleanup (unmount)
  cleanup()
  mockWindow.dispatchEvent('storage', { key: LIBRARY_KEY, newValue: 'subsequent_data' })
  assert.equal(conflicts.length, 1, 'Must not fire after cleanup has been called')
})

// ----------------------------------------------------------------------------
// GAP 1: Persist failure feedback and state preservation
// ----------------------------------------------------------------------------
test('persistLibrary write failure retains in-memory state and recovery data', () => {
  const store = createMockStorage()
  const baseLibrary = { songs: [{ id: 's1', title: 'Song 1', rawContent: 'content 1' }], setlists: [] }
  persistLibrary(baseLibrary, store)

  // Seed recovery snapshots and active state
  store.setItem('gtar_sync_recovery:account:snap1', '{"local":{"songs":[],"setlists":[]},"remote":null}')
  const beforeRecovery = recoveryData(store)
  assert.ok(beforeRecovery['gtar_sync_recovery:account:snap1'])

  // Simulate quota failure when saving large updated library
  const oversizedLibrary = {
    songs: [{ id: 's1', title: 'Updated Song 1', rawContent: 'updated content' }],
    setlists: []
  }

  // Force quota exceeded error on setItem
  const quotaErr = new Error('QuotaExceededError')
  quotaErr.name = 'QuotaExceededError'
  const originalSetItem = store.setItem
  store.setItem = (k, v) => {
    if (k === LIBRARY_KEY) throw quotaErr
    return originalSetItem.call(store, k, v)
  }

  let errorCaught = null
  try {
    persistLibrary(oversizedLibrary, store)
  } catch (e) {
    errorCaught = e
  }

  assert.ok(errorCaught !== null, 'persistLibrary must throw when quota fails retry')
  assert.equal(isQuotaError(errorCaught), true, 'Error must be identified as quota error')

  // Existing recovery data in storage was NOT wiped
  store.setItem = originalSetItem
  const afterRecovery = recoveryData(store)
  assert.equal(afterRecovery['gtar_sync_recovery:account:snap1'], beforeRecovery['gtar_sync_recovery:account:snap1'])

  // In-memory data object is completely intact
  assert.equal(oversizedLibrary.songs[0].title, 'Updated Song 1')
})
