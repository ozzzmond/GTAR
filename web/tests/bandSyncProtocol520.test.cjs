const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { validateBandSyncMessage: validate, BAND_SYNC_LIMITS: L } = require('../src/utils/bandSyncProtocol.ts')
const { initialBandSyncState: initial, reconnectBandSync: reconnect, applyBandSyncMessage: apply } = require('../src/utils/bandSyncSync.ts')
const hash = 'a'.repeat(64)
const state = () => ({ songId: 'song', contentHash: hash, displayTitle: 'Title', transposeOffset: 0, effectiveKey: 'C',
  chordsVisible: false, setlist: { id: null, index: 0, count: 0 }, lineIndex: 0, scrollFraction: 0,
  autoscroll: { on: false, speed: 1 }, notation: 'chords' })
const chart = () => ({ songId: 'song', displayTitle: 'Title', lines: [{ type: 'LYRIC', lyrics: 'Words' }], chordsVisible: false,
  transpose: { offset: 0, effectiveKey: 'C' }, position: { lineIndex: 0 }, scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } })
const content = () => ({ contentHash: hash, snapshot: chart() })
const message = (type, payload, direction = 'SERVER_TO_CLIENT', sequence = 1) => ({ version: 1, roomCode: 'ABCDEFGH', type, payload, direction, sequence, timestamp: 0 })
const snap = (sequence = 1) => message('SNAPSHOT', { state: state(), content: content(), leaderOnline: true }, 'SERVER_TO_CLIENT', sequence)
const cases = [
  ['HELLO', { role: 'leader' }, ['LEADER_TO_SERVER', 'FOLLOWER_TO_SERVER']],
  ['SNAPSHOT', { state: state(), content: content(), leaderOnline: true }, ['SERVER_TO_CLIENT']],
  ['STATE', { state: state() }, ['LEADER_TO_SERVER', 'SERVER_TO_CLIENT']],
  ['CONTENT', content(), ['LEADER_TO_SERVER', 'SERVER_TO_CLIENT']],
  ['NEED_CONTENT', { contentHash: hash }, ['FOLLOWER_TO_SERVER', 'SERVER_TO_CLIENT']],
  ['BYE', {}, ['LEADER_TO_SERVER', 'FOLLOWER_TO_SERVER']],
  ['SESSION_ENDED', { reason: 'EXPIRED' }, ['SERVER_TO_CLIENT']],
  ['ERROR', { code: 'RESYNC_REQUIRED' }, ['SERVER_TO_CLIENT']],
]
test('all messages: exact payload/envelope allowlists and direction matrix', () => {
  for (const [type, payload, allowed] of cases) {
    for (const direction of ['LEADER_TO_SERVER', 'FOLLOWER_TO_SERVER', 'SERVER_TO_CLIENT']) {
      const m = message(type, payload, direction)
      assert.equal(validate(m, direction).ok, allowed.includes(direction), `${type}/${direction}`)
      assert.equal(validate({ ...m, extra: true }, direction).ok, false)
      assert.equal(validate({ ...m, payload: { ...payload, extra: true } }, direction).ok, false)
      assert.equal(validate({ ...m, payload: {} }, direction).ok, type === 'BYE' && allowed.includes(direction))
    }
    const direction = allowed[0], m = message(type, payload, direction)
    for (const field of ['ORIGINAL_KEY', 'CHART_KEY', 'original_key', '{original_key}']) {
      assert.equal(validate({ ...m, [field]: 'C' }, direction).ok, false)
      assert.equal(validate({ ...m, payload: { ...payload, [field]: 'C' } }, direction).ok, false)
    }
    assert.equal(validate(m, 'INVALID').ok, false)
  }
  for (const type of ['REQUEST_SONG', 'CHAT', 'VOICE_MEMO', '__proto__']) assert.equal(validate(message(type, {}), 'SERVER_TO_CLIENT').error, 'UNKNOWN_MESSAGE_TYPE')
})
test('state fields: numeric boundaries, exact nested allowlists, no key metadata, detached display text', () => {
  const v = s => validate(message('STATE', { state: s }), 'SERVER_TO_CLIENT')
  for (const [key, value] of [['transposeOffset', -12], ['transposeOffset', 12], ['transposeOffset', 0.5], ['scrollFraction', -0.1],
    ['scrollFraction', 1.01], ['scrollFraction', NaN], ['lineIndex', 2048], ['contentHash', 'wrong'], ['notation', 'html'], ['displayTitle', '']]) {
    assert.equal(v({ ...state(), [key]: value }).ok, false, key)
  }
  for (const offset of [-11, 0, 11]) assert.equal(v({ ...state(), transposeOffset: offset }).ok, true)
  for (const key of ['ORIGINAL_KEY', 'CHART_KEY', 'original_key', '{original_key}']) {
    assert.equal(v({ ...state(), [key]: 'C' }).ok, false)
    const c = content(); c.snapshot[key] = 'C'
    assert.equal(validate(message('CONTENT', c), 'SERVER_TO_CLIENT').ok, false)
  }
  for (const field of ['setlist', 'autoscroll']) assert.equal(v({ ...state(), [field]: { ...state()[field], extra: 1 } }).ok, false)
  assert.equal(v({ ...state(), setlist: { id: null, index: 1, count: 1 } }).ok, false)
  const m = message('STATE', { state: { ...state(), displayTitle: '<script>text</script>' } })
  const result = validate(m, 'SERVER_TO_CLIENT'); assert.equal(result.value.payload.state.displayTitle, '<script>text</script>')
  m.payload.state.displayTitle = 'changed'; assert.notEqual(result.value.payload.state.displayTitle, 'changed')
})
test('bounded JSON and fixed errors: oversize, cycles, accessors, invalid envelopes and Cast2 content limits', () => {
  assert.equal(validate(' '.repeat(L.bytes + 1), 'SERVER_TO_CLIENT').error, 'OVERSIZED_PAYLOAD')
  const huge = state(); huge.displayTitle = '\u0000'.repeat(512); huge.songId = '\u0000'.repeat(128)
  huge.setlist.id = '\u0000'.repeat(128); huge.effectiveKey = '\u0000'.repeat(32)
  const m = message('STATE', { state: huge }); assert.ok(Buffer.byteLength(JSON.stringify(m)) > 4096)
  assert.equal(validate(m, 'SERVER_TO_CLIENT').error, 'OVERSIZED_PAYLOAD')
  const cyclic = {}; cyclic.x = cyclic
  for (const input of [cyclic, new Date(), '{', null, new Uint8Array(2), { get token() { throw Error('do not echo') } }]) {
    assert.equal(validate(input, 'SERVER_TO_CLIENT').error, 'MALFORMED_PAYLOAD')
  }
  for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(validate({ ...snap(), sequence }, 'SERVER_TO_CLIENT').error, 'INVALID_SEQUENCE')
  assert.equal(validate({ ...snap(), version: 2 }, 'SERVER_TO_CLIENT').error, 'UNKNOWN_PROTOCOL_VERSION')
  assert.equal(validate({ ...snap(), direction: 'LEADER_TO_SERVER' }, 'SERVER_TO_CLIENT').error, 'INVALID_DIRECTION')
  for (const mutate of [s => s.lines.push(...Array(2048).fill({ type: 'EMPTY' })), s => { s.lines[0].lyrics = 'x'.repeat(8193) },
    s => { s.transpose.original_key = 'C' }, s => { s.mode.notation = 'html' }, s => { s.position.lineIndex = 1 }]) {
    const c = content(); mutate(c.snapshot); assert.equal(validate(message('CONTENT', c), 'SERVER_TO_CLIENT').ok, false)
  }
})
test('follower: initial/reconnect/gap require snapshot; duplicate/stale/wrong room rejected; ending terminal', () => {
  const s0 = initial('ABCDEFGH'), update = n => message('STATE', { state: state() }, 'SERVER_TO_CLIENT', n)
  assert.equal(apply(s0, update(2)).error, 'RESYNC_REQUIRED')
  const s1 = apply(s0, snap()).state; assert.equal(s1.awaitingSnapshot, false)
  assert.equal(apply(s1, snap()).error, 'STALE_OR_OUT_OF_ORDER_UPDATE')
  assert.equal(apply(s1, { ...snap(2), roomCode: 'JKLMNPQR' }).error, 'ROOM_MISMATCH')
  const s2 = apply(s1, update(2)).state
  const gap = apply(s2, update(4)); assert.equal(gap.error, 'RESYNC_REQUIRED'); assert.equal(gap.state.awaitingSnapshot, true)
  assert.equal(apply(gap.state, update(5)).error, 'RESYNC_REQUIRED')
  assert.equal(apply(gap.state, snap(5)).error, null)
  assert.equal(apply(reconnect(s2), update(3)).error, 'RESYNC_REQUIRED')
  assert.equal(apply(reconnect(s2), snap(2)).error, null)
  const changed = apply(s2, message('STATE', { state: { ...state(), contentHash: 'b'.repeat(64) } }, 'SERVER_TO_CLIENT', 3)).state
  assert.equal(changed.content, null)
  const ended = apply(s2, message('SESSION_ENDED', { reason: 'EXPIRED' }, 'SERVER_TO_CLIENT', 99)).state
  assert.equal(ended.revoked, true); assert.equal(ended.content, null); assert.equal(ended.state, null)
  assert.equal(apply(reconnect(ended), snap(100)).error, 'SESSION_REVOKED')
})
