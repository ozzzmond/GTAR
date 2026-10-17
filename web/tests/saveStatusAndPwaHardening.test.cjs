const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      filename
    )
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: fn => fn(),
})
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.prompt = (_msg, src) => src

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')
const { Header } = require('../src/components/Header.tsx')

const song = {
  id: 'song-test-save-1',
  title: 'P3 Song Title',
  artist: 'P3 Artist',
  key: 'G',
  rawContent: '[G] Praise the Lord',
  capo: '',
  bpm: '120',
  tags: '',
  format: 'CHORD_PRO',
  transposeOffset: 0,
}

const change = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    ).set.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

test('SAVE_STATUS: initial state is SAVED when draft matches persisted', async () => {
  const root = createRoot(document.getElementById('root'))
  const props = {
    song,
    transposeOffset: 0,
    onUpdateSong: () => true,
    onSaveSong: () => true,
  }
  try {
    await act(async () => root.render(React.createElement(DesktopEditor, props)))
    const badge = document.querySelector('[data-testid="editor-save-status"]')
    assert.ok(badge, 'save status badge must exist')
    assert.equal(badge.getAttribute('data-save-status'), 'SAVED')
    assert.equal(badge.textContent.trim(), 'Saved')
  } finally {
    await act(async () => root.unmount())
  }
})

test('SAVE_STATUS: failed write sets FAILED status and NEVER reports SAVED', async () => {
  const root = createRoot(document.getElementById('root'))
  let failWrites = true
  let persistedSong = { ...song }
  const guard = { current: null }
  const recovery = { current: null }

  const props = {
    song: persistedSong,
    transposeOffset: 0,
    navigationGuardRef: guard,
    recoveryDraftRef: recovery,
    onUpdateSong: () => {
      if (failWrites) return false
      return true
    },
    onSaveSong: () => {
      if (failWrites) return false
      return true
    },
  }

  try {
    await act(async () => root.render(React.createElement(DesktopEditor, props)))
    const textarea = document.querySelector('textarea')

    // 1. Edit text while write fails
    await change(textarea, '[G] Edit that fails to persist')

    const badgeAfterFail = document.querySelector('[data-testid="editor-save-status"]')
    assert.equal(badgeAfterFail.getAttribute('data-save-status'), 'FAILED')
    assert.match(badgeAfterFail.textContent, /Failed/)
    assert.notEqual(badgeAfterFail.getAttribute('data-save-status'), 'SAVED', 'Never report SAVED after failed write')

    // 2. Click Save button while write fails
    const saveButton = document.querySelector('[aria-label="Save changes"]')
    assert.ok(saveButton)
    await act(async () => saveButton.click())

    const badgeAfterExplicitFail = document.querySelector('[data-testid="editor-save-status"]')
    assert.equal(badgeAfterExplicitFail.getAttribute('data-save-status'), 'FAILED')
    assert.notEqual(badgeAfterExplicitFail.getAttribute('data-save-status'), 'SAVED')

    // 3. Navigation guard blocks navigation while in FAILED state
    let navigated = false
    await act(async () => guard.current(() => { navigated = true }))
    assert.equal(navigated, false, 'Navigation must be blocked when write failed')
    assert.ok(document.querySelector('[aria-label="Unsaved changes"]'), 'Unsaved changes prompt must appear')

    // 4. Recovery snapshot remains accessible
    assert.ok(recovery.current(), 'Recovery draft must be retained')
    assert.equal(recovery.current().rawContent, '[G] Edit that fails to persist')

    // 5. When writes succeed again, retry clears FAILED and reports SAVED
    failWrites = false
    const modalSaveBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')
    await act(async () => modalSaveBtn.click())

    const badgeAfterSuccess = document.querySelector('[data-testid="editor-save-status"]')
    assert.equal(badgeAfterSuccess.getAttribute('data-save-status'), 'SAVED')
    assert.equal(badgeAfterSuccess.textContent.trim(), 'Saved')
    assert.equal(navigated, true, 'Navigation proceeds after successful save')
  } finally {
    await act(async () => root.unmount())
  }
})

test('PWA_MANIFEST_AND_INSTALL: manifest has explicit scope and id, Header responds to appinstalled', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifestRaw = fs.readFileSync(path.join(__dirname, '../public/manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestRaw)

  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.id, '/')
  assert.equal(manifest.display, 'standalone')

  const viteConfigRaw = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8')
  assert.ok(viteConfigRaw.includes("id: '/'"), 'vite.config.ts must set id: /')
  assert.ok(viteConfigRaw.includes("scope: '/'"), 'vite.config.ts must set scope: /')

  // Header appinstalled listener test
  const headerProps = {
    searchQuery: '',
    onSearchChange: () => {},
    onOpenSongbook: () => {},
    onOpenSetlists: () => {},
    onOpenStageTools: () => {},
    onOpenStageSettings: () => {},
  }

  try {
    await act(async () => root.render(React.createElement(Header, headerProps)))

    // Dispatch appinstalled event
    await act(async () => {
      window.dispatchEvent(new window.Event('appinstalled'))
    })

    // Verify install button is not present
    const installBtn = document.querySelector('button[title="Install GTAR App to Home Screen"]')
    assert.equal(installBtn, null, 'Install button must not be shown after appinstalled event')
  } finally {
    await act(async () => root.unmount())
  }
})
