const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
const { JSDOM } = require('jsdom')
const boot = new JSDOM('<html><body></body></html>')
global.window = boot.window; global.document = boot.window.document
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
boot.window.close(); delete global.window; delete global.document
const theme = require('../src/components/ThemeModal.tsx')
const palette = require('../src/utils/customPaletteJson.ts')
const backup = require('../src/utils/backupSettings.ts')
const { CustomPaletteEditor } = require('../src/components/CustomPaletteEditor.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { createBackupPayload, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const fields = ['actionColor', 'selectionColor', 'sectionIconColor']
const factorySnapshot = JSON.parse(fs.readFileSync(require.resolve('./fixtures/dev3fFactoryThemes.json'), 'utf8'))
const target = theme.normalizeCustomThemeColors({ bgHex: '#F8F4FA', textHex: '#201830', headerBg: '#6B2D84', headerPrimaryText: '#FFFFFF', headerSecondaryText: '#E9DDF2', headerIconColor: '#FFFFFF', songCardBg: '#FFFFFF', setlistCardBg: '#FFFFFF', selectedCardBg: '#F3E6F9', buttonBg: '#6B2D84', buttonText: '#FFFFFF', uiPrimaryText: '#201830', uiSectionText: '#201830', uiSecondaryText: '#4B385B', uiMutedText: '#4B385B', actionColor: '#8A1828', selectionColor: '#AF1545', sectionIconColor: '#542082', fonts: { ui: { source: 'builtin', family: 'Georgia' }, heading: { source: 'builtin', family: 'Inter' } } })
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
async function harness(run) {
  const dom = new JSDOM('<html><head></head><body class="theme-custom"><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document; global.localStorage = window.localStorage; global.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false }); window.requestAnimationFrame = fn => setTimeout(fn, 0)
  const root = createRoot(document.getElementById('root'))
  const render = async (component, props) => act(async () => root.render(React.createElement(component, props)))
  const click = async selector => act(async () => { const el = document.querySelector(selector); assert.ok(el, selector); el.click() })
  const setInput = async (selector, value) => act(async () => {
    const el = document.querySelector(selector)
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  // jsdom has no CSS-variable evaluation. Resolve actual emitted variables in the
  // production custom-theme declarations, rather than duplicating theme styles.
  const css = fs.readFileSync(require.resolve('../src/index.css'), 'utf8')
  const sheet = document.createElement('style'); document.head.appendChild(sheet)
  const apply = colors => {
    theme.applyCustomThemeStyles(colors)
    let rules = css.match(/body\.theme-custom[^{}]*\{[^{}]+\}/g).join('\n')
    for (let i = 0; i < 8; i++) rules = rules.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, name, fallback) => document.documentElement.style.getPropertyValue(name) || fallback || 'Arial')
    sheet.textContent = rules
  }
  const style = selector => window.getComputedStyle(typeof selector === 'string' ? document.querySelector(selector) : selector)
  try { await run({ render, click, setInput, apply, style }) } finally {
    await act(async () => root.unmount()); dom.window.close()
    delete global.window; delete global.document; delete global.localStorage; delete global.IS_REACT_ACT_ENVIRONMENT
  }
}

test('DEV.3f V2 imports; semantic colors and identity round-trip, invalid name/color/identity rejects atomically', () => {
  const old = palette.exportCustomPaletteJson(target); fields.forEach(field => delete old.colors[field])
  assert.equal(palette.importCustomPaletteJson(old).success, true)
  const colors = theme.normalizeCustomThemeColors({ ...target, identity: { factoryId: 'paper-light', displayName: '  Classic Facebook  ' } })
  const exported = palette.exportCustomPaletteJson(colors)
  assert.equal(exported.version, 2); assert.equal(exported.identity.displayName, 'Classic Facebook')
  assert.equal('identity' in exported.colors, false)
  assert.deepEqual(palette.importCustomPaletteJson(JSON.stringify(exported)).colors, colors)
  const map = new Map(), storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
  const settings = { themeMode: 'custom', customThemeColors: colors, factoryThemeOverrides: { 'paper-light': colors } }
  backup.restoreBackupSettings(settings, storage)
  assert.deepEqual(backup.readBackupSettings(storage), settings)
  for (const displayName of ['', '   ', 'x'.repeat(81), 123, null]) {
    assert.equal(palette.importCustomPaletteJson({ ...exported, identity: { ...exported.identity, displayName } }).success, false)
    const snapshot = new Map(map)
    assert.throws(() => backup.restoreBackupSettings({ ...settings, customThemeColors: { ...colors, identity: { ...colors.identity, displayName } } }, storage))
    assert.deepEqual(map, snapshot)
  }
  for (const field of fields) assert.equal(palette.importCustomPaletteJson({ ...exported, colors: { ...exported.colors, [field]: 'red' } }).success, false)
  assert.equal(palette.importCustomPaletteJson({ ...exported, identity: { ...exported.identity, factoryId: 'custom' } }).success, false)
  assert.ok(backup.validateBackupSettings({ factoryThemeOverrides: { 'azure-stage': colors } }).length)
  assert.deepEqual(theme.THEME_OPTIONS, factorySnapshot)
})

test('Theme selector uses body text, paired buttons and UI/heading fonts under a light body with a dark header', async () => harness(async ({ render, apply, style }) => {
  await render(theme.ThemeModal, { isOpen: true, onClose() {}, currentTheme: 'custom', customColors: target })
  apply(target)
  const modal = document.querySelector('[data-testid="theme-selector"]')
  assert.equal(style(modal.querySelector('h2')).color, rgb(target.uiSectionText))
  assert.match(style(modal.querySelector('h2')).fontFamily, /Inter/)
  assert.equal(style(modal.querySelector('p')).color, rgb(target.uiMutedText))
  const names = [...modal.querySelectorAll('[data-testid^="theme-slot-"] .ui-primary-text.leading-tight')]
  assert.equal(names.length, 7)
  names.forEach(name => assert.equal(style(name).color, rgb(target.uiPrimaryText)))
  for (const button of modal.querySelectorAll('.ui-button')) {
    assert.equal(style(button).color, rgb(target.buttonText))
    assert.equal(style(button).backgroundColor, rgb(target.buttonBg))
    assert.match(style(button).fontFamily, /Georgia/)
    for (const span of button.querySelectorAll('span')) assert.equal(style(span).color, rgb(target.buttonText))
  }
  assert.equal(style(modal.querySelector('[title="Close without saving"]')).color, rgb(target.uiMutedText))
  assert.deepEqual([...modal.querySelectorAll('[data-testid^="theme-slot-"]')].map(el => el.dataset.testid.slice(11)), factorySnapshot.map(p => p.id))
  assert.equal(modal.querySelectorAll('[data-testid^="restore-factory-"]').length, 0)
  assert.equal(localStorage.length, 0)
}))

test('Rendered library actions, selection and section icons respond independently; destructive colors remain separate', async () => harness(async ({ render, click, apply, style }) => {
  const noop = () => {}
  await render(SongbookHomeView, { songs: [{ id: 'a', title: 'Song A', artist: 'Artist', content: '[C]Hello', key: 'C' }], activeSongIndex: 0, setlists: [{ id: 'gig', name: 'Sunday', songs: [{ id: 'a', title: 'Song A' }] }], onSongMembershipChange: noop, onCreateSetlistForSong: noop, onSelectSong: noop, onNewSong: noop, onOpenSetlists: noop, onDeleteSong: noop, onSelectSetlistSong: noop, onDeleteSetlist: noop })
  apply(target)
  for (const selector of ['[data-testid="play-setlist-gig"]', '[data-testid="toggle-song-selection-mode"]', '[data-testid="toggle-setlist-selection-mode"]']) {
    assert.equal(style(selector).color, rgb(target.actionColor))
    assert.match(style(selector).fontFamily, /Georgia/)
  }
  assert.ok(document.querySelectorAll('.ui-section-icon').length >= 3)
  for (const icon of document.querySelectorAll('.ui-section-icon')) assert.equal(style(icon).color, rgb(target.sectionIconColor))
  assert.equal(style('.ui-selection-indicator').backgroundColor, rgb(target.selectionColor))
  await click('[data-testid="toggle-song-selection-mode"]'); await click('[data-testid="select-song-0"]')
  assert.equal(style('[data-testid="select-song-0"]').backgroundColor, rgb(target.selectionColor))
  const destructive = [...document.querySelectorAll('button')].find(el => el.title === 'Delete selected songs')
  assert.ok(destructive); assert.equal(destructive.classList.contains('ui-action-text'), false)
  const before = style(destructive).color
  apply({ ...target, actionColor: '#123456', sectionIconColor: '#654321', selectionColor: '#ABCDEF' })
  assert.equal(style(destructive).color, before)
  assert.equal(style('[data-testid="select-song-0"]').backgroundColor, rgb('#ABCDEF'))
  assert.equal(style('.ui-section-icon').color, rgb('#654321'))
  assert.equal(document.documentElement.style.getPropertyValue('--custom-selection-foreground'), '#000000')
  const header = fs.readFileSync(require.resolve('../src/components/Header.tsx'), 'utf8')
  assert.equal(header.includes('ui-action-text'), false)
}))

test('Factory customization names persist in the same slot; reset is staged, Cancel preserves, active deletion restores factory', async () => harness(async ({ render, click, setInput }) => {
  const applied = []; let closed = 0
  let props = { isOpen: true, currentTheme: 'paper-light', customColors: target, onClose: () => closed++, onApplyTheme: (mode, colors) => applied.push({ mode, colors }) }
  await render(theme.ThemeModal, props)
  await click('[data-testid="customize-preset-paper-light-btn"]')
  assert.equal(document.querySelector('[aria-label="Custom theme name"]').value, 'Paper Cream Light Custom')
  await setInput('[aria-label="Custom theme name"]', '   ')
  await click('[data-testid="save-apply-palette-btn"]')
  assert.equal(applied.length, 0); assert.equal(localStorage.length, 0)
  assert.match(document.querySelector('[role="alert"]').textContent, /name/)
  await setInput('[aria-label="Custom theme name"]', '  Classic Facebook  ')
  await click('[data-testid="save-apply-palette-btn"]')
  assert.equal(applied.length, 1)
  const active = applied[0].colors
  assert.equal(active.identity.displayName, 'Classic Facebook'); assert.equal(applied[0].mode, 'custom')
  props = { ...props, currentTheme: 'custom', customColors: active }
  await render(theme.ThemeModal, { ...props, isOpen: false }); await render(theme.ThemeModal, props)
  let slot = document.querySelector('[data-testid="theme-slot-paper-light"]')
  assert.ok(slot.textContent.includes('Classic Facebook'))
  assert.ok(document.querySelector('[data-testid="custom-theme-option-card"]'))
  assert.deepEqual([...document.querySelectorAll('[data-testid^="theme-slot-"]')].map(el => el.dataset.testid.slice(11)), factorySnapshot.map(p => p.id))
  const snapshot = Object.entries(localStorage)
  await click('[data-testid="restore-factory-paper-light"]'); await click('[data-testid="confirm-factory-restore"]')
  assert.ok(document.querySelector('[data-testid="theme-slot-paper-light"]').textContent.includes('Paper Cream Light'))
  assert.deepEqual(Object.entries(localStorage), snapshot)
  await click('[title="Close without saving"]')
  await render(theme.ThemeModal, { ...props, isOpen: false }); await render(theme.ThemeModal, props)
  assert.ok(document.querySelector('[data-testid="theme-slot-paper-light"]').textContent.includes('Classic Facebook'))
  await click('[data-testid="restore-factory-paper-light"]'); await click('[data-testid="confirm-factory-restore"]')
  await click('[data-testid="theme-save-apply-btn"]')
  assert.equal(applied.at(-1).mode, 'paper-light')
  assert.equal(localStorage.getItem(backup.SETTINGS_KEYS.themeMode), 'paper-light')
  assert.deepEqual(JSON.parse(localStorage.getItem(backup.SETTINGS_KEYS.factoryThemeOverrides)), {})
  assert.equal(JSON.parse(localStorage.getItem(backup.SETTINGS_KEYS.customThemeColors)).identity, undefined)
  assert.deepEqual(theme.THEME_OPTIONS, factorySnapshot)
  props = { ...props, currentTheme: 'paper-light', customColors: applied.at(-1).colors }
  await render(theme.ThemeModal, { ...props, isOpen: false }); await render(theme.ThemeModal, props)
  slot = document.querySelector('[data-testid="theme-slot-paper-light"]')
  assert.ok(slot.textContent.includes('Paper Cream Light')); assert.equal(slot.querySelector('[data-testid^="restore-factory-"]'), null)
  assert.equal(slot.querySelector('div[style]').style.backgroundColor, rgb(factorySnapshot[3].bgHex))
  assert.deepEqual([...document.querySelectorAll('[data-testid^="theme-slot-"]')].map(el => el.dataset.testid.slice(11)), factorySnapshot.map(p => p.id))
}))

test('Palette previews expose accent effects; Cancel never persists names, colors or fonts; backup includes all overrides', async () => harness(async ({ render, click, setInput }) => {
  const colors = { ...target, identity: { factoryId: 'azure-stage', displayName: 'Red Yahoo' } }
  const saved = []; const props = { isOpen: true, customColors: colors, onClose() {}, onSaveAndApply: c => saved.push(c) }
  await render(CustomPaletteEditor, props); await click('[data-testid="category-tab-controls"]')
  for (const field of fields) assert.ok(document.querySelector(`[data-testid="color-control-${field}"]`))
  for (const [id, field] of [['action-color-preview', 'actionColor'], ['section-icon-preview', 'sectionIconColor'], ['selection-color-preview', 'selectionColor']]) assert.equal(document.querySelector(`[data-testid="${id}"]`).style.color, rgb(colors[field]))
  await setInput('[aria-label="Custom theme name"]', 'Changed')
  await click('[data-testid="color-control-actionColor"] button[title="#38BDF8"]')
  assert.equal(document.querySelector('[data-testid="action-color-preview"]').style.color, rgb('#38BDF8'))
  await click('[data-testid="close-palette-editor-btn"]')
  assert.equal(saved.length, 0); assert.equal(localStorage.length, 0); assert.equal(colors.identity.displayName, 'Red Yahoo')
  await render(CustomPaletteEditor, { ...props, isOpen: false }); await render(CustomPaletteEditor, props)
  assert.equal(document.querySelector('[aria-label="Custom theme name"]').value, 'Red Yahoo')
  backup.restoreBackupSettings({ themeMode: 'custom', customThemeColors: colors, factoryThemeOverrides: { 'azure-stage': colors } })
  const payload = createBackupPayload([], [])
  const parsed = parseBackupJson(JSON.stringify(payload), [], [])
  assert.deepEqual(parsed.factoryThemeOverrides, payload.factoryThemeOverrides)
  assert.equal(parsed.customThemeColors.identity.displayName, 'Red Yahoo')
  localStorage.clear(); backup.restoreBackupSettings(parsed)
  assert.deepEqual(backup.readBackupSettings().factoryThemeOverrides, payload.factoryThemeOverrides)
}))

test('Multiple factory overrides retain slots; restoring an inactive slot preserves the active customization and backup', async () => harness(async ({ render, click }) => {
  const active = { ...target, identity: { factoryId: 'azure-stage', displayName: 'Red Yahoo' } }
  const other = { ...target, identity: { factoryId: 'paper-light', displayName: 'Classic Facebook' } }
  backup.restoreBackupSettings({ themeMode: 'custom', customThemeColors: active, factoryThemeOverrides: { 'azure-stage': active, 'paper-light': other } })
  const applied = []
  const props = { isOpen: true, currentTheme: 'custom', customColors: active, onClose() {}, onApplyTheme: (mode, colors) => applied.push({ mode, colors }) }
  await render(theme.ThemeModal, props)
  assert.equal(document.querySelectorAll('[data-testid^="theme-slot-"]').length, 7)
  await click('[data-testid="restore-factory-paper-light"]'); await click('[data-testid="confirm-factory-restore"]'); await click('[data-testid="theme-save-apply-btn"]')
  assert.equal(applied[0].mode, 'custom'); assert.deepEqual(applied[0].colors, theme.normalizeCustomThemeColors(active))
  const overrides = JSON.parse(localStorage.getItem(backup.SETTINGS_KEYS.factoryThemeOverrides))
  assert.deepEqual(Object.keys(overrides), ['azure-stage'])
  assert.equal(overrides['azure-stage'].identity.displayName, 'Red Yahoo')
  await render(theme.ThemeModal, { ...props, isOpen: false }); await render(theme.ThemeModal, props)
  assert.ok(document.querySelector('[data-testid="theme-slot-paper-light"]').textContent.includes('Paper Cream Light'))
  assert.ok(document.querySelector('[data-testid="theme-slot-azure-stage"]').textContent.includes('Red Yahoo'))
  assert.deepEqual(theme.THEME_OPTIONS, factorySnapshot)
}))
