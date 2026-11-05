const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f)
const bs = require('../src/utils/backupSettings.ts')
const format = require('../src/utils/cloudBackupFormat.ts')
const cloud = require('../src/utils/manualCloudBackup.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const { QuotaStorage } = require('./helpers/syntheticSongbook.cjs')
const old = require('./fixtures/cloudBackupSettingsV2.json')
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
const capture = storage => cloud.captureCloudBackup({ songs: [], setlists: [] }, storage)
const record = data => ({ version: 1, updatedAt: '2026-11-05T00:00:00Z', data, checksum: format.computeSongbookChecksum(data) })
const restore = (storage, data, choice = { appearance: true, preferences: true }) => cloud.restoreCloudBackup(
  readPersistedLibrary(storage), data, 'replace', lib => persistLibrary(lib, storage), storage, { locks, choice })

test('#372 old settings-v2 fixture retains the exact dev HEAD checksum and original bytes', async () => {
  const raw = JSON.stringify(old)
  assert.equal(format.computeSongbookChecksum(old.data), 'ck_af61519599369113')
  assert.equal(format.verifySongbookChecksum(old), true)
  const target = source(); persistLibrary({ songs: [], setlists: [] }, target)
  await restore(target, old.data)
  assert.equal(target.getItem(bs.SETTINGS_KEYS.themeMode), 'paper-light')
  assert.deepEqual(bs.loadThemeModeAssignments(target), { light: 'paper-light', dark: 'solarized-dark' })
  assert.deepEqual(JSON.parse(target.getItem(bs.SETTINGS_KEYS.customThemeColors)), old.data.settings.appearance.customThemeColors)
  assert.equal(JSON.stringify(old), raw, 'legacy record is never edited in place')
  const changed = structuredClone(old); changed.data.settings.appearance.themeMode = 'oled-black'
  assert.equal(format.verifySongbookChecksum(changed), false, 'old mode still covered')
})

test('#372 new envelope covers roles, palettes, stage/TV, preferences and library; excludes only active mode', () => {
  const storage = source(), initial = record(capture(storage))
  assert.equal(initial.data.settingsSchemaVersion, 3)
  assert.equal(initial.data.checksumScheme, 'gtar-backup-settings-v3')
  assert.equal('themeMode' in initial.data.settings.appearance, false)
  assert.deepEqual(initial.data.settings.appearance.themeModeAssignments, { light: 'custom', dark: 'azure-stage' })
  for (const mode of ['solarized-dark', 'paper-light', 'custom']) {
    storage.setItem(bs.SETTINGS_KEYS.themeMode, mode)
    assert.equal(format.computeSongbookChecksum(capture(storage)), initial.checksum)
  }
  for (const edit of [
    d => { d.settings.appearance.themeModeAssignments.light = 'e-ink-paper' },
    d => { d.settings.appearance.themeModeAssignments.dark = 'oled-black' },
    d => { d.settings.appearance.customThemeColors.bgHex = '#222222' },
    d => { d.settings.appearance.factoryThemeOverrides['azure-stage'].textHex = '#222222' },
    d => { d.settings.appearance.standaloneCustomThemeColors.chordHex = '#222222' },
    d => { d.settings.appearance.tvFontSize = 44 },
    d => { d.settings.appearance.stageSettings = { fontSizePx: 30 } },
    d => { d.settings.preferences.songbookSort = 'artist' },
    d => { d.songs.push({ id: 'song', title: 'Song', rawContent: '[C]Song' }) },
    d => { d.setlists.push({ id: 'set', name: 'Set', songs: [] }) },
  ]) {
    const changed = structuredClone(initial); edit(changed.data)
    assert.equal(format.verifySongbookChecksum(changed), false, 'tamper rejected')
    assert.notEqual(format.computeSongbookChecksum(changed.data), initial.checksum)
  }
})

test('#372 upload readback and explicit appearance restore preserve both mappings and every saved color', async () => {
  const storage = source(), data = capture(storage)
  const previousFetch = global.fetch
  let saved
  try {
    global.fetch = async (_url, options) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body)
        assert.equal(body.data.checksumScheme, 'gtar-backup-settings-v3')
        saved = { ...record(body.data), userId: 'A', checksum: body.clientChecksum }
      }
      return new Response(JSON.stringify({ success: true, cloudRecord: saved }))
    }
    const verified = await cloud.writeCloudBackup({ token: 't', userId: 'A' }, data, null)
    assert.equal(format.verifySongbookChecksum(verified), true)
    const target = new QuotaStorage(Number.MAX_SAFE_INTEGER)
    target.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
    persistLibrary({ songs: [], setlists: [] }, target)
    await restore(target, verified.data, { appearance: false, preferences: true })
    assert.equal(target.getItem(bs.THEME_MODE_ASSIGNMENTS_KEY), null)
    await restore(target, verified.data)
    for (const key of [bs.THEME_MODE_ASSIGNMENTS_KEY, bs.SETTINGS_KEYS.customThemeColors, bs.SETTINGS_KEYS.factoryThemeOverrides, bs.STANDALONE_PALETTE_KEY, 'gtar_tv_font_size']) {
      assert.equal(target.getItem(key), storage.getItem(key), key)
    }
    assert.equal(target.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black', 'active mode preserved')
    assert.equal(bs.inspectSettingsRecovery(target).state, 'none')
  } finally { global.fetch = previousFetch }
})

test('#372 malformed mappings and scheme/version confusion fail before any restore write', async () => {
  const good = capture(source())
  const malformed = [null, [], {}, { light: 'custom' }, { light: 'custom', dark: 'custom' },
    { light: 'missing', dark: 'solarized-dark' }, { light: 'paper-light', dark: 'solarized-dark', extra: true }]
  const bad = malformed.map(assignments => {
    const d = structuredClone(good); d.settings.appearance.themeModeAssignments = assignments; return d
  })
  const missing = structuredClone(good); delete missing.settings.appearance.themeModeAssignments; bad.push(missing)
  bad.push({ ...good, settingsSchemaVersion: 2 }, { ...good, checksumScheme: format.SETTINGS_CHECKSUM_SCHEME, settingsSchemaVersion: 2 },
    { ...good, settings: { appearance: 1, preferences: {} } })
  const mode = structuredClone(good); mode.settings.appearance.themeMode = 'paper-light'; bad.push(mode)
  for (const data of bad) {
    assert.equal(format.verifySongbookChecksum(record(data)), false)
    const storage = source(); persistLibrary({ songs: [], setlists: [] }, storage)
    const before = [...storage.map]
    await assert.rejects(() => restore(storage, data))
    assert.deepEqual([...storage.map], before, 'no partial writes, including library/snapshot')
  }
  const relabelled = { ...old, data: { ...old.data, checksumScheme: format.SMART_SETTINGS_CHECKSUM_SCHEME, settingsSchemaVersion: 3 } }
  assert.equal(format.verifySongbookChecksum(relabelled), false)
})

test('#372 assignment write failure rolls back colors; failed rollback retains verified recovery', async () => {
  for (const recovery of [false, true]) {
    const storage = source(); persistLibrary({ songs: [], setlists: [] }, storage)
    const data = capture(source())
    data.settings.appearance.customThemeColors.bgHex = '#abcdef'
    data.settings.appearance.themeModeAssignments = { light: 'paper-light', dark: 'oled-black' }
    const previous = [...storage.map], set = storage.setItem.bind(storage)
    let failed = false
    storage.setItem = (key, value) => {
      if (key === bs.THEME_MODE_ASSIGNMENTS_KEY && value.includes('oled-black')) { failed = true; throw Error('disk full') }
      if (recovery && failed && key === bs.SETTINGS_KEYS.customThemeColors) throw Error('rollback unavailable')
      set(key, value)
    }
    await assert.rejects(() => restore(storage, data), /settings restore did not complete/)
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
