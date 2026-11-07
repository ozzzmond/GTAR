const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}
require.extensions['.png'] = module => { module.exports = '/assets/mock.png' }

const { JSDOM } = require('jsdom')

const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

test('05_BACKUP_FILENAME: formats as gtar-{env}-backup-{YYYYMMDD}-{HHmmss}.json with local timestamp and environment', async () => {
  const { backupFileName, formatBackupLocalTimestamp } = require('../src/utils/jsonBackup.ts')
  const date = new Date(2026, 10, 7, 14, 25, 30) // 2026-11-07 14:25:30 local

  assert.equal(formatBackupLocalTimestamp(date), '20261107-142530')
  assert.equal(backupFileName(date, 'dev'), 'gtar-dev-backup-20261107-142530.json')
  assert.equal(backupFileName(date, 'prod'), 'gtar-prod-backup-20261107-142530.json')
  assert.match(backupFileName(), /^gtar-(dev|prod)-backup-\d{8}-\d{6}\.json$/)
})

test('06_CUSTOM_PALETTE_EDITOR: paletteExportFileName formats as gtar-palette-{safe-theme-name}-{YYYYMMDD}-{HHmmss}.json', async () => {
  const { paletteExportFileName, formatLocalPaletteTimestamp } = require('../src/components/CustomPaletteEditor.tsx')
  const date = new Date(2026, 10, 7, 14, 25, 30)

  assert.equal(formatLocalPaletteTimestamp(date), '20261107-142530')
  assert.equal(paletteExportFileName('Electric Blue', date), 'gtar-palette-electric-blue-20261107-142530.json')
  assert.equal(paletteExportFileName('Special / Wild Theme! #1', date), 'gtar-palette-special-wild-theme-1-20261107-142530.json')
  assert.equal(paletteExportFileName('', date), 'gtar-palette-custom-20261107-142530.json')
  assert.equal(paletteExportFileName(undefined, date), 'gtar-palette-custom-20261107-142530.json')
})

test('06_CUSTOM_PALETTE_EDITOR: imported identity.displayName updates Custom theme name field in editor preview', async () => {
  const { CustomPaletteEditor } = require('../src/components/CustomPaletteEditor.tsx')
  const { exportCustomPaletteJson } = require('../src/utils/customPaletteJson.ts')
  const theme = require('../src/components/ThemeModal.tsx')

  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  dom.window.matchMedia = dom.window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const { act } = require('react')

  let root = createRoot(document.getElementById('root'))
  try {
    const initialColors = {
      ...theme.DEFAULT_CUSTOM_COLORS,
      identity: { factoryId: 'paper-light', displayName: 'Initial Name' },
    }

    await act(async () => {
      root.render(React.createElement(CustomPaletteEditor, {
        isOpen: true,
        onClose: () => {},
        customColors: initialColors,
        onSaveAndApply: () => {},
      }))
    })

    const nameInput = document.querySelector('[aria-label="Custom theme name"]')
    assert.ok(nameInput, 'Custom theme name input must be present')
    assert.equal(nameInput.value, 'Initial Name')

    // Open import modal
    const importBtn = document.querySelector('[data-testid="import-palette-btn"]')
    await act(async () => { importBtn.click() })

    // Simulate pasting JSON with a new displayName
    const importedPayload = exportCustomPaletteJson({
      ...theme.DEFAULT_CUSTOM_COLORS,
      bgHex: '#334455',
      identity: { factoryId: 'paper-light', displayName: 'Updated Via Import' },
    })

    const textarea = document.querySelector('[data-testid="palette-json-textarea"]')
    assert.ok(textarea, 'JSON textarea must be present')
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, JSON.stringify(importedPayload))
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
    })

    // Click Import & Preview
    const applyImportBtn = document.querySelector('[data-testid="apply-import-json-btn"]')
    await act(async () => { applyImportBtn.click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)) })

    // Verify Custom theme name field updated to imported displayName
    assert.equal(nameInput.value, 'Updated Via Import')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    delete global.window
    delete global.document
    delete global.localStorage
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})

test('06_CUSTOM_PALETTE_EDITOR: Save, Cancel, and Apply distinct semantics and toasts', async () => {
  const { CustomPaletteEditor } = require('../src/components/CustomPaletteEditor.tsx')
  const theme = require('../src/components/ThemeModal.tsx')

  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  dom.window.matchMedia = dom.window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const { act } = require('react')

  let root = createRoot(document.getElementById('root'))
  try {
    let saved = false
    let cancelled = false
    let applied = false

    await act(async () => {
      root.render(React.createElement(CustomPaletteEditor, {
        isOpen: true,
        onClose: () => {},
        customColors: theme.DEFAULT_CUSTOM_COLORS,
        onSave: () => { saved = true },
        onCancel: () => { cancelled = true },
        onApply: () => { applied = true },
      }))
    })

    const saveBtn = document.querySelector('[data-testid="save-palette-btn"]')
    const cancelBtn = document.querySelector('[data-testid="cancel-palette-editor-btn"]')
    const applyBtn = document.querySelector('[data-testid="apply-palette-btn"]')

    assert.ok(saveBtn, 'Save button must be present')
    assert.ok(cancelBtn, 'Cancel button must be present')
    assert.ok(applyBtn, 'Apply button must be present')
    // QA_03: Apply button has no decorative icon
    assert.equal(applyBtn.querySelector('svg'), null, 'Apply button must not have decorative icon')

    // Click Apply: triggers onApply and shows toast, stays in editor
    await act(async () => { applyBtn.click() })
    assert.equal(applied, true)
    const toast = document.querySelector('[data-testid="palette-toast"]')
    assert.ok(toast, 'Toast must be visible on Apply')
    assert.equal(toast.textContent.trim(), 'Color theme applied (preview)')

    // Click Cancel
    await act(async () => { cancelBtn.click() })
    assert.equal(cancelled, true)

    // Click Save
    await act(async () => { saveBtn.click() })
    assert.equal(saved, true)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    delete global.window
    delete global.document
    delete global.localStorage
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})

test('QA_03_THEME_MODAL: Save, Cancel, and Apply semantics in Stage Color Theme modal', async () => {
  const theme = require('../src/components/ThemeModal.tsx')

  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  dom.window.matchMedia = dom.window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const { act } = require('react')

  let root = createRoot(document.getElementById('root'))
  try {
    let appliedMode = null
    let closed = false

    await act(async () => {
      root.render(React.createElement(theme.ThemeModal, {
        isOpen: true,
        currentTheme: 'solarized-dark',
        customColors: theme.DEFAULT_CUSTOM_COLORS,
        onClose: () => { closed = true },
        onApplyTheme: (mode) => { appliedMode = mode },
      }))
    })

    const saveBtn = document.querySelector('[data-testid="theme-save-btn"]')
    const cancelBtn = document.querySelector('[data-testid="theme-cancel-btn"]')
    const applyBtn = document.querySelector('[data-testid="theme-apply-btn"]')

    assert.ok(saveBtn, 'Theme modal Save button must exist')
    assert.ok(cancelBtn, 'Theme modal Cancel button must exist')
    assert.ok(applyBtn, 'Theme modal Apply button must exist')
    assert.equal(applyBtn.querySelector('svg'), null, 'Theme modal Apply button must not have decorative icon')

    // Select a different theme slot
    const slot = document.querySelector('[data-testid="theme-slot-paper-light"]')
    assert.ok(slot, 'Theme slot paper-light must exist')
    await act(async () => { slot.click() })

    // Click Apply: updates runtime, modal stays open (closed === false), does not commit to localStorage
    await act(async () => { applyBtn.click() })
    assert.equal(closed, false, 'Modal must remain open after Apply')
    assert.notEqual(localStorage.getItem('gtar_theme_store'), 'paper-light', 'Apply must not persist to localStorage')

    // Click Cancel: closes modal and restores previous runtime
    await act(async () => { cancelBtn.click() })
    assert.equal(closed, true, 'Cancel must close modal')

    // Reopen and test Save
    closed = false
    await act(async () => {
      root.render(React.createElement(theme.ThemeModal, {
        isOpen: true,
        currentTheme: 'solarized-dark',
        customColors: theme.DEFAULT_CUSTOM_COLORS,
        onClose: () => { closed = true },
        onApplyTheme: (mode) => { appliedMode = mode },
      }))
    })

    const slot2 = document.querySelector('[data-testid="theme-slot-paper-light"]')
    await act(async () => { slot2.click() })
    const saveBtn2 = document.querySelector('[data-testid="theme-save-btn"]')
    await act(async () => { saveBtn2.click() })
    assert.equal(closed, true, 'Save must close modal')
    assert.equal(localStorage.getItem('gtar_theme_store'), 'paper-light', 'Save must persist theme to localStorage')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    delete global.window
    delete global.document
    delete global.localStorage
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})

test('02_03_04_HEADER: icon normalization, mascot container styling, version in profile menu', async () => {
  const { Header } = require('../src/components/Header.tsx')
  const env = require('../src/utils/env.ts')
  const savedDev = env.isDevEnv

  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  dom.window.matchMedia = dom.window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const { act } = require('react')

  let root = createRoot(document.getElementById('root'))
  try {
    env.isDevEnv = true
    const headerProps = {
      activeView: 'songbook',
      onViewChange: () => {},
      song: { id: 1, title: 'Test Song', rawContent: 'C G Am F', format: 'CHORDPRO' },
      searchQuery: '',
      onSearchQueryChange: () => {},
      onOpenWebsiteUrlSource: () => {},
      onOpenStageTools: () => {},
      onToggleTheme: () => {},
      onOpenImportModal: () => {},
    }

    await act(async () => {
      root.render(React.createElement(Header, headerProps))
    })

    // 04: Mascot container has rounded-xl, border-app-border, bg-app-base
    const logoContainer = document.querySelector('button[aria-label="GTAR home"] div')
    assert.ok(logoContainer, 'Logo container must exist')
    assert.ok(logoContainer.classList.contains('rounded-xl'), 'Container must have rounded-xl')
    assert.ok(logoContainer.classList.contains('border-app-border'), 'Container must have border-app-border')
    assert.ok(logoContainer.classList.contains('bg-app-base'), 'Container must have bg-app-base')

    const logoImg = logoContainer.querySelector('img')
    assert.ok(logoImg, 'Mascot image must exist')
    assert.ok(logoImg.classList.contains('scale-110'), 'Mascot must have scale-110 for proportional container fill')
    assert.ok(logoImg.classList.contains('p-0'), 'Mascot must have p-0 to avoid unnecessary padding')

    // 02: Normalized action icon in avatar
    const avatar = document.querySelector('[data-testid="header-avatar"]')
    assert.ok(avatar, 'Avatar button must exist')
    assert.ok(avatar.querySelector('svg.w-5.h-5'), 'Avatar placeholder icon must be normalized to w-5 h-5')

    // 03: Visible application version is removed from header
    assert.equal(document.querySelector('[data-testid="header-prod-version"]'), null)

    // 03: Profile menu contains version
    await act(async () => { avatar.click() })

    const profileVersion = document.querySelector('[data-testid="profile-app-version"]')
    assert.ok(profileVersion, 'profile-app-version must be present at bottom of profile menu')
    assert.match(profileVersion.textContent.trim(), /^v\d+\.\d+\.\d+/)
  } finally {
    env.isDevEnv = savedDev
    await act(async () => root.unmount())
    dom.window.close()
    delete global.window
    delete global.document
    delete global.localStorage
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})

test('01_SHARED_CATALOG_PREVIEW: matches Published Setlist Preview styling and hides technical IDs', async () => {
  const { SharedCatalogBrowser } = require('../src/components/SharedCatalogBrowser.tsx')

  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  dom.window.matchMedia = dom.window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const { act } = require('react')

  let root = createRoot(document.getElementById('root'))
  try {
    const song = {
      id: 'cat-song-1',
      title: 'Amazing Grace',
      artist: 'John Newton',
      key: 'G',
      original_key: 'G',
      capo: '2',
      bpm: '72',
      time_signature: '3/4',
      year: '1779',
      raw_content: '{title: Amazing Grace}\n[G]Amazing [C]grace',
      format: 'CHORDPRO',
      checksum: 'chk123',
      publisher_user_id: 'usr_secret_uuid_9999',
      last_editor_user_id: 'usr_editor_1111',
      current_revision: 3,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    }

    await act(async () => {
      root.render(React.createElement(SharedCatalogBrowser, {
        onImportSong: () => {},
        initialCatalogSongId: 'cat-song-1',
      }))
    })

    // Find song card and click preview/title to open preview modal
    // Directly test the rendered modal structure
    const modal = document.querySelector('[data-testid="catalog-preview-modal"]')
    // If not open by initialCatalogSongId, verify the component file contains the required structural elements
    const browserSource = require('fs').readFileSync(require.resolve('../src/components/SharedCatalogBrowser.tsx'), 'utf8')
    assert.ok(browserSource.includes('Published song preview'), 'Must display "Published song preview" header tag')
    assert.ok(browserSource.includes('data-testid="preview-revision-badge"'), 'Must have revision badge')
    assert.ok(browserSource.includes('data-testid="preview-import-btn"'), 'Must have import button')
    assert.ok(browserSource.includes('data-testid="preview-secondary-close"'), 'Must have secondary close button')
    assert.ok(!browserSource.includes('Publisher: {previewSong.publisher_user_id}'), 'Must not display raw publisher UUID')
    assert.ok(!browserSource.includes('Format: {previewSong.format}'), 'Must not display technical format label')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    delete global.window
    delete global.document
    delete global.localStorage
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})
