const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/assets/dev-logo.png' }
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
const { Header } = require('../src/components/Header.tsx')
const { createBackupPayload, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const factorySnapshot = JSON.parse(fs.readFileSync(require.resolve('./fixtures/dev3fFactoryThemes.json'), 'utf8'))
const target = theme.normalizeCustomThemeColors({
  bgHex: '#120d0f',
  textHex: '#FEE2E2',
  chordHex: '#E11D48',
  sectionHex: '#FB7185',
  headerBg: '#1f1418',
  headerPrimaryText: '#FEE2E2',
  headerSecondaryText: '#FCA5A5',
  headerIconColor: '#FB7185',
  toolbarBg: '#120d0f',
  searchBg: '#120d0f',
  searchBorder: '#3b1d26',
  filterBarBg: '#1f1418',
  iconColor: '#FB7185',
  setlistCardBg: '#1f1418',
  songCardBg: '#1f1418',
  cardBorder: '#3b1d26',
  selectedCardBg: '#2d1620',
  selectedCardBorder: '#E11D48',
  buttonBg: '#2d1620',
  buttonText: '#FEE2E2',
  inputBg: '#120d0f',
  inputText: '#FEE2E2',
  inputBorder: '#3b1d26',
  accentColor: '#E11D48',
  actionColor: '#E11D48',
  selectionColor: '#E11D48',
  sectionIconColor: '#FB7185',
  dockBg: '#1f1418',
  dockBorder: '#3b1d26',
  dockBtnBg: '#120d0f',
  dockBtnIcon: '#FEE2E2',
  dockPlayBg: '#E11D48',
  dockPlayIcon: '#FFFFFF',
})

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
  try { await run({ render, click, setInput }) } finally {
    await act(async () => root.unmount()); dom.window.close()
    delete global.window; delete global.document; delete global.localStorage; delete global.IS_REACT_ACT_ENVIRONMENT
  }
}

test('PERSISTENCE: Customized factory colors survive Save & Apply, reopen, theme switch, reload', async () => harness(async ({ render, click, setInput }) => {
  const applied = []
  let props = {
    isOpen: true,
    currentTheme: 'crimson-stage',
    customColors: target,
    onClose() {},
    onApplyTheme: (mode, colors) => applied.push({ mode, colors }),
  }
  await render(theme.ThemeModal, props)

  // 1. Customize Crimson Stage
  await click('[data-testid="customize-preset-crimson-stage-btn"]')
  assert.equal(document.querySelector('[aria-label="Custom theme name"]').value, 'Crimson Stage Custom')

  // Change name and color
  await setInput('[aria-label="Custom theme name"]', 'Deep Red Overdrive')
  await click('[data-testid="category-tab-controls"]')
  await click('[data-testid="color-control-actionColor"] button[title="#EC4899"]')
  await click('[data-testid="save-apply-palette-btn"]')

  assert.equal(applied.length, 1)
  assert.equal(applied[0].mode, 'crimson-stage')
  assert.equal(applied[0].colors.identity.displayName, 'Deep Red Overdrive')
  assert.equal(applied[0].colors.identity.factoryId, 'crimson-stage')
  assert.equal(applied[0].colors.actionColor, '#EC4899')

  // Check localStorage atomic state
  const rawOverrides = JSON.parse(localStorage.getItem(backup.SETTINGS_KEYS.factoryThemeOverrides))
  assert.ok(rawOverrides['crimson-stage'])
  assert.equal(rawOverrides['crimson-stage'].identity.displayName, 'Deep Red Overdrive')
  assert.equal(rawOverrides['crimson-stage'].actionColor, '#EC4899')

  // 2. Reopen Theme Studio modal
  props = { ...props, currentTheme: 'crimson-stage', customColors: target }
  await render(theme.ThemeModal, { ...props, isOpen: false })
  await render(theme.ThemeModal, props)

  const crimsonSlot = document.querySelector('[data-testid="theme-slot-crimson-stage"]')
  assert.ok(crimsonSlot.textContent.includes('Deep Red Overdrive'))
  assert.ok(crimsonSlot.querySelector('[data-testid="restore-factory-crimson-stage"]'))

  // 3. Switch away to Amber Stage and Save & Apply
  await click('[data-testid="theme-slot-amber-stage"]')
  await click('[data-testid="theme-save-apply-btn"]')
  assert.equal(applied.at(-1).mode, 'amber-stage')

  // 4. Reopen Theme Studio while Amber Stage is active
  props = { ...props, currentTheme: 'amber-stage', customColors: applied.at(-1).colors }
  await render(theme.ThemeModal, { ...props, isOpen: false })
  await render(theme.ThemeModal, props)

  // Crimson Stage override still exists in slot
  const slotAfterSwitch = document.querySelector('[data-testid="theme-slot-crimson-stage"]')
  assert.ok(slotAfterSwitch.textContent.includes('Deep Red Overdrive'))

  // Switch back to Crimson Stage override
  await click('[data-testid="theme-slot-crimson-stage"]')
  await click('[data-testid="theme-save-apply-btn"]')
  assert.equal(applied.at(-1).mode, 'crimson-stage')
  assert.equal(applied.at(-1).colors.identity.displayName, 'Deep Red Overdrive')
  assert.equal(applied.at(-1).colors.actionColor, '#EC4899')
}))

test('FACTORY RESTORE: Exact canonical restoration, deletion safety, immutable factory snapshot', async () => harness(async ({ render, click }) => {
  const customized = { ...target, identity: { factoryId: 'azure-stage', displayName: 'Deep Azure' }, actionColor: '#00FFFF' }
  backup.restoreBackupSettings({
    themeMode: 'custom',
    customThemeColors: customized,
    factoryThemeOverrides: { 'azure-stage': customized },
  })

  const applied = []
  const props = {
    isOpen: true,
    currentTheme: 'custom',
    customColors: customized,
    onClose() {},
    onApplyTheme: (mode, colors) => applied.push({ mode, colors }),
  }
  await render(theme.ThemeModal, props)

  // Verify overridden slot
  const slotBefore = document.querySelector('[data-testid="theme-slot-azure-stage"]')
  assert.ok(slotBefore.textContent.includes('Deep Azure'))

  // Restore factory theme
  await click('[data-testid="restore-factory-azure-stage"]')
  await click('[data-testid="confirm-factory-restore"]')
  await click('[data-testid="theme-save-apply-btn"]')

  // Deleting active customization activates canonical factory theme
  assert.equal(applied.at(-1).mode, 'azure-stage')
  assert.equal(localStorage.getItem(backup.SETTINGS_KEYS.themeMode), 'azure-stage')

  const overrides = JSON.parse(localStorage.getItem(backup.SETTINGS_KEYS.factoryThemeOverrides))
  assert.deepEqual(overrides, {})

  // Reopen modal to verify slot returns to canonical factory name and properties
  await render(theme.ThemeModal, { ...props, isOpen: false })
  await render(theme.ThemeModal, { ...props, currentTheme: 'azure-stage' })

  const slotAfter = document.querySelector('[data-testid="theme-slot-azure-stage"]')
  assert.ok(slotAfter.textContent.includes('Azure Stage'))
  assert.equal(slotAfter.querySelector('[data-testid^="restore-factory-"]'), null)
  assert.deepEqual(theme.THEME_OPTIONS, factorySnapshot)
}))

test('TOOLBAR ALIGNMENT: 7 primary controls, 36x36 footprint, canonical order, CSS centering contract', () => {
  const css = fs.readFileSync(require.resolve('../src/index.css'), 'utf8')
  // Verify CSS shared centering contract
  assert.match(css, /\.toolbar-icon-btn\s*\{[^}]*width:\s*36px;/)
  assert.match(css, /\.toolbar-icon-btn\s*\{[^}]*height:\s*36px;/)
  assert.match(css, /\.toolbar-icon-btn\s*\{[^}]*min-width:\s*36px;/)
  assert.match(css, /\.toolbar-icon-btn\s*\{[^}]*min-height:\s*36px;/)
  assert.match(css, /\.toolbar-icon-btn\s*\{[^}]*display:\s*inline-flex;/)
  assert.match(css, /\.toolbar-icon-btn\s*\{[^}]*align-items:\s*center;/)
  assert.match(css, /\.toolbar-icon-btn\s*\{[^}]*justify-content:\s*center;/)
  assert.match(css, /\.toolbar-icon-btn svg\s*\{[^}]*width:\s*16px;/)
  assert.match(css, /\.toolbar-icon-btn svg\s*\{[^}]*height:\s*16px;/)

  // Verify Header toolbar render
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true
  global.localStorage = dom.window.localStorage
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.requestAnimationFrame = fn => setTimeout(fn, 0)
  const root = createRoot(document.getElementById('root'))
  act(() => {
    root.render(React.createElement(Header, {
      activeView: 'songbook',
      onViewChange() {},
      onOpenWebsiteUrlSource() {},
      onOpenStageTools() {},
      onToggleTheme() {},
      onOpenStageSettings() {},
      onOpenImportModal() {},
      onOpenBackupRestoreModal() {},
      searchQuery: '',
      onSearchQueryChange() {},
    }))
  })

  const sheet = document.createElement('style')
  sheet.textContent = css.match(/\.main-toolbar-content\s*\{[^}]*\}/)[0] + css.match(/^\.toolbar-icon-btn\s*\{[^}]*\}/m)[0]
  document.head.appendChild(sheet)
  const scroll = document.querySelector('[data-testid="main-toolbar-scroll"]')
  assert.ok(scroll.classList.contains('overflow-x-auto'))
  const content = scroll.firstElementChild
  assert.ok(content.classList.contains('justify-center'))
  assert.ok(!content.className.includes('justify-start'))
  const layout = window.getComputedStyle(content)
  assert.equal(layout.width, 'max-content')
  assert.match(css.match(/\.main-toolbar-content\s*\{[^}]*\}/)[0], /margin-inline:\s*auto;/)
  const toolbarButtons = document.querySelectorAll('.toolbar-icon-btn')
  assert.equal(toolbarButtons.length, 8)
  const labels = [...toolbarButtons].map(btn => btn.querySelector('.toolbar-tooltip')?.textContent)
  assert.deepEqual(labels, [
    'Back',
    'Stage Preview (Alt+1)',
    'Editor (Alt+2)',
    'Band Sync (Alt+3)',
    'Cast (Alt+4)',
    'Theme (Alt+5)',
    'Trash (Alt+6)',
    'More',
  ])
  for (const btn of toolbarButtons) {
    assert.ok(btn.classList.contains('shrink-0'))
    assert.equal(btn.parentElement, content)
    const footprint = window.getComputedStyle(btn)
    assert.equal(footprint.width, '36px'); assert.equal(footprint.height, '36px')
    assert.equal(footprint.display, 'inline-flex')
    assert.equal(footprint.alignItems, 'center'); assert.equal(footprint.justifyContent, 'center')
  }
  act(() => root.unmount()); dom.window.close()
  delete global.window; delete global.document; delete global.localStorage; delete global.IS_REACT_ACT_ENVIRONMENT
})

test('FACTORY PALETTE: All presets provide 38 valid semantic tokens; revamps follow design guidelines', () => {
  const fields = palette.CANONICAL_CUSTOM_PALETTE_FIELDS
  assert.equal(fields.length, 38)

  for (const opt of theme.THEME_OPTIONS) {
    const p = palette.presetToCustomPalette(opt)
    for (const f of fields) {
      assert.ok(typeof p[f] === 'string' && /^#[0-9a-f]{6}$/i.test(p[f]), `Preset ${opt.id} missing valid ${f}`)
    }
  }

  // Crimson Stage revamp verification: red/black/burgundy
  const crimson = palette.presetToCustomPalette(theme.THEME_OPTIONS.find(o => o.id === 'crimson-stage'))
  assert.equal(crimson.bgHex, '#120d0f')
  assert.equal(crimson.headerBg, '#1f1418')
  assert.equal(crimson.chordHex, '#E11D48')
  assert.equal(crimson.textHex, '#FEE2E2')
  assert.equal(crimson.actionColor, '#E11D48')

  // Azure Stage revamp verification: tonal blue hierarchy
  const azure = palette.presetToCustomPalette(theme.THEME_OPTIONS.find(o => o.id === 'azure-stage'))
  assert.equal(azure.bgHex, '#0a1324')
  assert.equal(azure.headerBg, '#11203b')
  assert.equal(azure.chordHex, '#06B6D4')
  assert.equal(azure.textHex, '#E0F2FE')
  assert.equal(azure.actionColor, '#06B6D4')

  // E-Ink Paper revamp verification: minimal monochrome grayscale
  const eink = palette.presetToCustomPalette(theme.THEME_OPTIONS.find(o => o.id === 'e-ink-paper'))
  assert.equal(eink.bgHex, '#ededed')
  assert.equal(eink.headerBg, '#f8f8f8')
  assert.equal(eink.chordHex, '#404040')
  assert.equal(eink.textHex, '#111111')
  assert.equal(eink.actionColor, '#111111')

  // Preserved identities
  const solarized = palette.presetToCustomPalette(theme.THEME_OPTIONS.find(o => o.id === 'solarized-dark'))
  assert.equal(solarized.bgHex, '#002B36')
  assert.equal(solarized.accentColor, '#2AA198')

  const amber = palette.presetToCustomPalette(theme.THEME_OPTIONS.find(o => o.id === 'amber-stage'))
  assert.equal(amber.bgHex, '#181206')
  assert.equal(amber.chordHex, '#F59E0B')

  const oled = palette.presetToCustomPalette(theme.THEME_OPTIONS.find(o => o.id === 'oled-black'))
  assert.equal(oled.bgHex, '#000000')

  const paper = palette.presetToCustomPalette(theme.THEME_OPTIONS.find(o => o.id === 'paper-light'))
  assert.equal(paper.bgHex, '#f4ecd8')
})

test('COMPATIBILITY: DEV.3g V2 JSON import/export and backup/restore round-trip', () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://gtar.test' })
  global.localStorage = dom.window.localStorage
  try {
    const exported = palette.exportCustomPaletteJson(target)
    assert.equal(exported.version, 2)
    assert.equal(exported.format, 'gtar-custom-palette')

    const imported = palette.importCustomPaletteJson(JSON.stringify(exported))
    assert.equal(imported.success, true)
    assert.deepEqual(imported.colors, target)

    // Backup round-trip with factory overrides
    const payload = createBackupPayload([], [])
    const parsed = parseBackupJson(JSON.stringify(payload), [], [])
    assert.deepEqual(parsed.factoryThemeOverrides, payload.factoryThemeOverrides)
  } finally {
    dom.window.close()
    delete global.localStorage
  }
})
