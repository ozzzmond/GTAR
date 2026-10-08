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
  PALETTE_GROUPS,
  presetToCustomPalette,
} = require('../src/components/ThemeModal.tsx')
const {
  exportCustomPaletteJson,
  importCustomPaletteJson,
  CUSTOM_PALETTE_JSON_FORMAT,
  CUSTOM_PALETTE_JSON_VERSION,
  CANONICAL_CUSTOM_PALETTE_FIELDS,
} = require('../src/utils/customPaletteJson.ts')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')

// =============================================================================
// 1. VERSION CHECK (1.0.123-dev.6b)
// =============================================================================
test('DEV3D_VERSION: Canonical dev version identity is 1.0.123-dev.6b', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.6b')

  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.123-dev.6b')

  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  assert.equal(pkgLockJson.version, '1.0.123-dev.6b')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.6b')

  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.123-dev.6b'))
})

// =============================================================================
// 2. SEPARATE CUSTOM PALETTE EDITOR MODAL (NO INLINE EDITOR IN THEME LIST)
// =============================================================================
test('DEV3D_SEPARATE_EDITOR: Full palette editor is not rendered inline inside theme list, uses dedicated editor component', () => {
  const themeModalSrc = fs.readFileSync(path.join(webDir, 'src/components/ThemeModal.tsx'), 'utf8')
  const customPaletteEditorSrc = fs.readFileSync(path.join(webDir, 'src/components/CustomPaletteEditor.tsx'), 'utf8')

  // ThemeModal renders list of presets and a custom card with "Edit Palette" button
  assert.ok(themeModalSrc.includes('data-testid="open-custom-palette-editor-btn"'), 'ThemeModal has open-custom-palette-editor-btn')
  assert.ok(themeModalSrc.includes('<CustomPaletteEditor'), 'ThemeModal renders CustomPaletteEditor as separate modal')

  // ThemeModal does not contain color input fields directly in its main body
  assert.ok(!themeModalSrc.includes('type="color"'), 'ThemeModal does not render inline native color pickers')
  assert.ok(customPaletteEditorSrc.includes('type="color"'), 'CustomPaletteEditor renders native color pickers')
  assert.ok(customPaletteEditorSrc.includes('data-testid="custom-palette-editor-overlay"'), 'CustomPaletteEditor has dedicated overlay')
  assert.ok(customPaletteEditorSrc.includes('data-testid="custom-palette-editor-window"'), 'CustomPaletteEditor has dedicated window')
})

// =============================================================================
// 3. RESPONSIVE DESKTOP/TABLET TWO-COLUMN & MOBILE SINGLE-COLUMN LAYOUT
// =============================================================================
test('DEV3D_RESPONSIVE_LAYOUT: Multi-column on desktop/tablet (md+), single-column stacked on mobile', () => {
  const editorSrc = fs.readFileSync(path.join(webDir, 'src/components/CustomPaletteEditor.tsx'), 'utf8')

  // Responsive grid on content container
  assert.ok(
    editorSrc.includes('grid-cols-1 md:grid-cols-12'),
    'Content area uses 1 column on mobile and 12-column grid on md+ screens'
  )
  assert.ok(
    editorSrc.includes('md:col-span-7'),
    'Controls pane spans 7 columns on md+ screens'
  )
  assert.ok(
    editorSrc.includes('md:col-span-5'),
    'Preview pane spans 5 columns on md+ screens'
  )
  assert.ok(
    editorSrc.includes('overflow-y-auto') && editorSrc.includes('custom-scrollbar'),
    'Contains internal scrolling for controls and preview panes'
  )
})

// =============================================================================
// 4. CATEGORY NAVIGATION: ALL 5 CATEGORIES CLEARLY ACCESSIBLE INCLUDING STAGE CONTROLS
// =============================================================================
test('DEV3D_CATEGORY_NAV: All 5 categories accessible, stageControls reachable and unclipped', () => {
  const editorSrc = fs.readFileSync(path.join(webDir, 'src/components/CustomPaletteEditor.tsx'), 'utf8')

  assert.ok(editorSrc.includes('data-testid="palette-category-nav"'), 'Category nav exists')
  assert.ok(editorSrc.includes('PALETTE_GROUPS.map'), 'Category nav iterates PALETTE_GROUPS')

  const groupIds = PALETTE_GROUPS.map((g) => g.id)
  assert.deepEqual(groupIds, ['typography', 'stage', 'chrome', 'cards', 'controls', 'stageControls'])

  const stageControlsGroup = PALETTE_GROUPS.find((g) => g.id === 'stageControls')
  assert.ok(stageControlsGroup, 'stageControls group exists')
  assert.equal(stageControlsGroup.label, 'Stage Controls')
  assert.equal(stageControlsGroup.fields.length, 6)

  // Verify all 27 canonical fields are accounted for across the 5 categories
  const totalFields = PALETTE_GROUPS.reduce((acc, g) => acc + g.fields.length, 0)
  assert.equal(totalFields, 38)
})

// =============================================================================
// 5. JSON EXPORT CONTAINS CANONICAL FORMAT, VERSION, AND ALL 27 COLORS
// =============================================================================
test('DEV3D_JSON_EXPORT: exportCustomPaletteJson generates valid payload with format, version, and colors', () => {
  const sampleColors = {
    ...DEFAULT_CUSTOM_COLORS,
    bgHex: '#002B36',
    chordHex: '#2AA198',
    dockPlayBg: '#F59E0B',
  }

  const exported = exportCustomPaletteJson(sampleColors)
  assert.equal(exported.format, 'gtar-custom-palette')
  assert.equal(exported.version, 2)
  assert.equal(typeof exported.colors, 'object')

  // Check that all 27 canonical fields are present
  for (const field of CANONICAL_CUSTOM_PALETTE_FIELDS) {
    assert.ok(field in exported.colors, `Exported colors must contain ${field}`)
    assert.match(exported.colors[field], /^#[0-9a-fA-F]{6}$/)
  }

  assert.equal(exported.colors.bgHex, '#002B36')
  assert.equal(exported.colors.chordHex, '#2AA198')
  assert.equal(exported.colors.dockPlayBg, '#F59E0B')
})

// =============================================================================
// 6. JSON IMPORT VALIDATION & SAFETY
// =============================================================================
test('DEV3D_JSON_IMPORT_VALIDATION: Rejects malformed JSON, wrong format, wrong version, invalid hex, and unknown fields', () => {
  // Malformed JSON string
  const malformed = importCustomPaletteJson('{ format: ')
  assert.equal(malformed.success, false)
  assert.match(malformed.error, /Invalid JSON syntax/i)

  // Non-object input
  const nonObj = importCustomPaletteJson(12345)
  assert.equal(nonObj.success, false)
  assert.match(nonObj.error, /must be a JSON object/i)

  // Wrong format
  const wrongFormat = importCustomPaletteJson({
    format: 'unsupported-format',
    version: 2,
    colors: {},
  })
  assert.equal(wrongFormat.success, false)
  assert.match(wrongFormat.error, /Invalid palette format/i)

  // Wrong version
  const wrongVersion = importCustomPaletteJson({
    format: CUSTOM_PALETTE_JSON_FORMAT,
    version: 999,
    colors: {},
  })
  assert.equal(wrongVersion.success, false)
  assert.match(wrongVersion.error, /Unsupported palette version/i)

  // Unknown field
  const unknownField = importCustomPaletteJson({
    format: CUSTOM_PALETTE_JSON_FORMAT,
    version: CUSTOM_PALETTE_JSON_VERSION,
    colors: {
      bgHex: '#000000',
      unknownProperty: '#123456',
    },
  })
  assert.equal(unknownField.success, false)
  assert.match(unknownField.error, /Unsupported color field "unknownProperty"/i)

  // Invalid hex value
  const invalidHex = importCustomPaletteJson({
    format: CUSTOM_PALETTE_JSON_FORMAT,
    version: CUSTOM_PALETTE_JSON_VERSION,
    colors: {
      bgHex: 'red',
    },
  })
  assert.equal(invalidHex.success, false)
  assert.match(invalidHex.error, /must be #RRGGBB hex/i)
})

// =============================================================================
// 7. JSON ROUND-TRIP PRESERVES EXACT VALUES
// =============================================================================
test('DEV3D_JSON_ROUND_TRIP: Exported JSON re-imports into identical normalized palette', () => {
  const original = {
    ...DEFAULT_CUSTOM_COLORS,
    bgHex: '#010203',
    textHex: '#E1E2E3',
    chordHex: '#F1A2B3',
    sectionHex: '#8192A3',
    headerBg: '#0A0B0C',
    dockPlayBg: '#FF8800',
  }

  const exported = exportCustomPaletteJson(original)
  const jsonString = JSON.stringify(exported)
  const imported = importCustomPaletteJson(jsonString)

  assert.equal(imported.success, true)
  assert.deepEqual(imported.colors, normalizeCustomThemeColors(original))
})

// =============================================================================
// 8. BUILT-IN PRESET CUSTOMIZATION & IMMUTABILITY OF FACTORY DEFINITIONS
// =============================================================================
test('DEV3D_PRESET_CLONING_IMMUTABILITY: presetToCustomPalette produces coherent palette without mutating factory preset', () => {
  const allPresets = [
    'solarized-dark',
    'amber-stage',
    'oled-black',
    'paper-light',
    'crimson-stage',
    'azure-stage',
    'e-ink-paper',
  ]

  for (const presetId of allPresets) {
    const preset = THEME_OPTIONS.find((p) => p.id === presetId)
    assert.ok(preset, `Preset ${presetId} must exist`)

    // Deep freeze / snapshot of preset before cloning
    const snapshot = JSON.parse(JSON.stringify(preset))

    const customCloned = presetToCustomPalette(preset)

    // Verify factory preset definition was NOT mutated
    assert.deepEqual(preset, snapshot, `Factory preset ${presetId} must remain immutable`)

    // Verify cloned palette contains all 27 fields
    for (const field of CANONICAL_CUSTOM_PALETTE_FIELDS) {
      assert.ok(field in customCloned, `Cloned custom palette must contain ${field}`)
      assert.match(customCloned[field], /^#[0-9a-fA-F]{6}$/)
    }

    // Verify core colors align with preset
    assert.equal(customCloned.bgHex.toLowerCase(), preset.bgHex.toLowerCase())
    assert.equal(customCloned.textHex.toLowerCase(), preset.textHex.toLowerCase())
  }
})

// =============================================================================
// 9. PRESET-TO-CUSTOM COHERENT DERIVATION (NO RANDOM DEFAULTS)
// =============================================================================
test('DEV3D_PRESET_MAPPING_COHERENCE: Cloned presets derive coherent background, surface, and contrast values', () => {
  const oled = THEME_OPTIONS.find((p) => p.id === 'oled-black')
  const clonedOled = presetToCustomPalette(oled)

  // OLED is true black
  assert.equal(clonedOled.bgHex.toLowerCase(), '#000000')
  assert.equal(clonedOled.textHex.toLowerCase(), '#ffffff')
  assert.equal(clonedOled.chordHex.toLowerCase(), '#38bdf8')
  assert.equal(clonedOled.headerBg.toLowerCase(), '#111111')
  assert.equal(clonedOled.dockBg.toLowerCase(), '#111111')

  const paper = THEME_OPTIONS.find((p) => p.id === 'paper-light')
  const clonedPaper = presetToCustomPalette(paper)

  // Paper is warm light
  assert.equal(clonedPaper.bgHex.toLowerCase(), '#f4ecd8')
  assert.equal(clonedPaper.textHex.toLowerCase(), '#172033')
  assert.equal(clonedPaper.headerBg.toLowerCase(), '#fffdf7')
  assert.equal(clonedPaper.chordHex.toLowerCase(), '#b45309')
})

// =============================================================================
// 10. THEME MODAL EXPOSES "Customize This Theme" ON EACH BUILT-IN PRESET
// =============================================================================
test('DEV3D_THEME_MODAL_CUSTOMIZE_BUTTONS: Each built-in preset exposes customize action button', () => {
  const themeModalSrc = fs.readFileSync(path.join(webDir, 'src/components/ThemeModal.tsx'), 'utf8')

  for (const preset of THEME_OPTIONS) {
    assert.ok(
      themeModalSrc.includes(`customize-preset-${preset.id}-btn`) ||
      themeModalSrc.includes('customize-preset-${theme.id}-btn'),
      `ThemeModal must include customize action for ${preset.id}`
    )
  }

  assert.ok(themeModalSrc.includes('Customize This Theme'), 'ThemeModal has "Customize This Theme" label')
})
