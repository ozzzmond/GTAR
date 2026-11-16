// #536 Slice 1: MIDI settings in localStorage key gtar_midi_v1. Round trip; bad JSON, unknown
// version and bad fields fall back safely; default OFF; not in backups or cloud sync.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

const settings = require('../src/midi/settings.ts')
const KEY = 'gtar_midi_v1'
const DEFAULTS = { version: 1, enabled: false, device: 'all', channel: 'all', mappings: {} }
const cc = (number, channel = 1) => ({ type: 'cc', channel, number })

function memory(initial = {}) {
  const data = new Map(Object.entries(initial))
  const writes = []
  return { data, writes, getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { writes.push(key); data.set(key, String(value)) }, removeItem: key => data.delete(key) }
}
const stored = value => memory({ [KEY]: typeof value === 'string' ? value : JSON.stringify(value) })

test('key name and defaults: MIDI is OFF with no mappings', () => {
  assert.equal(settings.MIDI_SETTINGS_KEY, KEY)
  assert.equal(settings.MIDI_SETTINGS_VERSION, 1)
  assert.deepEqual(settings.defaultMidiSettings(), DEFAULTS)
  assert.notEqual(settings.defaultMidiSettings(), settings.defaultMidiSettings(), 'a fresh object each time')
  assert.notEqual(settings.defaultMidiSettings().mappings, settings.defaultMidiSettings().mappings)
  assert.deepEqual(settings.readMidiSettings(memory()), DEFAULTS, 'nothing stored means OFF')
  assert.equal(settings.readMidiSettings(memory()).enabled, false)
})

test('round trip keeps every field', () => {
  const storage = memory()
  const value = { version: 1, enabled: true, device: { id: 'port-1', name: 'FS-1-WL', manufacturer: 'BOSS' }, channel: 10,
    mappings: { nextSong: cc(64), prevSong: { type: 'note', channel: 2, number: 60 }, toggleAutoScroll: { type: 'pc', channel: 16, number: 5 } } }
  assert.equal(settings.writeMidiSettings(value, storage), true)
  assert.deepEqual(storage.writes, [KEY], 'one key, nothing else')
  assert.deepEqual(JSON.parse(storage.data.get(KEY)), value)
  assert.deepEqual(settings.readMidiSettings(storage), value)
  // And back to defaults.
  assert.equal(settings.writeMidiSettings(settings.defaultMidiSettings(), storage), true)
  assert.deepEqual(settings.readMidiSettings(storage), DEFAULTS)
})

test('unreadable JSON means OFF with no mappings, and the stored value is left alone', () => {
  for (const text of ['', '{', 'not json', '{"version":1,"enabled":true', 'undefined', '\u0000']) {
    const storage = stored(text)
    assert.deepEqual(settings.readMidiSettings(storage), DEFAULTS, JSON.stringify(text))
    assert.equal(storage.data.get(KEY), text, 'reading never rewrites')
    assert.deepEqual(storage.writes, [])
  }
})

test('JSON that is not a settings object means OFF with no mappings', () => {
  for (const value of [null, true, 1, 'on', [], [{ version: 1, enabled: true }], {}]) {
    assert.deepEqual(settings.readMidiSettings(stored(value)), DEFAULTS, JSON.stringify(value))
  }
})

test('unknown version means OFF with no mappings, and the stored value is left alone', () => {
  const full = { enabled: true, device: { id: 'p', name: 'n', manufacturer: 'm' }, channel: 3, mappings: { nextSong: cc(64) } }
  for (const version of [2, 0, -1, 1.5, '1', null, undefined, true, [1]]) {
    const text = JSON.stringify({ version, ...full })
    const storage = stored(text)
    assert.deepEqual(settings.readMidiSettings(storage), DEFAULTS, `version ${JSON.stringify(version)}`)
    assert.equal(storage.data.get(KEY), text)
    assert.deepEqual(storage.writes, [])
  }
})

test('enabled: only an exact true turns MIDI on', () => {
  for (const enabled of [1, 'true', 'on', {}, [], null, undefined, false]) {
    assert.equal(settings.readMidiSettings(stored({ version: 1, enabled })).enabled, false, JSON.stringify(enabled))
  }
  assert.equal(settings.readMidiSettings(stored({ version: 1, enabled: true })).enabled, true)
})

test('each bad field falls back on its own; good fields stay', () => {
  const good = { version: 1, enabled: true, device: { id: 'port-1', name: 'Pedal', manufacturer: 'Maker' }, channel: 5, mappings: { nextSong: cc(64) } }
  const read = patch => settings.readMidiSettings(stored({ ...good, ...patch }))
  for (const channel of [0, 17, -1, 1.5, '5', null, {}, [], 'ALL', true]) {
    assert.deepEqual(read({ channel }), { ...good, channel: 'all' }, `channel ${JSON.stringify(channel)}`)
  }
  for (let channel = 1; channel <= 16; channel++) assert.equal(read({ channel }).channel, channel)
  assert.equal(read({ channel: 'all' }).channel, 'all')

  for (const device of [null, 'port-1', 5, [], {}, { id: '' }, { id: 5, name: 'x' }, { name: 'Pedal', manufacturer: 'Maker' }, { id: 'x'.repeat(129) }]) {
    assert.deepEqual(read({ device }), { ...good, device: 'all' }, `device ${JSON.stringify(device)?.slice(0, 40)}`)
  }
  assert.deepEqual(read({ device: { id: 'p', name: 7, manufacturer: null } }).device, { id: 'p', name: '', manufacturer: '' })
  assert.deepEqual(read({ device: { id: 'p', name: 'n', manufacturer: 'm', extra: '<b>x</b>' } }).device, { id: 'p', name: 'n', manufacturer: 'm' })

  for (const mappings of [null, 'x', 5, [], [cc(64)]]) assert.deepEqual(read({ mappings }), { ...good, mappings: {} })
  assert.deepEqual(read({ mappings: { nextSong: cc(120), prevSong: cc(65), unknownAction: cc(66) } }).mappings, { prevSong: cc(65) })
  assert.deepEqual(read({ enabled: 'yes', channel: 99, device: 3, mappings: { scrollUp: cc(1) } }),
    { version: 1, enabled: false, device: 'all', channel: 'all', mappings: { scrollUp: cc(1) } })
})

test('device text is plain text cut to 128 characters', () => {
  const long = '<img src=x onerror=alert(1)>'.repeat(10)
  const device = settings.readMidiSettings(stored({ version: 1, device: { id: 'i'.repeat(128), name: long, manufacturer: long } })).device
  assert.equal(settings.MIDI_DEVICE_TEXT_MAX, 128)
  assert.equal(device.id.length, 128)
  assert.equal(device.name, long.slice(0, 128))
  assert.equal(device.manufacturer.length, 128)
})

test('unknown extra fields, Learn state and monitor data are never stored', () => {
  const storage = memory()
  settings.writeMidiSettings({ ...settings.defaultMidiSettings(), enabled: true, learning: 'nextSong', monitor: [[176, 64, 127]],
    lastMessage: { type: 'cc' }, mappings: { nextSong: { ...cc(64), value: 127, velocity: 100 } } }, storage)
  assert.deepEqual(JSON.parse(storage.data.get(KEY)), { ...DEFAULTS, enabled: true, mappings: { nextSong: cc(64) } })
})

test('storage that throws or is missing: read is OFF, write reports false, nothing throws', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  assert.deepEqual(settings.readMidiSettings(broken), DEFAULTS)
  assert.equal(settings.writeMidiSettings({ ...DEFAULTS, enabled: true }, broken), false)
  assert.deepEqual(settings.readMidiSettings(null), DEFAULTS)
  assert.equal(settings.writeMidiSettings(DEFAULTS, null), false)
  // The default storage argument must be safe whether or not this process has a localStorage.
  assert.doesNotThrow(() => settings.readMidiSettings())
})

test('change events: a successful write announces once; a failed write does not', () => {
  const previous = global.window
  const listeners = new Map()
  global.window = {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== fn)),
    dispatchEvent: event => { for (const fn of listeners.get(event.type) ?? []) fn(event); return true },
  }
  try {
    let calls = 0
    const unsubscribe = settings.subscribeMidiSettings(() => { calls++ })
    assert.equal(settings.writeMidiSettings({ ...DEFAULTS, enabled: true }, memory()), true)
    assert.equal(calls, 1)
    assert.equal(settings.writeMidiSettings(DEFAULTS, { setItem() { throw new Error('quota') } }), false)
    assert.equal(calls, 1, 'nothing announced when the save failed')
    // Another tab: only this key (or a full clear) counts.
    window.dispatchEvent({ type: 'storage', key: KEY })
    window.dispatchEvent({ type: 'storage', key: null })
    window.dispatchEvent({ type: 'storage', key: 'gtar_theme_store' })
    assert.equal(calls, 3)
    unsubscribe()
    settings.writeMidiSettings(DEFAULTS, memory())
    window.dispatchEvent({ type: 'storage', key: KEY })
    assert.equal(calls, 3, 'no calls after unsubscribe')
    assert.deepEqual([...listeners.values()].flat(), [])
  } finally {
    if (previous === undefined) delete global.window
    else global.window = previous
  }
  // Without a window (tests, workers) subscribing and writing are safe no-ops for events.
  assert.doesNotThrow(() => settings.subscribeMidiSettings(() => {})())
  assert.equal(settings.writeMidiSettings(DEFAULTS, memory()), true)
})

test('the key is not in SETTINGS_KEYS and no backup or sync code knows it', () => {
  const { SETTINGS_KEYS } = require('../src/utils/backupSettings.ts')
  assert.equal(Object.values(SETTINGS_KEYS).includes(KEY), false)
  assert.equal(Object.values(SETTINGS_KEYS).some(value => /midi/i.test(value)), false)
  const root = path.join(__dirname, '../src')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
  const mentions = walk(root).filter(file => !file.startsWith(path.join(root, 'midi') + path.sep))
    .filter(file => /gtar_midi|gtar-midi-settings-changed/.test(fs.readFileSync(file, 'utf8')))
  assert.deepEqual(mentions, [], 'only web/src/midi names the MIDI storage key')
  for (const file of fs.readdirSync(path.join(__dirname, '../functions'), { recursive: true }).filter(name => /\.(ts|js)$/.test(String(name)))) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../functions', String(file)), 'utf8'), /gtar_midi/)
  }
})
