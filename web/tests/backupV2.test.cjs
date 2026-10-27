// #251 Cloud V2 P0: backup schema v2, verified export (share / download / copy), restore choices,
// restore verification, safety snapshot fallback, backup status and reminders.
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
const { BackupRestoreDialogModal } = require('../src/components/BackupRestoreDialogModal.tsx')

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
  gtar_auth_session: 'SECRET-auth-token', gtar_google_session: 'SECRET-google', gtar_web_debug_logs: '[{"message":"SECRET-log"}]',
  'gtar_sync_recovery:x': 'SECRET-recovery', gtar_records_sync_v1: 'SECRET-records', gtar_cloud_sync_base: 'SECRET-base',
  gtar_cloud_sync_meta: 'SECRET-meta', gtar_library_owner_v1: 'SECRET-owner', gtar_band_sync_leader_ip: 'SECRET-ip',
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

test('the backup keys are exactly the documented appearance + preference keys', async () => {
  assert.deepEqual(new Set(bs.backupSettingsStorageKeys()), new Set([...APPEARANCE_KEYS, ...PREFERENCE_KEYS]))
  const { raw } = fullSettingsStorage()
  assert.deepEqual(new Set(Object.keys(raw)), new Set(bs.backupSettingsStorageKeys()))
})

test('values the app would ignore are not exported; malformed v1 storage still blocks export', async () => {
  const storage = new MemoryStorage()
  storage.setItem('gtar_stage_chord_scale', '9'); storage.setItem('gtar_tv_font_size', '20px'); storage.setItem('gtar_edge_swipe_panel', 'yes')
  storage.setItem('gtar_songbook_sort', 'random'); storage.setItem('gtar_stage_font_weight', 'heavy')
  assert.deepEqual(bs.readBackupSettingsV2(storage), { appearance: {}, preferences: {} })
  storage.setItem(bs.SETTINGS_KEYS.customThemeColors, '{broken')
  assert.throws(() => bs.readBackupSettingsV2(storage))
})

test('v1 backups still import: all v1 settings become appearance and restore to the same keys', async () => {
  const v1 = { app: 'GTAR', schemaVersion: 1, version: '1.1.139', exportType: 'FULL_BACKUP', songCount: 1, setlistCount: 0, trashCount: 0,
    themeMode: 'paper-light', customThemeColors: palette(), stageSettings: { fontStyle: 'mono', fontSizePx: 20, isTwoColumn: true, scrollSpeed: 40 },
    songs: [{ id: 'a', title: 'A', artist: '', rawContent: '[C]a' }], setlists: [] }
  const parsed = jb.parseBackupJson(JSON.stringify(v1))
  assert.equal(parsed.isValid, true, parsed.error)
  assert.equal(parsed.metadata.schemaVersion, 1)
  assert.deepEqual(parsed.settings.preferences, {})
  assert.equal(parsed.settings.appearance.themeMode, 'paper-light')
  assert.deepEqual(parsed.stageSettings, v1.stageSettings) // legacy fields stay on the result for older callers
  const legacy = new MemoryStorage(); const v2 = new MemoryStorage()
  bs.restoreBackupSettings(parsed, legacy)
  await bs.restoreBackupSettingsV2(parsed.settings, bs.DEFAULT_SETTINGS_RESTORE_CHOICE, v2)
  v2.removeItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
  assert.deepEqual([...v2.map], [...legacy.map])
  // Unversioned (pre-schema) song arrays still import.
  assert.equal(jb.parseBackupJson(JSON.stringify([{ id: 'x', title: 'X', rawContent: '' }])).isValid, true)
})

test('invalid, incomplete and corrupted backups are rejected before any write', async () => {
  const good = JSON.parse(JSON.stringify(jb.createBackupPayload([{ id: 'a', title: 'A', rawContent: 'x' }], [])))
  const cases = [
    ['truncated', JSON.stringify(good).slice(0, -20)],
    ['not json', 'GTAR backup'],
    ['future schema', JSON.stringify({ ...good, schemaVersion: 3 })],
    ['v2 with top-level v1 settings', JSON.stringify({ ...good, themeMode: 'paper-light' })],
    ['settings object in v1', JSON.stringify({ ...good, schemaVersion: 1 })],
    ['unknown settings group', JSON.stringify({ ...good, settings: { ...good.settings, secrets: {} } })],
    ['unknown appearance field', JSON.stringify({ ...good, settings: { appearance: { glow: 1 }, preferences: {} } })],
    ['invalid preference', JSON.stringify({ ...good, settings: { appearance: {}, preferences: { songbookSort: 'random' } } })],
    ['invalid chord scale', JSON.stringify({ ...good, settings: { appearance: { chordScale: 2 }, preferences: {} } })],
    ['palette with identity as standalone', JSON.stringify({ ...good, settings: { appearance: { standaloneCustomThemeColors: { ...palette(), identity: { factoryId: 'paper-light', displayName: 'x' } } }, preferences: {} } })],
    ['songs not an array', JSON.stringify({ ...good, songs: {} })],
    ['malformed song', JSON.stringify({ ...good, songs: [{ id: 'a', title: '', rawContent: 1 }] })],
    ['dangling setlist ref', JSON.stringify({ ...good, setlists: [{ id: 's', name: 'S', songs: [{ id: 'missing', title: 'M' }] }] })],
  ]
  for (const [label, text] of cases) {
    const parsed = jb.parseBackupJson(text)
    assert.equal(parsed.isValid, false, label)
    assert.deepEqual(parsed.songs, [], label)
    assert.equal(typeof parsed.error, 'string', label)
  }
  const storage = { setItem() { assert.fail('wrote settings') }, getItem: () => null }
  await assert.rejects(() => bs.restoreBackupSettingsV2({ appearance: { glow: 1 }, preferences: {} }, { appearance: true, preferences: true }, storage))
})

test('fields this version does not know are reported, not silently dropped', async () => {
  const payload = JSON.parse(JSON.stringify(jb.createBackupPayload([{ id: 'a', title: 'A', rawContent: 'x' }], [{ id: 's', name: 'S', songs: [{ id: 'a', title: 'A' }] }])))
  delete payload.contentFingerprint // a hand-made or older file; an edited v2 file with a fingerprint is rejected (F4)
  payload.futureThing = 1; payload.songs[0].mood = 'happy'; payload.setlists[0].color = 'red'; payload.setlists[0].songs[0].note = 'n'
  const parsed = jb.parseBackupJson(JSON.stringify(payload))
  assert.equal(parsed.isValid, true, parsed.error)
  assert.deepEqual(parsed.ignoredFields, ['futureThing', 'setlists[].color', 'setlists[].songs[].note', 'songs[].mood'])
})

test('verification refuses bytes that do not restore to the same library', async () => {
  global.localStorage = new MemoryStorage()
  const payload = jb.createBackupPayload([{ id: 'a', title: 'A', rawContent: 'x' }, { id: 'b', title: 'B', rawContent: 'y', isDeleted: true }], [])
  const json = JSON.stringify(payload)
  assert.deepEqual(jb.verifyBackupJson(json, payload), { songs: 1, trash: 1, setlists: 0 })
  assert.throws(() => jb.verifyBackupJson(json.replace('"x"', '"z"'), payload), /verification failed.*contentFingerprint/s)
  assert.throws(() => jb.verifyBackupJson(JSON.stringify({ ...payload, songs: payload.songs.slice(0, 1) }), payload), /verification failed/)
  const noPrint = { ...payload }; delete noPrint.contentFingerprint
  assert.throws(() => jb.verifyBackupJson(JSON.stringify(noPrint).replace('"x"', '"z"'), noPrint), /songs differ/)
  assert.throws(() => jb.verifyBackupJson(json.slice(0, -2), payload), /verification failed/)
})

// Share sheet / download / copy paths
function fakeEnv({ canShare = true, shareError, clipboard = true } = {}) {
  const calls = { share: 0, downloads: [], copied: null }
  const env = {
    makeFile: (json, name) => ({ name, size: json.length }),
    download: (json, name) => calls.downloads.push(name),
    navigator: {
      canShare: () => canShare,
      share: async () => { calls.share++; if (typeof shareError === 'function') { const e = shareError(calls.share); if (e) throw e } else if (shareError) throw shareError },
      ...(clipboard ? { clipboard: { writeText: async text => { calls.copied = text } } } : {}),
    },
  }
  return { env, calls }
}
const named = name => Object.assign(new Error(name), { name })
function smallBackup() {
  global.localStorage = new MemoryStorage()
  return jb.buildVerifiedBackup([{ id: 'a', title: 'A', rawContent: 'x' }], [])
}

test('share supported → shared and status recorded; nothing downloaded', async () => {
  const backup = smallBackup()
  const { env, calls } = fakeEnv()
  assert.equal(ex.canShareBackupFile(backup, env), true)
  assert.deepEqual(await ex.shareOrDownloadBackup(backup, env), { kind: 'shared' })
  assert.equal(calls.share, 1); assert.deepEqual(calls.downloads, [])
  const saved = status.readBackupStatus()
  assert.equal(saved.delivery, 'share'); assert.equal(saved.songs, 1); assert.equal(saved.fingerprint, backup.fingerprint)
  assert.equal(saved.schemaVersion, 2)
  assert.equal(JSON.stringify(saved).includes('rawContent'), false)
})

test('share unsupported → download fallback; share failure → download; cancel → nothing recorded', async () => {
  let backup = smallBackup()
  let { env, calls } = fakeEnv({ canShare: false })
  assert.deepEqual(await ex.shareOrDownloadBackup(backup, env), { kind: 'downloaded', reason: 'share-unavailable' })
  assert.deepEqual(calls.downloads, [backup.fileName]); assert.equal(calls.share, 0)
  assert.equal(status.readBackupStatus().delivery, 'download')

  backup = smallBackup(); ({ env, calls } = fakeEnv({ shareError: new TypeError('boom') }))
  assert.deepEqual(await ex.shareOrDownloadBackup(backup, env), { kind: 'downloaded', reason: 'share-failed' })
  assert.equal(calls.downloads.length, 1)

  backup = smallBackup(); ({ env, calls } = fakeEnv({ shareError: named('AbortError') }))
  assert.deepEqual(await ex.shareOrDownloadBackup(backup, env), { kind: 'share-cancelled' })
  assert.deepEqual(calls.downloads, []); assert.equal(status.readBackupStatus(), null)

  // No navigator.share at all (older desktop browsers).
  backup = smallBackup()
  const downloads = []
  assert.equal((await ex.shareOrDownloadBackup(backup, { navigator: {}, download: (_j, n) => downloads.push(n) })).kind, 'downloaded')
  assert.equal(downloads.length, 1)
})

test('NotAllowedError keeps the verified file for one more tap', async () => {
  const backup = smallBackup()
  const { env, calls } = fakeEnv({ shareError: n => n === 1 ? named('NotAllowedError') : null })
  assert.deepEqual(await ex.shareOrDownloadBackup(backup, env), { kind: 'needs-tap' })
  assert.equal(status.readBackupStatus(), null)
  assert.deepEqual(await ex.shareOrDownloadBackup(backup, env), { kind: 'shared' })
  assert.equal(calls.share, 2); assert.deepEqual(calls.downloads, [])
})

test('Copy JSON only for small backups and only reports success after the clipboard accepted it', async () => {
  const backup = smallBackup()
  const { env, calls } = fakeEnv()
  assert.deepEqual(await ex.copyBackup(backup, env), { kind: 'copied' })
  assert.equal(calls.copied, backup.json)
  const big = { ...backup, bytes: jb.COPY_JSON_MAX_BYTES + 1 }
  assert.equal(ex.canCopyBackup(big), false)
  assert.equal((await ex.copyBackup(big, env)).kind, 'failed')
  assert.equal((await ex.copyBackup(backup, fakeEnv({ clipboard: false }).env)).kind, 'failed')
})

test('safety snapshot falls back to a verified recovery archive when the single snapshot does not fit', async () => {
  class SnapshotQuota extends MemoryStorage {
    setItem(k, v) { if (k === jb.RESTORE_SNAPSHOT_KEY) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); super.setItem(k, v) }
  }
  const storage = new SnapshotQuota()
  const library = { songs: [{ id: 'a', title: 'A', rawContent: 'x' }], setlists: [] }
  persistLibrary(library, storage)
  const result = await ex.ensureRestoreSafetySnapshot(library, storage)
  assert.equal(result.location, 'recovery-archive')
  assert.match(result.key, /^gtar_sync_recovery:restore-snapshot:/)
  assert.deepEqual(JSON.parse(storage.getItem(result.key)).local, library)
  // #257 review: the archive is in a format Recovery Review reads (not "invalid").
  const review = inspectRecovery(storage)
  const source = review.sources.find(item => item.key === result.key)
  assert.ok(source, 'archive listed in recovery review')
  assert.notEqual(source.status, 'invalid')
  // Neither fits: throws, nothing changes.
  const none = new QuotaStorage(10)
  await assert.rejects(ex.ensureRestoreSafetySnapshot(library, none), /safety snapshot/)
  assert.equal(none.length, 0)
})

test('verifyRestoredLibrary compares the complete canonical library (replace and merge)', async () => {
  const a = { id: 'a', title: 'A', artist: '', key: 'G', capo: '', bpm: '120', format: 'CHORD_PRO', transposeOffset: 0, rawContent: 'x', tags: 't1' }
  const b = { ...a, id: 'b', title: 'B', rawContent: 'y', tags: undefined }
  const sl = { id: 's', name: 'S', songs: [{ id: 'a', title: 'A', artist: '' }, { id: 'b', title: 'B', artist: '' }] }
  const empty = new MemoryStorage()
  assert.match(ex.verifyRestoredLibrary({ songs: [], setlists: [] }, { songs: [a], setlists: [] }, 'replace', empty)[0], /could not be read back/)
  for (const mode of ['replace', 'merge']) {
    const before = { songs: [{ ...a, id: 'keep', title: 'Keep' }], setlists: [] }
    const incoming = { songs: [a, b], setlists: [sl] }
    const good = ex.expectedRestoredLibrary(before, incoming, mode)
    const storage = new MemoryStorage()
    persistLibrary(good, storage)
    assert.deepEqual(ex.verifyRestoredLibrary(before, incoming, mode, storage), [], mode)
    const faults = {
      key: lib => { lib.songs.find(s => s.id === 'a').key = 'A' },
      tags: lib => { delete lib.songs.find(s => s.id === 'a').tags },
      transpose: lib => { lib.songs.find(s => s.id === 'a').transposeOffset = 2 },
      content: lib => { lib.songs.find(s => s.id === 'b').rawContent = 'y!' },
      trash: lib => { lib.songs.find(s => s.id === 'b').isDeleted = true },
      'setlist name': lib => { lib.setlists[0].name = 'Renamed' },
      membership: lib => { lib.setlists[0].songs.pop() },
      reference: lib => { lib.setlists[0].songs[1] = { id: 'a', title: 'A', artist: '' } },
      'reference order': lib => { lib.setlists[0].songs.reverse() },
      'song order': lib => { lib.songs.reverse() },
      'missing song': lib => { lib.songs = lib.songs.filter(s => s.id !== 'b'); lib.setlists[0].songs.pop() },
      'extra song': lib => { lib.songs.push({ ...a, id: 'z', title: 'Z' }) },
      'missing setlist': lib => { lib.setlists = [] },
      'other song changed (merge damage)': lib => { const k = lib.songs.find(s => s.id === 'keep'); if (k) k.title = 'Changed'; else lib.songs[0].artist = 'X' },
    }
    for (const [label, mutate] of Object.entries(faults)) {
      const bad = JSON.parse(JSON.stringify(good))
      mutate(bad)
      const store = new MemoryStorage()
      persistLibrary(bad, store, { force: true })
      const problems = ex.verifyRestoredLibrary(before, incoming, mode, store)
      assert.ok(problems.length > 0, `${mode}: ${label} must fail verification`)
    }
  }
  const store = new MemoryStorage()
  const bad = { songs: [{ ...a, key: 'A' }], setlists: [] }
  persistLibrary(bad, store)
  assert.match(ex.verifyRestoredLibrary({ songs: [], setlists: [] }, { songs: [a], setlists: [] }, 'replace', store)[0], /song a differs in key/)
})

test('reminders: never, stale with changes, large change, disabled, and not due', async () => {
  const day = 86400000, now = Date.parse('2026-10-27T00:00:00Z')
  const lib = { songs: 100, trash: 2, setlists: 5 }
  const on = { enabled: true, intervalDays: 14 }
  assert.deepEqual(status.backupReminderDue(null, lib, () => 'f', on, now), { due: true, reason: 'never' })
  assert.deepEqual(status.backupReminderDue(null, { songs: 0, trash: 0, setlists: 0 }, () => 'f', on, now), { due: false })
  const s = { v: 1, at: new Date(now - 15 * day).toISOString(), delivery: 'share', schemaVersion: 2, bytes: 1, songs: 100, trash: 2, setlists: 5, fingerprint: 'f' }
  assert.deepEqual(status.backupReminderDue(s, lib, () => 'g', on, now), { due: true, reason: 'stale', daysSince: 15 })
  assert.equal(status.backupReminderDue(s, lib, () => 'f', on, now).due, false, 'unchanged library is not stale')
  let hashed = 0
  const recent = { ...s, at: new Date(now - 2 * day).toISOString() }
  assert.equal(status.backupReminderDue(recent, lib, () => { hashed++; return 'g' }, on, now).due, false)
  assert.equal(hashed, 0, 'no library read before the interval passes')
  assert.deepEqual(status.backupReminderDue(recent, { ...lib, songs: 130 }, () => 'f', on, now), { due: true, reason: 'changed', daysSince: 2 })
  assert.deepEqual(status.backupReminderDue(null, lib, () => 'f', { enabled: false, intervalDays: 14 }, now), { due: false })
  assert.match(status.backupReminderMessage({ due: true, reason: 'stale', daysSince: 15 }), /15 days ago/)
  const store = new MemoryStorage()
  status.saveBackupReminder({ enabled: false, intervalDays: 30 }, store)
  assert.deepEqual(status.readBackupReminder(store), { enabled: false, intervalDays: 30 })
  store.setItem(status.BACKUP_REMINDER_KEY, '{"enabled":true,"intervalDays":3}')
  assert.deepEqual(status.readBackupReminder(store), status.DEFAULT_BACKUP_REMINDER)
})

// Dialog flows
function withJsdom(fn) {
  return async () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test/' })
    const prior = { window: global.window, document: global.document, localStorage: global.localStorage }
    Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
    const timers = new Set(), realSet = global.setTimeout, realClear = global.clearTimeout
    global.setTimeout = (cb, ms, ...args) => { const id = realSet(() => { timers.delete(id); cb(...args) }, ms); timers.add(id); return id }
    global.clearTimeout = id => { timers.delete(id); realClear(id) }
    const root = createRoot(document.getElementById('root'))
    try { await fn({ dom, root }) } finally {
      for (const id of timers) realClear(id)
      await act(async () => root.unmount())
      Object.assign(global, prior, { setTimeout: realSet, clearTimeout: realClear })
      dom.window.close()
    }
  }
}
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text))
const checkbox = text => [...document.querySelectorAll('label')].find(l => l.textContent.includes(text)).querySelector('input')
async function pick(dom, label, payload) {
  await act(async () => button(label).click())
  const input = document.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => JSON.stringify(payload) }] })
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
}

const current = { id: 'cur', title: 'Current', artist: '', rawContent: '[G]current' }
const incoming = { id: 'inc', title: 'Incoming', artist: '', rawContent: '[C]incoming' }
for (const mode of ['replace', 'merge']) {
  for (const appearance of [true, false]) {
    for (const preferences of [true, false]) {
      test(`restore ${mode} × appearance ${appearance} × preferences ${preferences}: only chosen settings, verified library, snapshot first`, withJsdom(async ({ dom, root }) => {
        // Source device: every setting set; build the file there.
        fullSettingsStorage(localStorage)
        const payload = JSON.parse(jb.buildVerifiedBackup([incoming], []).json)
        // Target device: different values everywhere, plus unrelated device state.
        localStorage.clear()
        const device = { [bs.SETTINGS_KEYS.themeMode]: 'oled-black', gtar_songbook_sort: 'date', gtar_stage_font_weight: 'medium', ...EXCLUDED }
        for (const [k, v] of Object.entries(device)) localStorage.setItem(k, v)
        persistLibrary({ songs: [current], setlists: [] })
        let snapshotBeforeWrite = false
        const save = (songs, setlists) => {
          snapshotBeforeWrite = !!localStorage.getItem(jb.RESTORE_SNAPSHOT_KEY)
          const base = mode === 'merge' ? [current] : []
          persistLibrary({ songs: [...base, ...songs], setlists }, localStorage, { force: true })
        }
        await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
          isOpen: true, onClose: () => {}, allSongs: [current], setlists: [], onImportAllSongs: () => assert.fail('fallback'),
          onFullRestore: save, onSmartMerge: save,
        })))
        assert.equal(checkbox('Appearance').checked, true, 'appearance restores by default')
        assert.equal(checkbox('Preferences').checked, false, 'preferences stay on the device by default')
        if (checkbox('Appearance').checked !== appearance) await act(async () => checkbox('Appearance').click())
        if (checkbox('Preferences').checked !== preferences) await act(async () => checkbox('Preferences').click())
        await pick(dom, mode === 'replace' ? 'Full Restore (Wipe & Replace)' : 'Restore Backup (Smart Merge)', payload)
        if (mode === 'replace') {
          assert.match(document.body.textContent, /This file has 10 appearance and 6 preference settings/)
          await act(async () => button('Confirm Wipe & Replace').click())
        }
        assert.match(document.body.textContent, /Backup restored: 1 songs, 0 setlists \(verified after saving\)/)
        assert.equal(snapshotBeforeWrite, true, 'verified safety snapshot exists before the library changes')
        assert.equal(JSON.parse(localStorage.getItem(jb.RESTORE_SNAPSHOT_KEY)).library.songs[0].id, 'cur')
        const ids = readPersistedLibrary().songs.map(s => s.id)
        assert.deepEqual(ids, mode === 'merge' ? ['cur', 'inc'] : ['inc'])
        const { raw } = fullSettingsStorage(new MemoryStorage())
        for (const key of APPEARANCE_KEYS) assert.equal(localStorage.getItem(key), appearance ? raw[key] : (device[key] ?? null), key)
        for (const key of PREFERENCE_KEYS) assert.equal(localStorage.getItem(key), preferences ? raw[key] : (device[key] ?? null), key)
        for (const [k, v] of Object.entries(EXCLUDED)) assert.equal(localStorage.getItem(k), v, `device state ${k} untouched`)
      }))
    }
  }
}

test('restore that does not read back correctly is not reported as success and leaves settings alone', withJsdom(async ({ dom, root }) => {
  persistLibrary({ songs: [current], setlists: [] })
  localStorage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
  const payload = { songs: [incoming], setlists: [], themeMode: 'paper-light' }
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: true, onClose: () => assert.fail('closed'), allSongs: [current], setlists: [], onImportAllSongs: () => {},
    onFullRestore: () => { /* claims success but saves nothing */ },
  })))
  await pick(dom, 'Full Restore (Wipe & Replace)', payload)
  await act(async () => button('Confirm Wipe & Replace').click())
  assert.match(document.body.textContent, /Restore could not be verified: song order or membership differs/)
  assert.doesNotMatch(document.body.textContent, /Backup restored:/)
  assert.equal(localStorage.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black')
  assert.equal(JSON.parse(localStorage.getItem(jb.RESTORE_SNAPSHOT_KEY)).library.songs[0].id, 'cur')
  assert.equal(readPersistedLibrary().songs[0].id, 'cur')
}))

test('merge aborts with zero library change when the safety snapshot cannot be saved', withJsdom(async ({ dom, root }) => {
  const storage = new QuotaStorage(10)
  let merged = false
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: true, onClose: () => {}, allSongs: [current], setlists: [], storage, onImportAllSongs: () => {},
    onSmartMerge: () => { merged = true },
  })))
  await pick(dom, 'Restore Backup (Smart Merge)', { songs: [incoming], setlists: [] })
  assert.match(document.body.textContent, /Restore aborted: pre-restore safety snapshot failed to save/)
  assert.equal(merged, false)
  assert.equal(storage.length, 0)
}))

test('dialog export: share sheet path with wording that never claims an upload; status shown', withJsdom(async ({ root }) => {
  persistLibrary({ songs: [current], setlists: [] })
  const { env, calls } = fakeEnv({ shareError: n => n === 1 ? named('NotAllowedError') : null })
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: true, onClose: () => assert.fail('export must not auto-close'), allSongs: [current], setlists: [], onImportAllSongs: () => {}, exportEnv: env,
  })))
  await act(async () => button('Export Backup').click())
  assert.match(document.querySelector('[data-testid="backup-status"]').textContent, /No backup made from this device yet/)
  await act(async () => button('Save backup file').click())
  assert.match(document.body.textContent, /Tap "Open share sheet"/)
  assert.equal(status.readBackupStatus(), null)
  await act(async () => button('Open share sheet').click())
  assert.equal(calls.share, 2)
  const text = document.body.textContent
  assert.match(text, /Backup file verified \(1 songs, 0 setlists, 0 in trash/)
  assert.match(text, /GTAR cannot see where it was saved/)
  assert.doesNotMatch(text, /uploaded|synced|cloud backup complete/i)
  assert.match(document.querySelector('[data-testid="backup-status"]').textContent, /Last backup: .*sent to the share sheet\. GTAR cannot confirm where the file was saved\./)
  // Download path from the same dialog.
  await act(async () => button('Download .json').click())
  assert.equal(calls.downloads.length, 1)
  assert.match(document.body.textContent, /handed to browser downloads/)
}))

test('dialog shows when the library changed after the last backup', withJsdom(async ({ root }) => {
  global.localStorage = localStorage
  const backup = jb.buildVerifiedBackup([current], [])
  status.recordBackupStatus(backup, 'download')
  const render = songs => act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: true, onClose: () => {}, allSongs: songs, setlists: [], onImportAllSongs: () => {},
  })))
  await render([current])
  await act(async () => button('Export Backup').click())
  await act(async () => new Promise(r => setTimeout(r, 5)))
  assert.doesNotMatch(document.body.textContent, /newer edits are not in it/)
  // Computed when the dialog opens (App re-renders constantly; the library is read once per opening).
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { isOpen: false, onClose: () => {}, allSongs: [], setlists: [], onImportAllSongs: () => {} })))
  await render([{ ...current, rawContent: '[G]edited' }])
  await act(async () => new Promise(r => setTimeout(r, 5)))
  assert.match(document.body.textContent, /Your library changed after this backup; the newer edits are not in it\./)
}))

test('menu export (download) is verified and recorded; Cloud V1 library keys are not touched', async () => {
  const storage = new MemoryStorage()
  global.localStorage = storage
  persistLibrary({ songs: [current], setlists: [] }, storage)
  const before = storage.getItem(LIBRARY_KEY)
  global.window = { document: undefined }
  global.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }
  const urls = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
  const priorUrl = global.URL
  global.URL = Object.assign(function () {}, priorUrl, urls)
  try {
    const name = jb.exportAllDataJson([current], [])
    assert.match(name, /^gtar-stage-backup-\d{4}-\d{2}-\d{2}\.json$/)
    assert.equal(status.readBackupStatus(storage).delivery, 'download')
    assert.equal(storage.getItem(LIBRARY_KEY), before)
  } finally { global.URL = priorUrl; delete global.window; delete global.document }
})

// #257 audit remediation: F2 settings rollback, F3 stale prepared export, F4 manifest validation, F1 through the dialog.
const ALL_SETTINGS = { appearance: true, preferences: true }
/** Storage that fails the nth settings write (the previous-settings snapshot write does not count). */
class FailingWrites extends MemoryStorage {
  constructor(failAt, { failPutBack = false, failSnapshot = false } = {}) { super(); this.failAt = failAt; this.writes = 0; this.failPutBack = failPutBack; this.failSnapshot = failSnapshot; this.armed = false }
  setItem(k, v) {
    if (this.armed && k === bs.SETTINGS_RESTORE_SNAPSHOT_KEY) { if (this.failSnapshot) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); return super.setItem(k, v) }
    if (this.armed) {
      this.writes++
      if (this.writes === this.failAt) throw Object.assign(new Error('Storage full'), { name: 'QuotaExceededError' })
      if (this.failPutBack && this.writes > this.failAt) throw new Error('still broken')
    }
    super.setItem(k, v)
  }
  removeItem(k) { if (this.armed && this.failPutBack && this.writes >= this.failAt) throw new Error('still broken'); super.removeItem(k) }
}
function backedUpSettings() {
  const { storage } = fullSettingsStorage()
  return bs.readBackupSettingsV2(storage)
}
function deviceSettings(storage) {
  // A different, partly empty device: some keys absent, some with other values.
  storage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black'); storage.setItem('gtar_stage_font_weight', 'medium'); storage.setItem('gtar_songbook_sort', 'date')
  storage.setItem('gtar_auth_session', 'SECRET-auth-token')
  return new Map(storage.map)
}

test('F2: a failed settings write at the start, middle or end is rolled back and read back', async () => {
  const settings = backedUpSettings()
  const total = bs.backupSettingsStorageKeys().length
  for (const [label, choice, count] of [['all', ALL_SETTINGS, total], ['appearance', { appearance: true, preferences: false }, 13], ['preferences', { appearance: false, preferences: true }, 6]]) {
    for (const failAt of [1, Math.ceil(count / 2), count]) {
      const storage = new FailingWrites(failAt)
      const before = deviceSettings(storage)
      storage.armed = true
      await assert.rejects(() => bs.restoreBackupSettingsV2(settings, choice, storage), error => {
        assert.equal(error.state, 'rolled-back', `${label} @${failAt}`)
        assert.match(error.message, /every setting was put back and verified/)
        assert.ok(error.failedKey)
        return true
      })
      const after = new Map(storage.map); after.delete(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
      assert.deepEqual([...after].sort(), [...before].sort(), `${label} @${failAt}: device settings identical after rollback`)
    }
  }
})

test('F2: when putting settings back also fails, the verified snapshot restores the previous settings', async () => {
  const settings = backedUpSettings()
  const storage = new FailingWrites(5, { failPutBack: true })
  const before = deviceSettings(storage)
  storage.armed = true
  let failure
  await assert.rejects(() => bs.restoreBackupSettingsV2(settings, ALL_SETTINGS, storage), error => { failure = error; return true })
  assert.equal(failure.state, 'partial')
  assert.ok(failure.unresolvedKeys.length > 0)
  assert.match(failure.message, /could not be put back/)
  const snapshot = bs.readSettingsRestoreSnapshot(storage)
  assert.equal(snapshot.values[bs.SETTINGS_KEYS.themeMode], 'oled-black')
  assert.equal(snapshot.values[bs.SETTINGS_KEYS.customThemeColors], null)
  // Storage recovers; the snapshot puts everything back exactly.
  storage.armed = false
  assert.deepEqual(await bs.restorePreviousSettings(storage), { unresolved: [], cleared: true })
  const after = new Map(storage.map); after.delete(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
  assert.deepEqual([...after].sort(), [...before].sort())
})

test('F2: if the previous-settings snapshot cannot be saved, no setting is written', async () => {
  const storage = new FailingWrites(99, { failSnapshot: true })
  const before = deviceSettings(storage)
  storage.armed = true
  await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, storage), error => error.state === 'snapshot' && /no setting was changed/.test(error.message))
  assert.equal(storage.writes, 0)
  assert.deepEqual([...storage.map], [...before])
  // A snapshot never lists keys outside the backup allowlist (device/session state stays out).
  const kept = new FailingWrites(3, { failPutBack: true }); deviceSettings(kept); kept.armed = true
  await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, kept), error => error.state === 'partial')
  const snap = bs.readSettingsRestoreSnapshot(kept)
  assert.equal('gtar_auth_session' in snap.values, false)
  assert.deepEqual(snap.keys, [...bs.backupSettingsStorageKeys()].sort())
})

for (const mode of ['replace', 'merge']) {
  test(`F2 dialog (${mode}): settings failure after a verified library save is rolled back and reported precisely`, withJsdom(async ({ dom, root }) => {
    fullSettingsStorage(localStorage)
    const payload = JSON.parse(jb.buildVerifiedBackup([incoming], []).json)
    localStorage.clear()
    persistLibrary({ songs: [current], setlists: [] })
    localStorage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
    const before = new Map(Object.entries({ ...localStorage }))
    const realSet = dom.window.Storage.prototype.setItem
    let settingsWrites = 0
    dom.window.Storage.prototype.setItem = function (k, v) {
      if (bs.backupSettingsStorageKeys().includes(k) && ++settingsWrites === 3) throw new dom.window.DOMException('Storage full', 'QuotaExceededError')
      return realSet.call(this, k, v)
    }
    try {
      await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
        isOpen: true, onClose: () => assert.fail('closed'), allSongs: [current], setlists: [], onImportAllSongs: () => {},
        onFullRestore: (songs, setlists) => persistLibrary({ songs, setlists }, localStorage, { force: true }), onSmartMerge: appMerge(),
      })))
      await pick(dom, mode === 'replace' ? 'Full Restore (Wipe & Replace)' : 'Restore Backup (Smart Merge)', payload)
      if (mode === 'replace') await act(async () => button('Confirm Wipe & Replace').click())
    } finally { dom.window.Storage.prototype.setItem = realSet }
    const text = document.body.textContent
    assert.match(text, /Library restored: 1 songs, 0 setlists \(verified after saving\), but settings were not restored: saving .* failed .*every setting was put back and verified\. This device's previous settings are unchanged\./)
    assert.doesNotMatch(text, /Backup restored:/)
    for (const key of bs.backupSettingsStorageKeys()) assert.equal(localStorage.getItem(key), before.get(key) ?? null, key)
  }))
}

test('F2 dialog: unresolved partial settings state offers "Put back previous settings"', withJsdom(async ({ dom, root }) => {
  fullSettingsStorage(localStorage)
  const payload = JSON.parse(jb.buildVerifiedBackup([incoming], []).json)
  localStorage.clear()
  persistLibrary({ songs: [current], setlists: [] })
  localStorage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
  const proto = dom.window.Storage.prototype
  const realSet = proto.setItem, realRemove = proto.removeItem
  let broken = false, writes = 0
  proto.setItem = function (k, v) {
    if (bs.backupSettingsStorageKeys().includes(k)) { writes++; if (writes === 4) broken = true; if (broken) throw new Error('disk error') }
    return realSet.call(this, k, v)
  }
  proto.removeItem = function (k) { if (broken && bs.backupSettingsStorageKeys().includes(k)) throw new Error('disk error'); return realRemove.call(this, k) }
  try {
    await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true, onClose: () => {}, allSongs: [current], setlists: [], onImportAllSongs: () => {},
      onFullRestore: (songs, setlists) => persistLibrary({ songs, setlists }, localStorage, { force: true }),
    })))
    await pick(dom, 'Full Restore (Wipe & Replace)', payload)
    await act(async () => button('Confirm Wipe & Replace').click())
    assert.match(document.body.textContent, /Partial restore: library saved, but settings restoration failed .*could not be put back.*kept in a verified snapshot/)
    broken = false
  } finally { proto.setItem = realSet; proto.removeItem = realRemove }
  await act(async () => button('Put back previous settings').click())
  assert.match(document.body.textContent, /Previous settings put back and verified/)
  assert.equal(localStorage.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black')
  for (const key of bs.backupSettingsStorageKeys().filter(k => k !== bs.SETTINGS_KEYS.themeMode)) assert.equal(localStorage.getItem(key), null, key)
}))

for (const [label, mutate] of [
  ['key', lib => { lib.songs[0].key = 'D' }], ['tags', lib => { delete lib.songs[0].tags }], ['transpose', lib => { lib.songs[0].transposeOffset = 3 }],
  ['setlist name', lib => { lib.setlists[0].name = 'X' }], ['membership', lib => { lib.setlists[0].songs = [] }], ['content', lib => { lib.songs[0].rawContent += '!' }],
]) {
  for (const mode of ['replace', 'merge']) {
    test(`F1 dialog (${mode}): a handler that saves a different ${label} is never reported as verified`, withJsdom(async ({ dom, root }) => {
      const song = { ...incoming, key: 'C', tags: 'worship', transposeOffset: 1 }
      const payload = JSON.parse(jb.buildVerifiedBackup([song], [{ id: 'set', name: 'Set', songs: [{ id: song.id, title: song.title, artist: '' }] }]).json)
      localStorage.clear()
      persistLibrary({ songs: [current], setlists: [] })
      localStorage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
      const faulty = (songs, setlists) => {
        const lib = JSON.parse(JSON.stringify(mode === 'merge' ? { songs: [current, ...songs], setlists } : { songs, setlists }))
        mutate({ songs: lib.songs.filter(s => s.id === song.id), setlists: lib.setlists })
        persistLibrary(lib, localStorage, { force: true })
      }
      await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
        isOpen: true, onClose: () => assert.fail('closed'), allSongs: [current], setlists: [], onImportAllSongs: () => {}, onFullRestore: faulty, onSmartMerge: faulty,
      })))
      await pick(dom, mode === 'replace' ? 'Full Restore (Wipe & Replace)' : 'Restore Backup (Smart Merge)', payload)
      if (mode === 'replace') await act(async () => button('Confirm Wipe & Replace').click())
      assert.match(document.body.textContent, /Restore could not be verified: (song|setlist) /)
      assert.doesNotMatch(document.body.textContent, /verified after saving|Backup restored:/)
      assert.equal(localStorage.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black', 'settings untouched')
      assert.equal(JSON.parse(localStorage.getItem(jb.RESTORE_SNAPSHOT_KEY)).library.songs[0].id, 'cur', 'recovery state kept')
    }))
  }
}

test('F3: a prepared file is not reused after the library or settings change; reopening starts fresh', withJsdom(async ({ root }) => {
  persistLibrary({ songs: [current], setlists: [] })
  const files = []
  const { env, calls } = fakeEnv({ shareError: n => n === 1 ? named('NotAllowedError') : null })
  env.makeFile = (json, name) => { files.push(json); return { name, size: json.length } }
  const props = songs => ({ isOpen: true, onClose: () => {}, allSongs: songs, setlists: [], onImportAllSongs: () => {}, exportEnv: env })
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, props([current]))))
  await act(async () => button('Export Backup').click())
  await act(async () => button('Save backup file').click())
  assert.ok(button('Open share sheet'))
  // Library edited while the old file waits for a tap.
  const edited = { ...current, rawContent: '[G]edited after prepare' }
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, props([edited]))))
  await act(async () => button('Open share sheet').click())
  assert.equal(calls.share, 2)
  const shared = files[files.length - 1]
  assert.ok(shared.includes('edited after prepare'), 'the shared bytes are the current library')
  const saved = status.readBackupStatus()
  assert.equal(saved.fingerprint, jb.libraryFingerprint([edited], []))
  assert.doesNotMatch(document.body.textContent, /newer edits are not in it/)
  // Settings change alone also invalidates a prepared file.
  calls.share = 0
  const env2 = fakeEnv({ shareError: n => n === 1 ? named('NotAllowedError') : null })
  const files2 = []; env2.env.makeFile = (json, name) => { files2.push(json); return { name, size: json.length } }
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { ...props([edited]), exportEnv: env2.env })))
  await act(async () => button('Save backup file').click())
  localStorage.setItem('gtar_songbook_sort', 'artist')
  await act(async () => button('Open share sheet').click())
  assert.ok(files2[files2.length - 1].includes('"songbookSort": "artist"'))
  // Closing and reopening drops a waiting file.
  const env3 = fakeEnv({ shareError: named('NotAllowedError') })
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { ...props([edited]), exportEnv: env3.env })))
  await act(async () => button('Save backup file').click())
  assert.ok(button('Open share sheet'))
  const edited2 = { ...edited, rawContent: '[G]second edit' }
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { ...props([edited2]), exportEnv: env3.env })))
  await act(async () => button('Open share sheet').click())
  assert.match(document.body.textContent, /changed after the earlier file was prepared, so a new backup was created and verified/)
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { ...props([edited]), isOpen: false })))
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { ...props([edited]), exportEnv: env3.env })))
  await act(async () => new Promise(r => setTimeout(r, 5)))
  assert.ok(button('Save backup file'), 'a new opening does not offer the old prepared file')
}))

test('F4: declared counts or fingerprint that do not match the content are rejected; files without them still import', async () => {
  global.localStorage = new MemoryStorage()
  const songs = [{ id: 'a', title: 'A', rawContent: 'x' }, { id: 'b', title: 'B', rawContent: 'y', isDeleted: true }]
  const setlists = [{ id: 's', name: 'S', songs: [{ id: 'a', title: 'A' }] }]
  const good = JSON.parse(jb.buildVerifiedBackup(songs, setlists).json)
  assert.equal(jb.parseBackupJson(JSON.stringify(good)).isValid, true)
  const cases = [
    ['songCount', { ...good, songCount: 2 }, /songCount: file declares 2 but contains 1/],
    ['trashCount', { ...good, trashCount: 0 }, /trashCount: file declares 0 but contains 1/],
    ['setlistCount', { ...good, setlistCount: 999 }, /setlistCount: file declares 999 but contains 1/],
    ['fingerprint', { ...good, contentFingerprint: 'c53:00000000000000' }, /contentFingerprint: songs or setlists do not match/],
    ['fingerprint format', { ...good, contentFingerprint: 'sha1:abc' }, /contentFingerprint: invalid format/],
    ['song edited, manifest kept', { ...good, songs: [{ ...good.songs[0], rawContent: 'edited' }, good.songs[1]] }, /contentFingerprint/],
    ['song removed', { ...good, songs: [good.songs[0]] }, /trashCount: file declares 1 but contains 0/],
    ['v1 with counts off', { ...good, schemaVersion: 1, settings: undefined, contentFingerprint: undefined, songCount: 5 }, /songCount: file declares 5/],
    ['fingerprint in v1', { ...good, schemaVersion: 1, settings: undefined, contentFingerprint: good.contentFingerprint }, /only schema v2 backups carry a content fingerprint/],
  ]
  for (const [label, payload, pattern] of cases) {
    const parsed = jb.parseBackupJson(JSON.stringify(payload))
    assert.equal(parsed.isValid, false, label)
    assert.match(parsed.error, pattern, label)
    assert.deepEqual(parsed.songs, [], label)
  }
  // Legitimate older files: v1 with correct counts, and files with no manifest at all.
  const v1 = { app: 'GTAR', schemaVersion: 1, exportType: 'FULL_BACKUP', songCount: 1, setlistCount: 1, trashCount: 1, songs, setlists }
  assert.equal(jb.parseBackupJson(JSON.stringify(v1)).isValid, true)
  assert.equal(jb.parseBackupJson(JSON.stringify({ songs, setlists })).isValid, true)
  assert.equal(jb.parseBackupJson(JSON.stringify(songs)).isValid, true)
})

test('F4 dialog: a backup with an inconsistent manifest changes nothing', withJsdom(async ({ dom, root }) => {
  global.localStorage = localStorage
  const payload = JSON.parse(jb.buildVerifiedBackup([incoming], []).json)
  payload.songCount = 3
  localStorage.clear()
  persistLibrary({ songs: [current], setlists: [] })
  localStorage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
  const before = JSON.stringify({ ...localStorage })
  for (const label of ['Full Restore (Wipe & Replace)', 'Restore Backup (Smart Merge)']) {
    await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true, onClose: () => {}, allSongs: [current], setlists: [], onImportAllSongs: () => assert.fail('import'),
      onFullRestore: () => assert.fail('replaced'), onSmartMerge: () => assert.fail('merged'),
    })))
    await pick(dom, label, payload)
    assert.match(document.body.textContent, /songCount: file declares 3 but contains 1/)
    assert.equal(JSON.stringify({ ...localStorage }), before, `${label}: zero library/settings/snapshot change`)
  }
}))

// #257 round 2: snapshot integrity, durable recovery UI, reactive changed-since-backup warning.
async function pendingSnapshotStorage() {
  const storage = new FailingWrites(4, { failPutBack: true })
  deviceSettings(storage)
  storage.armed = true
  await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, storage), error => error.state === 'partial')
  storage.armed = false
  return storage
}

test('R1: truncated, emptied, edited or inconsistent snapshots are rejected before any settings change', async () => {
  const good = JSON.parse((await pendingSnapshotStorage()).getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY))
  const raw = JSON.stringify(good)
  const variants = {
    truncated: raw.slice(0, raw.length - 40),
    empty: '',
    'empty object': '{}',
    'empty values': JSON.stringify({ ...good, values: {} }),
    'empty inventory': JSON.stringify({ ...good, keys: [], values: {} }),
    'value missing': JSON.stringify({ ...good, values: Object.fromEntries(Object.entries(good.values).slice(1)) }),
    'inventory shortened with matching values': JSON.stringify({ ...good, keys: good.keys.slice(1), values: Object.fromEntries(Object.entries(good.values).slice(1)) }),
    'value edited': JSON.stringify({ ...good, values: { ...good.values, [bs.SETTINGS_KEYS.themeMode]: 'paper-light' } }),
    'foreign key': JSON.stringify({ ...good, keys: [...good.keys, 'gtar_auth_session'].sort(), values: { ...good.values, gtar_auth_session: 'x' } }),
    'old v1 format': JSON.stringify({ v: 1, at: good.at, values: good.values }),
    'wrong value type': JSON.stringify({ ...good, values: { ...good.values, [good.keys[0]]: 7 } }),
  }
  for (const [label, text] of Object.entries(variants)) {
    const storage = new MemoryStorage()
    deviceSettings(storage)
    storage.setItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY, text)
    const before = [...storage.map]
    const recovery = bs.inspectSettingsRecovery(storage)
    assert.equal(recovery.state, 'invalid', label)
    assert.equal(bs.readSettingsRestoreSnapshot(storage), null, label)
    await assert.rejects(() => bs.restorePreviousSettings(storage), /not usable/, label)
    await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, storage), e => e.state === 'blocked', label)
    assert.deepEqual([...storage.map], before, `${label}: nothing changed`)
  }
})

test('R1: an unfinished snapshot is never overwritten; retries keep the original values until a verified put-back', async () => {
  const storage = await pendingSnapshotStorage()
  const original = storage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
  const theme = bs.readSettingsRestoreSnapshot(storage).values[bs.SETTINGS_KEYS.themeMode]
  assert.equal(theme, 'oled-black')
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, storage), e => e.state === 'blocked' && /did not finish/.test(e.message))
    assert.equal(storage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), original, `retry ${i}: snapshot unchanged`)
  }
  // A put-back that fails part-way leaves the snapshot byte-identical for the next attempt.
  class FlakyPutBack extends MemoryStorage { constructor(map) { super(); this.map = map; this.fail = true }
    setItem(k, v) { if (this.fail && k === bs.SETTINGS_KEYS.themeMode) throw new Error('disk'); super.setItem(k, v) } }
  const flaky = new FlakyPutBack(storage.map)
  const first = await bs.restorePreviousSettings(flaky)
  assert.deepEqual(first, { unresolved: [bs.SETTINGS_KEYS.themeMode], cleared: false })
  assert.equal(flaky.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), original)
  flaky.fail = false
  assert.deepEqual(await bs.restorePreviousSettings(flaky), { unresolved: [], cleared: true })
  assert.equal(flaky.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black')
  assert.equal(flaky.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), null)
  // Now a new restore may start, and finishes clean.
  await bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, flaky)
  assert.equal(flaky.getItem(bs.SETTINGS_KEYS.themeMode), 'azure-stage')
  assert.equal(bs.inspectSettingsRecovery(flaky).state, 'none')
})

test('R1: a crash after the snapshot (process killed mid-restore) is detected as unfinished', async () => {
  const storage = new MemoryStorage(); deviceSettings(storage)
  const previous = Object.fromEntries(bs.backupSettingsStorageKeys().map(k => [k, storage.getItem(k)]))
  storage.setItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY, JSON.stringify(bs.makeSettingsRestoreSnapshot(previous)))
  storage.setItem(bs.SETTINGS_KEYS.themeMode, 'azure-stage') // first write landed, then the tab died
  assert.equal(bs.inspectSettingsRecovery(storage).state, 'pending')
  assert.deepEqual(await bs.restorePreviousSettings(storage), { unresolved: [], cleared: true })
  assert.equal(storage.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black')
})

test('R2 dialog: unfinished settings restore is shown on mount and put back without another import', withJsdom(async ({ root }) => {
  const source = await pendingSnapshotStorage()
  for (const [k, v] of source.map) localStorage.setItem(k, v)
  const changedTheme = localStorage.getItem(bs.SETTINGS_KEYS.themeMode)
  assert.notEqual(changedTheme, 'oled-black')
  const render = open => act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: open, onClose: () => {}, allSongs: [], setlists: [], onImportAllSongs: () => {},
  })))
  await render(true)
  await act(async () => new Promise(r => setTimeout(r, 5)))
  assert.match(document.querySelector('[data-testid="settings-recovery"]').textContent, /An earlier settings restore did not finish/)
  // Survives close/reopen (remount of the content).
  await render(false); await render(true)
  await act(async () => new Promise(r => setTimeout(r, 5)))
  await act(async () => button('Put back previous settings').click())
  assert.match(document.body.textContent, /Previous settings put back and verified/)
  assert.equal(localStorage.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black')
  assert.equal(localStorage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), null)
  assert.equal(document.querySelector('[data-testid="settings-recovery"]'), null)
  assert.equal(localStorage.getItem('gtar_auth_session'), 'SECRET-auth-token')
}))

test('R2 dialog: damaged recovery data stays unresolved until explicitly discarded; never applied', withJsdom(async ({ root }) => {
  deviceSettings(localStorage)
  localStorage.setItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY, '{"v":2,"at":"2026-10-27T00:00:00Z","keys":["gtar_theme_store"],"values":{}')
  const before = JSON.stringify({ ...localStorage })
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { isOpen: true, onClose: () => {}, allSongs: [], setlists: [], onImportAllSongs: () => {} })))
  await act(async () => new Promise(r => setTimeout(r, 5)))
  const banner = () => document.querySelector('[data-testid="settings-recovery"]')
  assert.match(banner().textContent, /cannot be used: not valid JSON/)
  assert.equal(button('Put back previous settings'), undefined, 'no false recovery action')
  assert.equal(JSON.stringify({ ...localStorage }), before)
  await act(async () => button('Discard damaged recovery data').click())
  assert.equal(JSON.stringify({ ...localStorage }), before, 'first click only asks for confirmation')
  await act(async () => button('Confirm discard').click())
  assert.equal(localStorage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), null)
  assert.equal(localStorage.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black', 'no setting changed')
  assert.equal(banner(), null)
}))

test('R2 dialog: a restore with settings ticked is refused while recovery is unfinished; library-only restore still works', withJsdom(async ({ dom, root }) => {
  const source = await pendingSnapshotStorage()
  for (const [k, v] of source.map) localStorage.setItem(k, v)
  const snapshot = localStorage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
  persistLibrary({ songs: [current], setlists: [] })
  const payload = JSON.parse(jb.buildVerifiedBackup([incoming], []).json)
  let calls = 0
  const save = (songs, setlists) => { calls++; persistLibrary({ songs, setlists }, localStorage, { force: true }) }
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: true, onClose: () => {}, allSongs: [current], setlists: [], onImportAllSongs: () => {}, onFullRestore: save, onSmartMerge: appMerge(),
  })))
  await pick(dom, 'Full Restore (Wipe & Replace)', payload)
  await act(async () => button('Confirm Wipe & Replace').click())
  assert.match(document.body.textContent, /Restore not started: an earlier settings restore did not finish/)
  assert.equal(calls, 0)
  assert.equal(readPersistedLibrary().songs[0].id, 'cur')
  assert.equal(localStorage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), snapshot)
  await act(async () => checkbox('Appearance').click())
  await pick(dom, 'Full Restore (Wipe & Replace)', payload)
  await act(async () => button('Confirm Wipe & Replace').click())
  assert.match(document.body.textContent, /Backup restored: 1 songs/)
  assert.equal(localStorage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), snapshot, 'unfinished recovery evidence untouched')
}))

test('R3: changed-since-backup follows later library edits, edits during share, settings-only changes and remounts', withJsdom(async ({ root }) => {
  persistLibrary({ songs: [current], setlists: [] })
  let releaseShare
  const env = {
    makeFile: (json, name) => ({ name, size: json.length }), download: () => {},
    navigator: { canShare: () => true, share: () => new Promise(resolve => { releaseShare = resolve }) },
  }
  const statusText = () => document.querySelector('[data-testid="backup-status"]').textContent
  const show = (songs, open = true) => act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: open, onClose: () => {}, allSongs: songs, setlists: [], onImportAllSongs: () => {}, exportEnv: env,
  })))
  const settle = () => act(async () => new Promise(r => setTimeout(r, 5)))
  const lib1 = [current]
  await show(lib1); await act(async () => button('Export Backup').click())
  // Edit during share: the share sheet is open while the library changes.
  let sharing
  await act(async () => { sharing = button('Save backup file').click() })
  const lib2 = [{ ...current, rawContent: '[G]edited while sharing' }]
  await show(lib2); await settle()
  await act(async () => { releaseShare(); await sharing; await new Promise(r => setTimeout(r, 0)) })
  await settle()
  assert.match(statusText(), /Last backup: .*sent to the share sheet/)
  assert.match(statusText(), /Your library changed after this backup/)
  // Back to the exported content: no warning, and nothing claims the file was saved off-device.
  await show(lib1); await settle()
  assert.doesNotMatch(statusText(), /changed after this backup/)
  assert.match(statusText(), /Nothing changed since this file was made \(GTAR still cannot confirm it was saved\)/)
  // Edit after export, without reopening.
  const lib3 = [{ ...current, title: 'Renamed later' }]
  await show(lib3); await settle()
  assert.match(statusText(), /Your library changed after this backup/)
  // Settings-only change (another tab or a restore in this one signals it).
  await show(lib1); await settle()
  localStorage.setItem('gtar_songbook_sort', 'artist')
  await act(async () => { window.dispatchEvent(new window.Event(bs.SETTINGS_CHANGED)) })
  await settle()
  assert.match(statusText(), /Your settings changed after this backup/)
  assert.doesNotMatch(statusText(), /Your library changed/)
  // Remount: computed again from storage.
  await show(lib1, false); await show(lib1); await settle()
  assert.match(statusText(), /Your settings changed after this backup/)
  // A status without settings identity (older format) never claims "nothing changed".
  const saved = status.readBackupStatus(); delete saved.settingsFingerprint
  localStorage.setItem(status.BACKUP_STATUS_KEY, JSON.stringify(saved))
  localStorage.removeItem('gtar_songbook_sort')
  await show(lib1, false); await show(lib1); await settle()
  assert.doesNotMatch(statusText(), /Nothing changed since/)
}))

// #257 round 3: cross-tab exclusivity, same-tab settings freshness, finished-restore copy.
/** A "tab" over a shared localStorage map: optional hook before each write, optional failures. */
class TabStorage {
  constructor(map, { beforeSet, failSetAt, failPutBack = false } = {}) { this.map = map; this.beforeSet = beforeSet; this.failSetAt = failSetAt; this.failPutBack = failPutBack; this.sets = 0; this.broken = false }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) {
    this.beforeSet?.(k, v)
    if (k !== bs.SETTINGS_RESTORE_SNAPSHOT_KEY && bs.backupSettingsStorageKeys().includes(k)) {
      this.sets++
      if (this.broken && this.failPutBack) throw new Error('disk error (put back)')
      if (this.sets === this.failSetAt) { this.broken = true; throw new Error('disk error') }
    }
    this.map.set(k, String(v))
  }
  removeItem(k) { if (this.broken && this.failPutBack && k !== bs.SETTINGS_RESTORE_SNAPSHOT_KEY) throw new Error('disk error (put back)'); this.map.delete(k) }
}
const callAsync = fn => { try { return Promise.resolve(fn()) } catch (error) { return Promise.reject(error) } }
const SORT = 'gtar_songbook_sort'
const prefsSort = { appearance: {}, preferences: { songbookSort: 'artist', songbookFilterMetadata: 'NEEDS_METADATA' } }

test('P1 interleaving restore/restore: a paused tab can never overwrite or delete another tab\'s recovery copy', async () => {
  const locks = new FakeLockManager()
  const map = new Map([[SORT, 'date']])
  let tabB
  // Tab B: preferences restore; first write lands (sort=artist), second fails, put-back fails → keeps its copy.
  const storageB = new TabStorage(map, { failSetAt: 2, failPutBack: true })
  // Tab A: appearance restore that is interrupted right at its first storage write, while B runs completely.
  const storageA = new TabStorage(map, { beforeSet: () => { if (!tabB) tabB = callAsync(() => bs.restoreBackupSettingsV2(prefsSort, ALL_SETTINGS, storageB, { locks })) } })
  const resultA = await callAsync(() => bs.restoreBackupSettingsV2(backedUpSettings(), { appearance: true, preferences: false }, storageA, { locks })).then(v => ({ ok: v }), e => ({ error: e }))
  const resultB = await tabB.then(v => ({ ok: v }), e => ({ error: e }))
  // Invariant first: the original sort is either still in place or recoverable from a valid copy.
  const copy = bs.readSettingsRestoreSnapshot(new TabStorage(map))
  assert.ok(map.get(SORT) === 'date' || copy?.values[SORT] === 'date', `original sort lost: sort=${map.get(SORT)}, copy=${JSON.stringify(copy?.values)}`)
  assert.ok(resultA.ok, 'tab A completes')
  assert.equal(resultB.error?.state, 'busy', 'tab B is refused while A holds the settings lock')
  assert.equal(map.get(SORT), 'date')
  assert.equal(bs.inspectSettingsRecovery(new TabStorage(map)).state, 'none')
})

test('P1 interleaving restore/put-back: a restore started during another tab\'s put-back is refused; the copy survives until verified', async () => {
  const locks = new FakeLockManager()
  const map = new Map([[SORT, 'date']])
  await assert.rejects(() => bs.restoreBackupSettingsV2(prefsSort, ALL_SETTINGS, new TabStorage(map, { failSetAt: 2, failPutBack: true }), { locks }), e => e.state === 'partial')
  const copyRaw = map.get(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
  assert.equal(map.get(SORT), 'artist')
  let other
  const putBackTab = new TabStorage(map, { beforeSet: () => { if (!other) other = callAsync(() => bs.restoreBackupSettingsV2(prefsSort, ALL_SETTINGS, new TabStorage(map), { locks })) } })
  const result = await bs.restorePreviousSettings(putBackTab, { locks })
  assert.deepEqual(result, { unresolved: [], cleared: true })
  await assert.rejects(other, e => e.state === 'busy')
  assert.equal(map.get(SORT), 'date')
  assert.equal(map.has(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), false)
  assert.ok(copyRaw)
})

test('P1: busy, lock failure, no Web Locks and stale-owner removal never change settings or the copy', async () => {
  const locks = new FakeLockManager()
  const map = new Map([[SORT, 'date']])
  await assert.rejects(() => bs.restoreBackupSettingsV2(prefsSort, ALL_SETTINGS, new TabStorage(map, { failSetAt: 2, failPutBack: true }), { locks }), e => e.state === 'partial')
  const copyRaw = map.get(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
  const before = JSON.stringify([...map])
  // Another tab mid-operation holds the lock.
  const held = locks.hold(bs.SETTINGS_RESTORE_LOCK); await held.acquired
  await assert.rejects(() => bs.restorePreviousSettings(new TabStorage(map), { locks }), e => e.state === 'busy')
  await assert.rejects(() => bs.discardSettingsRecovery(copyRaw, new TabStorage(map), { locks }), e => e.state === 'busy')
  held.release(); await new Promise(r => setTimeout(r, 0))
  // The lock request itself fails.
  locks.failNext = new Error('SecurityError')
  await assert.rejects(() => bs.restorePreviousSettings(new TabStorage(map), { locks }), e => e.state === 'unavailable')
  // No Web Locks at all: refused, never unsafely allowed.
  await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, new TabStorage(new Map()), { locks: null }), e => e.state === 'unavailable')
  // A stale operation holding older bytes cannot delete another owner's copy.
  const foreign = JSON.stringify(bs.makeSettingsRestoreSnapshot({ [SORT]: 'title' }))
  assert.equal(await bs.discardSettingsRecovery(foreign, new TabStorage(map), { locks }), false)
  assert.equal(JSON.stringify([...map]), before, 'settings and copy untouched')
  assert.notEqual(JSON.parse(copyRaw).owner, JSON.parse(foreign).owner)
})

test('P1: an owner interrupted mid-restore releases the lock; its copy is reported unfinished and put back by another tab', async () => {
  const locks = new FakeLockManager()
  const map = new Map([[SORT, 'date'], [bs.SETTINGS_KEYS.themeMode, 'oled-black']])
  // The owner stops after two writes (storage fails, put-back fails) – the lock is released when its callback ends.
  await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, new TabStorage(map, { failSetAt: 3, failPutBack: true }), { locks }), e => e.state === 'partial')
  assert.equal(locks.held.get(bs.SETTINGS_RESTORE_LOCK), false)
  const tab2 = new TabStorage(map)
  assert.equal(bs.inspectSettingsRecovery(tab2).state, 'pending')
  await assert.rejects(() => bs.restoreBackupSettingsV2(prefsSort, ALL_SETTINGS, tab2, { locks }), e => e.state === 'blocked')
  assert.deepEqual(await bs.restorePreviousSettings(tab2, { locks }), { unresolved: [], cleared: true })
  assert.equal(map.get(SORT), 'date'); assert.equal(map.get(bs.SETTINGS_KEYS.themeMode), 'oled-black')
})

/** Storage whose removal of the recovery copy fails (optionally also re-marking it). */
class StickyCopy extends MemoryStorage {
  constructor({ failMark = false } = {}) { super(); this.sticky = true; this.failMark = failMark }
  removeItem(k) { if (this.sticky && k === bs.SETTINGS_RESTORE_SNAPSHOT_KEY) throw new Error('cannot remove'); super.removeItem(k) }
  setItem(k, v) { if (this.sticky && this.failMark && k === bs.SETTINGS_RESTORE_SNAPSHOT_KEY && super.getItem(k) !== null) throw new Error('cannot rewrite'); super.setItem(k, v) }
}

test('P2: a finished restore whose copy cannot be removed is marked committed, not unfinished; undo and keep are explicit', async () => {
  const storage = new StickyCopy(); deviceSettings(storage)
  const result = await bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, storage)
  assert.equal(result.recoveryCopy, 'kept-committed')
  assert.equal(storage.getItem(bs.SETTINGS_KEYS.themeMode), 'azure-stage')
  const recovery = bs.inspectSettingsRecovery(storage)
  assert.equal(recovery.state, 'committed')
  assert.equal(recovery.snapshot.values[bs.SETTINGS_KEYS.themeMode], 'oled-black')
  // Still evidence: a new settings restore is blocked until the user decides.
  await assert.rejects(() => bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, storage), e => e.state === 'blocked' && /from before the last restore/.test(e.message))
  // Undo with a failing put-back leaves the copy byte-identical.
  const raw = storage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY)
  const realSet = storage.setItem.bind(storage)
  storage.setItem = (k, v) => { if (k === bs.SETTINGS_KEYS.themeMode) throw new Error('disk'); realSet(k, v) }
  const failed = await bs.restorePreviousSettings(storage)
  assert.ok(failed.unresolved.includes(bs.SETTINGS_KEYS.themeMode)); assert.equal(failed.cleared, false)
  assert.equal(storage.getItem(bs.SETTINGS_RESTORE_SNAPSHOT_KEY), raw)
  storage.setItem = realSet
  // "Keep current settings": removes the copy (storage healthy again), settings unchanged.
  storage.sticky = false
  const current = storage.getItem(bs.SETTINGS_KEYS.customThemeColors)
  assert.equal(await bs.discardSettingsRecovery(raw, storage), true)
  assert.equal(bs.inspectSettingsRecovery(storage).state, 'none')
  assert.equal(storage.getItem(bs.SETTINGS_KEYS.customThemeColors), current)
})

test('P2: when the copy can be neither removed nor re-marked, the result says so (stale) instead of claiming a clean finish', async () => {
  const storage = new StickyCopy({ failMark: true }); deviceSettings(storage)
  const result = await bs.restoreBackupSettingsV2(backedUpSettings(), ALL_SETTINGS, storage)
  assert.equal(result.recoveryCopy, 'stale')
  assert.equal(bs.inspectSettingsRecovery(storage).state, 'pending')
})

test('P2 dialog: committed copy after remount offers Keep current settings / Undo that restore with the consequence stated', withJsdom(async ({ dom, root }) => {
  fullSettingsStorage(localStorage)
  const payload = JSON.parse(jb.buildVerifiedBackup([incoming], []).json)
  localStorage.clear()
  persistLibrary({ songs: [current], setlists: [] })
  localStorage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
  const proto = dom.window.Storage.prototype
  const realRemove = proto.removeItem
  let sticky = true
  proto.removeItem = function (k) { if (sticky && k === bs.SETTINGS_RESTORE_SNAPSHOT_KEY) throw new Error('cannot remove'); return realRemove.call(this, k) }
  const props = { isOpen: true, onClose: () => {}, allSongs: [current], setlists: [], onImportAllSongs: () => {}, onFullRestore: (songs, setlists) => persistLibrary({ songs, setlists }, localStorage, { force: true }) }
  try {
    await act(async () => root.render(React.createElement(BackupRestoreDialogModal, props)))
    await pick(dom, 'Full Restore (Wipe & Replace)', payload)
    await act(async () => button('Confirm Wipe & Replace').click())
    assert.match(document.body.textContent, /Backup restored: 1 songs.*could not be removed; it is kept and marked as finished/)
  } finally { sticky = false; proto.removeItem = realRemove }
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, { ...props, isOpen: false })))
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, props)))
  await act(async () => new Promise(r => setTimeout(r, 5)))
  const banner = document.querySelector('[data-testid="settings-recovery"]').textContent
  assert.match(banner, /The last settings restore finished .*Putting it back undoes that restore/)
  assert.doesNotMatch(banner, /did not finish/)
  assert.equal(button('Put back previous settings'), undefined)
  await act(async () => button('Undo that restore').click())
  assert.match(document.body.textContent, /The last settings restore was undone/)
  assert.equal(localStorage.getItem(bs.SETTINGS_KEYS.themeMode), 'oled-black')
  assert.equal(document.querySelector('[data-testid="settings-recovery"]'), null)
}))

test('P2 dialog: same-tab settings writes with no event update the warning while open; library signal stays independent', withJsdom(async ({ root }) => {
  persistLibrary({ songs: [current], setlists: [] })
  const { env } = fakeEnv()
  const statusText = () => document.querySelector('[data-testid="backup-status"]').textContent
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: true, onClose: () => {}, allSongs: [current], setlists: [], onImportAllSongs: () => {}, exportEnv: env, settingsPollMs: 20,
  })))
  await act(async () => button('Export Backup').click())
  await act(async () => button('Save backup file').click())
  await act(async () => new Promise(r => setTimeout(r, 10)))
  assert.match(statusText(), /Nothing changed since this file was made/)
  // A component in this tab writes a backed-up key directly (no event).
  localStorage.setItem('gtar_stage_font_weight', 'bold')
  // Poll tick (20 ms) → re-check scheduled → flushed by the next act turn.
  await act(async () => new Promise(r => setTimeout(r, 80)))
  await act(async () => new Promise(r => setTimeout(r, 10)))
  assert.match(statusText(), /Your settings changed after this backup/)
  assert.doesNotMatch(statusText(), /Your library changed/)
  // A key that is not a backup setting does not count.
  localStorage.setItem('gtar_stage_font_weight', 'regular'); localStorage.removeItem('gtar_stage_font_weight')
  localStorage.setItem('gtar_auth_session', 'x')
  await act(async () => new Promise(r => setTimeout(r, 80)))
  await act(async () => new Promise(r => setTimeout(r, 10)))
  assert.match(statusText(), /Nothing changed since this file was made/)
}))
