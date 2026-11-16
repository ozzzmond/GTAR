// #536 Slice 3: the MIDI row in Advanced Tools. Row order, default OFF, every row state and its
// pill, the N/A row without switch or button, and an engine that cannot load. Real Header, fake
// MIDIAccess, no real device.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/midiHeaderHarness.cjs')
const { q, click, run, midi, fakeInput, fakeAccess, domError } = h

const row = () => q('[data-testid="midi-row"]')
const launcher = () => q('[data-testid="midi-expand"]')
const toggle = () => q('[data-testid="settings-midi"]')
const pill = () => row().querySelector('[data-testid="midi-pill"]')
const tone = el => ['amber', 'rose', 'emerald'].find(colour => el.className.includes(`text-${colour}-400`)) ?? (el.className.includes('text-app-muted') ? 'grey' : 'none')

// Must run first: nothing in this process has loaded the engine yet.
test('default OFF: switch off, no pill, and the menu and dialog load no engine and ask nothing', async () => {
  const nav = h.reset({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) })
  const stop = midi.startMidi()
  const header = await h.mountHeader()
  try {
    await h.openPopover()
    assert.equal(toggle().getAttribute('role'), 'switch')
    assert.equal(toggle().getAttribute('aria-checked'), 'false', 'default OFF')
    assert.equal(toggle().getAttribute('aria-label'), 'MIDI', 'the switch is named MIDI')
    assert.equal(pill(), null, 'Off has no pill')
    assert.deepEqual(h.visibleText(launcher()), ['MIDI'])
    assert.equal(launcher().getAttribute('aria-haspopup'), 'dialog', 'the row button announces a dialog')
    assert.equal(launcher().querySelector('.sr-only').textContent, 'Pedal or controller for Stage')

    const panel = await h.openMidiDialog()
    assert.ok(panel, 'the row opens the dialog while MIDI is off')
    await click(panel.querySelector('[data-testid="midi-panel-close"]'))
    assert.equal(h.engineLoaded(), false, 'no engine code loaded with MIDI off')
    assert.deepEqual([nav.requests.length, nav.queries.length, h.listenerCount(nav.access), nav.access.onstatechange], [0, 0, 0, null])
    assert.equal(localStorage.getItem(h.KEY), null)
  } finally { await header.unmount(); stop() }
})

// Must run second: the engine is still not loaded, so the switch has to import it.
test('engine load failure: Error pill, and the rest of Advanced Tools works as before', async () => {
  const nav = h.reset({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) })
  const restore = h.breakEngineLoad()
  const header = await h.mountHeader()
  try {
    await h.openPopover()
    await click(toggle())
    assert.equal(pill().textContent, 'Error')
    assert.equal(tone(pill()), 'rose')
    assert.equal(toggle().getAttribute('aria-checked'), 'true')
    assert.equal(nav.requests.length, 0)

    const online = q('[data-testid="settings-online-sources"]')
    await click(online)
    assert.equal(q('[data-testid="settings-online-sources"]').getAttribute('aria-checked'), 'true', 'Online Song Sources still toggles')
    const metronome = q('[data-testid="settings-stage-tool-metronome"]')
    await click(metronome)
    assert.equal(q('[data-testid="settings-stage-tool-metronome"]').getAttribute('aria-checked'), 'true', 'Stage tools still toggle')
    assert.ok(q('[data-testid="extension-propresenter-follower"]'), 'extension rows still render')

    const panel = await h.openMidiDialog()
    assert.equal(panel.querySelector('[data-testid="midi-status"]').textContent, 'MIDI could not start. Turn it off and on again.')
    await click(panel.querySelector('[data-testid="midi-panel-close"]'))

    // Off and on again, with the engine reachable, recovers.
    await h.openPopover()
    await click(toggle())
    assert.equal(pill(), null)
    restore()
    await click(toggle())
    assert.equal(pill().textContent, 'Ready')
  } finally { restore(); await header.unmount() }
})

test('row order: MIDI comes after the Stage tools (Metronome, Tuner) and before ProPresenter', async () => {
  h.reset()
  const header = await h.mountHeader()
  try {
    const menu = await h.openPopover()
    const expected = ['online-sources-row', 'stage-tool-row-metronome', 'stage-tool-row-tuner', 'midi-row', 'extension-propresenter-follower', 'extension-band-sync']
    const rows = [...menu.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')).filter(id => expected.includes(id))
    assert.deepEqual(rows, expected)
    assert.equal(menu.querySelectorAll('[data-testid="midi-row"]').length, 1, 'one MIDI row')
  } finally { await header.unmount() }
})

test('every ON state: the switch is on and the pill says what the switch cannot', async () => {
  const cases = [
    ['starting', { request: () => new Promise(() => {}) }, 'Starting', 'amber'],
    ['blocked', { request: () => Promise.reject(domError('NotAllowedError')) }, 'Blocked', 'rose'],
    ['no-device', {}, 'No device', 'grey'],
    ['connected', { access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) }, 'Ready', 'emerald'],
    ['error', { request: () => Promise.reject(domError('NotSupportedError')) }, 'Error', 'rose'],
  ]
  for (const [state, navOptions, label, colour] of cases) {
    const nav = h.reset(navOptions)
    const header = await h.mountHeader()
    try {
      await h.openPopover()
      await click(toggle())
      assert.equal(midi.getMidiSnapshot().state, state)
      assert.equal(toggle().getAttribute('aria-checked'), 'true', `${state}: switch on`)
      assert.equal(pill().textContent, label, `${state}: pill text`)
      assert.equal(tone(pill()), colour, `${state}: pill colour`)
      assert.deepEqual(h.visibleText(launcher()), ['MIDI', label], 'name and pill, nothing else')
      assert.ok(h.popover(), 'the switch leaves the menu open')
      assert.equal(q('[data-testid="midi-panel"]'), null, 'the switch does not open the dialog')
      assert.deepEqual(nav.requests, [[]], 'asked once, without SysEx')

      await click(toggle())
      assert.equal(toggle().getAttribute('aria-checked'), 'false')
      assert.equal(pill(), null, 'switched off: no pill')
      assert.equal(h.listenerCount(nav.access), 0)
    } finally { await header.unmount() }
  }
})

test('Allow: MIDI left ON without a grant shows Allow after a reload and does not prompt', async () => {
  const nav = h.reset({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]), permission: 'prompt' })
  h.leftOn()
  const stop = midi.startMidi()
  const header = await h.mountHeader()
  try {
    await h.openPopover()
    assert.equal(pill().textContent, 'Allow')
    assert.equal(tone(pill()), 'amber')
    assert.equal(toggle().getAttribute('aria-checked'), 'true')
    assert.equal(nav.requests.length, 0)
  } finally { await header.unmount(); stop() }
})

test('reload with MIDI left ON and access granted: Ready without a new request for permission', async () => {
  const nav = h.reset({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]), permission: 'granted' })
  h.leftOn()
  const stop = midi.startMidi()
  const header = await h.mountHeader()
  try {
    await h.openPopover()
    assert.equal(pill().textContent, 'Ready')
    assert.deepEqual(nav.queries, [{ name: 'midi' }])
    assert.equal(nav.requests.length, 1)
  } finally { await header.unmount(); stop() }
})

test('hot-plug changes the pill while the menu is open', async () => {
  const nav = h.reset()
  const header = await h.mountHeader()
  try {
    await h.openPopover()
    await click(toggle())
    assert.equal(pill().textContent, 'No device')
    const pedal = fakeInput('p1', 'FS-1-WL')
    await run(() => nav.access.plug(pedal))
    assert.equal(pill().textContent, 'Ready')
    await run(() => nav.access.unplug(pedal))
    assert.equal(pill().textContent, 'No device')
    await run(() => nav.access.plug(pedal))
    assert.equal(pill().textContent, 'Ready')
    assert.equal(h.listenerCount(nav.access), 1)
  } finally { await header.unmount() }
})

test('N/A row: name, one summary line and an N/A pill; no switch, no button, nothing asks for permission', async () => {
  const cases = [
    ['iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }],
    ['iPad', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }],
    ['Firefox Android', { userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0', platform: 'Linux armv81', maxTouchPoints: 5 }],
    ['Firefox desktop', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', platform: 'Win32' }],
    ['no Web MIDI', { requestMIDIAccess: undefined }],
  ]
  for (const [label, navOptions] of cases) {
    h.reset()
    h.leftOn()
    const nav = h.useNavigator(navOptions)
    const stop = midi.startMidi()
    const header = await h.mountHeader()
    try {
      await h.openPopover()
      assert.equal(row().querySelectorAll('button, input, [role="switch"], a, [tabindex]').length, 0, `${label}: no switch and no button`)
      assert.equal(launcher(), null)
      assert.equal(toggle(), null)
      assert.deepEqual(h.visibleText(row()), ['MIDI', 'Pedal or controller for Stage', 'N/A'], label)
      const badge = row().querySelector('[data-testid="midi-unavailable"]')
      assert.equal(badge.querySelector('.sr-only').textContent, 'Not available on this device/browser', 'screen readers get the full reason')
      assert.equal(badge.querySelector('[aria-hidden="true"]').textContent, 'N/A')
      assert.equal(tone(badge), 'rose')
      assert.deepEqual([nav.requests.length, nav.queries.length], [0, 0], `${label}: nothing asks for permission`)
      assert.equal(q('[data-testid="midi-panel"]'), null)
    } finally { await header.unmount(); stop() }
  }
})

test('row controls: 44px targets, the launcher opens the dialog and closes the menu, reduced motion is respected', async () => {
  h.reset({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) })
  const header = await h.mountHeader()
  try {
    await h.openPopover()
    for (const cls of ['min-w-[44px]', 'min-h-[44px]']) assert.ok(toggle().classList.contains(cls), `switch ${cls}`)
    assert.ok(launcher().classList.contains('min-h-11'), 'launcher is 44px tall')
    const track = toggle().firstElementChild, thumb = track.firstElementChild
    for (const part of [track, thumb]) assert.ok(part.classList.contains('motion-reduce:transition-none'))
    assert.doesNotMatch(row().innerHTML, /animate-/, 'no animation in the row')

    await click(toggle())
    await click(launcher())
    assert.equal(h.popover(), null, 'the menu closes')
    assert.ok(q('[data-testid="midi-panel"]'), 'the dialog opens')
    assert.equal(h.wrench().getAttribute('aria-expanded'), 'false')
  } finally { await header.unmount() }
})
