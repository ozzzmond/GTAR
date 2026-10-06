const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
const { JSDOM } = require('jsdom')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const fonts = require('../src/utils/customFonts.ts')
const theme = require('../src/components/ThemeModal.tsx')
const json = require('../src/utils/customPaletteJson.ts')
const backup = require('../src/utils/backupSettings.ts')
const { CustomPaletteEditor } = require('../src/components/CustomPaletteEditor.tsx')
const sample = theme.normalizeCustomThemeColors({ bgHex: '#F0F2F5', textHex: '#FFFFFF', chordHex: '#FFAA00', sectionHex: '#AA00FF', fonts: { ui: { source: 'google', family: 'Roboto' }, heading: { source: 'builtin', family: 'Georgia' }, stage: { source: 'webfont', family: 'My Font', url: 'https://example.com/font.woff2' } } })

test('Typography and fonts round-trip through V2 JSON and validated backup storage', () => {
  const exported = json.exportCustomPaletteJson(sample)
  assert.equal(exported.version, 2)
  assert.deepEqual(json.importCustomPaletteJson(JSON.stringify(exported)).colors, sample)
  const map = new Map(), storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
  backup.restoreBackupSettings({ customThemeColors: sample }, storage)
  assert.deepEqual(backup.readBackupSettings(storage).customThemeColors, sample)
  const snapshot = new Map(map)
  assert.throws(() => backup.restoreBackupSettings({ customThemeColors: { ...sample, fonts: { ui: { source: 'webfont', family: 'Bad', url: 'javascript:alert(1)' } } } }, storage))
  assert.deepEqual(map, snapshot)
})

test('Old V2 palettes derive readable independent UI text and default Stage font', () => {
  const result = json.importCustomPaletteJson({ format: 'gtar-custom-palette', version: 2, colors: { bgHex: '#F0F2F5', textHex: '#FFFFFF' } })
  assert.equal(result.success, true)
  assert.equal(result.colors.uiPrimaryText, '#111827')
  assert.equal(result.colors.uiSecondaryText, '#374151')
  assert.equal(result.colors.textHex, '#FFFFFF')
  assert.deepEqual(result.colors.fonts, {})
})

test('Atomic import rejects unknown fields, unsafe families, sources and URLs', () => {
  for (const url of ['http://example.com/a.css', 'javascript:alert(1)', 'data:text/css,a', 'https://user:pass@example.com/a', 'https://example.com/a";x']) {
    assert.equal(json.importCustomPaletteJson({ format: 'gtar-custom-palette', version: 2, colors: {}, fonts: { ui: { source: 'stylesheet', family: 'Safe', url } } }).success, false)
  }
  for (const config of [{ ui: { source: 'html', family: 'Safe' } }, { ui: { source: 'google', family: '<script>' } }, { extra: { source: 'system' } }, { ui: { source: 'system', html: 'x' } }, { ui: { source: 'builtin', family: 'Missing' } }]) assert.ok(fonts.validateFontSettings(config).length)
  assert.equal(json.importCustomPaletteJson({ ...json.exportCustomPaletteJson(sample), html: 'x' }).success, false)
  assert.equal(json.importCustomPaletteJson({ ...json.exportCustomPaletteJson(sample), colors: { uiPrimaryText: 'red' } }).success, false)
})

test('Font loader deduplicates preview/apply resources and falls back after load failure', async () => {
  const dom = new JSDOM('<html><head></head><body></body></html>')
  const doc = dom.window.document
  const loaded = [], attempts = []
  Object.defineProperty(doc, 'fonts', { value: { add: font => loaded.push(font) } })
  global.FontFace = class { constructor(family, url, options) { attempts.push({ family, url, options }) } load() { return Promise.reject(new Error('offline')) } }
  fonts.loadFontResources(sample.fonts, doc)
  fonts.applyFontSettings(sample.fonts, doc.documentElement)
  await Promise.resolve(); await Promise.resolve()
  assert.equal(doc.querySelectorAll('link[data-gtar-font]').length, 1)
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].options.display, 'swap')
  assert.equal(loaded.length, 0)
  assert.match(doc.documentElement.style.getPropertyValue('--custom-font-stage'), /system-ui/)
  fonts.applyFontSettings({}, doc.documentElement)
  assert.equal(doc.documentElement.style.getPropertyValue('--custom-font-stage'), '')
  assert.equal(doc.querySelectorAll('link').length, 1)
  delete global.FontFace; dom.window.close()
})

test('Semantic tokens cover responsive home/header while factory presets and Stage controls remain scoped', () => {
  const css = fs.readFileSync(require.resolve('../src/index.css'), 'utf8')
  for (const token of ['Primary', 'Secondary', 'Section', 'Muted', 'Link']) assert.ok(css.includes(`color: var(--custom-ui${token}Text`))
  for (const file of ['Header', 'SongbookHomeView']) {
    const source = fs.readFileSync(require.resolve(`../src/components/${file}.tsx`), 'utf8')
    assert.ok(source.includes('ui-primary-text'))
    assert.ok(source.includes('ui-secondary-text'))
    assert.ok(source.includes('sm:'))
  }
  for (const style of ['mono', 'sans', 'serif']) assert.ok(css.includes(`body.theme-custom .stage-${style} { font-family: var(--custom-font-stage, var(--font-stage-${style})); }`))
  assert.equal(theme.PALETTE_GROUPS.find(group => group.id === 'typography').fields.length, 5)
  for (const preset of theme.THEME_OPTIONS) {
    const snapshot = JSON.stringify(preset)
    const cloned = json.presetToCustomPalette(preset)
    assert.equal(JSON.stringify(preset), snapshot)
    assert.equal(cloned.uiPrimaryText, preset.textHex)
  }
})

test('Editor stages UI/heading/Stage fonts and colors, Cancel discards, Save commits and Reset clears', async () => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  let saved = [], closed = 0
  const props = { isOpen: true, customColors: sample, onClose: () => closed++, onSaveAndApply: value => saved.push(value) }
  const render = async p => act(async () => root.render(React.createElement(CustomPaletteEditor, p)))
  const click = async selector => act(async () => document.querySelector(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
  const select = async (label, value) => act(async () => {
    const input = document.querySelector(`[aria-label="${label}"]`)
    input.value = value; input.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await render(props)
  await click('[data-testid="category-tab-typography"]')
  for (const target of ['ui', 'heading', 'stage']) await select(`${target} font source`, 'builtin')
  assert.match(document.querySelector('[data-testid="palette-live-preview-box"]').style.fontFamily, /Inter/)
  assert.equal(saved.length, 0)
  assert.equal(window.localStorage.length, 0)
  assert.equal(document.querySelector('[data-testid="typography-preview"] p').style.color, 'rgb(17, 24, 39)')
  await click('[data-testid="close-palette-editor-btn"]')
  assert.equal(closed, 1); assert.equal(saved.length, 0)
  await render({ ...props, isOpen: false }); await render(props)
  await click('[data-testid="category-tab-typography"]')
  assert.equal(document.querySelector('[aria-label="ui font source"]').value, 'google')
  await select('ui font source', 'builtin')
  const save = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save & Apply')
  await act(async () => save.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
  assert.equal(saved[0].fonts.ui.source, 'builtin')
  await click('[data-testid="reset-palette-defaults-btn"]')
  assert.equal(document.querySelector('[aria-label="ui font source"]').value, 'system')
  await act(async () => root.unmount())
  dom.window.close(); delete global.document; delete global.window; delete global.IS_REACT_ACT_ENVIRONMENT
})
