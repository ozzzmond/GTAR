// #536 Slice 5: the device choice in the Connection section and the Advanced section of the MIDI
// dialog (channel filter and input monitor). Choice saved by id, fallback by name, a missing
// device shows Waiting and Use all devices, Advanced collapsed on every open, the monitor keeps
// 5 lines in memory only, and monitoring never changes what fires. Real Header, fake MIDIAccess.
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/midiHeaderHarness.cjs')
const { q, click, key, run, midi, fakeInput, fakeAccess, domError } = h
const settings = require('../src/midi/settings.ts')
const { registerStageCommandRunner } = require('../src/utils/stageCommands.ts')

// The press limits read performance.now(); a fake clock steps past the 500 ms settle time.
const clock = { at: 100_000 }
performance.now = () => clock.at
const tick = ms => { clock.at += ms }

const cc = (number, channel = 1) => ({ type: 'cc', channel, number })
const ccOn = (number = 64, channel = 1, value = 127) => [0xb0 + channel - 1, number, value]
const ccOff = (number = 64, channel = 1) => [0xb0 + channel - 1, number, 0]
const noteOn = (number = 60, channel = 1) => [0x90 + channel - 1, number, 100]
const PEDAL = { id: 'p1', name: 'FS-1-WL', manufacturer: 'Fake' }, KEYS = { id: 'p2', name: 'Keystation', manufacturer: 'Fake' }
const CAPTION = 'Shows the last 5 inputs. Nothing is saved.'

const panel = () => q('[data-testid="midi-panel"]')
const part = name => panel().querySelector(`[data-testid="midi-${name}"]`)
const status = () => part('status').textContent
const action = () => part('status-action')
const pill = () => panel().querySelector('[data-app-modal="header"] [data-testid="midi-pill"]').textContent
const options = select => [...select.options].map(option => option.textContent)
const toggle = () => part('advanced-toggle')
const lines = () => [...part('monitor').children].map(line => line.textContent)
const saved = () => JSON.parse(localStorage.getItem(h.KEY))
/** Picks an option the way a player does: the value changes, then a change event. */
const choose = (select, value) => run(() => { select.value = value; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
const send = (port, bytes) => run(() => port.send(bytes))

/** Mounts the Header with MIDI on and the given ports and saved settings, and opens the dialog. */
async function open({ ports = [fakeInput('p1', 'FS-1-WL'), fakeInput('p2', 'Keystation')], stored = {}, on = true } = {}) {
  const nav = h.reset({ access: fakeAccess(ports) })
  localStorage.setItem(h.KEY, JSON.stringify({ version: 1, enabled: false, device: 'all', channel: 'all', mappings: {}, ...stored }))
  const header = await h.mountHeader()
  if (on) { await h.openPopover(); await click(q('[data-testid="settings-midi"]')) }
  tick(500)
  await h.openMidiDialog()
  return { nav, access: nav.access, ports, close: () => header.unmount() }
}
const reopen = async () => { await click(part('panel-close')); await h.openMidiDialog() }

test('Listen to: default All devices, the connected inputs by name, and a choice saved by id with name and manufacturer', async () => {
  const { close } = await open()
  try {
    const select = part('device')
    assert.equal(select.closest('label').textContent.startsWith('Listen to'), true, 'the select is named by its label')
    assert.equal(select.closest('section').querySelector('h3').textContent, 'Connection')
    assert.deepEqual(options(select), ['All devices', 'FS-1-WL', 'Keystation'])
    assert.equal(select.value, 'all')
    assert.equal(status(), 'Connected: 2 devices')
    assert.equal(saved().device, 'all')

    await choose(select, 'p2')
    assert.deepEqual(saved().device, KEYS)
    assert.equal(part('device').value, 'p2')
    assert.equal(status(), 'Connected: Keystation')
    assert.equal(action(), null)
    assert.equal(pill(), 'Ready')

    await choose(part('device'), 'all')
    assert.equal(saved().device, 'all')
    assert.equal(status(), 'Connected: 2 devices')
  } finally { await close() }
})

test('device names are plain text, cut to 128 characters; a nameless device is "MIDI device"', async () => {
  const { close } = await open({ ports: [fakeInput('p1', '<img src=x onerror=alert(1)>'), fakeInput('p2', 'n'.repeat(300)), fakeInput('p3', '')] })
  try {
    assert.deepEqual(options(part('device')), ['All devices', '<img src=x onerror=alert(1)>', 'n'.repeat(128), 'MIDI device'])
    assert.equal(panel().querySelector('img'), null, 'never HTML')
    await choose(part('device'), 'p2')
    assert.deepEqual(saved().device, { id: 'p2', name: 'n'.repeat(128), manufacturer: 'Fake' })
    assert.equal(status(), `Connected: ${'n'.repeat(128)}`)
  } finally { await close() }
})

test('fallback: the saved id changed, the device is found by name and manufacturer and shown as chosen', async () => {
  const stored = { device: { id: 'id-from-last-week', name: 'Keystation', manufacturer: 'Fake' } }
  const { close } = await open({ stored })
  try {
    assert.equal(status(), 'Connected: Keystation')
    assert.equal(part('device').value, 'p2')
    assert.deepEqual(options(part('device')), ['All devices', 'FS-1-WL', 'Keystation'], 'no "not connected" entry')
    assert.deepEqual(saved().device, stored.device, 'opening the dialog rewrites nothing')
  } finally { await close() }
})

test('chosen device missing: Waiting for <name>, Use all devices, and no silent switch', async () => {
  const fired = []
  const remove = registerStageCommandRunner(command => { fired.push(command); return true })
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { access, close } = await open({ ports: [pedal], stored: { device: KEYS, mappings: { nextSong: cc(64) } } })
  try {
    assert.equal(midi.getMidiSnapshot().state, 'no-device')
    assert.equal(status(), 'Waiting for Keystation.')
    assert.equal(action().textContent, 'Use all devices')
    assert.equal(pill(), 'No device')
    assert.deepEqual(options(part('device')), ['All devices', 'FS-1-WL', 'Keystation (not connected)'])
    assert.equal(part('device').selectedOptions[0].textContent, 'Keystation (not connected)')
    await send(pedal, ccOn())
    assert.deepEqual(fired, [], 'the connected pedal is not used in its place')
    assert.deepEqual(saved().device, KEYS)
    assert.ok([...panel().querySelectorAll('[data-testid^="midi-learn-"]:not([data-testid^="midi-learn-status-"])')].every(button => button.disabled), 'Learn is disabled while waiting')

    // The chosen device arrives: Connected, without a tap.
    const keys = fakeInput('p2', 'Keystation')
    await run(() => access.plug(keys))
    assert.equal(status(), 'Connected: Keystation')
    assert.equal(action(), null)
    assert.equal(part('device').value, 'p2')
    await run(() => access.unplug(keys))
    assert.equal(status(), 'Waiting for Keystation.')

    // Use all devices is the player's own switch.
    await click(action())
    assert.equal(saved().device, 'all')
    assert.equal(status(), 'Connected: FS-1-WL')
    assert.equal(part('device').value, 'all')
    assert.deepEqual(options(part('device')), ['All devices', 'FS-1-WL'])
    tick(500)
    await send(pedal, ccOff()); await send(pedal, ccOn())
    assert.deepEqual(fired, ['nextSong'])
  } finally { await close(); remove() }
})

test('no device at all, with All devices: the usual No device text and Check again', async () => {
  const { close } = await open({ ports: [] })
  try {
    assert.equal(status(), 'No MIDI device found. Plug in or pair your controller.')
    assert.equal(action().textContent, 'Check again')
    assert.deepEqual(options(part('device')), ['All devices'])
  } finally { await close() }
})

test('two devices connected and one chosen: only the chosen one fires', async () => {
  const fired = []
  const remove = registerStageCommandRunner(command => { fired.push(command); return true })
  const { ports: [pedal, keys], close } = await open({ stored: { mappings: { nextSong: cc(64) } } })
  try {
    await choose(part('device'), 'p1')
    tick(500)
    await send(keys, ccOn()); await send(keys, ccOff())
    assert.deepEqual(fired, [])
    await send(pedal, ccOn())
    assert.deepEqual(fired, ['nextSong'])
  } finally { await close(); remove() }
})

test('Advanced: collapsed on every open, aria-expanded on its button, holding the Channel select and the monitor', async () => {
  const { close } = await open()
  try {
    assert.equal(toggle().tagName, 'BUTTON')
    assert.equal(toggle().textContent, 'Advanced')
    assert.equal(toggle().closest('h3').textContent, 'Advanced')
    assert.equal(toggle().getAttribute('aria-expanded'), 'false')
    assert.deepEqual([part('advanced'), part('channel'), part('monitor')], [null, null, null])

    await click(toggle())
    assert.equal(toggle().getAttribute('aria-expanded'), 'true')
    assert.equal(toggle().getAttribute('aria-controls'), part('advanced').id)
    assert.deepEqual(options(part('channel')), ['All channels', ...Array.from({ length: 16 }, (_, index) => String(index + 1))])
    assert.equal(part('channel').value, 'all')
    assert.equal(part('channel').closest('label').textContent.startsWith('Channel'), true)
    assert.match(part('advanced').textContent, /Input monitor/)
    assert.equal(part('monitor-caption').textContent, CAPTION)
    assert.deepEqual(lines(), [])

    await click(toggle())
    assert.equal(toggle().getAttribute('aria-expanded'), 'false')
    assert.equal(part('advanced'), null)

    // Left open, then the dialog is closed every way it can be: collapsed again each time.
    for (const leave of [() => click(panel().querySelector('[data-testid="midi-panel-close"]')), () => key('Escape'), () => click(q('[data-testid="midi-modal-backdrop"]'))]) {
      await click(toggle())
      assert.equal(toggle().getAttribute('aria-expanded'), 'true')
      await leave()
      assert.equal(panel(), null)
      await h.openMidiDialog()
      assert.equal(toggle().getAttribute('aria-expanded'), 'false')
      assert.equal(part('advanced'), null)
    }
  } finally { await close() }
})

test('Channel: saved in settings.channel, applied to Learn at once, and followed from another tab', async () => {
  const { ports: [pedal], close } = await open()
  try {
    await click(toggle())
    await choose(part('channel'), '2')
    assert.equal(saved().channel, 2)
    assert.equal(part('channel').value, '2')

    const learn = () => part('learn-nextSong'), message = () => part('learn-status-nextSong').textContent
    await click(learn())
    await send(pedal, ccOn(64, 1)); await send(pedal, noteOn(60, 3))
    assert.equal(message(), 'Press a pedal or button…', 'another channel is not learned')
    assert.deepEqual(lines(), [], 'and not shown')
    await send(pedal, ccOn(64, 2))
    assert.equal(message(), 'Next song set to CC 64 · Ch 2.')
    assert.deepEqual(lines(), ['CC 64 · value 127 · Ch 2 · FS-1-WL'])
    assert.deepEqual(saved().mappings, { nextSong: cc(64, 2) })

    await run(() => {
      localStorage.setItem(h.KEY, JSON.stringify({ ...saved(), channel: 16, device: KEYS }))
      window.dispatchEvent(Object.assign(new window.Event('storage'), { key: h.KEY }))
    })
    assert.equal(part('channel').value, '16')
    assert.equal(part('device').value, 'p2')
    assert.equal(status(), 'Connected: Keystation')

    await choose(part('channel'), 'all')
    assert.equal(saved().channel, 'all')
    assert.deepEqual(saved().device, KEYS, 'one choice is saved without touching the others')
  } finally { await close() }
})

test('monitor: the last 5 inputs, newest first, one plain-text line each, and nothing stored', async () => {
  const { ports: [pedal, keys], close } = await open({ ports: [fakeInput('p1', 'FS-1-WL'), fakeInput('p2', '<i>Keys</i>')] })
  try {
    await click(toggle())
    const before = { ...localStorage }
    await send(pedal, ccOn(64, 1, 127))
    assert.deepEqual(lines(), ['CC 64 · value 127 · Ch 1 · FS-1-WL'])
    await send(keys, noteOn(60))
    assert.deepEqual(lines(), ['Note 60 (C4) · Ch 1 · <i>Keys</i>', 'CC 64 · value 127 · Ch 1 · FS-1-WL'])
    assert.equal(part('monitor').querySelector('i'), null, 'device names are text, never HTML')
    await send(pedal, [0xc0, 5])
    assert.equal(lines()[0], 'Program 5 · Ch 1 · FS-1-WL')

    // Clock, active sensing, releases and a Control Change below 64 are not shown.
    for (const bytes of [[0xf8], [0xfe], ccOff(), [0x80, 60, 0], ccOn(64, 1, 10), ccOn(121)]) await send(pedal, bytes)
    assert.equal(lines().length, 3)

    for (let number = 1; number <= 7; number++) await send(pedal, noteOn(number, 4))
    assert.deepEqual(lines(), [7, 6, 5, 4, 3].map(number => `Note ${number} (${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G'][number]}-1) · Ch 4 · FS-1-WL`))
    assert.equal(part('monitor').children.length, 5)
    assert.ok([...part('monitor').children].every(line => line.tagName === 'LI' && line.children.length === 0), 'one text node per line')

    assert.deepEqual({ ...localStorage }, before, 'localStorage is unchanged by input and by the monitor')
    assert.deepEqual(Object.keys(saved()).sort(), ['channel', 'device', 'enabled', 'mappings', 'version'])
    assert.equal(window.sessionStorage.length, 0)
  } finally { await close() }
})

test('monitor is not a live region and has no animation; both selects and the Advanced button are 44px on app tokens', async () => {
  const { ports: [pedal], close } = await open()
  try {
    await click(toggle())
    await send(pedal, ccOn())
    const advanced = part('advanced')
    assert.equal(advanced.querySelectorAll('[aria-live], [role="status"], [role="log"], [role="alert"]').length, 0, 'the monitor would talk over the player')
    assert.equal(part('monitor').closest('[aria-live], [role="status"], [role="log"], [role="alert"]'), null)
    for (const region of panel().querySelectorAll('[aria-live]')) assert.equal(region.getAttribute('aria-live'), 'polite')

    for (const control of [part('device'), part('channel'), toggle()]) {
      for (const cls of ['min-h-11', 'min-w-11']) assert.ok(control.classList.contains(cls), `${control.getAttribute('data-testid')}: ${cls}`)
      assert.ok(control.classList.contains('focus-visible:outline-2'), 'visible keyboard focus')
    }
    const body = panel().querySelector('[data-app-modal="body"]')
    assert.doesNotMatch(body.innerHTML, /animate-|transition|style=/, 'no animation on monitor lines or anything else in the body')
    const colours = [...body.querySelectorAll('*')].flatMap(el => [...el.classList]).filter(cls => /^(?:hover:)?(?:bg|text|border)-/.test(cls) && !/^(?:hover:)?(?:text-(?:sm|xs|\[\d+px\]|left)$|border$)/.test(cls))
    for (const cls of colours) assert.match(cls, /^(?:hover:)?(?:bg|text|border)-app-[a-z-]+(?:\/\d+)?$/, cls)
  } finally { await close() }
})

test('monitor runs only while Advanced is open, and is cleared when Advanced closes, the dialog closes and MIDI turns off', async () => {
  const { ports: [pedal], close } = await open()
  try {
    // Collapsed: input is not collected.
    await send(pedal, noteOn(1))
    await click(toggle())
    assert.deepEqual(lines(), [], 'nothing from before Advanced was opened')

    await send(pedal, noteOn(2))
    assert.equal(lines().length, 1)
    await click(toggle())
    await send(pedal, noteOn(3))
    await click(toggle())
    assert.deepEqual(lines(), [], 'cleared when Advanced closes; nothing collected while closed')

    await send(pedal, noteOn(4))
    assert.equal(lines().length, 1)
    await reopen()
    await send(pedal, noteOn(5))
    await click(toggle())
    assert.deepEqual(lines(), [], 'cleared when the dialog closes; nothing collected while it was closed or collapsed')

    // MIDI OFF from the Advanced Tools switch while the dialog stays open.
    await send(pedal, noteOn(6))
    assert.equal(lines().length, 1)
    await run(() => midi.setMidiEnabled(false))
    assert.equal(status(), 'MIDI is off. Turn it on to use a pedal or controller.')
    assert.deepEqual(lines(), [], 'cleared when MIDI turns off')
    await send(pedal, noteOn(7))
    assert.deepEqual(lines(), [])

    // On again with Advanced still open: the monitor runs again, starting empty.
    await click(action())
    tick(500)
    assert.equal(status(), 'Connected: 2 devices')
    assert.deepEqual(lines(), [])
    await send(pedal, noteOn(8))
    assert.deepEqual(lines(), ['Note 8 (G#-1) · Ch 1 · FS-1-WL'])

  } finally { await close() }
})

test('monitor keeps running across a hot-plug with one line per input', async () => {
  const { access, ports: [pedal, keys], close } = await open()
  try {
    await click(toggle())
    await run(() => { access.unplug(pedal); access.unplug(keys) })
    assert.equal(status(), 'No MIDI device found. Plug in or pair your controller.')
    await run(() => access.plug(pedal))
    tick(500)
    await send(pedal, noteOn(9))
    assert.deepEqual(lines(), ['Note 9 (A-1) · Ch 1 · FS-1-WL'])
  } finally { await close() }
})

test('dispatch is identical with the monitor open or closed', async () => {
  const session = async watching => {
    const fired = []
    const remove = registerStageCommandRunner(command => { fired.push(command); return true })
    const { ports: [pedal, keys], close } = await open({ stored: { mappings: { nextSong: cc(64), prevSong: { type: 'note', channel: 1, number: 60 }, scrollDown: cc(10, 2) } } })
    try {
      if (watching) await click(toggle())
      await send(pedal, ccOn()); await send(pedal, ccOn()); await send(pedal, ccOff()); tick(50); await send(pedal, ccOn()); await send(pedal, ccOff())
      tick(200); await send(keys, noteOn()); tick(10); await send(keys, noteOn())
      tick(200); await send(pedal, ccOn(10, 2)); await send(pedal, ccOn(11)); await send(pedal, [0xf8])
      for (let i = 0; i < 10; i++) { tick(160); await send(pedal, ccOff()); await send(pedal, ccOn()) }
      if (watching) assert.equal(lines().length, 5)
      return fired
    } finally { await close(); remove() }
  }
  const closed = await session(false)
  assert.ok(closed.length > 6 && closed.includes('scrollDown'))
  assert.deepEqual(await session(true), closed)
})

test('Esc order stays: help, then Learn, then the dialog; Advanced never takes Esc', async () => {
  const { close } = await open()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await click(toggle())
    await click(part('learn-nextSong'))
    await click(part('help-button'))
    assert.ok(q('[data-testid="midi-help"]'), 'help is open')
    await key('Escape')
    assert.equal(q('[data-testid="midi-help"]'), null, 'the first Esc closes the help only')
    assert.equal(part('learn-status-nextSong').textContent, 'Press a pedal or button…', 'Learn is still waiting')

    await key('Escape')
    assert.equal(part('learn-status-nextSong').textContent, '', 'Esc cancelled Learn')
    assert.ok(panel(), 'the dialog is still open')
    assert.equal(toggle().getAttribute('aria-expanded'), 'true', 'Advanced stays as it was')

    await key('Escape')
    assert.equal(panel(), null)
  } finally { mock.timers.reset(); await close() }
})

test('storage failure on a device or channel choice: "Could not save on this device." and the selects show what is saved', async () => {
  const { close } = await open()
  const proto = Object.getPrototypeOf(localStorage)
  const setItem = proto.setItem
  try {
    await click(toggle())
    proto.setItem = () => { throw domError('QuotaExceededError') }
    await choose(part('device'), 'p2')
    assert.equal(part('reset-status').textContent, 'Could not save on this device.')
    assert.equal(part('device').value, 'all')
    await choose(part('channel'), '7')
    assert.equal(part('channel').value, 'all')
    assert.equal(status(), 'Connected: 2 devices')
    proto.setItem = setItem
    await choose(part('channel'), '7')
    assert.equal(part('reset-status').textContent, '')
    assert.equal(saved().channel, 7)
  } finally { proto.setItem = setItem; await close() }
})

test('with MIDI off the choices are still shown and can be changed; nothing is listened to', async () => {
  const { nav, close } = await open({ on: false, stored: { device: KEYS, channel: 3 } })
  try {
    assert.equal(status(), 'MIDI is off. Turn it on to use a pedal or controller.')
    assert.equal(action().textContent, 'Turn on')
    assert.deepEqual(options(part('device')), ['All devices', 'Keystation (not connected)'])
    await click(toggle())
    assert.equal(part('channel').value, '3')
    await choose(part('channel'), 'all')
    assert.equal(saved().channel, 'all')
    assert.equal(saved().enabled, false, 'a choice never turns MIDI on')
    assert.equal(nav.requests.length, 0)
    assert.equal(h.listenerCount(nav.access), 0)
  } finally { await close() }
})

test('no Stage indicator, no per-device mappings, no latching option; app files reach MIDI only as before', () => {
  const fs = require('node:fs'), path = require('node:path')
  const src = path.join(__dirname, '..', 'src')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
  const importers = walk(src).filter(file => !file.startsWith(path.join(src, 'midi') + path.sep))
    .filter(file => /from\s+['"][^'"]*\/midi\/[^'"]+['"]|import\(\s*['"][^'"]*\/midi\/[^'"]+['"]/.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(src, file).split(path.sep).join('/')).sort()
  assert.deepEqual(importers, ['App.tsx', 'components/Header.tsx'], 'no new import of web/src/midi from app files')
  assert.deepEqual(fs.readdirSync(path.join(src, 'midi')).sort(),
    ['MidiDialog.tsx', 'MidiHelp.tsx', 'MidiRow.tsx', 'actions.ts', 'engine.ts', 'limits.ts', 'loader.ts', 'mapping.ts', 'message.ts', 'settings.ts'])
  assert.doesNotMatch(fs.readFileSync(path.join(src, 'components/StageView.tsx'), 'utf8'), /midi/i, 'Stage shows nothing about MIDI')
  const dialog = fs.readFileSync(path.join(src, 'midi/MidiDialog.tsx'), 'utf8')
  assert.doesNotMatch(dialog, /latch|every press/i)
  assert.deepEqual(Object.keys(settings.defaultMidiSettings()).sort(), ['channel', 'device', 'enabled', 'mappings', 'version'], 'one mapping set, not one per device')
})
