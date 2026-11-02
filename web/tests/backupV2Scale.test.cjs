// #251 Cloud V2 P0: backup schema v2, verified export (share / download / copy), restore choices,
// restore verification, safety snapshot fallback and backup status.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText,
    filename
  )
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { makeLibrary, QuotaStorage } = require('./helpers/syntheticSongbook.cjs')
const { FakeLockManager, installNavigatorLocks } = require('./helpers/fakeLocks.cjs')
// Settings restore requires Web Locks (#257); tests share one origin-wide lock manager like real tabs.
const sharedLocks = installNavigatorLocks()

class MemoryStorage extends QuotaStorage { constructor() { super(Number.MAX_SAFE_INTEGER) } }
global.localStorage = new MemoryStorage()

const jb = require('../src/utils/jsonBackup.ts')
const bs = require('../src/utils/backupSettings.ts')
const status = require('../src/utils/backupStatus.ts')
const ex = require('../src/utils/backupExport.ts')
const { persistLibrary, readPersistedLibrary, LIBRARY_KEY, inspectRecovery } = require('../src/utils/syncJournal.ts')
const { mergeBackupLibrary } = require('../src/utils/setlistSongs.ts')
const { mergeImportedSetlists } = require('../src/utils/importIdentity.ts')
/** The App's smart-merge persistence (useLibraryImports.handleSmartMerge), for dialog tests. */
function appMerge(storage = localStorage) {
  return (songs, setlists) => {
    const before = readPersistedLibrary(storage) ?? { songs: [], setlists: [] }
    const merged = mergeBackupLibrary(before.songs, songs, setlists)
    persistLibrary({ songs: merged.songs, setlists: mergeImportedSetlists(before.setlists, merged.setlists) }, storage, { force: true })
  }
}
const { DeviceBackupCard } = require('../src/components/DeviceBackupCard.tsx')

const palette = (bg = '#123456') => ({ bgHex: bg, textHex: '#ffffff', chordHex: '#abcdef', sectionHex: '#654321', headerBg: '#112233' })
/** Every backed-up key with a non-default valid value, in the exact runtime encoding. */
function fullSettingsStorage(storage = new MemoryStorage()) {
  const raw = {
    [bs.SETTINGS_KEYS.themeMode]: 'azure-stage',
    [bs.SETTINGS_KEYS.customThemeColors]: JSON.stringify(palette()),
    [bs.SETTINGS_KEYS.factoryThemeOverrides]: JSON.stringify({ 'paper-light': { ...palette('#445566'), identity: { factoryId: 'paper-light', displayName: 'Mine' } } }),
    [bs.SETTINGS_KEYS.fontStyle]: 'serif',
    [bs.SETTINGS_KEYS.isTwoColumn]: 'true',
    [bs.SETTINGS_KEYS.fontSizePx]: '31',
    [bs.SETTINGS_KEYS.scrollSpeed]: '77',
    gtar_standalone_custom_theme_colors: JSON.stringify(palette('#0a0b0c')),
    gtar_stage_chord_scale: '1.2',
    gtar_stage_font_weight: 'bold',
    gtar_stage_line_spacing: 'relaxed',
    gtar_stage_notation: 'numbers',
    gtar_tv_font_size: '44',
    gtar_edge_swipe_panel: 'true',
    gtar_songbook_sort: 'artist',
    gtar_songbook_filter_metadata: 'NEEDS_METADATA',
    gtar_songbook_filter_setlist: 'set-7',
    gtar_songbook_setlists_collapsed: 'true',
    gtar_songbook_songs_collapsed: 'false',
  }
  for (const [k, v] of Object.entries(raw)) storage.setItem(k, v)
  return { storage, raw }
}
const APPEARANCE_KEYS = [...Object.values(bs.SETTINGS_KEYS), ...Object.values(bs.APPEARANCE_EXTRA_SETTINGS).map(s => s.key)]
const PREFERENCE_KEYS = Object.values(bs.PREFERENCE_SETTINGS).map(s => s.key)
/** Device/session state that must never enter a backup. */
const EXCLUDED = {
  gtar_auth_session: JSON.stringify({ user: { id: 'SECRET-owner-id' }, sessionToken: 'SECRET-auth-token' }), gtar_google_session: 'SECRET-google', gtar_web_debug_logs: '[{"message":"SECRET-log"}]',
  'gtar_sync_recovery:x': 'SECRET-recovery', gtar_records_sync_v1: 'SECRET-records', gtar_cloud_sync_base: 'SECRET-base',
  gtar_cloud_sync_meta: 'SECRET-meta', gtar_library_owner_v1: JSON.stringify({ v: 1, userId: 'SECRET-owner-id', env: 'unknown', boundAt: 1, reason: 'confirmed' }), gtar_band_sync_leader_ip: 'SECRET-ip',
  gtar_stage_dock_pos: 'SECRET-dock', gtar_cast_session_id: 'SECRET-cast', gtar_debug_logs_enabled: 'SECRET-logs-on',
  gtar_backup_status_v1: '{"SECRET":"status"}', gtar_backup_reminder_v1: '{"SECRET":"reminder"}', gtar_pending_share_token: 'SECRET-share',
}

function largeLibrary() {
  const { songs } = makeLibrary(10000, 0)
  songs.forEach((song, i) => { if (i % 50 === 0) song.isDeleted = true })
  const setlists = Array.from({ length: 300 }, (_, i) => ({
    id: `set-${i}`, name: `Setlist ${i}`, createdAt: 1_700_000_000_000 + i, ...(i % 30 === 0 ? { isDeleted: true } : {}),
    songs: songs.filter(s => !s.isDeleted).slice((i * 17) % 9000, (i * 17) % 9000 + 12).map(s => ({ id: s.id, title: s.title, artist: s.artist })),
  }))
  return { songs, setlists }
}



test('10,000 songs + 300 setlists + trash + every setting: export → verify → import is lossless', async () => {
  const { storage, raw } = fullSettingsStorage()
  for (const [k, v] of Object.entries(EXCLUDED)) storage.setItem(k, v)
  global.localStorage = storage
  const { songs, setlists } = largeLibrary()
  const backup = jb.buildVerifiedBackup(songs, setlists, '1.0.139-dev.1')
  assert.equal(backup.schemaVersion, 2)
  assert.deepEqual(backup.counts, { songs: 9800, trash: 200, setlists: 300 })
  assert.ok(backup.bytes > 10 * 1024 * 1024, 'synthetic library is realistically large')
  for (const secret of Object.values(EXCLUDED)) assert.equal(backup.json.includes(secret), false, `excluded value leaked: ${secret}`)

  const parsed = jb.parseBackupJson(backup.json)
  assert.equal(parsed.isValid, true, parsed.error)
  assert.deepEqual(parsed.ignoredFields, [])
  const expected = songs.map(jb.normalizeBackupSong)
  assert.equal(JSON.stringify(parsed.songs), JSON.stringify(expected))
  assert.equal(jb.stableStringify(parsed.setlists), jb.stableStringify(setlists))
  assert.equal(jb.libraryFingerprint(parsed.songs, parsed.setlists), backup.fingerprint)

  // Restoring every group into a clean device reproduces every key byte-for-byte, and nothing else.
  const target = new MemoryStorage()
  const result = await bs.restoreBackupSettingsV2(parsed.settings, { appearance: true, preferences: true }, target)
  assert.deepEqual(new Set(result.written), new Set(Object.keys(raw)))
  for (const [k, v] of Object.entries(raw)) assert.equal(target.getItem(k), v, k)
  // The previous-settings copy is retired after a verified success (#257).
  assert.equal(target.length, Object.keys(raw).length)
  assert.equal(target.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), null)
  global.localStorage = new MemoryStorage()
})
