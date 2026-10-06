const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
const { JSDOM } = require('jsdom')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const theme = require('../src/components/ThemeModal.tsx')
const json = require('../src/utils/customPaletteJson.ts')
const backup = require('../src/utils/backupSettings.ts')
const { CustomPaletteEditor } = require('../src/components/CustomPaletteEditor.tsx')
// Render the real header without loading unrelated auth, search or modal implementations.
const Module = require('node:module'), originalLoad = Module._load
Module._load = function (request, parent, ...args) {
  if (parent?.filename && /[\\/]components[\\/]Header\.tsx$/.test(parent.filename)) {
    if (request === '../utils/env') return { isDevEnv: true }
    if (request === './AuthGate') return { useGoogleAuth: () => ({ session: null }) }
    if (request.endsWith('.png')) return 'logo.png'
    if (request === '../utils/onlineSearch') return {}
    if (request.startsWith('./') && request.endsWith('Modal')) return new Proxy({}, { get: () => () => null })
  }
  return originalLoad.call(this, request, parent, ...args)
}
const { Header } = require('../src/components/Header.tsx')
Module._load = originalLoad

const fields = ['headerPrimaryText', 'headerSecondaryText', 'headerIconColor']
const target = theme.normalizeCustomThemeColors({
  bgHex: '#F8F4FA', songCardBg: '#FFFFFF', setlistCardBg: '#FFFFFF',
  headerBg: '#6B2D84', headerPrimaryText: '#FFFFFF', headerSecondaryText: '#E9DDF2', headerIconColor: '#FFFFFF',
  uiPrimaryText: '#2D1B3D', uiSecondaryText: '#6E5A7D',
})
const rgb = hex => `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`
const contrast = (a, b) => {
  const l = hex => {
    const c = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722
  }
  return (Math.max(l(a), l(b)) + .05) / (Math.min(l(a), l(b)) + .05)
}

test('V2 header fields round-trip through JSON and backup persistence; malformed values reject atomically', () => {
  const exported = json.exportCustomPaletteJson(target)
  assert.equal(exported.version, 2)
  assert.deepEqual(json.importCustomPaletteJson(JSON.stringify(exported)).colors, target)
  const map = new Map(), storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
  backup.restoreBackupSettings({ customThemeColors: target }, storage)
  assert.deepEqual(backup.readBackupSettings(storage).customThemeColors, target)
  for (const field of fields) for (const invalid of ['white', '#FFF', '#GGGGGG', null, 42]) {
    assert.equal(json.importCustomPaletteJson({ ...exported, colors: { ...exported.colors, [field]: invalid } }).success, false)
    const snapshot = new Map(map)
    assert.throws(() => backup.restoreBackupSettings({ customThemeColors: { ...target, [field]: invalid } }, storage))
    assert.deepEqual(map, snapshot)
  }
})

test('Legacy DEV.3e JSON and stored palettes derive safe colors from header rather than body; explicit values survive', () => {
  for (const headerBg of ['#6B2D84', '#FFFFFF', '#888888']) {
    const colors = { ...json.exportCustomPaletteJson(target).colors, headerBg }
    fields.forEach(field => delete colors[field])
    const result = json.importCustomPaletteJson({ format: 'gtar-custom-palette', version: 2, colors })
    assert.equal(result.success, true)
    assert.deepEqual(result.colors, theme.normalizeCustomThemeColors(colors))
    for (const field of fields) assert.ok(contrast(result.colors[field], headerBg) >= 4.5, `${field} against ${headerBg}`)
    assert.equal(result.colors.uiPrimaryText, target.uiPrimaryText)
    assert.equal(result.colors.uiSecondaryText, target.uiSecondaryText)
  }
  assert.equal(theme.normalizeCustomThemeColors({ headerBg: '#6B2D84', uiPrimaryText: '#FFFFFF' }).headerPrimaryText, '#FFFFFF')
  assert.equal(theme.normalizeCustomThemeColors({ ...target, headerPrimaryText: '#010203' }).headerPrimaryText, '#010203')
})

test('Preset cloning derives valid readable header colors without mutating factory themes or changing body identity', () => {
  const snapshot = JSON.stringify(theme.THEME_OPTIONS)
  for (const preset of theme.THEME_OPTIONS) {
    const cloned = json.presetToCustomPalette(preset)
    assert.equal(cloned.headerBg, preset.surfaceHex)
    assert.equal(cloned.uiPrimaryText, preset.textHex)
    for (const field of fields) {
      assert.match(cloned[field], /^#[0-9A-Fa-f]{6}$/)
      assert.ok(contrast(cloned[field], cloned.headerBg) >= 4.5)
    }
    assert.deepEqual(json.importCustomPaletteJson(json.exportCustomPaletteJson(cloned)).colors, cloned)
  }
  assert.equal(JSON.stringify(theme.THEME_OPTIONS), snapshot)
  const chrome = theme.PALETTE_GROUPS.find(group => group.id === 'chrome')
  for (const field of fields) assert.ok(chrome.fields.some(item => item.key === field))
  assert.equal(theme.PALETTE_GROUPS.length, 6)
})

test('Real header roles resolve independently from body, with neutral icons scoped and functional state colors preserved', async () => {
  const dom = new JSDOM('<html><head></head><body class="theme-custom"><div id="root"></div><p class="ui-primary-text">Song title</p><p class="ui-secondary-text">Artist</p></body></html>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false })
  const root = createRoot(document.getElementById('root'))
  try {
    const noop = () => {}
    await act(async () => root.render(React.createElement(Header, { activeView: 'editor', song: {}, searchQuery: '', onViewChange: noop, onSearchQueryChange: noop, onOpenWebsiteUrlSource: noop, onOpenStageTools: noop, onToggleTheme: noop, onOpenStageSettings: noop, onOpenImportModal: noop, onOpenBackupRestoreModal: noop })))
    // jsdom does not resolve CSS custom properties. Resolve only the exact production
    // role declarations using the variables emitted by the real theme application.
    const css = fs.readFileSync(require.resolve('../src/index.css'), 'utf8')
    const rules = css.match(/body\.theme-custom \.(?:header-primary-text|header-secondary-text|header-neutral-icon|ui-primary-text|ui-secondary-text) \{[^}]+\}/g)
    assert.equal(rules.length, 5)
    const sheet = document.createElement('style'); document.head.appendChild(sheet)
    const apply = colors => {
      theme.applyCustomThemeStyles(colors)
      sheet.textContent = rules.join('\n').replace(/var\((--[\w-]+), [^)]+\)/g, (_, key) => document.documentElement.style.getPropertyValue(key))
    }
    const color = selector => window.getComputedStyle(document.querySelector(selector)).color
    const title = document.querySelector('.header-primary-text'), version = document.querySelector('.header-secondary-text')
    assert.equal(title.textContent.trim(), 'GTAR-Dev')
    assert.match(version.textContent, /v1\.0\.123-dev\.3m/)
    assert.ok(!title.classList.contains('ui-primary-text'))
    assert.ok(!version.classList.contains('ui-secondary-text'))
    apply(target)
    for (const [field, selector] of [['headerPrimaryText', '.header-primary-text'], ['headerSecondaryText', '.header-secondary-text'], ['headerIconColor', '.header-neutral-icon']]) {
      assert.equal(color(selector), rgb(target[field]))
      apply({ ...target, [field]: '#123456' })
      assert.equal(color(selector), rgb('#123456'))
      assert.equal(color('.ui-primary-text'), rgb(target.uiPrimaryText))
      assert.equal(color('.ui-secondary-text'), rgb(target.uiSecondaryText))
      for (const [other, role] of [['headerPrimaryText', '.header-primary-text'], ['headerSecondaryText', '.header-secondary-text'], ['headerIconColor', '.header-neutral-icon']]) if (other !== field) assert.equal(color(role), rgb(target[other]))
      apply(target)
    }
    apply({ ...target, uiPrimaryText: '#010203', uiSecondaryText: '#040506' })
    assert.equal(color('.header-primary-text'), rgb(target.headerPrimaryText))
    assert.equal(color('.header-secondary-text'), rgb(target.headerSecondaryText))
    assert.equal(color('.header-neutral-icon'), rgb(target.headerIconColor))
    // Neutral install icon appears only when the PWA install action is available.
    const installEvent = new window.Event('beforeinstallprompt'); installEvent.prompt = noop
    await act(async () => window.dispatchEvent(installEvent))
    assert.equal(document.querySelectorAll('.header-neutral-icon').length, 2)
    for (const state of ['IN_SYNC', 'ERROR', 'CONFLICT', 'SYNCING']) {
      await act(async () => window.dispatchEvent(new window.CustomEvent('gtar:cloud_sync_state', { detail: { status: state, isProcessing: false } })))
      const sync = document.querySelector('[data-testid="header-cloud-sync-button"]')
      assert.equal(sync.querySelectorAll('.header-neutral-icon').length, 0)
      assert.ok(sync.querySelector('svg').getAttribute('class').includes(state === 'ERROR' || state === 'CONFLICT' ? 'text-status-error' : 'text-app-action'))
    }
    assert.ok(![...document.querySelectorAll('span')].find(el => el.textContent === 'DEV').classList.contains('header-primary-text'))
    assert.ok(!document.querySelector('.auth-dot').classList.contains('header-neutral-icon'))
    document.body.className = 'theme-paper-light'
    assert.notEqual(color('.header-primary-text'), rgb(target.headerPrimaryText))
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    delete global.document; delete global.window; delete global.IS_REACT_ACT_ENVIRONMENT
  }
})

test('Chrome preview demonstrates both header contrasts alongside body; staging and Cancel never persist, Save preserves fields', async () => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false })
  const root = createRoot(document.getElementById('root'))
  try {
    const saved = [], original = JSON.stringify(target)
    let closed = 0
    const props = { isOpen: true, customColors: target, onClose: () => closed++, onSaveAndApply: value => saved.push(value) }
    const render = async p => act(async () => root.render(React.createElement(CustomPaletteEditor, p)))
    const click = async selector => act(async () => document.querySelector(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
    await render(props); await click('[data-testid="category-tab-chrome"]')
    for (const [field, id] of [['headerPrimaryText', 'header-primary-preview'], ['headerSecondaryText', 'header-secondary-preview'], ['headerIconColor', 'header-icon-preview']]) {
      assert.ok(document.querySelector(`[data-testid="color-control-${field}"]`))
      assert.equal(document.querySelector(`[data-testid="${id}"]`).style.color, rgb(target[field]))
    }
    assert.equal(document.querySelector('[data-testid="header-preview"]').style.backgroundColor, rgb(target.headerBg))
    assert.equal(document.querySelector('[data-testid="header-body-preview"] p').style.color, rgb(target.uiPrimaryText))
    await click('[data-testid="color-control-headerPrimaryText"] button[title="#111827"]')
    assert.equal(document.querySelector('[data-testid="header-primary-preview"]').style.color, rgb('#111827'))
    await click('[data-testid="close-palette-editor-btn"]')
    assert.equal(closed, 1); assert.equal(saved.length, 0); assert.equal(window.localStorage.length, 0)
    assert.equal(JSON.stringify(target), original)
    await render({ ...props, isOpen: false }); await render(props); await click('[data-testid="category-tab-chrome"]')
    assert.equal(document.querySelector('[data-testid="header-primary-preview"]').style.color, rgb(target.headerPrimaryText))
    await click('[data-testid="color-control-headerSecondaryText"] button[title="#111827"]')
    await click('[data-testid="color-control-headerIconColor"] button[title="#93A1A1"]')
    const save = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save & Apply')
    await act(async () => save.click())
    assert.equal(saved[0].headerSecondaryText, '#111827'); assert.equal(saved[0].headerIconColor, '#93A1A1')
    assert.equal(saved[0].uiPrimaryText, target.uiPrimaryText)
    await render({ ...props, customColors: theme.normalizeCustomThemeColors({ ...target, headerBg: '#FFFFFF', headerPrimaryText: '#111827', headerSecondaryText: '#374151', headerIconColor: '#4B5563' }) })
    await click('[data-testid="category-tab-chrome"]')
    assert.equal(document.querySelector('[data-testid="header-preview"]').style.backgroundColor, rgb('#FFFFFF'))
    assert.equal(document.querySelector('[data-testid="header-primary-preview"]').style.color, rgb('#111827'))
    assert.equal(document.querySelector('[data-testid="header-body-preview"] p').style.color, rgb(target.uiPrimaryText))
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    delete global.document; delete global.window; delete global.IS_REACT_ACT_ENVIRONMENT
  }
})
