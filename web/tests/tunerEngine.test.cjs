// Tuner microphone lifecycle (#534): the mic opens only on start(), uses the speech-processing-off
// constraints, reads pitch on animation frames, and stop() releases every track and closes the
// AudioContext. Denied, unsupported, no-mic, device change, ended track, interruption and hidden
// tab all stop it. Browser audio is replaced by in-memory fakes; no device is touched.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false })'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename)

const { TunerMic, TUNER_MIC_MESSAGES } = require('../src/utils/tunerEngine.ts')

class FakeTrack extends EventTarget {
  constructor() { super(); this.stopped = false }
  stop() { this.stopped = true }
}

class FakeStream {
  constructor() { this.tracks = [new FakeTrack()] }
  getTracks() { return this.tracks }
}

/** Builds an environment whose analyser reads the current test signal (a sine, or silence). */
function makeEnv({ supported = true, getUserMedia, hidden = false, withContext = true } = {}) {
  const env = {
    contexts: [], streams: [], constraints: [], frames: new Map(), nextFrame: 1,
    signal: { freq: 440, amplitude: 0.5 }, clock: 0,
  }
  class FakeContext extends EventTarget {
    constructor() {
      super()
      this.state = 'running'; this.sampleRate = 48000; this.closed = false
      env.contexts.push(this)
    }
    resume() { return Promise.resolve() }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve() }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createAnalyser() {
      return {
        fftSize: 0,
        getFloatTimeDomainData(buffer) {
          const { freq, amplitude } = env.signal
          for (let i = 0; i < buffer.length; i++) buffer[i] = freq ? amplitude * Math.sin(2 * Math.PI * freq * (i / 48000)) : 0
        },
      }
    }
  }
  const mediaDevices = supported ? new EventTarget() : undefined
  if (mediaDevices) {
    mediaDevices.getUserMedia = getUserMedia ?? (async (constraints) => {
      env.constraints.push(constraints)
      const stream = new FakeStream(); env.streams.push(stream); return stream
    })
  }
  const doc = Object.assign(new EventTarget(), { hidden })
  env.doc = doc
  env.mediaDevices = mediaDevices
  env.make = () => ({
    mediaDevices,
    AudioContextClass: withContext ? FakeContext : undefined,
    doc,
    requestFrame: (callback) => { const id = env.nextFrame++; env.frames.set(id, callback); return id },
    cancelFrame: (id) => { env.frames.delete(id) },
    now: () => env.clock,
  })
  /** Runs one animation frame; the clock advances 60 ms so every frame is an analysis tick. */
  env.frame = () => {
    env.clock += 60
    const pending = [...env.frames.values()]
    env.frames.clear()
    for (const callback of pending) callback()
  }
  return env
}

const streamOf = env => env.streams[env.streams.length - 1]

test('nothing opens until the player taps Start', () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  assert.equal(env.constraints.length, 0, 'no permission prompt on construction')
  assert.equal(env.contexts.length, 0)
  assert.deepEqual(mic.getSnapshot(), { state: 'off', message: null, frequency: null })
})

test('Start requests the mic with echo cancellation, noise suppression and auto gain off', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  assert.equal(env.constraints.length, 1)
  assert.deepEqual(env.constraints[0], { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  assert.equal(mic.getSnapshot().state, 'listening')
  mic.stop()
})

test('a repeated Start while listening does not open a second mic', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  await mic.start()
  assert.equal(env.constraints.length, 1)
  mic.stop()
})

test('frames read pitch: a steady tone is reported; silence is the calm no-signal state', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  env.signal = { freq: 440, amplitude: 0.5 }
  for (let i = 0; i < 12; i++) env.frame()
  const heard = mic.getSnapshot().frequency
  assert.ok(heard !== null && Math.abs(heard - 440) < 4.4, `reads 440 Hz (got ${heard})`)
  env.signal = { freq: 0, amplitude: 0 }
  for (let i = 0; i < 40; i++) env.frame()
  assert.equal(mic.getSnapshot().frequency, null, 'silence shows no signal after the hold')
  assert.equal(mic.getSnapshot().state, 'listening', 'silence is not an error')
  mic.stop()
})

test('stop releases every track, closes the AudioContext, cancels frames and leaves no listeners', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  const [context] = env.contexts
  const stream = streamOf(env)
  assert.equal(env.frames.size, 1, 'one frame is pending while listening')
  mic.stop()
  assert.ok(stream.tracks.every(track => track.stopped), 'every track is stopped')
  assert.equal(context.closed, true, 'the AudioContext is closed')
  assert.equal(env.frames.size, 0, 'the pending frame is cancelled')
  assert.deepEqual(mic.getSnapshot(), { state: 'off', message: null, frequency: null })
  // Late events from the old session must not revive or re-stop anything.
  env.doc.dispatchEvent(new Event('visibilitychange'))
  env.mediaDevices.dispatchEvent(new Event('devicechange'))
  assert.deepEqual(mic.getSnapshot(), { state: 'off', message: null, frequency: null })
  assert.equal(env.constraints.length, 1)
})

test('a hidden tab stops the mic without an error message', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  env.doc.hidden = true
  env.doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(mic.getSnapshot().state, 'off')
  assert.equal(mic.getSnapshot().message, null)
  assert.ok(streamOf(env).tracks.every(track => track.stopped))
  assert.ok(env.contexts.every(context => context.closed))
})

test('a visible tab change does not stop the mic', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  env.doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(mic.getSnapshot().state, 'listening')
  mic.stop()
})

test('device change stops the mic with a short message', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  env.mediaDevices.dispatchEvent(new Event('devicechange'))
  assert.equal(mic.getSnapshot().state, 'off')
  assert.equal(mic.getSnapshot().message, TUNER_MIC_MESSAGES.deviceChanged)
  assert.ok(streamOf(env).tracks.every(track => track.stopped))
})

test('an ended track stops the mic with a message', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  streamOf(env).tracks[0].dispatchEvent(new Event('ended'))
  assert.equal(mic.getSnapshot().state, 'off')
  assert.equal(mic.getSnapshot().message, TUNER_MIC_MESSAGES.trackEnded)
  assert.ok(env.contexts.every(context => context.closed))
})

test('an interrupted AudioContext (iOS) stops the mic with a message', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  await mic.start()
  const [context] = env.contexts
  context.state = 'interrupted'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(mic.getSnapshot().state, 'off')
  assert.equal(mic.getSnapshot().message, TUNER_MIC_MESSAGES.interrupted)
  assert.equal(context.closed, true)
})

test('permission denied: a short message, no mic and no open AudioContext left behind', async () => {
  const env = makeEnv({ getUserMedia: async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }) } })
  const mic = new TunerMic(env.make)
  await mic.start()
  assert.deepEqual(mic.getSnapshot(), { state: 'denied', message: TUNER_MIC_MESSAGES.denied, frequency: null })
  assert.ok(env.contexts.every(context => context.closed), 'the context opened for the attempt is closed')
  assert.equal(env.frames.size, 0)
})

test('no microphone found: a no-mic state with its own message', async () => {
  const env = makeEnv({ getUserMedia: async () => { throw Object.assign(new Error('none'), { name: 'NotFoundError' }) } })
  const mic = new TunerMic(env.make)
  await mic.start()
  assert.equal(mic.getSnapshot().state, 'no-mic')
  assert.equal(mic.getSnapshot().message, TUNER_MIC_MESSAGES.noMic)
})

test('other start failures show a generic retry message', async () => {
  const env = makeEnv({ getUserMedia: async () => { throw Object.assign(new Error('abort'), { name: 'AbortError' }) } })
  const mic = new TunerMic(env.make)
  await mic.start()
  assert.equal(mic.getSnapshot().state, 'error')
  assert.equal(mic.getSnapshot().message, TUNER_MIC_MESSAGES.error)
})

test('unsupported: no getUserMedia means no prompt and no AudioContext', async () => {
  const env = makeEnv({ supported: false })
  const mic = new TunerMic(env.make)
  await mic.start()
  assert.equal(mic.getSnapshot().state, 'unsupported')
  assert.equal(mic.getSnapshot().message, TUNER_MIC_MESSAGES.unsupported)
  assert.equal(env.contexts.length, 0)
})

test('unsupported: no AudioContext means the mic is not requested', async () => {
  const env = makeEnv({ withContext: false })
  const mic = new TunerMic(env.make)
  await mic.start()
  assert.equal(mic.getSnapshot().state, 'unsupported')
  assert.equal(env.constraints.length, 0)
})

test('stop during the permission prompt discards the late stream', async () => {
  let resolveStream
  const env = makeEnv({ getUserMedia: () => new Promise((resolve) => { resolveStream = resolve }) })
  const mic = new TunerMic(env.make)
  const starting = mic.start()
  assert.equal(mic.getSnapshot().state, 'starting')
  mic.stop()
  const late = new FakeStream()
  resolveStream(late)
  await starting
  assert.ok(late.tracks.every(track => track.stopped), 'the late track is released')
  assert.deepEqual(mic.getSnapshot(), { state: 'off', message: null, frequency: null })
  assert.ok(env.contexts.every(context => context.closed))
})

test('a snapshot is replaced only on change, so subscribers are not woken for no reason', async () => {
  const env = makeEnv()
  const mic = new TunerMic(env.make)
  let wakeups = 0
  const unsubscribe = mic.subscribe(() => { wakeups++ })
  mic.stop()
  assert.equal(wakeups, 0, 'stopping an idle mic changes nothing')
  await mic.start()
  assert.ok(wakeups >= 2, 'starting announces starting and listening')
  unsubscribe()
  const after = wakeups
  mic.stop()
  assert.equal(wakeups, after, 'an unsubscribed listener is not called')
})
