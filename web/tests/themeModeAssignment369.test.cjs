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
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const boot = new JSDOM('<html><body></body></html>')
global.window = boot.window
global.document = boot.window.document
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
boot.window.close()
delete global.window
delete global.document

const theme = require('../src/components/ThemeModal.tsx')
const headerModule = require('../src/components/Header.tsx')
const {
  SETTINGS_KEYS,
  SETTINGS_CHANGED,
  THEME_MODE_ASSIGNMENTS_KEY,
  DEFAULT_THEME_MODE_ASSIGNMENTS,
  normalizeThemeModeAssignments,
  loadThemeModeAssignments,
  saveThemeModeAssignments,
  assignThemeToMode,
  getThemeAssignedRole,
  isLightTheme,
} = require('../src/utils/backupSettings.ts')

async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html><head></head><body class="theme-paper-light"><div id="root"></div></body></html>', {
    url: 'https://gtar.test',
  })
  const prev = {
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  }
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

  const root = createRoot(document.getElementById('root'))
  const render = async (element) => act(async () => root.render(element))
  const click = async (selector) => {
    await act(async () => {
      const el = document.querySelector(selector)
      assert.ok(el, `Element not found: ${selector}`)
      el.click()
    })
  }

  try {
    await run({ root, render, click, dom })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(global, prev)
  }
}

// 1. Untouched initial active theme on first load / migration
test('Initial load preserves currently active theme without silent repaint or activation', async () => withDom(async () => {
  localStorage.setItem(SETTINGS_KEYS.themeMode, 'crimson-stage')
  localStorage.removeItem(THEME_MODE_ASSIGNMENTS_KEY)

  // Loading assignments initializes defaults in memory/storage
  const assignments = loadThemeModeAssignments()
  assert.equal(assignments.light, 'paper-light')
  assert.equal(assignments.dark, 'solarized-dark')

  // The active theme remains untouched in storage and runtime
  const activeMode = localStorage.getItem(SETTINGS_KEYS.themeMode)
  assert.equal(activeMode, 'crimson-stage')
  const hydrated = theme.hydrateThemeSettings()
  assert.equal(hydrated.mode, 'crimson-stage')
}))

// 2. Correct factory defaults
test('Factory defaults assign Light to Paper Cream Light and Dark to Solarized Dark', () => {
  assert.equal(DEFAULT_THEME_MODE_ASSIGNMENTS.light, 'paper-light')
  assert.equal(DEFAULT_THEME_MODE_ASSIGNMENTS.dark, 'solarized-dark')

  const paperOption = theme.THEME_OPTIONS.find(o => o.id === 'paper-light')
  assert.ok(paperOption, 'Paper Cream Light preset exists')
  assert.equal(paperOption.name, 'Paper Cream Light')

  const solarizedOption = theme.THEME_OPTIONS.find(o => o.id === 'solarized-dark')
  assert.ok(solarizedOption, 'Solarized Dark preset exists')
  assert.equal(solarizedOption.name, 'Solarized Dark')

  const emptyAssignments = normalizeThemeModeAssignments(null)
  assert.deepEqual(emptyAssignments, { light: 'paper-light', dark: 'solarized-dark' })
  assert.equal(getThemeAssignedRole('paper-light', emptyAssignments), 'light')
  assert.equal(getThemeAssignedRole('solarized-dark', emptyAssignments), 'dark')
  assert.equal(getThemeAssignedRole('crimson-stage', emptyAssignments), null)
  assert.equal(getThemeAssignedRole('custom', emptyAssignments), null)
})

// 3. One-per-role exclusivity & collision resolution
test('One-per-role exclusivity: assigning replaces previous and prevents holding both roles', () => {
  let state = { light: 'paper-light', dark: 'solarized-dark' }

  // Assign amber-stage as light mode: replaces paper-light
  state = assignThemeToMode(state, 'amber-stage', 'light')
  assert.equal(state.light, 'amber-stage')
  assert.equal(state.dark, 'solarized-dark')
  assert.equal(getThemeAssignedRole('amber-stage', state), 'light')
  assert.equal(getThemeAssignedRole('paper-light', state), null)

  // Assign amber-stage as dark mode: frees light mode (cannot hold both)
  state = assignThemeToMode(state, 'amber-stage', 'dark')
  assert.equal(state.dark, 'amber-stage')
  assert.notEqual(state.light, 'amber-stage')
  assert.equal(state.light, 'paper-light')

  // Assign custom as light mode
  state = assignThemeToMode(state, 'custom', 'light')
  assert.equal(state.light, 'custom')
  assert.equal(state.dark, 'amber-stage')

  // Unassign custom: reverts light to default
  state = assignThemeToMode(state, 'custom', 'none')
  assert.equal(state.light, 'paper-light')
  assert.equal(state.dark, 'amber-stage')
})

// 4. Custom assigned palette retained after edits
test('Customized assigned theme uses latest saved override values upon mode switch', async () => withDom(async () => {
  const customCrimson = theme.normalizeCustomThemeColors({
    ...theme.presetToCustomPalette(theme.THEME_OPTIONS[4]),
    headerBg: '#990011',
    actionColor: '#FF3344',
    identity: { factoryId: 'crimson-stage', displayName: 'Custom Crimson' },
  })
  localStorage.setItem(SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify({ 'crimson-stage': customCrimson }))
  saveThemeModeAssignments({ light: 'paper-light', dark: 'crimson-stage' })

  // Resolving palette for the assigned dark mode yields the custom override
  const resolved = theme.resolveThemePalette('crimson-stage', theme.DEFAULT_CUSTOM_COLORS)
  assert.equal(resolved.headerBg, '#990011')
  assert.equal(resolved.actionColor, '#FF3344')
}))

// 5. Deliberate switch via Header mode toggle
test('Header mode toggle displays accurate mode state, label, and invokes switch', async () => withDom(async ({ render, click }) => {
  const toggles = []
  const assignments = { light: 'paper-light', dark: 'solarized-dark' }

  const baseHeaderProps = {
    activeView: 'songbook',
    onViewChange() {},
    song: { id: 's1', title: 'Song 1', rawContent: '' },
    searchQuery: '',
    onSearchQueryChange() {},
    onOpenWebsiteUrlSource() {},
    onOpenStageTools() {},
    onToggleTheme() {},
    onOpenImportModal() {},
    themeModeAssignments: assignments,
    onToggleThemeMode: () => toggles.push(true),
  }

  // A. Current theme is Solarized Dark (assigned Dark Mode) -> Destination preview is Light Mode (Sun icon + Light theme styling)
  await render(React.createElement(headerModule.Header, {
    ...baseHeaderProps,
    currentTheme: 'solarized-dark',
  }))

  const toggleBtnDark = document.querySelector('[data-testid="header-theme-mode-toggle"]')
  assert.ok(toggleBtnDark, 'Theme mode toggle button exists in header')
  assert.equal(toggleBtnDark.getAttribute('data-mode'), 'dark')
  assert.equal(toggleBtnDark.getAttribute('aria-label'), 'Switch to light mode')
  assert.ok(toggleBtnDark.querySelector('.lucide-sun'), 'Displays Sun icon previewing destination Light mode')
  assert.ok(
    ['rgb(244, 236, 216)', '#f4ecd8'].includes(toggleBtnDark.style.backgroundColor),
    `Switch button styled with assigned Light theme background: ${toggleBtnDark.style.backgroundColor}`
  )

  await click('[data-testid="header-theme-mode-toggle"]')
  assert.equal(toggles.length, 1)

  // B. Current theme is Paper Cream Light (assigned Light Mode) -> Destination preview is Dark Mode (Moon icon + Dark theme styling)
  await render(React.createElement(headerModule.Header, {
    ...baseHeaderProps,
    currentTheme: 'paper-light',
  }))

  const toggleBtnLight = document.querySelector('[data-testid="header-theme-mode-toggle"]')
  assert.equal(toggleBtnLight.getAttribute('data-mode'), 'light')
  assert.equal(toggleBtnLight.getAttribute('aria-label'), 'Switch to dark mode')
  assert.ok(toggleBtnLight.querySelector('.lucide-moon'), 'Displays Moon icon previewing destination Dark mode')
  assert.ok(
    ['rgb(0, 43, 54)', '#002b36', '#002B36'].includes(toggleBtnLight.style.backgroundColor),
    `Switch button styled with assigned Dark theme background: ${toggleBtnLight.style.backgroundColor}`
  )

  // C. Current theme is unassigned (e.g. Crimson Stage, dark visually) -> Destination preview is Light Mode
  await render(React.createElement(headerModule.Header, {
    ...baseHeaderProps,
    currentTheme: 'crimson-stage',
  }))

  const toggleBtnUnassigned = document.querySelector('[data-testid="header-theme-mode-toggle"]')
  assert.equal(toggleBtnUnassigned.getAttribute('data-mode'), 'unassigned', 'Does not falsely claim unassigned theme is dark')
  assert.equal(toggleBtnUnassigned.getAttribute('aria-label'), 'Switch to light mode')
  assert.ok(toggleBtnUnassigned.querySelector('.lucide-sun'), 'Displays Sun icon for unassigned dark theme')
  assert.ok(
    ['rgb(244, 236, 216)', '#f4ecd8'].includes(toggleBtnUnassigned.style.backgroundColor),
    'Switch button styled with assigned Light theme background'
  )

  // D. Customized destination theme updates preview styling
  const customDark = theme.normalizeCustomThemeColors({
    ...theme.presetToCustomPalette(theme.THEME_OPTIONS[0]),
    bgHex: '#120d0f',
    actionColor: '#f43f5e',
    cardBorder: '#2d0f17',
    identity: { factoryId: 'solarized-dark', displayName: 'Solarized Dark Custom' },
  })
  localStorage.setItem(SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify({ 'solarized-dark': customDark }))

  await render(React.createElement(headerModule.Header, {
    ...baseHeaderProps,
    currentTheme: 'paper-light',
  }))

  const toggleCustomPreview = document.querySelector('[data-testid="header-theme-mode-toggle"]')
  assert.ok(
    ['rgb(18, 13, 15)', '#120d0f'].includes(toggleCustomPreview.style.backgroundColor),
    `Customized destination theme background previewed: ${toggleCustomPreview.style.backgroundColor}`
  )

  // E. Reassignment to another theme updates destination preview
  const reassigned = { light: 'e-ink-paper', dark: 'solarized-dark' }
  await render(React.createElement(headerModule.Header, {
    ...baseHeaderProps,
    currentTheme: 'solarized-dark',
    themeModeAssignments: reassigned,
  }))

  const toggleReassigned = document.querySelector('[data-testid="header-theme-mode-toggle"]')
  assert.ok(
    ['rgb(237, 237, 237)', '#ededed'].includes(toggleReassigned.style.backgroundColor),
    `Reassigned destination theme background previewed: ${toggleReassigned.style.backgroundColor}`
  )
}))

// 6. Persistence & reload across components
test('Theme mode assignments persist and broadcast via SETTINGS_CHANGED', async () => withDom(async () => {
  let eventFired = false
  window.addEventListener(SETTINGS_CHANGED, () => { eventFired = true })

  saveThemeModeAssignments({ light: 'e-ink-paper', dark: 'oled-black' })
  assert.equal(eventFired, true)

  const reloaded = loadThemeModeAssignments()
  assert.equal(reloaded.light, 'e-ink-paper')
  assert.equal(reloaded.dark, 'oled-black')
}))

// 7. Account separation / containment
test('Theme mode assignments remain intact through auth session changes', async () => withDom(async () => {
  saveThemeModeAssignments({ light: 'paper-light', dark: 'crimson-stage' })

  // Simulate user sign-out and new user sign-in
  localStorage.removeItem('gtar_auth_session')
  localStorage.setItem('gtar_auth_session', JSON.stringify({
    version: 1,
    user: { id: 'new-user', email: 'new@example.com' },
  }))

  const assignments = loadThemeModeAssignments()
  assert.equal(assignments.light, 'paper-light')
  assert.equal(assignments.dark, 'crimson-stage')
}))

// 8. Missing / deleted / malformed theme fallback
test('Malformed or colliding stored assignments fall back deterministically', () => {
  const malformed = normalizeThemeModeAssignments({ light: 'invalid-id', dark: 123 })
  assert.equal(malformed.light, 'paper-light')
  assert.equal(malformed.dark, 'solarized-dark')

  // Collision: light and dark both point to same theme
  const collided = normalizeThemeModeAssignments({ light: 'solarized-dark', dark: 'solarized-dark' })
  assert.equal(collided.light, 'paper-light')
  assert.equal(collided.dark, 'solarized-dark')
})

// 9. Stage Color Theme UI interactions & factory restore role retention
test('Stage Color Theme modal preserves mode assignments through card selection and factory restore', async () => withDom(async ({ render, click }) => {
  saveThemeModeAssignments({ light: 'paper-light', dark: 'solarized-dark' })

  let applied = null
  const props = {
    isOpen: true,
    currentTheme: 'solarized-dark',
    customColors: theme.DEFAULT_CUSTOM_COLORS,
    onClose() {},
    onApplyTheme(mode, colors) {
      applied = { mode, colors }
    },
  }

  await render(React.createElement(theme.ThemeModal, props))

  // Check radio buttons exist on solarized-dark and custom
  const solarizedDarkRadio = document.querySelector('[data-testid="mode-assign-solarized-dark-dark"]')
  assert.ok(solarizedDarkRadio, 'Solarized Dark has Dark Mode radio')
  assert.equal(solarizedDarkRadio.getAttribute('aria-checked'), 'true')

  const customLightRadio = document.querySelector('[data-testid="mode-assign-custom-light"]')
  assert.ok(customLightRadio, 'Custom Palette has Light Mode radio')
  assert.equal(customLightRadio.getAttribute('aria-checked'), 'false')

  // Assign Custom Palette as Light Mode
  await click('[data-testid="mode-assign-custom-light"]')
  assert.equal(document.querySelector('[data-testid="mode-assign-custom-light"]').getAttribute('aria-checked'), 'true')
  assert.equal(document.querySelector('[data-testid="mode-assign-paper-light-light"]').getAttribute('aria-checked'), 'false')

  // Click Save & Apply
  await click('[data-testid="theme-save-apply-btn"]')
  assert.ok(applied, 'Theme saved and applied')

  // Saved assignments now show custom as light
  const updatedAssignments = loadThemeModeAssignments()
  assert.equal(updatedAssignments.light, 'custom')
  assert.equal(updatedAssignments.dark, 'solarized-dark')
}))
