const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f)
const bs = require('../src/utils/backupSettings.ts')
const { persistLibrary } = require('../src/utils/syncJournal.ts')
const { QuotaStorage } = require('./helpers/syntheticSongbook.cjs')
const locks = { request: async (_name, _options, fn) => fn({}) }
const palette = bg => ({ bgHex: bg, textHex: '#ffffff', chordHex: '#abcdef', sectionHex: '#654321' })
function source() {
  const storage = new QuotaStorage(Number.MAX_SAFE_INTEGER)
  storage.setItem(bs.SETTINGS_KEYS.themeMode, 'paper-light')
  storage.setItem(bs.THEME_MODE_ASSIGNMENTS_KEY, JSON.stringify({ light: 'custom', dark: 'azure-stage' }))
  storage.setItem(bs.SETTINGS_KEYS.customThemeColors, JSON.stringify(palette('#123456')))
  storage.setItem(bs.SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify({ 'azure-stage': { ...palette('#112233'), identity: { factoryId: 'azure-stage', displayName: 'My blue' } } }))
  storage.setItem(bs.STANDALONE_PALETTE_KEY, JSON.stringify(palette('#334455')))
  storage.setItem('gtar_tv_font_size', '40')
  return storage
}

test('#372 assignment write failure rolls back colors; failed rollback retains verified recovery', async () => {
  for (const recovery of [false, true]) {
    const storage = source(); persistLibrary({ songs: [], setlists: [] }, storage)
    const settings = bs.readBackupSettingsV2(source())
    delete settings.appearance.themeMode
    settings.appearance.customThemeColors.bgHex = '#abcdef'
    settings.appearance.themeModeAssignments = { light: 'paper-light', dark: 'oled-black' }
    const previous = [...storage.map], set = storage.setItem.bind(storage)
    let failed = false
    storage.setItem = (key, value) => {
      if (key === bs.THEME_MODE_ASSIGNMENTS_KEY && value.includes('oled-black')) { failed = true; throw Error('disk full') }
      if (recovery && failed && key === bs.SETTINGS_KEYS.customThemeColors) throw Error('rollback unavailable')
      set(key, value)
    }
    await assert.rejects(() => bs.restoreBackupSettingsV2(settings, { appearance: true, preferences: true }, storage, { locks }))
    storage.setItem = set
    if (recovery) {
      const copy = bs.inspectSettingsRecovery(storage)
      assert.equal(copy.state, 'pending')
      const result = await bs.restorePreviousSettings(storage, { locks, expectedRaw: copy.raw })
      assert.deepEqual(result.unresolved, []); assert.equal(result.cleared, true)
    } else assert.equal(bs.inspectSettingsRecovery(storage).state, 'none')
    for (const [key, value] of previous.filter(([key]) => bs.backupSettingsStorageKeys().includes(key))) assert.equal(storage.getItem(key), value, key)
  }
})
