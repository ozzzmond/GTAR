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

class MemoryStorage extends QuotaStorage { constructor() { super(Number.MAX_SAFE_INTEGER) } }
global.localStorage = new MemoryStorage()

const jb = require('../src/utils/jsonBackup.ts')
const bs = require('../src/utils/backupSettings.ts')
const status = require('../src/utils/backupStatus.ts')
const ex = require('../src/utils/backupExport.ts')
const { persistLibrary, readPersistedLibrary, LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
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

test('10,000 songs + 300 setlists + trash + every setting: export → verify → import is lossless', () => {
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
  const result = bs.restoreBackupSettingsV2(parsed.settings, { appearance: true, preferences: true }, target)
  assert.deepEqual(new Set(result.written), new Set(Object.keys(raw)))
  for (const [k, v] of Object.entries(raw)) assert.equal(target.getItem(k), v, k)
  assert.equal(target.length, Object.keys(raw).length)
  global.localStorage = new MemoryStorage()
})

test('the backup keys are exactly the documented appearance + preference keys', () => {
  assert.deepEqual(new Set(bs.backupSettingsStorageKeys()), new Set([...APPEARANCE_KEYS, ...PREFERENCE_KEYS]))
  const { raw } = fullSettingsStorage()
  assert.deepEqual(new Set(Object.keys(raw)), new Set(bs.backupSettingsStorageKeys()))
})

test('values the app would ignore are not exported; malformed v1 storage still blocks export', () => {
  const storage = new MemoryStorage()
  storage.setItem('gtar_stage_chord_scale', '9'); storage.setItem('gtar_tv_font_size', '20px'); storage.setItem('gtar_edge_swipe_panel', 'yes')
  storage.setItem('gtar_songbook_sort', 'random'); storage.setItem('gtar_stage_font_weight', 'heavy')
  assert.deepEqual(bs.readBackupSettingsV2(storage), { appearance: {}, preferences: {} })
  storage.setItem(bs.SETTINGS_KEYS.customThemeColors, '{broken')
  assert.throws(() => bs.readBackupSettingsV2(storage))
})

test('v1 backups still import: all v1 settings become appearance and restore to the same keys', () => {
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
  bs.restoreBackupSettingsV2(parsed.settings, bs.DEFAULT_SETTINGS_RESTORE_CHOICE, v2)
  assert.deepEqual([...v2.map], [...legacy.map])
  // Unversioned (pre-schema) song arrays still import.
  assert.equal(jb.parseBackupJson(JSON.stringify([{ id: 'x', title: 'X', rawContent: '' }])).isValid, true)
})

test('invalid, incomplete and corrupted backups are rejected before any write', () => {
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
  assert.throws(() => bs.restoreBackupSettingsV2({ appearance: { glow: 1 }, preferences: {} }, { appearance: true, preferences: true }, storage))
})

test('fields this version does not know are reported, not silently dropped', () => {
  const payload = JSON.parse(JSON.stringify(jb.createBackupPayload([{ id: 'a', title: 'A', rawContent: 'x' }], [{ id: 's', name: 'S', songs: [{ id: 'a', title: 'A' }] }])))
  payload.futureThing = 1; payload.songs[0].mood = 'happy'; payload.setlists[0].color = 'red'; payload.setlists[0].songs[0].note = 'n'
  const parsed = jb.parseBackupJson(JSON.stringify(payload))
  assert.equal(parsed.isValid, true, parsed.error)
  assert.deepEqual(parsed.ignoredFields, ['futureThing', 'setlists[].color', 'setlists[].songs[].note', 'songs[].mood'])
})

test('verification refuses bytes that do not restore to the same library', () => {
  global.localStorage = new MemoryStorage()
  const payload = jb.createBackupPayload([{ id: 'a', title: 'A', rawContent: 'x' }, { id: 'b', title: 'B', rawContent: 'y', isDeleted: true }], [])
  const json = JSON.stringify(payload)
  assert.deepEqual(jb.verifyBackupJson(json, payload), { songs: 1, trash: 1, setlists: 0 })
  assert.throws(() => jb.verifyBackupJson(json.replace('"x"', '"z"'), payload), /songs differ/)
  assert.throws(() => jb.verifyBackupJson(JSON.stringify({ ...payload, songs: payload.songs.slice(0, 1) }), payload), /counts differ/)
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
  const result = await ex.ensureRestoreSafetySnapshot(library, storage)
  assert.equal(result.location, 'recovery-archive')
  assert.match(result.key, /^gtar_sync_recovery:restore-snapshot:/)
  assert.deepEqual(JSON.parse(storage.getItem(result.key)).library, library)
  // Neither fits: throws, nothing changes.
  const none = new QuotaStorage(10)
  await assert.rejects(ex.ensureRestoreSafetySnapshot(library, none), /safety snapshot/)
  assert.equal(none.length, 0)
})

test('verifyRestoredLibrary: replace must match exactly; merge must contain every backup record', () => {
  const storage = new MemoryStorage()
  const a = { id: 'a', title: 'A', artist: '', rawContent: 'x' }, b = { id: 'b', title: 'B', artist: '', rawContent: 'y' }
  const sl = { id: 's', name: 'S', songs: [{ id: 'a', title: 'A', artist: '' }] }
  assert.match(ex.verifyRestoredLibrary({ songs: [a], setlists: [] }, 'replace', storage)[0], /could not be read back/)
  persistLibrary({ songs: [a, b], setlists: [sl] }, storage)
  assert.deepEqual(ex.verifyRestoredLibrary({ songs: [a], setlists: [sl] }, 'merge', storage), [])
  assert.match(ex.verifyRestoredLibrary({ songs: [a], setlists: [sl] }, 'replace', storage)[0], /saved library has 2 songs/)
  assert.match(ex.verifyRestoredLibrary({ songs: [{ ...a, rawContent: 'changed' }], setlists: [] }, 'merge', storage)[0], /differs/)
  assert.match(ex.verifyRestoredLibrary({ songs: [{ id: 'c', title: 'C', rawContent: '' }], setlists: [] }, 'merge', storage)[0], /missing/)
})

test('reminders: never, stale with changes, large change, disabled, and not due', () => {
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
  assert.match(document.body.textContent, /Restore could not be verified: song inc missing after restore/)
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
  await render([{ ...current, rawContent: '[G]edited' }])
  await act(async () => new Promise(r => setTimeout(r, 5)))
  assert.match(document.body.textContent, /Your library changed after this backup; the newer edits are not in it\./)
}))

test('menu export (download) is verified and recorded; Cloud V1 library keys are not touched', () => {
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
