// Metronome engine, model and tap tempo with a fake AudioContext and a fake clock (no real audio).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename)

const { MetronomeEngine } = require(path.join(__dirname, '../src/utils/metronome.ts'))
const model = require(path.join(__dirname, '../src/utils/metronomeModel.ts'))
const { createTapTempo } = require(path.join(__dirname, '../src/utils/metronomeTap.ts'))

const EPS = 1e-6
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < EPS, `${message ?? ''} expected ${expected}, got ${actual}`)
/** Lights fire on the first scheduler tick at or after the scheduled time (ticks are 25 ms apart). */
const firedOnTime = (actual, scheduled, message) => assert.ok(actual >= scheduled - EPS && actual <= scheduled + 0.025 + EPS, `${message ?? ''} scheduled ${scheduled}, fired ${actual}`)

/** Fake AudioContext: records every node, link and start/stop time. Time only moves when the test moves it. */
function fakeContext() {
  const ctx = {
    state: 'running', currentTime: 0, sampleRate: 48000, resumes: 0,
    oscillators: [], gains: [], links: [], sources: [],
    destination: { kind: 'destination' },
    resume() { ctx.resumes += 1; ctx.state = 'running'; return Promise.resolve() },
    createOscillator() {
      const osc = {
        kind: 'osc', type: '', started: null, stopped: null,
        frequency: { value: 0, setValueAtTime(v) { this.value = v }, exponentialRampToValueAtTime() {} },
        connect(to) { ctx.links.push({ from: this, to }) }, disconnect() {},
        start(t) { this.started = t ?? 0 }, stop(t) { this.stopped = t ?? 0 },
      }
      ctx.oscillators.push(osc)
      return osc
    },
    createGain() {
      const gain = {
        kind: 'gain', gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect(to, output, input) { ctx.links.push({ from: this, to, output, input }) }, disconnect() { this.disconnected = true },
      }
      ctx.gains.push(gain)
      return gain
    },
    createChannelMerger() {
      const merger = { kind: 'merger', connect(to, output, input) { ctx.links.push({ from: this, to, output, input }) }, disconnect() {} }
      return merger
    },
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) } },
    createBufferSource() {
      const src = { kind: 'source', buffer: null, connect(to) { ctx.links.push({ from: this, to }) }, disconnect() {}, start(t) { this.started = t }, stop(t) { this.stopped = t } }
      ctx.sources.push(src)
      return src
    },
    createBiquadFilter() { return { kind: 'filter', type: '', frequency: { value: 0 }, connect(to) { ctx.links.push({ from: this, to }) }, disconnect() {} } },
  }
  return ctx
}

function harness({ stored, storage, noAudio = false, clock } = {}) {
  const ctx = fakeContext()
  const timers = new Map()
  let nextId = 0
  const visible = []
  const created = []
  const mem = new Map(Object.entries(stored ?? {}))
  const store = storage === undefined ? {
    getItem: key => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, value) },
  } : storage
  const engine = new MetronomeEngine({
    createContext: () => { created.push(true); return noAudio ? null : ctx },
    now: () => (clock ? clock.t : ctx.currentTime),
    setTimer: (fn) => { const id = ++nextId; timers.set(id, fn); return id },
    clearTimer: id => { timers.delete(id) },
    storage: () => store,
    onVisible: fn => { visible.push(fn); return () => {} },
  })
  const beats = []
  engine.onBeat((beat, isAccented, detail) => beats.push({ beat, isAccented, ...detail, at: clock ? clock.t : ctx.currentTime }))
  // Advance the clock in 25 ms steps, running every scheduler timer at each step, like the browser does.
  const run = seconds => {
    const end = (clock ? clock.t : ctx.currentTime) + seconds
    while ((clock ? clock.t : ctx.currentTime) < end - 1e-9) {
      const next = Math.min(end, (clock ? clock.t : ctx.currentTime) + 0.025)
      if (clock) clock.t = next
      else ctx.currentTime = next
      for (const fn of [...timers.values()]) fn()
    }
  }
  const at = t => { if (clock) clock.t = t; else ctx.currentTime = t }
  const starts = () => ctx.oscillators.filter(o => o.started !== null).map(o => o.started).sort((a, b) => a - b)
  return { ctx, engine, timers, visible, created, mem, beats, run, at, starts, clock }
}

const audibleAt = (ctx, t) => ctx.oscillators.filter(o => o.started !== null && o.started <= t && (o.stopped === null || t < o.stopped))
/** Output node a voice reaches: osc -> gain -> left/right gain -> merger input (0 = left, 1 = right). */
function channelOf(ctx, osc) {
  const gain = ctx.links.find(l => l.from === osc).to
  const outs = ctx.links.filter(l => l.from === gain).map(l => l.to)
  const sides = outs.map(out => ctx.links.find(l => l.from === out && l.to.kind === 'merger')?.input)
  return sides.length === 2 ? 'center' : sides[0] === 0 ? 'left' : 'right'
}

test('tempo: clamps to 30..300, rounds, ignores non-numbers, and keeps the value after reload', () => {
  const h = harness()
  h.engine.setBpm(10); assert.equal(h.engine.getState().bpm, 30)
  h.engine.setBpm(999); assert.equal(h.engine.getState().bpm, 300)
  h.engine.setBpm(127.6); assert.equal(h.engine.getState().bpm, 128)
  h.engine.setBpm(Number.NaN); assert.equal(h.engine.getState().bpm, 128)
  assert.equal(JSON.parse(h.mem.get('gtar_metronome_v2')).bpm, 128)
  const reloaded = harness({ stored: { gtar_metronome_v2: h.mem.get('gtar_metronome_v2') } })
  assert.equal(reloaded.engine.getState().bpm, 128)
})

test('no AudioContext before a tap: scheduling and settings never create audio', () => {
  const h = harness()
  h.engine.setBpm(90); h.engine.cycleAccent(0); h.engine.setSplit(true)
  assert.equal(h.created.length, 0)
  h.engine.start()
  assert.equal(h.created.length, 1)
  h.engine.stop()
  h.engine.start()
  assert.equal(h.created.length, 1, 'the context is created once')
})

test('tap tempo: two taps give BPM, smoothing averages recent intervals, outliers are ignored', () => {
  const tap = createTapTempo()
  assert.equal(tap.tap(0), null, 'one tap is not a tempo')
  assert.equal(tap.tap(500), 120)
  assert.equal(tap.tap(1000), 120)
  const smooth = createTapTempo()
  smooth.tap(0); smooth.tap(600); smooth.tap(1100)
  assert.equal(smooth.tap(1700), 106, 'intervals 600, 500, 600 average to 566.7 ms')
  const outlier = createTapTempo()
  outlier.tap(0); outlier.tap(500); outlier.tap(1000); outlier.tap(1500)
  assert.equal(outlier.tap(3500), 120, 'a 2000 ms pause among 500 ms taps is a miss, not a tempo')
  const bounds = createTapTempo()
  bounds.tap(0)
  assert.equal(bounds.tap(100), 300, 'a very fast tap is clamped to 300')
})

test('tap tempo: a pause longer than the gap starts a new sequence', () => {
  const tap = createTapTempo({ gapMs: 2500 })
  tap.tap(0); tap.tap(500)
  assert.equal(tap.tap(5000), null, 'long gap restarts: this tap alone gives nothing')
  assert.equal(tap.tap(5500), 120)
  tap.reset()
  assert.equal(tap.tap(6000), null)
})

test('model: 6/8 counts are eighths in 3 + 3 groups, defaults accent the group starts, accents cycle in order', () => {
  assert.equal(model.countsPerBar('6/8'), 6)
  assert.equal(model.sixteenthsPerBar('6/8'), 12)
  assert.equal(model.sixteenthsPerBar('4/4'), 16)
  assert.deepEqual(model.groupStarts('6/8'), [0, 3])
  assert.deepEqual(model.groupStarts('4/4'), [0])
  assert.deepEqual(model.defaultAccents('6/8'), ['accent', 'normal', 'normal', 'accent', 'normal', 'normal'])
  assert.equal(model.nextAccent('accent'), 'normal')
  assert.equal(model.nextAccent('normal'), 'silent')
  assert.equal(model.nextAccent('silent'), 'accent')
  assert.deepEqual(model.sanitizeSettings('garbage'), model.defaultSettings())
  const cleaned = model.sanitizeSettings({ bpm: 9999, timeSignature: '5/4', accents: { '2/4': ['silent'] }, ears: { left: { note: 'thirtysecond' } } })
  assert.equal(cleaned.bpm, 300)
  assert.equal(cleaned.timeSignature, '4/4')
  assert.deepEqual(cleaned.accents['2/4'], model.defaultAccents('2/4'), 'wrong-length accents fall back to defaults')
  assert.equal(cleaned.ears.left.note, 'quarter')
})

test('4/4 at 120 BPM: clicks land on exact count times, lights run 1..4 with the accent on 1', () => {
  const h = harness()
  h.engine.start()
  h.run(2.2)
  const first = h.starts().slice(0, 5);
  [0.05, 0.55, 1.05, 1.55, 2.05].forEach((t, i) => near(first[i], t, `click ${i}`))
  assert.deepEqual(h.beats.slice(0, 5).map(b => b.beat), [1, 2, 3, 4, 1])
  assert.deepEqual(h.beats.slice(0, 5).map(b => b.isAccented), [true, false, false, false, true])
})

test('6/8: counts are eighths at 120 BPM, main beats on counts 1 and 4 get the accent pitch', () => {
  const h = harness()
  h.engine.setTimeSignature('6/8')
  h.engine.start()
  h.run(1.6)
  const s = h.starts()
  for (let k = 0; k < 6; k++) near(s[k], 0.05 + 0.25 * k, `eighth ${k}`)
  assert.deepEqual(h.beats.slice(0, 6).map(b => b.beat), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(h.beats.slice(0, 6).map(b => b.isAccented), [true, false, false, true, false, false])
  const freqs = h.ctx.oscillators.slice(0, 6).map(o => o.frequency.value)
  assert.deepEqual(freqs, [1200, 800, 800, 1200, 800, 800], 'accent pitch on counts 1 and 4 only')
})

test('split ears: each ear has its own note value and routes to its own channel', () => {
  const h = harness()
  h.engine.setSplit(true)
  h.engine.setEar('left', { note: 'quarter', sound: 'beep', volume: 1 })
  h.engine.setEar('right', { note: 'sixteenth', sound: 'tick', volume: 1 })
  h.engine.start()
  h.run(1.0)
  const heard = side => h.ctx.oscillators.filter(o => o.started !== null && o.started < 1.0 && channelOf(h.ctx, o) === side).map(o => o.started).sort((a, b) => a - b)
  const left = heard('left')
  const right = heard('right')
  assert.equal(left.length, 2, 'quarter ear: one click per quarter note')
  near(left[0], 0.05); near(left[1], 0.55)
  assert.equal(right.length, 8, 'sixteenth ear: four clicks per quarter note')
  for (let m = 0; m < 8; m++) near(right[m], 0.05 + 0.125 * m, `sixteenth ${m}`)
  assert.ok(h.ctx.oscillators.filter(o => o.started !== null).every(o => ['left', 'right'].includes(channelOf(h.ctx, o))))
})

test('simple view: the ear grid is not used and both channels get the same clicks', () => {
  const h = harness()
  h.engine.start()
  h.run(0.2)
  const osc = h.ctx.oscillators.find(o => o.started !== null)
  assert.equal(channelOf(h.ctx, osc), 'center')
})

test('silent drops only that count; its subdivisions still sound', () => {
  const h = harness()
  h.engine.setSplit(true)
  h.engine.setEar('left', { note: 'quarter', volume: 1 })
  h.engine.setEar('right', { note: 'sixteenth', volume: 1 })
  h.engine.cycleAccent(1) // normal -> silent on count 2
  h.engine.start()
  h.run(0.8)
  const s = h.starts()
  assert.ok(!s.some(t => Math.abs(t - 0.55) < EPS), 'no count-2 click on the quarter ear or the sixteenth ear')
  for (const t of [0.675, 0.8, 0.925]) assert.ok(s.some(x => Math.abs(x - t) < EPS), `subdivision at ${t} still sounds`)
  assert.deepEqual(h.beats.slice(0, 2).map(b => b.beat), [1, 2], 'the light still lights and is silent')
  assert.equal(h.beats[1].accent, 'silent')
})

test('BPM change while running keeps the bar position: no restart, next beat follows the new tempo', () => {
  const h = harness()
  h.engine.start()
  h.run(1.2)
  assert.deepEqual(h.beats.map(b => b.beat), [1, 2, 3])
  h.engine.setBpm(60)
  h.run(2.0)
  assert.deepEqual(h.beats.map(b => b.beat), [1, 2, 3, 4, 1], 'beat 4 follows beat 3, not beat 1')
  firedOnTime(h.beats[3].at, 1.9, 'beat 4 at the new tempo')
  firedOnTime(h.beats[4].at, 2.9, 'beat 1 one bar later at 60 BPM')
})

test('start/stop: stop silences pending clicks at once; restart leaves no stacked clicks', () => {
  const h = harness()
  h.engine.start()
  h.run(0.01)
  h.engine.stop()
  assert.equal(audibleAt(h.ctx, 0.01).length, 0, 'nothing sounding after stop')
  assert.equal(h.timers.size, 0, 'scheduler timer cleared')
  assert.equal(h.engine.getState().isRunning, false)
  h.run(1.0)
  const live = h.ctx.oscillators.filter(o => o.started !== null && (o.stopped === null || o.stopped > o.started))
  assert.equal(live.length, 0, 'every pending click was cancelled by stop')
  assert.equal(audibleAt(h.ctx, 1.0).length, 0)
  h.engine.start(); h.engine.start(); h.engine.start()
  h.run(1.0)
  // Clicks that were cancelled (stopped at or before their start) never sound; the rest must be one per grid point.
  const s = h.ctx.oscillators.filter(o => o.started !== null && (o.stopped === null || o.stopped > o.started)).map(o => o.started).sort((a, b) => a - b)
  assert.ok(s.length >= 2)
  for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] > 0.4, `no stacked clicks at ${s[i]}`)
  assert.equal(new Set(s.map(t => t.toFixed(6))).size, s.length, 'no duplicate clicks')
  near(s[0], 1.06, 'first click of the restarted run')
})

test('count-in: one bar of count clicks (lights marked count-in) before beat 1', () => {
  const h = harness()
  h.engine.setCountIn(true)
  h.engine.start()
  h.run(2.2)
  const first = h.beats.slice(0, 5)
  assert.deepEqual(first.map(b => b.beat), [1, 2, 3, 4, 1])
  assert.deepEqual(first.map(b => b.countingIn), [true, true, true, true, false])
  firedOnTime(first[4].at, 2.05, 'beat 1 after the count-in bar')
  assert.equal(h.starts().length, 5, 'count-in is one click per count, no subdivisions')
})

test('lights only: the scheduler and beat lights run with no sound', () => {
  const h = harness()
  h.engine.toggleMute()
  h.engine.start()
  h.run(1.2)
  assert.equal(h.ctx.oscillators.length, 0)
  assert.deepEqual(h.beats.map(b => b.beat), [1, 2, 3])
  h.engine.toggleMute()
  assert.equal(h.engine.getState().isMuted, false)
})

test('background or suspended context: no backlog on resume, grid continues from the audio clock', () => {
  const h = harness()
  h.engine.start()
  h.run(1.0)
  h.ctx.state = 'suspended'
  for (let i = 0; i < 20; i++) for (const fn of [...h.timers.values()]) fn() // timers keep firing; the audio clock is frozen
  assert.equal(h.starts().filter(t => t > 1.16).length, 0, 'nothing scheduled beyond the lookahead while suspended')
  h.visible[0]() // visibilitychange while suspended: a resume is requested, the schedule waits
  assert.equal(h.ctx.resumes, 1)
  h.ctx.state = 'running'
  h.visible[0]()
  const cancelled = h.ctx.oscillators.filter(o => o.started !== null && o.started > 1.0 && o.stopped !== null && o.stopped <= o.started)
  assert.ok(cancelled.length > 0, 'clicks queued before the suspension are dropped on wake')
  h.run(1.0)
  const after = h.ctx.oscillators.filter(o => o.started !== null && o.started > 1.0 && o.stopped > o.started).map(o => o.started)
  assert.ok(after.length > 0)
  for (const t of after) assert.ok(t >= 1.0 - EPS, `no click in the past at ${t}`)
  for (const t of after) assert.ok(Math.abs(((t - 0.05) / 0.5) - Math.round((t - 0.05) / 0.5)) < 1e-6, `on the 120 BPM grid at ${t}`)
})

test('late timer (throttled tab): clicks already in the past are dropped, not played in a burst', () => {
  const h = harness()
  h.engine.start()
  h.run(0.1)
  h.at(3.0)
  h.run(0.025)
  const late = h.starts().filter(t => t > 0.1 && t < 3.0)
  assert.equal(late.length, 0, 'nothing scheduled into the past')
  assert.ok(h.starts().filter(t => t >= 3.0).every(t => t >= 3.0))
})

test('no audio available: the lights still run from the fallback clock', () => {
  const clock = { t: 0 }
  const h = harness({ noAudio: true, clock })
  h.engine.start()
  h.run(1.2)
  assert.equal(h.ctx.oscillators.length, 0)
  assert.deepEqual(h.beats.map(b => b.beat), [1, 2, 3])
})

test('saved settings: restored on load, and the engine works when storage throws', () => {
  const h = harness()
  h.engine.setTimeSignature('3/4')
  h.engine.setEar('right', { note: 'sixteenth', sound: 'snap' })
  h.engine.setSplit(true)
  const reloaded = harness({ stored: { gtar_metronome_v2: h.mem.get('gtar_metronome_v2') } })
  const state = reloaded.engine.getState()
  assert.equal(state.timeSignature, '3/4')
  assert.equal(state.ears.right.sound, 'snap')
  assert.equal(state.split, true)
  const broken = harness({ storage: { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } } })
  assert.doesNotThrow(() => { broken.engine.setBpm(90); broken.engine.start(); broken.run(0.3); broken.engine.stop() })
  assert.equal(broken.engine.getState().bpm, 90)
})
