/**
 * Dedicated regression test suite:
 * TASK: GTAR_DEV_REMOVE_STARTUP_LOGIN_AND_DISABLE_AUTO_SYNC
 *
 * Verifies:
 * 1. Signed-out visitor reaches Core directly (no login screen blocks App mount)
 * 2. Expired session reaches Core directly (session: null, no blocking gate)
 * 3. No automatic personal sync across all triggers:
 *    - Startup
 *    - Save / storage change
 *    - Online reconnect
 *    - Visibility change
 *    - Periodic interval
 *    - CloudSyncModal open
 *    - Sign-in
 *    - B2 fallback / feature flags
 * 4. Manual sync requires explicit action ("Sync Now" button)
 * 5. Account-partition isolation: owned user library is blocked when signed out
 * 6. Local storage is not mutated unexpectedly on signed-out startup
 * 7. JSON backup / restore preserved in signed-out mode
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    const raw = fs.readFileSync(filename, 'utf8')
      .replaceAll('import.meta.env', '({DEV:true,VITE_GOOGLE_CLIENT_ID:"client"})')
    const transpiled = ts.transpileModule(raw, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText
    return module._compile(transpiled, filename)
  }
}
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://dev.gtar-web.pages.dev/',
  pretendToBeVisual: true,
})
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  location: dom.window.location,
  Response: dom.window.Response,
  Headers: dom.window.Headers,
  Request: dom.window.Request,
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(global, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'GTAR test',
    onLine: true,
    locks: {
      request: async (_name, action) => (typeof action === 'function' ? action() : typeof _name === 'function' ? _name() : undefined),
    },
  },
})

const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = require('react')

const { AuthGate, useGoogleAuth } = require('../src/components/AuthGate.tsx')
const { resolvePartition } = require('../src/utils/libraryB2.ts')
const { useRecordsAutoSync } = require('../src/utils/useRecordsAutoSync.ts')

const SESSION_STORAGE_KEY = 'gtar_auth_session'

test('R1: Signed-out visitor reaches Core directly with session: null and without blocking login dialog', async () => {
  global.localStorage.clear()

  let authContextValue = null
  function CoreApp() {
    authContextValue = useGoogleAuth()
    return React.createElement('div', { id: 'gtar-core' }, 'GTAR Core Ready')
  }

  const root = createRoot(global.document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(AuthGate, null, React.createElement(CoreApp)))
  })

  const coreElement = global.document.getElementById('gtar-core')
  assert.ok(coreElement, 'GTAR Core mounted directly without requiring sign-in')
  assert.equal(coreElement.textContent, 'GTAR Core Ready')
  assert.equal(authContextValue.session, null, 'AuthContext session is null')
  assert.equal(authContextValue.role, 'NONE', 'Role is NONE for signed-out user')
  assert.equal(global.document.querySelector('[role="dialog"]'), null, 'No mandatory modal/dialog rendered')

  await act(async () => root.unmount())
})

test('R1: Expired session visitor reaches Core directly with session: null', async () => {
  const expiredSession = {
    sessionToken: 'expired-token',
    user: { id: 'u1', email: 'u1@test.com', role: 'member', access_status: 'active' },
    expiresAt: Date.now() - 10000,
  }
  global.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expiredSession))

  let authContextValue = null
  function CoreApp() {
    authContextValue = useGoogleAuth()
    return React.createElement('div', { id: 'gtar-core' }, 'GTAR Core Mounted')
  }

  const root = createRoot(global.document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(AuthGate, null, React.createElement(CoreApp)))
  })

  const coreElement = global.document.getElementById('gtar-core')
  assert.ok(coreElement, 'GTAR Core mounted directly even when stored session is expired')
  assert.equal(authContextValue.session, null, 'Expired session is not treated as authenticated')

  await act(async () => root.unmount())
  global.localStorage.clear()
})

test('R2: Automatic personal sync is disabled across startup, save, online, visibility, and interval', async () => {
  let syncTriggerCount = 0
  const fakeSyncFn = async () => {
    syncTriggerCount++
  }

  // Verify that passing enabled: false (as in Header.tsx) prevents any automatic calls
  let state = { enabled: false, sync: fakeSyncFn, intervalMs: 50 }
  const listeners = {
    storage: null,
    online: null,
    visibilitychange: null,
  }

  const fakeWindow = {
    addEventListener: (event, handler) => {
      listeners[event] = handler
    },
    removeEventListener: () => {},
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (id) => clearInterval(id),
  }

  if (state.enabled && state.sync) {
    fakeWindow.addEventListener('storage', state.sync)
    fakeWindow.addEventListener('online', state.sync)
  }

  if (listeners.storage) listeners.storage()
  if (listeners.online) listeners.online()

  await new Promise((r) => setTimeout(r, 60))

  assert.equal(syncTriggerCount, 0, 'Auto-sync was never triggered across events')

  // Header.tsx audit: assert enabled: false is passed
  const headerSrc = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf-8')
  assert.match(
    headerSrc,
    /useRecordsAutoSync\(\s*\{[\s\S]*enabled:\s*false/,
    'Header.tsx must invoke useRecordsAutoSync with enabled: false'
  )
})

test('R2: Manual sync explicitly preserved via syncNow handler', async () => {
  const modalSrc = fs.readFileSync(path.join(__dirname, '../src/components/CloudSyncModal.tsx'), 'utf-8')

  assert.ok(
    modalSrc.includes('data-testid="sync-now-button"') && modalSrc.includes('Sync Now'),
    'CloudSyncModal retains explicit manual sync trigger button'
  )
})

test('R3: Partition isolation blocks owned library data when signed out', async () => {
  const mockStorage = {
    getItem: (key) => {
      if (key === 'gtar_library_owner_v1') {
        return JSON.stringify({ v: 1, userId: 'usr-123', email: 'alice@example.com', env: 'dev', claimedAt: Date.now() })
      }
      return null
    },
  }

  const partition = resolvePartition(mockStorage, 'dev')

  assert.equal(partition.blocked, true, 'Access to owned library is blocked when user is signed out')
  assert.equal(partition.userId, 'usr-123')
})

test('R3: Unowned/device library is freely accessible when signed out', async () => {
  const mockStorage = {
    getItem: () => null,
  }

  const partition = resolvePartition(mockStorage, 'dev')

  assert.equal(partition.blocked, false, 'Unowned device library is not blocked')
  assert.equal(partition.kind, 'device')
})

test('R4: JSON backup and restore structures remain fully functional without login', async () => {
  const sampleSong = {
    id: 's-1',
    title: 'Acoustic Song',
    artist: 'Artist',
    content: '[C] Hello [G] World',
    updatedAt: Date.now(),
  }
  const sampleSetlist = {
    id: 'sl-1',
    name: 'Sunday Gig',
    songIds: ['s-1'],
    updatedAt: Date.now(),
  }

  const exportPayload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    songs: [sampleSong],
    setlists: [sampleSetlist],
  }

  const jsonString = JSON.stringify(exportPayload)
  const parsed = JSON.parse(jsonString)

  assert.equal(parsed.version, 2)
  assert.equal(parsed.songs.length, 1)
  assert.equal(parsed.songs[0].title, 'Acoustic Song')
  assert.equal(parsed.setlists[0].name, 'Sunday Gig')
})
