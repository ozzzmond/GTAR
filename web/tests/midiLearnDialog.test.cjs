// #536 Slice 4: the Actions section of the MIDI dialog. The nine actions in order, the mapping
// text, Learn (prompt, capture, timeout, Cancel, conflict with Replace), Clear, Reset with its
// confirm, storage failure, and every way Learn ends. Real Header, fake MIDIAccess, fake clock.
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/midiHeaderHarness.cjs')
const { q, click, key, run, midi, fakeInput, fakeAccess, domError } = h
const settings = require('../src/midi/settings.ts')
const { registerStageCommandRunner } = require('../src/utils/stageCommands.ts')
const { nearestNote, frequencyOfMidi } = require('../src/utils/tunerMath.ts')
const { midiInputLabel } = require('../src/midi/mapping.ts')

// The press limits read performance.now(); a fake clock steps past the 500 ms settle time.
const clock = { at: 100_000 }
performance.now = () => clock.at

const ACTIONS = [
  ['nextSong', 'Next song'], ['prevSong', 'Previous song'], ['nextSection', 'Next section'], ['prevSection', 'Previous section'],
  ['toggleAutoScroll', 'Autoscroll on/off'], ['scrollUp', 'Scroll up'], ['scrollDown', 'Scroll down'], ['transposeUp', 'Transpose up'], ['transposeDown', 'Transpose down'],
]
const IDS = ACTIONS.map(([id]) => id)
const cc = (number, channel = 1) => ({ type: 'cc', channel, number })
const note = (number, channel = 1) => ({ type: 'note', channel, number })
const pc = (number, channel = 1) => ({ type: 'pc', channel, number })
const CC_ON = [0xb0, 64, 127], CC_OFF = [0xb0, 64, 0], NOTE_ON = [0x90, 60, 100], PROGRAM = [0xc0, 5]
const PROMPT = 'Press a pedal or button…'

const panel = () => q('[data-testid="midi-panel"]')
const row = id => panel().querySelector(`[data-testid="midi-action-${id}"]`)
const part = (name, id) => panel().querySelector(`[data-testid="midi-${name}-${id}"]`)
const mappingText = id => part('mapping', id).textContent
const learn = id => part('learn', id)
const clear = id => part('clear', id)
const replace = id => part('replace', id)
const message = id => part('learn-status', id).textContent
const resetStatus = () => panel().querySelector('[data-testid="midi-reset-status"]').textContent
const savedMappings = () => JSON.parse(localStorage.getItem(h.KEY)).mappings
const footerButtons = () => [...panel().querySelectorAll('[data-app-modal="footer"] button')].map(button => button.textContent.trim())

/** Mounts the Header with MIDI on and a pedal connected (unless told otherwise) and opens the dialog. */
async function open({ mappings, navOptions, on = true } = {}) {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const nav = h.reset(navOptions ?? { access: fakeAccess([pedal]) })
  if (mappings) localStorage.setItem(h.KEY, JSON.stringify({ version: 1, enabled: false, device: 'all', channel: 'all', mappings }))
  const header = await h.mountHeader()
  if (on) { await h.openPopover(); await click(q('[data-testid="settings-midi"]')) }
  clock.at += 500
  await h.openMidiDialog()
  const send = bytes => run(() => pedal.send(bytes))
  const tick = ms => { clock.at += ms }
  return { nav, pedal, send, tick, close: () => header.unmount() }
}

test('Actions: the nine actions, always in the design order, each Not set with Learn and no Clear', async () => {
  const { close } = await open()
  try {
    assert.deepEqual([...panel().querySelectorAll('h3')].map(heading => heading.textContent), ['Connection', 'Actions', 'Advanced'])
    const rows = [...panel().querySelectorAll('[data-testid="midi-actions"] > li')]
    assert.deepEqual(rows.map(item => item.getAttribute('data-testid')), IDS.map(id => `midi-action-${id}`))
    assert.deepEqual(rows.map(item => item.firstElementChild.textContent), ACTIONS.map(([, label]) => label))
    for (const [id, label] of ACTIONS) {
      assert.equal(mappingText(id), 'Not set', id)
      assert.deepEqual([...row(id).querySelectorAll('button')].map(button => button.textContent), ['Learn'], `${id}: Learn only, no Clear`)
      assert.equal(learn(id).getAttribute('aria-label'), `Learn ${label}`)
      assert.equal(learn(id).disabled, false)
      assert.equal(message(id), '')
    }
    assert.deepEqual(footerButtons(), ['Reset', 'Close'], 'one Reset, in the footer')
    assert.equal(panel().querySelectorAll('input, textarea, [role="switch"], details, form').length, 0, 'no second switch')
    assert.doesNotMatch(panel().textContent, /Channel|monitor/i, 'Advanced is collapsed')
  } finally { await close() }
})

test('mapping text: Note 60 (C4) · Ch 1, CC 64 · Ch 1, Program 5 · Ch 1; Clear shows only when mapped', async () => {
  const mappings = { nextSong: note(60), prevSong: cc(64), nextSection: pc(5), scrollUp: note(61, 16), scrollDown: note(0, 2), transposeUp: note(127), transposeDown: cc(0, 10) }
  const { close } = await open({ mappings })
  try {
    assert.deepEqual(Object.fromEntries(IDS.map(id => [id, mappingText(id)])), {
      nextSong: 'Note 60 (C4) · Ch 1', prevSong: 'CC 64 · Ch 1', nextSection: 'Program 5 · Ch 1', prevSection: 'Not set', toggleAutoScroll: 'Not set',
      scrollUp: 'Note 61 (C#4) · Ch 16', scrollDown: 'Note 0 (C-1) · Ch 2', transposeUp: 'Note 127 (G9) · Ch 1', transposeDown: 'CC 0 · Ch 10',
    })
    for (const [id, label] of ACTIONS) {
      const mapped = Object.hasOwn(mappings, id)
      assert.deepEqual([...row(id).querySelectorAll('button')].map(button => button.textContent), mapped ? ['Learn', 'Clear'] : ['Learn'], id)
      if (mapped) assert.equal(clear(id).getAttribute('aria-label'), `Clear ${label}`)
    }
  } finally { await close() }
})

test('note names use C4 = 60, the same as the Tuner, for all 128 notes', () => {
  for (let number = 0; number <= 127; number++) {
    const { name, octave } = nearestNote(frequencyOfMidi(number))
    assert.equal(midiInputLabel(note(number, 3)), `Note ${number} (${name}${octave}) · Ch 3`)
  }
  assert.equal(midiInputLabel(note(69)), 'Note 69 (A4) · Ch 1')
  assert.equal(midiInputLabel(cc(119, 16)), 'CC 119 · Ch 16')
  assert.equal(midiInputLabel(pc(0)), 'Program 0 · Ch 1')
})

test('Learn is disabled unless the state is Connected; Clear and Reset still work', async () => {
  const STATES = [
    ['off', {}, false],
    ['starting', { request: () => new Promise(() => {}) }, true],
    ['blocked', { request: () => Promise.reject(domError('NotAllowedError')) }, true],
    ['no-device', {}, true],
    ['error', { request: () => Promise.reject(domError('InvalidStateError')) }, true],
  ]
  for (const [state, navOptions, on] of STATES) {
    const { close } = await open({ mappings: { nextSong: cc(64) }, navOptions, on })
    try {
      assert.equal(midi.getMidiSnapshot().state, state)
      for (const id of IDS) assert.equal(learn(id).disabled, true, `${state}: Learn ${id}`)
      assert.equal(mappingText('nextSong'), 'CC 64 · Ch 1', `${state}: mappings are still shown`)
      await click(learn('prevSong'))
      assert.equal(message('prevSong'), '', `${state}: a disabled Learn starts nothing`)
      await click(clear('nextSong'))
      assert.equal(mappingText('nextSong'), 'Not set', `${state}: Clear works`)
    } finally { await close() }
  }

  // Allow: MIDI was left on, the browser has not been asked yet.
  const nav = h.reset({ permission: 'prompt', access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) })
  h.leftOn()
  const stop = midi.startMidi()
  const header = await h.mountHeader()
  try {
    await h.openMidiDialog()
    assert.equal(midi.getMidiSnapshot().state, 'allow')
    for (const id of IDS) assert.equal(learn(id).disabled, true)
    await click(panel().querySelector('[data-testid="midi-status-action"]'))
    assert.equal(nav.requests.length, 1)
    for (const id of IDS) assert.equal(learn(id).disabled, false, 'enabled once Connected')
  } finally { await header.unmount(); stop() }
})

test('Learn: prompt with Cancel, then the first press is saved at once as type, channel and number only', async () => {
  const { send, close } = await open()
  try {
    learn('nextSong').focus()
    await click(learn('nextSong'))
    assert.equal(message('nextSong'), PROMPT)
    assert.equal(learn('nextSong').textContent, 'Cancel')
    assert.equal(learn('nextSong').getAttribute('aria-label'), 'Cancel Learn for Next song')
    assert.equal(document.activeElement, learn('nextSong'), 'focus stays on the same button')
    assert.equal(mappingText('nextSong'), 'Not set', 'nothing changes until a press arrives')
    for (const id of IDS.slice(1)) assert.equal(learn(id).disabled, true, 'one action learns at a time')

    await send(CC_ON)
    assert.equal(mappingText('nextSong'), 'CC 64 · Ch 1')
    assert.equal(message('nextSong'), 'Next song set to CC 64 · Ch 1.')
    assert.deepEqual(savedMappings(), { nextSong: { type: 'cc', channel: 1, number: 64 } }, 'no value, no velocity, no device')
    assert.equal(learn('nextSong').textContent, 'Learn')
    assert.equal(document.activeElement, learn('nextSong'))
    assert.ok(clear('nextSong'), 'Clear appears')
    for (const id of IDS) assert.equal(learn(id).disabled, false)

    await send(CC_OFF)
    await send([0x90, 61, 100])
    assert.deepEqual(savedMappings(), { nextSong: cc(64) }, 'Learn ended on capture: later input changes nothing')
  } finally { await close() }
})

test('Learn captures a note and a program change, and skips messages that do not count', async () => {
  const { send, tick, close } = await open()
  try {
    await click(learn('scrollUp'))
    for (const bytes of [[0x80, 60, 0], [0x90, 60, 0], [0xb0, 64, 63], [0xb0, 123, 0], [0xf8], [0xfe], [0xe0, 0, 64], [0xf0, 1, 0xf7], [0x90, 60]]) await send(bytes)
    assert.equal(message('scrollUp'), PROMPT, 'still waiting')
    assert.equal(localStorage.getItem(h.KEY).includes('scrollUp'), false)
    await send(NOTE_ON)
    assert.equal(message('scrollUp'), 'Scroll up set to Note 60 (C4) · Ch 1.')

    tick(200)
    await click(learn('scrollDown'))
    assert.equal(message('scrollUp'), '', 'the last result goes away when the next Learn starts')
    await send([0xcf, 5])
    assert.equal(message('scrollDown'), 'Scroll down set to Program 5 · Ch 16.')
    assert.deepEqual(savedMappings(), { scrollUp: note(60), scrollDown: pc(5, 16) })

    // Learning an action again replaces its own input, with no question.
    tick(200)
    await click(learn('scrollUp'))
    await send(PROGRAM)
    assert.equal(message('scrollUp'), 'Scroll up set to Program 5 · Ch 1.')
    assert.deepEqual(savedMappings(), { scrollUp: pc(5), scrollDown: pc(5, 16) })
  } finally { await close() }
})

test('Learn times out after 10 s: "Nothing received. Try again."', async () => {
  const { send, close } = await open()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await click(learn('transposeUp'))
    await run(() => mock.timers.tick(9_999))
    assert.equal(message('transposeUp'), PROMPT, '9.999 s')
    await run(() => mock.timers.tick(1))
    assert.equal(message('transposeUp'), 'Nothing received. Try again.')
    assert.equal(learn('transposeUp').textContent, 'Learn')
    for (const id of IDS) assert.equal(learn(id).disabled, false)
    await send(CC_ON)
    assert.deepEqual(savedMappings(), {}, 'a press after the timeout is not learned')
    assert.equal(mappingText('transposeUp'), 'Not set')

    // A capture stops the timer: no late "Nothing received" over the result.
    await send(CC_OFF)
    await click(learn('transposeUp'))
    await send(CC_ON)
    await run(() => mock.timers.tick(60_000))
    assert.equal(message('transposeUp'), 'Transpose up set to CC 64 · Ch 1.')
  } finally { mock.timers.reset(); await close() }
})

test('Cancel ends Learn and saves nothing', async () => {
  const { send, close } = await open({ mappings: { nextSong: cc(1) } })
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await click(learn('nextSong'))
    assert.equal(clear('nextSong'), null, 'no Clear while learning')
    await click(learn('nextSong'))
    assert.equal(message('nextSong'), '')
    assert.equal(learn('nextSong').textContent, 'Learn')
    await send(CC_ON)
    await run(() => mock.timers.tick(60_000))
    assert.deepEqual(savedMappings(), { nextSong: cc(1) })
    assert.equal(message('nextSong'), '', 'no timeout text after Cancel')
  } finally { mock.timers.reset(); await close() }
})

test('conflict: an input that is already used asks Replace or Cancel, and nothing is replaced silently', async () => {
  const { send, tick, close } = await open({ mappings: { nextSong: cc(64), scrollUp: note(60) } })
  try {
    await click(learn('prevSong'))
    await send(CC_ON)
    assert.equal(message('prevSong'), 'CC 64 · Ch 1 is used by Next song.')
    assert.deepEqual([...row('prevSong').querySelectorAll('button')].map(button => button.textContent), ['Replace', 'Cancel'])
    assert.deepEqual(savedMappings(), { nextSong: cc(64), scrollUp: note(60) }, 'nothing is saved while the question is open')
    assert.equal(mappingText('nextSong'), 'CC 64 · Ch 1')
    assert.equal(mappingText('prevSong'), 'Not set')
    for (const id of IDS.filter(id => id !== 'prevSong')) assert.equal(learn(id).disabled, true, 'no other Learn while the question is open')

    // More input does not answer the question.
    await send(CC_OFF); tick(200); await send(CC_ON); await send(NOTE_ON)
    assert.equal(message('prevSong'), 'CC 64 · Ch 1 is used by Next song.')
    assert.deepEqual(savedMappings(), { nextSong: cc(64), scrollUp: note(60) })

    await click(learn('prevSong')) // Cancel
    assert.equal(message('prevSong'), '')
    assert.equal(replace('prevSong'), null)
    assert.deepEqual(savedMappings(), { nextSong: cc(64), scrollUp: note(60) }, 'Cancel keeps both as they were')

    await send(CC_OFF); tick(200)
    await click(learn('prevSong'))
    await send(CC_ON)
    replace('prevSong').focus()
    await click(replace('prevSong'))
    assert.equal(message('prevSong'), 'Previous song set to CC 64 · Ch 1.')
    assert.equal(mappingText('prevSong'), 'CC 64 · Ch 1')
    assert.equal(mappingText('nextSong'), 'Not set', 'Replace moves it; the other action becomes Not set')
    assert.equal(clear('nextSong'), null)
    assert.deepEqual(savedMappings(), { prevSong: cc(64), scrollUp: note(60) })
    assert.equal(document.activeElement, learn('prevSong'), 'focus moves to Learn when Replace goes away')
  } finally { await close() }
})

test('Esc cancels Learn first, then closes the dialog; the same for the Replace question', async () => {
  const { send, close } = await open({ mappings: { nextSong: cc(64) } })
  try {
    await click(learn('prevSong'))
    await key('Escape')
    assert.ok(panel(), 'the dialog stays open')
    assert.equal(message('prevSong'), '')
    assert.equal(learn('prevSong').textContent, 'Learn')
    await send(CC_ON)
    assert.deepEqual(savedMappings(), { nextSong: cc(64) }, 'Learn really ended')

    await send(CC_OFF); clock.at += 200
    await click(learn('prevSong'))
    await send(CC_ON)
    assert.ok(replace('prevSong'))
    await key('Escape')
    assert.ok(panel())
    assert.equal(replace('prevSong'), null)
    assert.deepEqual(savedMappings(), { nextSong: cc(64) })

    await key('Escape')
    assert.equal(panel(), null, 'the next Esc closes')
    assert.equal(document.activeElement, h.wrench())
  } finally { await close() }
})

test('closing the dialog ends Learn: the next press is not learned, and it plays again', async () => {
  const fired = []
  const remove = registerStageCommandRunner(command => { fired.push(command); return true })
  const { send, tick, close } = await open({ mappings: { nextSong: cc(64) } })
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    for (const leave of [() => click(panel().querySelector('[data-testid="midi-panel-close"]')), () => click(q('[data-testid="midi-modal-backdrop"]')), () => click(panel().querySelector('button[aria-label="Close"]'))]) {
      await click(learn('prevSong'))
      await leave()
      assert.equal(panel(), null)
      fired.length = 0
      tick(200)
      await send(CC_ON); await send(CC_OFF)
      assert.deepEqual(fired, ['nextSong'], 'not taken by Learn: Stage gets it')
      await run(() => mock.timers.tick(60_000))
      assert.deepEqual(savedMappings(), { nextSong: cc(64) })
      await h.openMidiDialog()
      assert.equal(message('prevSong'), '', 'Learn state is not kept between openings')
      assert.equal(learn('prevSong').textContent, 'Learn')
    }
  } finally { mock.timers.reset(); remove(); await close() }
})

test('MIDI off, or the device going away, ends Learn', async () => {
  const { nav, pedal, send, tick, close } = await open()
  try {
    await click(learn('nextSong'))
    await run(() => midi.setMidiEnabled(false))
    assert.equal(message('nextSong'), '')
    assert.equal(learn('nextSong').textContent, 'Learn')
    assert.equal(learn('nextSong').disabled, true)
    await click(panel().querySelector('[data-testid="midi-status-action"]')) // Turn on
    tick(500)
    assert.equal(midi.getMidiSnapshot().state, 'connected')
    assert.equal(message('nextSong'), '', 'on again does not resume Learn')
    await send(CC_ON)
    assert.deepEqual(savedMappings(), {})

    await send(CC_OFF)
    await click(learn('nextSong'))
    await run(() => nav.access.unplug(pedal))
    assert.equal(midi.getMidiSnapshot().state, 'no-device')
    assert.equal(message('nextSong'), '')
    assert.equal(learn('nextSong').disabled, true)
    await run(() => nav.access.plug(pedal))
    tick(500)
    await send(CC_ON)
    assert.deepEqual(savedMappings(), {}, 'a reconnect does not resume Learn')
  } finally { await close() }
})

test('Clear unsets one action and leaves the rest', async () => {
  const { close } = await open({ mappings: { nextSong: cc(64), prevSong: note(60) } })
  try {
    clear('nextSong').focus()
    await click(clear('nextSong'))
    assert.equal(mappingText('nextSong'), 'Not set')
    assert.equal(clear('nextSong'), null)
    assert.equal(mappingText('prevSong'), 'Note 60 (C4) · Ch 1')
    assert.deepEqual(savedMappings(), { prevSong: note(60) })
    assert.equal(message('nextSong'), '')
    assert.equal(document.activeElement, learn('nextSong'), 'focus moves to Learn when Clear goes away')
    assert.equal(JSON.parse(localStorage.getItem(h.KEY)).enabled, true, 'the switch is untouched')
  } finally { await close() }
})

test('Reset asks "Clear all MIDI mappings?" first; Cancel keeps everything, Reset clears and says so', async () => {
  const mappings = { nextSong: cc(64), prevSong: note(60), transposeDown: pc(5) }
  const { close } = await open({ mappings })
  try {
    const footer = () => panel().querySelector('[data-app-modal="footer"]')
    await click(panel().querySelector('[data-testid="midi-reset"]'))
    const confirm = panel().querySelector('[data-testid="midi-reset-confirm"]')
    assert.equal(confirm.getAttribute('role'), 'group')
    assert.equal(confirm.textContent, 'Clear all MIDI mappings?ResetCancel')
    assert.deepEqual(footerButtons(), ['Reset', 'Cancel', 'Close'])
    assert.equal(document.activeElement, panel().querySelector('[data-testid="midi-reset-no"]'), 'focus lands on Cancel, the safe answer')
    assert.deepEqual(savedMappings(), mappings, 'nothing is cleared before the answer')

    await click(panel().querySelector('[data-testid="midi-reset-no"]'))
    assert.deepEqual(footerButtons(), ['Reset', 'Close'])
    assert.deepEqual(savedMappings(), mappings)
    assert.equal(resetStatus(), '')
    assert.equal(document.activeElement, panel().querySelector('[data-testid="midi-reset"]'))

    await click(panel().querySelector('[data-testid="midi-reset"]'))
    await click(panel().querySelector('[data-testid="midi-reset-yes"]'))
    assert.equal(resetStatus(), 'Mappings cleared.')
    assert.deepEqual(savedMappings(), {})
    for (const id of IDS) { assert.equal(mappingText(id), 'Not set'); assert.equal(clear(id), null) }
    assert.deepEqual(footerButtons(), ['Reset', 'Close'])
    assert.equal(document.activeElement, panel().querySelector('[data-testid="midi-reset"]'))
    const stored = JSON.parse(localStorage.getItem(h.KEY))
    assert.deepEqual([stored.enabled, stored.device, stored.channel], [true, 'all', 'all'], 'Reset clears mappings only')
    assert.equal(midi.getMidiSnapshot().state, 'connected')
    assert.ok(footer().contains(panel().querySelector('[data-testid="midi-reset-status"]')))
  } finally { await close() }
})

test('Reset and Learn do not overlap: starting one ends the other', async () => {
  const { send, close } = await open({ mappings: { nextSong: cc(1) } })
  try {
    await click(learn('prevSong'))
    await click(panel().querySelector('[data-testid="midi-reset"]'))
    assert.equal(message('prevSong'), '', 'Reset pressed: Learn ends')
    await send(CC_ON)
    assert.deepEqual(savedMappings(), { nextSong: cc(1) })
    await click(learn('prevSong'))
    assert.equal(panel().querySelector('[data-testid="midi-reset-confirm"]'), null, 'Learn pressed: the Reset question goes away')
    assert.deepEqual(savedMappings(), { nextSong: cc(1) })
  } finally { await close() }
})

test('storage failure: "Could not save on this device." and the screen keeps showing what is really saved', async () => {
  const { send, tick, close } = await open({ mappings: { nextSong: cc(1) } })
  const proto = Object.getPrototypeOf(localStorage)
  const setItem = proto.setItem
  proto.setItem = () => { throw domError('QuotaExceededError') }
  try {
    await click(learn('prevSong'))
    await send(CC_ON)
    assert.equal(message('prevSong'), 'Could not save on this device.')
    assert.equal(mappingText('prevSong'), 'Not set')

    await click(clear('nextSong'))
    assert.equal(message('nextSong'), 'Could not save on this device.')
    assert.equal(mappingText('nextSong'), 'CC 1 · Ch 1')
    assert.ok(clear('nextSong'))

    await click(panel().querySelector('[data-testid="midi-reset"]'))
    await click(panel().querySelector('[data-testid="midi-reset-yes"]'))
    assert.equal(resetStatus(), 'Could not save on this device.')
    assert.equal(message('nextSong'), '', 'one result at a time')
    assert.deepEqual(savedMappings(), { nextSong: cc(1) })

    // A conflict that cannot be saved on Replace says so too.
    await send(CC_OFF); tick(200)
    await click(learn('prevSong'))
    await send([0xb0, 1, 127])
    await click(replace('prevSong'))
    assert.equal(message('prevSong'), 'Could not save on this device.')
    assert.deepEqual(savedMappings(), { nextSong: cc(1) })
  } finally { proto.setItem = setItem; await close() }
})

test('a change saved elsewhere (another tab) shows up in the open dialog', async () => {
  const { close } = await open()
  try {
    await run(() => settings.writeMidiSettings({ ...settings.readMidiSettings(), mappings: { toggleAutoScroll: pc(9, 2) } }))
    assert.equal(mappingText('toggleAutoScroll'), 'Program 9 · Ch 2')
    assert.ok(clear('toggleAutoScroll'))
  } finally { await close() }
})

test('a learned pedal moves Stage once the dialog is closed, and stops when MIDI is switched off', async () => {
  const fired = []
  const remove = registerStageCommandRunner(command => { fired.push(command); return true })
  const { send, tick, close } = await open()
  try {
    await click(learn('nextSection'))
    await send(CC_ON)
    assert.deepEqual(fired, [], 'the press that was learned is not also played')
    await key('Escape')
    await send(CC_ON)
    assert.deepEqual(fired, [], 'still held down from Learn')
    await send(CC_OFF); tick(200)
    await send(CC_ON)
    assert.deepEqual(fired, ['nextSection'])
    await send(CC_OFF); tick(200)

    await h.openPopover()
    await click(q('[data-testid="settings-midi"]'))
    assert.equal(midi.getMidiSnapshot().state, 'off')
    await send(CC_ON)
    assert.deepEqual(fired, ['nextSection'], 'off: the pedal does nothing')
    assert.deepEqual(savedMappings(), { nextSection: cc(64) }, 'the mapping is kept for next time')
  } finally { remove(); await close() }
})

test('access: results are polite live regions, targets are 44px, theme tokens only, no motion', async () => {
  const { send, close } = await open({ mappings: { nextSong: cc(64) } })
  try {
    await click(learn('prevSong'))
    await send(CC_ON) // conflict: Replace and Cancel are on screen
    await click(panel().querySelector('[data-testid="midi-reset"]'))
    await click(learn('prevSong'))
    await send(CC_OFF)
    const live = [...panel().querySelectorAll('[aria-live]')]
    assert.deepEqual(live.map(el => el.getAttribute('data-testid')), ['midi-status', ...IDS.map(id => `midi-learn-status-${id}`), 'midi-reset-status'])
    for (const region of live) {
      assert.equal(region.getAttribute('aria-live'), 'polite')
      assert.equal(region.getAttribute('role'), 'status')
    }
    assert.equal(panel().querySelector('[aria-live="assertive"], [role="alert"]'), null)

    await send(CC_ON)
    await click(panel().querySelector('[data-testid="midi-reset"]'))
    // Reset pressed ended the Replace question; show both a question and a mapped row at once.
    const body = panel().querySelector('[data-app-modal="body"]'), footer = panel().querySelector('[data-app-modal="footer"]')
    const midiButtons = [...body.querySelectorAll('button'), ...footer.querySelectorAll('button')].filter(button => button.getAttribute('data-testid') !== 'midi-panel-close')
    assert.ok(midiButtons.length >= 12)
    for (const button of midiButtons) {
      for (const cls of ['min-h-11', 'min-w-11']) assert.ok(button.classList.contains(cls), `${button.getAttribute('data-testid')} ${cls}`)
      assert.equal(button.getAttribute('type'), 'button')
    }
    for (const area of [body, footer]) {
      assert.doesNotMatch(area.innerHTML, /animate-|pulse|style=/, 'plain text, no pulsing, no inline colour')
      const colours = [...area.querySelectorAll('*')].flatMap(el => [...el.classList]).map(cls => cls.replace(/^(?:[a-z-]+:)+/, ''))
        .filter(cls => /^(?:bg|text|border|divide|outline)-/.test(cls) && !/^(?:text-(?:sm|xs|\[\d+px\]|left)|border|divide-y|outline-2)$/.test(cls))
      for (const cls of colours) assert.match(cls, /^(?:bg|text|border|divide|outline)-app-[a-z-]+(?:\/\d+)?$/, cls)
    }
  } finally { await close() }
})
