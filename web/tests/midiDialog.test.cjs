// #536 Slice 3: the status-only MIDI dialog. Status line and context button per state, the same
// modal pattern as ProPresenter, Esc and focus return, the one "?" help, and nothing from later
// slices (no Actions, Learn, Advanced or mappings). Real Header, fake MIDIAccess, no real device.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/midiHeaderHarness.cjs')
const { q, click, key, run, midi, fakeInput, fakeAccess, domError } = h

const panel = () => q('[data-testid="midi-panel"]')
const status = () => panel().querySelector('[data-testid="midi-status"]')
const action = () => panel().querySelector('[data-testid="midi-status-action"]')
const headerPill = () => panel().querySelector('[data-app-modal="header"] [data-testid="midi-pill"]')
const pedal = () => fakeInput('p1', 'FS-1-WL')

const OFF_TEXT = 'MIDI is off. Turn it on to use a pedal or controller.'
const STATES = [
  // state, navigator, MIDI left on at start?, status line, button, header pill
  ['off', {}, false, OFF_TEXT, 'Turn on', 'Off'],
  ['starting', { request: () => new Promise(() => {}) }, false, 'Looking for MIDI devices…', null, 'Starting'],
  ['allow', { permission: 'prompt' }, true, 'Your browser needs your OK to use MIDI.', 'Allow MIDI', 'Allow'],
  ['blocked', { request: () => Promise.reject(domError('NotAllowedError')) }, false, 'MIDI is blocked for this site. Allow it in your browser\'s site settings, then try again.', 'Try again', 'Blocked'],
  ['no-device', {}, false, 'No MIDI device found. Plug in or pair your controller.', 'Check again', 'No device'],
  ['connected', { access: fakeAccess([pedal()]) }, false, 'Connected: FS-1-WL', null, 'Ready'],
  ['connected', { access: fakeAccess([pedal(), fakeInput('p2', 'Keystation')]) }, false, 'Connected: 2 devices', null, 'Ready'],
  ['error', { request: () => Promise.reject(domError('InvalidStateError')) }, false, 'MIDI could not start. Turn it off and on again.', null, 'Error'],
]

/** Mounts the Header in the wanted state and opens the MIDI dialog. */
async function openIn(state, navOptions, leftOn) {
  const nav = h.reset(navOptions)
  if (leftOn) h.leftOn()
  const stop = leftOn ? midi.startMidi() : () => {}
  const header = await h.mountHeader()
  if (!leftOn && state !== 'off') { await h.openPopover(); await click(q('[data-testid="settings-midi"]')) }
  await h.openMidiDialog()
  return { nav, close: async () => { await header.unmount(); stop() } }
}

test('status line, context button and header pill for every state', async () => {
  for (const [state, navOptions, leftOn, text, button, pillText] of STATES) {
    const { close } = await openIn(state, navOptions, leftOn)
    try {
      assert.equal(midi.getMidiSnapshot().state, state)
      assert.equal(status().textContent, text, state)
      assert.equal(action()?.textContent ?? null, button, `${state}: button`)
      assert.equal(headerPill().textContent, pillText, `${state}: header pill has text`)
      assert.equal(panel().querySelectorAll('[data-testid="midi-status-action"]').length, button ? 1 : 0, 'at most one context button')
    } finally { await close() }
  }
})

test('status-only: one Connection section, no Actions, Learn, Clear, Reset, Advanced, device or channel choice', async () => {
  for (const [state, navOptions, leftOn] of STATES) {
    const { close } = await openIn(state, navOptions, leftOn)
    try {
      assert.deepEqual([...panel().querySelectorAll('h3')].map(heading => heading.textContent), ['Connection'], state)
      assert.equal(panel().querySelectorAll('select, input, textarea, [role="switch"], details, form').length, 0, `${state}: no second switch and no choices`)
      assert.equal(panel().querySelectorAll('[data-app-modal="body"] [aria-expanded]').length, 0, `${state}: nothing in the body expands`)
      assert.doesNotMatch(panel().textContent, /Learn|Clear|Reset|Advanced|Actions|Not set|Next song|Listen to|Channel|monitor/i, state)
      const footer = [...panel().querySelectorAll('[data-app-modal="footer"] button')].map(button => button.textContent.trim())
      assert.deepEqual(footer, ['Close'], `${state}: the footer has Close only`)
      const body = [...panel().querySelectorAll('[data-app-modal="body"] button')].map(button => button.textContent.trim())
      assert.ok(body.length <= 1, `${state}: at most the one context button in the body`)
    } finally { await close() }
  }
})

test('Turn on asks the browser and connects; the dialog follows hot-plug live', async () => {
  const { nav, close } = await openIn('off', { access: fakeAccess([pedal()]) }, false)
  try {
    await click(action())
    assert.deepEqual(nav.requests, [[]], 'asked once from the tap, without SysEx')
    assert.equal(status().textContent, 'Connected: FS-1-WL')
    assert.equal(action(), null)
    assert.equal(JSON.parse(localStorage.getItem(h.KEY)).enabled, true, 'Turn on is the same switch')

    const [port] = nav.access.inputs.values()
    await run(() => nav.access.unplug(port))
    assert.equal(status().textContent, 'No MIDI device found. Plug in or pair your controller.')
    assert.equal(headerPill().textContent, 'No device')
    await run(() => nav.access.plug(port))
    assert.equal(status().textContent, 'Connected: FS-1-WL')
    await run(() => nav.access.plug(fakeInput('p2', 'Keystation')))
    assert.equal(status().textContent, 'Connected: 2 devices')
    assert.equal(h.listenerCount(nav.access), 2)
  } finally { await close() }
})

test('Allow MIDI, Try again and Check again ask the browser again', async () => {
  const allow = await openIn('allow', { access: fakeAccess([pedal()]), permission: 'prompt' }, true)
  try {
    assert.equal(allow.nav.requests.length, 0, 'no prompt before the tap')
    await click(action())
    assert.equal(allow.nav.requests.length, 1)
    assert.equal(status().textContent, 'Connected: FS-1-WL')
  } finally { await allow.close() }

  const blocked = await openIn('blocked', { request: () => Promise.reject(domError('NotAllowedError')) }, false)
  try {
    await click(action())
    assert.equal(action().textContent, 'Try again', 'still blocked')
    blocked.nav.request = undefined
    blocked.nav.access.inputs.set('p1', pedal())
    await click(action())
    assert.equal(status().textContent, 'Connected: FS-1-WL', 'connects once the site setting allows it')
  } finally { await blocked.close() }

  const none = await openIn('no-device', {}, false)
  try {
    none.nav.access.inputs.set('p1', pedal())
    await click(action())
    assert.equal(status().textContent, 'Connected: FS-1-WL', 'Check again finds a device that raised no event')
    assert.equal(h.listenerCount(none.nav.access), 1)
  } finally { await none.close() }
})

test('same modal pattern as ProPresenter: app-level overlay, header, scrolling body, footer Close', async () => {
  const { close } = await openIn('connected', { access: fakeAccess([pedal()]) }, false)
  try {
    const dialog = panel(), backdrop = dialog.parentElement
    assert.equal(backdrop.parentElement, document.body, 'portaled to document.body')
    assert.equal(document.getElementById('root').contains(dialog), false)
    assert.equal(backdrop.getAttribute('data-testid'), 'midi-modal-backdrop')
    for (const cls of ['fixed', 'inset-0', 'z-[100]', 'bg-black/75']) assert.ok(backdrop.classList.contains(cls), `backdrop ${cls}`)
    assert.equal(dialog.getAttribute('role'), 'dialog')
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'MIDI')
    for (const cls of ['w-full', 'max-w-lg', 'max-h-[90dvh]']) assert.ok(dialog.classList.contains(cls), `card ${cls}`)
    const [header, body, footer] = ['header', 'body', 'footer'].map(part => dialog.querySelector(`[data-app-modal="${part}"]`))
    assert.ok(header.querySelector('svg') && header.querySelector('h2') && header.querySelector('button[aria-label="Close"]'), 'header has icon, title and close')
    assert.ok(body.classList.contains('overflow-y-auto'))
    assert.ok([...footer.querySelectorAll('button')].some(button => button.textContent.trim() === 'Close'))
    assert.equal(h.popover(), null, 'the dialog outlives the menu')
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Close', 'focus moves into the dialog')

    // Header order: pill, the one help, close.
    const controls = [...header.querySelectorAll('[data-testid="midi-pill"], button')].map(el => el.getAttribute('data-testid') ?? el.getAttribute('aria-label'))
    assert.deepEqual(controls, ['midi-pill', 'midi-help-button', 'Close'])
  } finally { await close() }
})

test('Esc closes and focus returns to the Advanced Tools button; the footer Close and the backdrop close too', async () => {
  const overlay = []
  h.reset({ access: fakeAccess([pedal()]) })
  const header = await h.mountHeader({ onOverlayChange: open => overlay.push(open) })
  try {
    await h.openMidiDialog()
    assert.equal(overlay.at(-1), true, 'an open MIDI dialog blocks Stage shortcuts like the other dialogs')
    await key('Escape')
    assert.equal(panel(), null, 'Esc closes')
    assert.equal(document.activeElement, h.wrench(), 'focus returns to the opener of the menu')
    assert.equal(overlay.at(-1), false)

    await h.openMidiDialog()
    await click(panel().querySelector('[data-testid="midi-panel-close"]'))
    assert.equal(panel(), null)
    assert.equal(document.activeElement, h.wrench())

    await h.openMidiDialog()
    await click(q('[data-testid="midi-modal-backdrop"]'))
    assert.equal(panel(), null)

    // Closing the dialog leaves MIDI as it was.
    await h.openPopover()
    await click(q('[data-testid="settings-midi"]'))
    await h.openMidiDialog()
    await key('Escape')
    assert.equal(midi.getMidiSnapshot().state, 'connected', 'listening continues after the dialog closes')
  } finally { await header.unmount() }
})

test('keyboard: Tab stays inside the dialog and the context button works from the keyboard', async () => {
  const { close } = await openIn('off', { access: fakeAccess([pedal()]) }, false)
  try {
    const focusable = [...panel().querySelectorAll('button')]
    assert.deepEqual(focusable.map(button => button.getAttribute('data-testid') ?? button.getAttribute('aria-label')), ['midi-help-button', 'Close', 'midi-status-action', 'midi-panel-close'], 'tab order follows the screen')
    focusable.at(-1).focus()
    await key('Tab')
    assert.equal(document.activeElement, focusable[0], 'Tab wraps to the first control')
    await key('Tab', { shiftKey: true })
    assert.equal(document.activeElement, focusable.at(-1), 'Shift+Tab wraps to the last')
    assert.equal(action().tagName, 'BUTTON', 'a real button: Enter and Space work')
    assert.equal(action().getAttribute('type'), 'button')
  } finally { await close() }
})

test('status line is a polite live region; MIDI controls are 44px; only theme tokens and existing pill colours', async () => {
  for (const [state, navOptions, leftOn] of STATES) {
    const { close } = await openIn(state, navOptions, leftOn)
    try {
      assert.equal(status().getAttribute('role'), 'status')
      assert.equal(status().getAttribute('aria-live'), 'polite')
      assert.equal(panel().querySelectorAll('[aria-live]').length, 1, 'one live region')
      if (action()) for (const cls of ['min-h-11', 'min-w-11']) assert.ok(action().classList.contains(cls), `${state}: button ${cls}`)
      assert.ok(panel().querySelector('[data-testid="midi-panel-close"]').classList.contains('min-h-11'))
      const body = panel().querySelector('[data-app-modal="body"]')
      assert.doesNotMatch(body.innerHTML, /animate-|style=/, `${state}: no animation and no inline colour`)
      const colours = [...body.querySelectorAll('*'), headerPill()].flatMap(el => [...el.classList]).filter(cls => /^(?:hover:)?(?:bg|text|border)-/.test(cls) && !/^(?:hover:)?(?:text-(?:sm|xs|\[\d+px\]|left)$|border$)/.test(cls))
      for (const cls of colours) assert.match(cls, /^(?:hover:)?(?:bg|text|border)-(?:app-[a-z-]+|amber-400|rose-(?:400|500)|emerald-(?:400|500))(?:\/\d+)?$/, `${state}: ${cls}`)
    } finally { await close() }
  }
})

test('a device name is shown as text, never as markup', async () => {
  const name = '<img src=x onerror=alert(1)><b>Pedal</b>'
  const { close } = await openIn('connected', { access: fakeAccess([fakeInput('p1', name + 'x'.repeat(300))]) }, false)
  try {
    assert.equal(status().textContent, `Connected: ${(name + 'x'.repeat(300)).slice(0, 128)}`)
    assert.equal(status().children.length, 0, 'no element was created from the name')
    assert.equal(panel().querySelector('img, b'), null)
  } finally { await close() }
})

test('help: one "?" in the header opens the MIDI help; Esc closes the help first, then the dialog', async () => {
  const { close } = await openIn('off', {}, false)
  try {
    assert.equal(panel().querySelectorAll('[data-testid="midi-help-button"]').length, 1)
    assert.equal(panel().querySelectorAll('button[aria-label^="Help"]').length, 1, 'no "?" on each control')
    const button = panel().querySelector('[data-testid="midi-help-button"]')
    assert.equal(button.getAttribute('aria-label'), 'Help for MIDI')
    await click(button)
    const help = q('[data-testid="midi-help"]')
    assert.ok(help)
    assert.match(help.textContent, /does not control Stage yet/, 'the help says what this version does not do')
    assert.match(help.textContent, /not available on iPhone, iPad, Safari or Firefox/)
    assert.doesNotMatch(help.textContent, /Learn|mapping|seamless|powerful|effortless|!/i, 'short plain text')
    await key('Escape')
    assert.equal(q('[data-testid="midi-help"]'), null)
    assert.ok(panel(), 'the dialog stays open')
    await key('Escape')
    assert.equal(panel(), null)
  } finally { await close() }
})

test('opening and closing the dialog again never adds a listener', async () => {
  const { nav, close } = await openIn('connected', { access: fakeAccess([pedal()]) }, false)
  try {
    const [port] = nav.access.inputs.values()
    for (let i = 0; i < 3; i++) { await key('Escape'); await h.openMidiDialog() }
    assert.deepEqual([h.listenerCount(nav.access), port.sets, nav.requests.length], [1, 1, 1])
  } finally { await close() }
})
