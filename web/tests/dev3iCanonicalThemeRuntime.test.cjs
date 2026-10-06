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
const { SETTINGS_KEYS } = require('../src/utils/backupSettings.ts')
const css = fs.readFileSync(require.resolve('../src/index.css'), 'utf8')
const factorySnapshot = JSON.stringify(theme.THEME_OPTIONS)
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
const variables = () => Object.fromEntries([...document.documentElement.style].map(key => [key, document.documentElement.style.getPropertyValue(key)]))
async function harness(run) {
  const dom = new JSDOM('<html><head></head><body class="theme-paper-light"><div id="root"></div></body></html>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document; global.localStorage = window.localStorage; global.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const sheet = document.createElement('style'); document.head.appendChild(sheet)
  // jsdom cannot evaluate variables. Substitute actual emitted values in production
  // rules to check the cascade, without a second test-only theme definition.
  const refreshStyles = () => {
    let rules = css.match(/body\.theme-custom[^{}]*\{[^{}]+\}/g).join('\n')
    for (let i = 0; i < 8; i++) rules = rules.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, name, fallback) => document.documentElement.style.getPropertyValue(name) || fallback || 'Arial')
    sheet.textContent = rules
  }
  const render = props => act(async () => root.render(React.createElement(theme.ThemeModal, props)))
  const click = selector => act(async () => { const el = document.querySelector(selector); assert.ok(el, selector); el.click() })
  try { await run({ render, click, refreshStyles, style: el => window.getComputedStyle(el) }) } finally {
    await act(async () => root.unmount()); dom.window.close()
    delete global.window; delete global.document; delete global.localStorage; delete global.IS_REACT_ACT_ENVIRONMENT
  }
}

for (const [mode, bg, header, chord, action] of [
  ['crimson-stage', '#120d0f', '#1f1418', '#E11D48', '#E11D48'],
  ['azure-stage', '#0a1324', '#11203b', '#06B6D4', '#06B6D4'],
  ['e-ink-paper', '#ededed', '#f8f8f8', '#404040', '#111111'],
  ['solarized-dark', '#002B36', '#073642', '#b58900', '#2AA198'],
]) test(`Selecting ${mode} applies DEV.3h semantic values without custom mode`, async () => harness(async ({ render, click, refreshStyles, style }) => {
  const applied = []
  await render({ isOpen: true, currentTheme: 'paper-light', customColors: theme.DEFAULT_CUSTOM_COLORS, onClose() {}, onApplyTheme: (mode, colors) => applied.push({ mode, colors }) })
  await click(`[data-testid="theme-slot-${mode}"]`)
  await click('[data-testid="theme-save-apply-btn"]')
  assert.equal(applied.at(-1).mode, mode)
  assert.equal(localStorage.getItem(SETTINGS_KEYS.themeMode), mode)
  assert.equal(document.body.dataset.theme, mode)
  const vars = variables()
  assert.equal(vars['--custom-stage-bg'], bg)
  assert.equal(vars['--custom-chrome-header-bg'], header)
  assert.equal(vars['--custom-stage-chord'], chord)
  assert.equal(vars['--custom-actionColor'], action)
  refreshStyles()
  assert.equal(style(document.body).backgroundColor, rgb(bg))
  const title = document.querySelector('[data-testid="theme-selector"] h2')
  assert.equal(style(title).color, rgb(theme.resolveThemePalette(mode, theme.DEFAULT_CUSTOM_COLORS).uiSectionText))
  assert.equal(document.body.classList.contains(`theme-${mode}`), false)
}))

test('Every factory and Custom Palette use identical applied variables and CSS scope; factories reset custom fonts', async () => harness(async ({ refreshStyles, style }) => {
  for (const preset of theme.THEME_OPTIONS) {
    const colors = theme.presetToCustomPalette(preset)
    theme.applyThemeRuntime('custom', { ...colors, fonts: { ui: { source: 'builtin', family: 'Georgia' } } })
    theme.applyThemeRuntime(preset.id, theme.DEFAULT_CUSTOM_COLORS)
    const factoryVars = variables()
    const factoryClass = document.body.className
    theme.applyThemeRuntime('custom', colors)
    assert.deepEqual(variables(), factoryVars, preset.id)
    assert.equal(document.body.className, factoryClass)
    refreshStyles()
    assert.equal(style(document.body).backgroundColor, rgb(colors.bgHex))
  }
  assert.equal(JSON.stringify(theme.THEME_OPTIONS), factorySnapshot)
  const app = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
  assert.ok(app.includes('applyThemeRuntime(stageTheme, customThemeColors)'))
  assert.ok(!app.includes("if (stageTheme === 'custom')"))
}))

test('Saved factory override survives selection, reload and switching; staged deletion restores exact immutable runtime', async () => harness(async ({ render, click }) => {
  const custom = theme.normalizeCustomThemeColors({ ...theme.presetToCustomPalette(theme.THEME_OPTIONS[4]), headerBg: '#123456', actionColor: '#ABCDEF', identity: { factoryId: 'crimson-stage', displayName: 'My Crimson' } })
  localStorage.setItem(SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify({ 'crimson-stage': custom }))
  const props = { isOpen: true, currentTheme: 'crimson-stage', customColors: theme.DEFAULT_CUSTOM_COLORS, onClose() {} }
  theme.applyThemeRuntime('crimson-stage', theme.DEFAULT_CUSTOM_COLORS)
  const overrideVars = variables()
  assert.equal(overrideVars['--custom-chrome-header-bg'], '#123456')
  theme.applyThemeRuntime('azure-stage', theme.DEFAULT_CUSTOM_COLORS)
  theme.applyThemeRuntime('crimson-stage', theme.DEFAULT_CUSTOM_COLORS)
  assert.deepEqual(variables(), overrideVars)
  // Reload reconstructs runtime state from serialized storage, with no in-memory overrides.
  document.documentElement.removeAttribute('style'); document.body.className = 'theme-crimson-stage'
  theme.applyThemeRuntime('crimson-stage', theme.DEFAULT_CUSTOM_COLORS)
  assert.deepEqual(variables(), overrideVars)
  await render(props)
  assert.ok(document.querySelector('[data-testid="theme-slot-crimson-stage"]').textContent.includes('My Crimson'))
  await click('[data-testid="theme-slot-crimson-stage"]'); await click('[data-testid="theme-save-apply-btn"]')
  assert.deepEqual(variables(), overrideVars)
  await render({ ...props, isOpen: false }); await render({ ...props, currentTheme: 'custom', customColors: custom })
  await click('[data-testid="restore-factory-crimson-stage"]'); await click('[data-testid="confirm-factory-restore"]')
  assert.deepEqual(variables(), overrideVars, 'restoration remains staged')
  await click('[data-testid="theme-save-apply-btn"]')
  assert.deepEqual(JSON.parse(localStorage.getItem(SETTINGS_KEYS.factoryThemeOverrides)), {})
  assert.equal(localStorage.getItem(SETTINGS_KEYS.themeMode), 'crimson-stage')
  const restored = variables()
  theme.applyThemeRuntime('custom', theme.presetToCustomPalette(theme.THEME_OPTIONS[4]))
  assert.deepEqual(variables(), restored)
  await render({ ...props, isOpen: false }); await render(props)
  assert.ok(document.querySelector('[data-testid="theme-slot-crimson-stage"]').textContent.includes('Crimson Stage'))
  assert.equal(document.querySelector('[data-testid="restore-factory-crimson-stage"]'), null)
  assert.equal(JSON.stringify(theme.THEME_OPTIONS), factorySnapshot)
}))

test('No factory CSS color definitions compete with semantic variables; invalid saved overrides fall back safely', async () => harness(async () => {
  for (const mode of theme.THEME_OPTIONS.map(p => p.id)) assert.ok(!css.includes(`body.theme-${mode}`), mode)
  localStorage.setItem(SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify({ 'crimson-stage': { identity: { factoryId: 'azure-stage', displayName: 'Invalid' }, bgHex: 'red' } }))
  theme.applyThemeRuntime('crimson-stage', theme.DEFAULT_CUSTOM_COLORS)
  assert.equal(variables()['--custom-stage-bg'], '#120d0f')
  localStorage.setItem(SETTINGS_KEYS.factoryThemeOverrides, '{bad json')
  theme.applyThemeRuntime('solarized-dark', theme.DEFAULT_CUSTOM_COLORS)
  assert.equal(variables()['--custom-stage-chord'], '#b58900')
}))
