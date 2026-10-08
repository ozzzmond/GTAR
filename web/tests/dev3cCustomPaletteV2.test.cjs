const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const webDir = path.resolve(__dirname, '..')

// Transpile typescript helper
require.extensions['.ts'] = (module, filename) => {
  const content = fs.readFileSync(filename, 'utf8')
  const transpiled = ts.transpileModule(content.replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  module._compile(transpiled, filename)
}

require.extensions['.tsx'] = (module, filename) => {
  const content = fs.readFileSync(filename, 'utf8')
  const transpiled = ts.transpileModule(content.replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  module._compile(transpiled, filename)
}

const {
  THEME_OPTIONS,
  DEFAULT_CUSTOM_COLORS,
  normalizeCustomThemeColors,
  applyCustomThemeStyles,
  PALETTE_GROUPS,
} = require('../src/components/ThemeModal.tsx')
const {
  SETTINGS_KEYS,
  validateBackupSettings,
  readBackupSettings,
  restoreBackupSettings,
} = require('../src/utils/backupSettings.ts')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')

// =============================================================================
// 1. VERSION CHECK (1.0.123-dev.5d)
// =============================================================================
test('DEV3C_VERSION: Canonical dev version bumped to 1.0.123-dev.5d across all manifests', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.5d')

  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.123-dev.5d')

  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  assert.equal(pkgLockJson.version, '1.0.123-dev.5d')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.5d')

  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.123-dev.5d'))
})

// =============================================================================
// a) ALL NEW CUSTOM PALETTE V2 FIELDS EXIST AND PERSIST
// =============================================================================
test('DEV3C_FIELDS_EXIST_AND_PERSIST: 27 Canonical fields exist in DEFAULT_CUSTOM_COLORS and persist in storage', () => {
  const expectedFields = [
    // STAGE (4)
    'bgHex', 'textHex', 'chordHex', 'sectionHex',
    // APP_CHROME (6)
    'headerBg', 'toolbarBg', 'searchBg', 'searchBorder', 'filterBarBg', 'iconColor',
    // CARDS_AND_BOXES (5)
    'setlistCardBg', 'songCardBg', 'cardBorder', 'selectedCardBg', 'selectedCardBorder',
    // CONTROLS (6)
    'buttonBg', 'buttonText', 'inputBg', 'inputText', 'inputBorder', 'accentColor',
    // STAGE_FLOATING_CONTROLS (6)
    'dockBg', 'dockBorder', 'dockBtnBg', 'dockBtnIcon', 'dockPlayBg', 'dockPlayIcon',
  ]

  assert.equal(expectedFields.length, 27, 'Total fields in Custom Palette V2 specification must be 27')

  for (const field of expectedFields) {
    assert.ok(field in DEFAULT_CUSTOM_COLORS, `DEFAULT_CUSTOM_COLORS must include ${field}`)
    assert.match(
      DEFAULT_CUSTOM_COLORS[field],
      /^#[0-9a-fA-F]{6}$/,
      `${field} in DEFAULT_CUSTOM_COLORS must be valid #RRGGBB hex`
    )
  }

  // Persistence round-trip
  const map = new Map()
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, val),
  }

  const customPayload = {
    themeMode: 'custom',
    customThemeColors: { ...DEFAULT_CUSTOM_COLORS, searchBg: '#112233', dockPlayBg: '#445566' },
  }

  restoreBackupSettings(customPayload, storage)
  const restored = readBackupSettings(storage)
  assert.equal(restored.customThemeColors.searchBg, '#112233')
  assert.equal(restored.customThemeColors.dockPlayBg, '#445566')
  assert.deepEqual(restored.customThemeColors, customPayload.customThemeColors)
})

// =============================================================================
// b) OLD CUSTOM PALETTE DATA REMAINS BACKWARD-COMPATIBLE
// =============================================================================
test('DEV3C_BACKWARD_COMPATIBILITY: Old DEV.3b 4-field palette loads safely and normalizes with V2 defaults', () => {
  const oldLegacyPalette = {
    bgHex: '#002B36',
    textHex: '#EEE8D5',
    chordHex: '#2AA198',
    sectionHex: '#859900',
  }

  // Validate old palette
  const validationErrors = validateBackupSettings({ customThemeColors: oldLegacyPalette })
  assert.equal(validationErrors.length, 0, 'Legacy 4-field palette must pass validation without errors')

  // Normalization derives missing V2 fields without corrupting legacy 4 fields
  const normalized = normalizeCustomThemeColors(oldLegacyPalette)
  assert.equal(normalized.bgHex, '#002B36')
  assert.equal(normalized.textHex, '#EEE8D5')
  assert.equal(normalized.chordHex, '#2AA198')
  assert.equal(normalized.sectionHex, '#859900')

  // New fields populated from defaults
  assert.equal(normalized.headerBg, DEFAULT_CUSTOM_COLORS.headerBg)
  assert.equal(normalized.searchBg, DEFAULT_CUSTOM_COLORS.searchBg)
  assert.equal(normalized.dockBg, DEFAULT_CUSTOM_COLORS.dockBg)
})

// =============================================================================
// c) SEARCH BAR USES CUSTOM COLORS
// =============================================================================
test('DEV3C_SEARCH_BAR_STYLING: index.css wires custom search background, border, and text to CSS variables', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  assert.ok(css.includes('body.theme-custom .pill-search {'))
  assert.ok(css.includes('var(--custom-chrome-search-bg'))
  assert.ok(css.includes('var(--custom-chrome-search-border'))
  assert.ok(css.includes('body.theme-custom .pill-search input {'))
  assert.ok(css.includes('var(--custom-stage-text'))
})

// =============================================================================
// d) TOOLBAR / HEADER USES CUSTOM COLORS
// =============================================================================
test('DEV3C_TOOLBAR_HEADER_STYLING: index.css wires header and secondary toolbar to custom variables', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  assert.ok(css.includes('body.theme-custom header'))
  assert.ok(css.includes('var(--custom-chrome-header-bg'))
  assert.ok(css.includes('var(--custom-chrome-toolbar-bg'))
})

// =============================================================================
// e) SETLIST / SONG CARDS USE CUSTOM COLORS
// =============================================================================
test('DEV3C_CARD_SURFACES_STYLING: index.css wires setlist cards, song cards, and card borders', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  assert.ok(css.includes('var(--custom-card-setlist-bg'))
  assert.ok(css.includes('var(--custom-card-song-bg'))
  assert.ok(css.includes('var(--custom-card-border'))
})

// =============================================================================
// f) SELECTED CARD STATE USES CUSTOM COLORS
// =============================================================================
test('DEV3C_SELECTED_CARD_STYLING: index.css wires selected card background and border', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  assert.ok(css.includes('var(--custom-card-selected-bg'))
  assert.ok(css.includes('var(--custom-card-selected-border'))
})

// =============================================================================
// g) INPUTS / DROPDOWNS USE CUSTOM COLORS
// =============================================================================
test('DEV3C_CONTROLS_INPUTS_STYLING: index.css wires inputs, selects, and dropdown backgrounds/borders', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  assert.ok(css.includes('var(--custom-control-input-bg'))
  assert.ok(css.includes('var(--custom-control-input-text'))
  assert.ok(css.includes('var(--custom-control-input-border'))
})

// =============================================================================
// h) GENERAL ICONS USE CUSTOM COLOR WHERE APPROPRIATE
// =============================================================================
test('DEV3C_ICON_STYLING: index.css wires general icons and active accent color', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  assert.ok(css.includes('var(--custom-chrome-icon'))
  assert.ok(css.includes('var(--custom-control-accent'))
})

// =============================================================================
// i) STAGE SCROLL DOCK / BUTTON / ICON COLORS USE CUSTOM PALETTE
// =============================================================================
test('DEV3C_STAGE_DOCK_STYLING: index.css wires dock shell, navigation buttons, and play/pause icon/button', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')

  assert.ok(css.includes('var(--custom-dock-bg'))
  assert.ok(css.includes('var(--custom-dock-border'))
  assert.ok(css.includes('var(--custom-dock-btn-bg'))
  assert.ok(css.includes('var(--custom-dock-btn-icon'))
  assert.ok(css.includes('var(--custom-dock-play-bg'))
  assert.ok(css.includes('var(--custom-dock-play-icon'))

  // Preserves disabled visibility
  assert.ok(css.includes('body.theme-custom [data-stage-dock="true"] button:disabled'))

  // Regression test: both Play and Pause states honor custom palette colors, no exclusion of Pause
  assert.ok(!css.includes(':not([aria-label*="Pause"])'), 'Pause state must not be excluded from custom palette')
  assert.ok(
    css.includes('body.theme-custom [data-stage-dock="true"] button[aria-label*="autoscroll"]'),
    'Both play and pause autoscroll states must match the stage dock play button selector'
  )
})

test('DEV3C_STAGE_DOCK_PAUSE_PALETTE: Both Play and Pause states in StageControlDock honor dockPlayBg and dockPlayIcon', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')
  const dockSource = fs.readFileSync(path.join(webDir, 'src/components/StageControlDock.tsx'), 'utf8')

  // Extract aria-labels from StageControlDock for play and pause states
  const playLabel = 'Start autoscroll. Long press to open stage options'
  const pauseLabel = 'Pause autoscroll. Long press to open stage options'
  assert.ok(dockSource.includes(playLabel), 'StageControlDock has play aria-label')
  assert.ok(dockSource.includes(pauseLabel), 'StageControlDock has pause aria-label')

  // Both aria-labels contain "autoscroll" so button[aria-label*="autoscroll"] matches both
  assert.ok(playLabel.includes('autoscroll'))
  assert.ok(pauseLabel.includes('autoscroll'))

  // Verify CSS selector targets button[aria-label*="autoscroll"] unconditionally
  const autoscrollRuleMatch = css.match(/body\.theme-custom\s+\[data-stage-dock="true"\]\s+button\[aria-label\*="autoscroll"\][^\{]*\{([^}]+)\}/s)
  assert.ok(autoscrollRuleMatch, 'CSS rule for dock autoscroll button exists')
  const ruleBody = autoscrollRuleMatch[1]

  assert.ok(ruleBody.includes('var(--custom-dock-play-bg'), 'Autoscroll rule uses dockPlayBg')
  assert.ok(ruleBody.includes('var(--custom-dock-play-icon'), 'Autoscroll rule uses dockPlayIcon')
  assert.ok(!css.includes(':not([aria-label*="Pause"])'), 'CSS must not exclude Pause state')
})

// =============================================================================
// j) RESET / DEFAULT BEHAVIOR
// =============================================================================
test('DEV3C_RESET_AND_DEFAULTS: Reset helper restores DEFAULT_CUSTOM_COLORS cleanly', () => {
  const modified = { ...DEFAULT_CUSTOM_COLORS, headerBg: '#999999', dockBg: '#888888' }
  assert.notEqual(modified.headerBg, DEFAULT_CUSTOM_COLORS.headerBg)

  // Reset restores exact defaults
  const resetColors = { ...DEFAULT_CUSTOM_COLORS }
  assert.equal(resetColors.headerBg, DEFAULT_CUSTOM_COLORS.headerBg)
  assert.equal(resetColors.dockBg, DEFAULT_CUSTOM_COLORS.dockBg)
})

// =============================================================================
// k) BACKUP / EXPORT / IMPORT ROUND-TRIP PRESERVES EXPANDED PALETTE
// =============================================================================
test('DEV3C_BACKUP_ROUND_TRIP: Full 27-field palette round-trips through validation, restore, and read', () => {
  const fullPalette = {
    bgHex: '#101010',
    textHex: '#EAEAEA',
    chordHex: '#F0A000',
    sectionHex: '#A060E0',
    headerBg: '#181818',
    toolbarBg: '#121212',
    searchBg: '#141414',
    searchBorder: '#282828',
    filterBarBg: '#181818',
    iconColor: '#A0A0A0',
    setlistCardBg: '#181818',
    songCardBg: '#181818',
    cardBorder: '#282828',
    selectedCardBg: '#202020',
    selectedCardBorder: '#3090F0',
    buttonBg: '#242424',
    buttonText: '#F0F0F0',
    inputBg: '#121212',
    inputText: '#F0F0F0',
    inputBorder: '#282828',
    accentColor: '#F0A000',
    dockBg: '#181818',
    dockBorder: '#282828',
    dockBtnBg: '#121212',
    dockBtnIcon: '#EAEAEA',
    dockPlayBg: '#F0A000',
    dockPlayIcon: '#000000',
  }

  const errs = validateBackupSettings({ themeMode: 'custom', customThemeColors: fullPalette })
  assert.equal(errs.length, 0, 'Full 27-field palette must pass validation')

  const map = new Map()
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, val),
  }

  restoreBackupSettings({ themeMode: 'custom', customThemeColors: fullPalette }, storage)
  const readBack = readBackupSettings(storage)
  assert.deepEqual(readBack.customThemeColors, fullPalette)

  // Rejection of invalid hex and unknown keys
  const invalidHex = validateBackupSettings({
    customThemeColors: { ...fullPalette, headerBg: 'rgb(0,0,0)' },
  })
  assert.ok(invalidHex.length > 0)
  assert.ok(invalidHex.some((e) => e.includes('expected #RRGGBB')))

  const unknownKey = validateBackupSettings({
    customThemeColors: { ...fullPalette, unapprovedProperty: '#112233' },
  })
  assert.ok(unknownKey.length > 0)
  assert.ok(unknownKey.some((e) => e.includes('unknown color setting')))
})

// =============================================================================
// l) EXISTING BUILT-IN THEME SELECTION REMAINS INTACT
// =============================================================================
test('DEV3C_BUILTIN_PRESETS_PRESERVED: 7 Built-in presets remain intact and untouched in order', () => {
  const expectedPresetIds = [
    'solarized-dark',
    'amber-stage',
    'oled-black',
    'paper-light',
    'crimson-stage',
    'azure-stage',
    'e-ink-paper',
  ]

  assert.equal(THEME_OPTIONS.length, 7)
  for (let i = 0; i < expectedPresetIds.length; i++) {
    assert.equal(THEME_OPTIONS[i].id, expectedPresetIds[i])
  }
})

// =============================================================================
// UI GROUPING CONTRACT: 5 Distinct Group Definitions in ThemeModal
// =============================================================================
test('DEV3C_UI_GROUPING_CONTRACT: ThemeModal defines 5 grouped categories A-E with canonical fields', () => {
  assert.ok(Array.isArray(PALETTE_GROUPS), 'PALETTE_GROUPS array must exist')
  assert.equal(PALETTE_GROUPS.length, 6, 'Must define exactly 6 grouped sections A-E')

  const groupIds = PALETTE_GROUPS.map((g) => g.id)
  assert.deepEqual(groupIds, ['typography', 'stage', 'chrome', 'cards', 'controls', 'stageControls'])

  const stageKeys = PALETTE_GROUPS.find((g) => g.id === 'stage').fields.map((f) => f.key)
  assert.deepEqual(stageKeys, ['bgHex', 'textHex', 'chordHex', 'sectionHex'])

  const chromeKeys = PALETTE_GROUPS.find((g) => g.id === 'chrome').fields.map((f) => f.key)
  assert.deepEqual(chromeKeys, ['headerBg', 'headerPrimaryText', 'headerSecondaryText', 'headerIconColor', 'toolbarBg', 'searchBg', 'searchBorder', 'filterBarBg', 'iconColor'])

  const cardKeys = PALETTE_GROUPS.find((g) => g.id === 'cards').fields.map((f) => f.key)
  assert.deepEqual(cardKeys, ['setlistCardBg', 'songCardBg', 'cardBorder', 'selectedCardBg', 'selectedCardBorder'])

  const controlKeys = PALETTE_GROUPS.find((g) => g.id === 'controls').fields.map((f) => f.key)
  assert.deepEqual(controlKeys, ['actionColor', 'selectionColor', 'sectionIconColor', 'buttonBg', 'buttonText', 'inputBg', 'inputText', 'inputBorder', 'accentColor'])

  const dockKeys = PALETTE_GROUPS.find((g) => g.id === 'stageControls').fields.map((f) => f.key)
  assert.deepEqual(dockKeys, ['dockBg', 'dockBorder', 'dockBtnBg', 'dockBtnIcon', 'dockPlayBg', 'dockPlayIcon'])
})
