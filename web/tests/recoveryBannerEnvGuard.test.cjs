const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  if (!require.extensions[ext]) {
    require.extensions[ext] = (module, filename) => {
      const src = fs.readFileSync(filename, 'utf8')
      const transpiled = ts.transpileModule(src.replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText
      module._compile(transpiled, filename)
    }
  }
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

function clearAppRequireCache() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('App.tsx') || k.includes('utils\\env') || k.includes('utils/env')) {
      delete require.cache[k]
    }
  }
}

function setupDom(url) {
  const dom = new JSDOM('<div id="root"></div>', { url })
  dom.window.matchMedia = dom.window.matchMedia || function() {
    return {
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
  }
  const prior = {
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    sessionStorage: global.sessionStorage,
    matchMedia: global.matchMedia,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  }
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    matchMedia: dom.window.matchMedia,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  return { dom, prior }
}

test('RECOVERY_BANNER_DEV: localhost renders global recovery data warning banner when recovery data present', async () => {
  clearAppRequireCache()
  const { dom, prior } = setupDom('http://localhost:5173/')

  // Valid library present in localStorage
  const validLibrary = {
    songs: [{ id: 's1', title: 'Test Song', artist: 'Artist', chords: 'C G', key: 'C', bpm: '120' }],
    setlists: [],
  }
  localStorage.setItem('gtar_library', JSON.stringify(validLibrary))
  // Recovery snapshot present
  localStorage.setItem('gtar_sync_recovery:snap1', JSON.stringify({ local: validLibrary, remote: null }))

  const root = createRoot(document.getElementById('root'))
  try {
    const App = require('../src/App.tsx').default
    await act(async () => root.render(React.createElement(App)))
    const alertAside = document.querySelector('aside[role="alert"]')
    assert.ok(alertAside, 'Dev/localhost must render recovery banner aside')
    assert.match(alertAside.textContent, /Recovery data is available/)
    assert.match(alertAside.textContent, /Export recovery data/)
  } finally {
    await act(async () => root.unmount())
    Object.assign(global, prior)
    dom.window.close()
  }
})

test('RECOVERY_BANNER_PROD: production URL does NOT render global recovery data banner when library is intact', async () => {
  clearAppRequireCache()
  const { dom, prior } = setupDom('https://gtar.app/')

  // Valid library + recovery snapshot in localStorage
  const validLibrary = {
    songs: [{ id: 's1', title: 'Test Song', artist: 'Artist', chords: 'C G', key: 'C', bpm: '120' }],
    setlists: [],
  }
  localStorage.setItem('gtar_library', JSON.stringify(validLibrary))
  localStorage.setItem('gtar_sync_recovery:snap1', JSON.stringify({ local: validLibrary, remote: null }))
  const rawRecoveryBefore = localStorage.getItem('gtar_sync_recovery:snap1')

  const root = createRoot(document.getElementById('root'))
  try {
    const App = require('../src/App.tsx').default
    await act(async () => root.render(React.createElement(App)))
    const alertAside = document.querySelector('aside[role="alert"]')
    assert.equal(alertAside, null, 'Production UI must NOT render recovery warning banner')
    assert.doesNotMatch(document.body.textContent, /Recovery data is available/)
    // Verify recovery data in storage was NOT deleted, cleared, or mutated
    assert.equal(localStorage.getItem('gtar_sync_recovery:snap1'), rawRecoveryBefore)
    assert.ok(localStorage.getItem('gtar_library'), 'Library must not be touched')
  } finally {
    await act(async () => root.unmount())
    Object.assign(global, prior)
    dom.window.close()
  }
})

test('RECOVERY_BANNER_PROD_DAMAGED: production renders damage alert if library data is unreadable', async () => {
  clearAppRequireCache()
  const { dom, prior } = setupDom('https://gtar.app/')

  // Corrupted library payload that triggers catch { damaged: true }
  localStorage.setItem('gtar_library_v1', '{"songs":[null],"setlists":[]}')
  localStorage.setItem('gtar_sync_recovery:snap2', 'raw')

  const root = createRoot(document.getElementById('root'))
  try {
    const App = require('../src/App.tsx').default
    await act(async () => root.render(React.createElement(App)))
    const alertAside = document.querySelector('aside[role="alert"]')
    assert.ok(alertAside, 'Damaged library must render alert banner even in prod')
    assert.match(alertAside.textContent, /Device library needs recovery/)
    assert.match(alertAside.textContent, /Export recovery data/)
  } finally {
    await act(async () => root.unmount())
    Object.assign(global, prior)
    dom.window.close()
  }
})

test('RECOVERY_BANNER_CONTRACT: App source code gates banner rendering with isDevEnv', () => {
  const appSrc = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')
  assert.match(appSrc, /import\s+\{[^}]*isDevEnv[^}]*\}\s+from\s+['"]\.\/utils\/env['"]/)
  assert.match(appSrc, /showBanner\s*=\s*status\.damaged\s*\|\|\s*\(\s*isDevEnv\s*&&\s*!status\.retired\s*\)/)
})
