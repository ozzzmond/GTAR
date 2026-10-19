const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { CAST2_LIMITS, validateCast2Message, validateReceiverSnapshot } = require('../src/utils/stageCast2Protocol.ts')
const { projectCast2Presentation } = require('../src/utils/stageCast2Projection.ts')
const { initialCast2SyncState, reconnectCast2, applyCast2Message, nextCast2Sequence } = require('../src/utils/stageCast2Sync.ts')
const { parseGtarSong } = require('../src/utils/songParser.ts')
const { transposeContext } = require('../src/utils/songKeySemantics.ts')
const stage = () => ({ song: { id: 'song-a', title: 'Stage title', rawContent: '{title: Chart title}\n{key: C}\n[Verse]\n[C]Sing [G/B]along\nC    G\nWords here\ne|---0-2---|', key: 'C', format: 'CHORD_PRO', transposeOffset: 0 }, effectiveKey: 'C', transposeOffset: 0, fontSizePx: 28, fontStyle: 'mono', isTwoColumn: false })
const position = () => ({ lineIndex: 0, scrollTop: 0, scrollFraction: 0, chordsVisible: true })
const snapshot = () => {
  const result = projectCast2Presentation(stage(), position())
  assert.equal(result.ok, true)
  return result.value
}
const message = (type = 'PRESENTATION_SNAPSHOT', sequence = 1, payload = { snapshot: snapshot() }, direction = 'SERVER_TO_RECEIVER') => ({ version: 1, type, direction, sessionId: 'offline-session', timestamp: 1000, sequence, payload })
const validate = m => validateCast2Message(m, m.direction)
const apply = (s, m) => {
  const r = applyCast2Message(s, m)
  assert.equal(r.error, null)
  return r.state
}

const contracts = [
  ['PAIRING_REQUEST', { requestId: 'request' }, ['RECEIVER_TO_SERVER']],
  ['PAIRING_APPROVAL', { requestId: 'request' }, ['CONTROLLER_TO_SERVER']],
  ['PAIRING_REJECTION', { requestId: 'request', reason: 'DECLINED' }, ['CONTROLLER_TO_SERVER', 'SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER']],
  ['PAIRING_EXPIRY', { requestId: 'request' }, ['SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER']],
  ['SESSION_ESTABLISHED', { controllerId: 'controller', receiverId: 'receiver' }, ['SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER']],
  ['SESSION_REVOKED', { reason: 'CONTROLLER_ENDED' }, ['SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER']],
  ['PRESENTATION_SNAPSHOT', { snapshot: snapshot() }, ['CONTROLLER_TO_SERVER', 'SERVER_TO_RECEIVER']],
  ['PRESENTATION_UPDATE', { baseSequence: 1, snapshot: snapshot() }, ['CONTROLLER_TO_SERVER', 'SERVER_TO_RECEIVER']],
  ['SYNC_ACK', { appliedSequence: 1 }, ['RECEIVER_TO_SERVER']],
  ['SYNC_ERROR', { code: 'RESYNC_REQUIRED' }, ['RECEIVER_TO_SERVER', 'SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER']],
]
for (const [type, payload, allowed] of contracts) {
  test(`schema and direction: ${type}`, () => {
    for (const direction of ['CONTROLLER_TO_SERVER', 'RECEIVER_TO_SERVER', 'SERVER_TO_CONTROLLER', 'SERVER_TO_RECEIVER']) {
      const m = message(type, 2, payload, direction)
      assert.equal(validate(m).ok, allowed.includes(direction))
      if (!allowed.includes(direction)) assert.equal(validate(m).error, 'INVALID_DIRECTION')
    }
    const valid = message(type, 2, payload, allowed[0])
    assert.equal(validate({ ...valid, payload: {} }).ok, false)
    assert.equal(validate({ ...valid, payload: { ...payload, token: 'secret' } }).ok, false)
    assert.equal(validateCast2Message(valid, 'BAD_DIRECTION').error, 'INVALID_DIRECTION')
  })
}
test('version, message type, envelope, sequence and timestamps fail closed', () => {
  const m = message()
  assert.equal(validate({ ...m, version: 2 }).error, 'UNKNOWN_PROTOCOL_VERSION')
  for (const type of ['FUTURE', '__proto__', 'constructor', null]) assert.equal(validate({ ...m, type }).error, 'UNKNOWN_MESSAGE_TYPE')
  for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) assert.equal(validate({ ...m, sequence }).error, 'INVALID_SEQUENCE')
  for (const sequence of [NaN, Infinity]) assert.equal(validate({ ...m, sequence }).error, 'MALFORMED_PAYLOAD')
  for (const timestamp of [-1, 1.1, '1000', Infinity]) assert.equal(validate({ ...m, timestamp }).ok, false)
  for (const sessionId of ['', 'x'.repeat(129), {}, null]) assert.equal(validate({ ...m, sessionId }).ok, false)
  assert.equal(validate({ ...m, oauthToken: 'secret' }).error, 'MALFORMED_PAYLOAD')
  assert.equal(validate(message('PRESENTATION_UPDATE', 1, { baseSequence: 1, snapshot: snapshot() })).error, 'INVALID_SEQUENCE')
  assert.equal(nextCast2Sequence(Number.MAX_SAFE_INTEGER).error, 'INVALID_SEQUENCE')
})
test('malformed input, cycles, accessors and exotic objects never enter state', () => {
  for (const input of [undefined, null, [], 42, '{', 'null', new Date(), { x: 1n }, { x: () => 1 }]) assert.equal(validateCast2Message(input, 'SERVER_TO_RECEIVER').ok, false)
  const cyclic = {}; cyclic.self = cyclic
  assert.equal(validateCast2Message(cyclic, 'SERVER_TO_RECEIVER').error, 'MALFORMED_PAYLOAD')
  const accessor = Object.defineProperty({}, 'version', { enumerable: true, get() { throw Error('must not invoke') } })
  assert.equal(validateCast2Message(accessor, 'SERVER_TO_RECEIVER').error, 'MALFORMED_PAYLOAD')
  assert.equal(validateCast2Message(new Array(4294967295), 'SERVER_TO_RECEIVER').error, 'OVERSIZED_PAYLOAD')
  assert.equal(validateCast2Message(new Array(3), 'SERVER_TO_RECEIVER').error, 'MALFORMED_PAYLOAD')
  assert.equal(validateCast2Message(JSON.stringify(message()), 'SERVER_TO_RECEIVER').ok, true)
})
test('payload limits cover encoded UTF-8, nesting, text, lines, segments and raw input', () => {
  assert.equal(validateCast2Message(' '.repeat(CAST2_LIMITS.bytes + 1), 'SERVER_TO_RECEIVER').error, 'OVERSIZED_PAYLOAD')
  const m = message(); m.payload.snapshot.lines = [{ type: 'LYRIC', lyrics: '🎵'.repeat(70000) }]
  assert.equal(validate(m).error, 'OVERSIZED_PAYLOAD')
  let nested = {}; for (let i = 0; i < 20; i++) nested = { nested }
  assert.equal(validateCast2Message(nested, 'SERVER_TO_RECEIVER').error, 'OVERSIZED_PAYLOAD')
  for (const lines of [Array(2049).fill({ type: 'EMPTY' }), [{ type: 'LYRIC', lyrics: 'x'.repeat(8193) }], [{ type: 'CHORD_PRO', raw: '', segments: Array(1025).fill({ chord: null, text: '' }) }]]) {
    const s = snapshot(); s.lines = lines
    assert.equal(validateReceiverSnapshot(s).ok, false)
  }
  const state = stage(); state.song.rawContent = 'x'.repeat(CAST2_LIMITS.rawContent + 1)
  assert.equal(projectCast2Presentation(state, position()).error, 'OVERSIZED_PAYLOAD')
  const s = snapshot(); s.displayTitle = 'x'.repeat(256)
  assert.equal(validateReceiverSnapshot(s).ok, true)
  s.displayTitle += 'x'
  assert.equal(validateReceiverSnapshot(s).ok, false)
})
test('projection uses existing chord parser and chart-relative transpose semantics', () => {
  const state = stage(); state.transposeOffset = 2
  state.song.originalKey = 'D'
  state.effectiveKey = transposeContext(state.song, 2).performanceKey
  const before = structuredClone(state)
  const r = projectCast2Presentation(state, position())
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.lines, parseGtarSong(state.song.rawContent, 2).lines)
  assert.equal(r.value.lines.find(l => l.type === 'CHORD_PRO').segments[1].chord, 'A/C#')
  assert.deepEqual(r.value.transpose, { offset: 2, effectiveKey: state.effectiveKey })
  assert.deepEqual(state, before)
})
test('lyrics-only projection removes chord and tab data without shifting position indexes', () => {
  const shown = snapshot()
  const hidden = projectCast2Presentation(stage(), { ...position(), chordsVisible: false }).value
  assert.equal(hidden.lines.length, shown.lines.length)
  assert.ok(hidden.lines.some(l => l.type === 'LYRIC' && l.lyrics === 'Sing along'))
  assert.ok(hidden.lines.every(l => !['CHORD_PRO', 'CHORD_ROW', 'TAB'].includes(l.type)))
  hidden.lines[0] = { type: 'CHORD_ROW', chords: ['C'], raw: 'C' }
  assert.equal(validateReceiverSnapshot(hidden).ok, false)
})
test('projection excludes library, draft, auth, recovery and theme fields', () => {
  const state = stage()
  for (const k of ['songbook', 'setlists', 'draft', 'localStorage', 'recoveryArchives', 'auth', 'oauthToken', 'pin', 'pairingSecret', 'customThemeColors']) {
    state[k] = 'SENSITIVE_SENTINEL'; state.song[k] = 'SENSITIVE_SENTINEL'
  }
  const result = projectCast2Presentation(state, position())
  assert.equal(result.ok, true)
  assert.ok(!JSON.stringify(result.value).includes('SENSITIVE_SENTINEL'))
  assert.ok(!Object.hasOwn(result.value, 'rawContent'))
  const m = message(); m.payload.snapshot.auth = 'secret'
  assert.equal(validate(m).error, 'INVALID_PRESENTATION_STATE')
})
test('invalid presentation values and line shapes reject without clamping or mutation', () => {
  for (const mutate of [s => { s.scroll.fraction = 1.1 }, s => { s.scroll.top = -1 }, s => { s.position.lineIndex = 2048 }, s => { s.position.lineIndex = 100 }, s => { s.transpose.offset = 12 }, s => { s.mode.notation = 'html' }, s => { s.mode.columns = 3 }, s => { s.lines = [{ type: 'HTML', html: '<script>' }] }, s => { s.lines = [{ type: 'LYRIC', lyrics: 'okay', token: 'secret' }] }]) {
    const s = snapshot(); mutate(s)
    assert.equal(validate(message('PRESENTATION_SNAPSHOT', 1, { snapshot: s })).error, 'INVALID_PRESENTATION_STATE')
  }
  for (const offset of [NaN, Infinity, 1.5, 12]) assert.equal(projectCast2Presentation({ ...stage(), transposeOffset: offset }, position()).ok, false)
  assert.equal(projectCast2Presentation(stage(), { ...position(), chordsVisible: 'yes' }).ok, false)
})
test('initial snapshot applies atomically and detaches external input', () => {
  const initial = initialCast2SyncState('offline-session')
  const m = message()
  const state = apply(initial, m)
  assert.equal(state.sequence, 1)
  assert.equal(state.awaitingSnapshot, false)
  assert.deepEqual(state.snapshot, m.payload.snapshot)
  m.payload.snapshot.displayTitle = 'mutated'
  assert.equal(state.snapshot.displayTitle, 'Stage title')
  assert.equal(initial.snapshot, null)
})
test('song switch, transpose, scroll, chord visibility and mode update together', () => {
  const state = apply(initialCast2SyncState('offline-session'), message())
  const source = stage(); source.song.id = 'song-b'; source.song.title = 'Next'; source.transposeOffset = -2; source.effectiveKey = 'Bb'; source.isTwoColumn = true; source.notation = 'numbers'
  const next = projectCast2Presentation(source, { lineIndex: 2, scrollTop: 250, scrollFraction: 0.5, chordsVisible: false }).value
  const updated = apply(state, message('PRESENTATION_UPDATE', 2, { baseSequence: 1, snapshot: next }))
  assert.deepEqual(updated.snapshot, next)
  assert.equal(updated.snapshot.songId, 'song-b')
  assert.equal(updated.snapshot.transpose.offset, -2)
  assert.equal(updated.snapshot.scroll.top, 250)
  assert.equal(updated.snapshot.position.lineIndex, 2)
  assert.equal(updated.snapshot.chordsVisible, false)
  assert.deepEqual(updated.snapshot.mode, { columns: 2, notation: 'numbers' })
  assert.equal(state.snapshot.songId, 'song-a')
})
test('stale/duplicate updates and snapshots, session mismatch and invalid input preserve state', () => {
  const state = apply(initialCast2SyncState('offline-session'), message(undefined, 5))
  for (const m of [message(undefined, 5), message(undefined, 4), message('PRESENTATION_UPDATE', 5, { baseSequence: 4, snapshot: snapshot() }), { ...message(undefined, 6), sessionId: 'other' }, { ...message(undefined, 6), direction: 'CONTROLLER_TO_SERVER' }, { ...message(undefined, 6), version: 2 }]) {
    const r = applyCast2Message(state, m)
    assert.ok(r.error)
    assert.strictEqual(r.state, state)
  }
})
test('sequence gaps and reconnect require fresh snapshot; clocks do not determine ordering', () => {
  const initial = initialCast2SyncState('offline-session')
  const update = n => message('PRESENTATION_UPDATE', n, { baseSequence: n - 1, snapshot: snapshot() })
  assert.equal(applyCast2Message(initial, update(2)).error, 'RESYNC_REQUIRED')
  const state = apply(initial, message())
  const gap = applyCast2Message(state, update(3))
  assert.equal(gap.error, 'STALE_OR_OUT_OF_ORDER_UPDATE')
  assert.equal(gap.state.awaitingSnapshot, true)
  assert.equal(applyCast2Message(gap.state, update(2)).error, 'RESYNC_REQUIRED')
  const disconnected = reconnectCast2(state)
  assert.equal(disconnected.snapshot, state.snapshot)
  assert.equal(applyCast2Message(disconnected, update(2)).error, 'RESYNC_REQUIRED')
  assert.equal(applyCast2Message(disconnected, message()).error, 'STALE_OR_OUT_OF_ORDER_UPDATE')
  const resynced = apply(disconnected, { ...message(undefined, 10), timestamp: 0 })
  assert.equal(resynced.sequence, 10)
  assert.equal(apply(resynced, update(11)).sequence, 11)
  assert.equal(applyCast2Message(state, message('PRESENTATION_UPDATE', 2, { baseSequence: 0, snapshot: snapshot() })).error, 'MALFORMED_PAYLOAD')
})
test('server revocation clears display and permanently closes this local session state', () => {
  const state = apply(initialCast2SyncState('offline-session'), message())
  const revoked = apply(state, message('SESSION_REVOKED', 2, { reason: 'CONTROLLER_ENDED' }))
  assert.equal(revoked.snapshot, null)
  assert.equal(revoked.revoked, true)
  assert.equal(applyCast2Message(reconnectCast2(revoked), message(undefined, 3)).error, 'SESSION_REVOKED')
})
