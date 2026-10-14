const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const webDir = path.resolve(__dirname, '..')

// Transpile typescript helper for testing ThemeModal and backupSettings
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

const { THEME_OPTIONS } = require('../src/components/ThemeModal.tsx')
const { THEME_MODES, validateBackupSettings } = require('../src/utils/backupSettings.ts')

// =============================================================================
// 1. PRESET ORDER & NAMING CONTRACT
// =============================================================================
test('DEV3B_PRESET_ORDER: 7 built-in presets defined in exact required stable order', () => {
  const expectedOrder = [
    { id: 'solarized-dark', name: 'Solarized Dark', tag: 'DEFAULT' },
    { id: 'amber-stage', name: 'Amber Stage' },
    { id: 'oled-black', name: 'OLED Pure Black' },
    { id: 'paper-light', name: 'Paper Cream Light' },
    { id: 'crimson-stage', name: 'Crimson Stage' },
    { id: 'azure-stage', name: 'Azure Stage' },
    { id: 'e-ink-paper', name: 'E-Ink Paper' },
  ]

  assert.equal(THEME_OPTIONS.length, 7, 'Must have exactly 7 built-in presets')

  for (let i = 0; i < expectedOrder.length; i++) {
    assert.equal(THEME_OPTIONS[i].id, expectedOrder[i].id, `Preset index ${i} id must be ${expectedOrder[i].id}`)
    assert.equal(THEME_OPTIONS[i].name, expectedOrder[i].name, `Preset index ${i} name must be ${expectedOrder[i].name}`)
    if (expectedOrder[i].tag) {
      assert.equal(THEME_OPTIONS[i].tag, expectedOrder[i].tag, `Preset index ${i} tag must match`)
    } else {
      assert.equal(THEME_OPTIONS[i].tag, undefined, `Preset index ${i} must have no verbose tag`)
    }
  }

  // Verify THEME_MODES union includes all 7 presets plus custom in stable order
  const expectedThemeModes = [
    'solarized-dark',
    'amber-stage',
    'oled-black',
    'paper-light',
    'crimson-stage',
    'azure-stage',
    'e-ink-paper',
    'custom',
  ]
  assert.deepEqual([...THEME_MODES], expectedThemeModes, 'THEME_MODES contains all presets and custom in stable order')

  // Validation accepts all presets
  for (const theme of expectedThemeModes) {
    const errs = validateBackupSettings({ themeMode: theme })
    assert.equal(errs.length, 0, `validateBackupSettings should accept theme: ${theme}`)
  }
})

// =============================================================================
// 2. AMBER STAGE VS OLED PURE BLACK VISUAL IDENTITY
// =============================================================================
test('DEV3B_AMBER_VS_OLED_DISTINCTION: Amber Stage is warm dark with gold/amber accents, OLED is true-black with cool accents', () => {
  const amber = THEME_OPTIONS.find((t) => t.id === 'amber-stage')
  const oled = THEME_OPTIONS.find((t) => t.id === 'oled-black')

  assert.ok(amber, 'Amber Stage preset must exist')
  assert.ok(oled, 'OLED Pure Black preset must exist')

  // OLED must be pure true-black #000000
  assert.equal(oled.bgHex.toLowerCase(), '#000000', 'OLED bg must be pure true-black #000000')
  assert.equal(oled.surfaceHex.toLowerCase(), '#111111', 'OLED surface must be minimal deep black #111111')
  assert.equal(oled.textHex.toLowerCase(), '#ffffff', 'OLED text must be true white #FFFFFF')
  assert.equal(oled.accentHex.toLowerCase(), '#38bdf8', 'OLED accent must be cool light sky/cyan #38BDF8')

  // Amber Stage must be warm dark (not pure black #000000 and distinct from OLED)
  assert.notEqual(amber.bgHex.toLowerCase(), oled.bgHex.toLowerCase(), 'Amber bg must not be OLED pure black')
  assert.equal(amber.bgHex.toLowerCase(), '#181206', 'Amber bg must be warm dark #181206')
  assert.equal(amber.surfaceHex.toLowerCase(), '#241c0c', 'Amber surface must be warm dark #241c0c')
  assert.equal(amber.textHex.toLowerCase(), '#fff8e7', 'Amber text must be warm cream #FFF8E7')
  assert.equal(amber.accentHex.toLowerCase(), '#f59e0b', 'Amber accent must be warm amber/gold #F59E0B')

  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')
  assert.ok(css.includes('body.theme-custom {'))
  assert.ok(!/body\.theme-(amber-stage|oled-black)/.test(css))

})

// =============================================================================
// 3. NEW PRESETS PRESENCE & PALETTE (CRIMSON, AZURE, E-INK PAPER)
// =============================================================================
test('DEV3B_NEW_PRESETS_PRESENCE: Crimson Stage, Azure Stage, and E-Ink Paper are configured with correct palettes', () => {
  const crimson = THEME_OPTIONS.find((t) => t.id === 'crimson-stage')
  const azure = THEME_OPTIONS.find((t) => t.id === 'azure-stage')
  const eInk = THEME_OPTIONS.find((t) => t.id === 'e-ink-paper')

  assert.ok(crimson, 'Crimson Stage preset must exist')
  assert.equal(crimson.name, 'Crimson Stage')
  assert.equal(crimson.bgHex.toLowerCase(), '#120d0f')
  assert.equal(crimson.surfaceHex.toLowerCase(), '#1f1418')
  assert.equal(crimson.accentHex.toLowerCase(), '#e11d48')
  assert.equal(crimson.textHex.toLowerCase(), '#fee2e2')

  assert.ok(azure, 'Azure Stage preset must exist')
  assert.equal(azure.name, 'Azure Stage')
  assert.equal(azure.bgHex.toLowerCase(), '#0a1324')
  assert.equal(azure.surfaceHex.toLowerCase(), '#11203b')
  assert.equal(azure.accentHex.toLowerCase(), '#06b6d4')
  assert.equal(azure.textHex.toLowerCase(), '#e0f2fe')

  assert.ok(eInk, 'E-Ink Paper preset must exist')
  assert.equal(eInk.name, 'E-Ink Paper')
  assert.equal(eInk.bgHex.toLowerCase(), '#ededed')
  assert.equal(eInk.surfaceHex.toLowerCase(), '#f8f8f8')
  assert.equal(eInk.accentHex.toLowerCase(), '#404040')
  assert.equal(eInk.textHex.toLowerCase(), '#111111')

  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')
  assert.ok(!/body\.theme-(crimson-stage|azure-stage|e-ink-paper)/.test(css))

})

// =============================================================================
// 4. SIMPLIFIED PRESET CARDS: NO SUBTITLES OR VERBOSE DESCRIPTIONS
// =============================================================================
test('DEV3B_SIMPLIFIED_CARDS: Descriptive subtitles removed from preset and custom cards', () => {
  const themeModalSource = fs.readFileSync(path.join(webDir, 'src/components/ThemeModal.tsx'), 'utf8')

  // In THEME_OPTIONS array, no subtitle property defined
  for (const theme of THEME_OPTIONS) {
    assert.equal(theme.subtitle, undefined, `Theme ${theme.id} must not have a subtitle`)
  }

  // In the JSX template, theme.subtitle is not rendered
  assert.ok(!themeModalSource.includes('{theme.subtitle}'), 'ThemeModal card template must not render {theme.subtitle}')

  // Custom card description paragraph is also removed
  assert.ok(!themeModalSource.includes('Personalized colors for background, lyrics, chords & section headers'),
    'Custom Palette card must not render verbose descriptive subtitle')

  // Preserved badges: minimal DEFAULT on Solarized Dark and CUSTOM on Custom Palette
  const solarized = THEME_OPTIONS.find((t) => t.id === 'solarized-dark')
  assert.equal(solarized.tag, 'DEFAULT', 'Solarized Dark retains DEFAULT badge')
  assert.ok(themeModalSource.includes('CUSTOM'), 'Custom Palette retains CUSTOM badge')
  assert.ok(!themeModalSource.includes("'POPULAR'"), 'Verbose POPULAR badge removed')
  assert.ok(!themeModalSource.includes("'BATTERY'"), 'Verbose BATTERY badge removed')
  assert.ok(!themeModalSource.includes("'DAYLIGHT'"), 'Verbose DAYLIGHT badge removed')
})

// =============================================================================
// 5. THEME SELECTION, PERSISTENCE & SAVE & APPLY BEHAVIOR
// =============================================================================
test('DEV3B_SAVE_AND_APPLY_CONTRACT: ThemeModal preserves Save & Apply, Cancel, and persistence logic', () => {
  const themeModalSource = fs.readFileSync(path.join(webDir, 'src/components/ThemeModal.tsx'), 'utf8')

  // Handler structure
  assert.ok(themeModalSource.includes('handleSaveAndApply'), 'handleSaveAndApply function preserved')
  assert.ok(themeModalSource.includes('localStorage.setItem(SETTINGS_KEYS.themeMode, mode)'), 'Persists staged theme to localStorage')
  assert.ok(themeModalSource.includes('onApplyTheme?.(mode, resolveThemePalette(mode, standalone, nextOverrides))'), 'Calls onApplyTheme on save')
  assert.ok(themeModalSource.includes('onSelectTheme?.(mode)'), 'Calls onSelectTheme fallback on save')
  assert.ok(themeModalSource.includes('Cancel'), 'Cancel button preserved')
  assert.ok(themeModalSource.includes('Save & Apply'), 'Save & Apply button preserved')

  const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  assert.ok(appSource.includes('applyThemeRuntime(stageTheme, customThemeColors)'))

})
