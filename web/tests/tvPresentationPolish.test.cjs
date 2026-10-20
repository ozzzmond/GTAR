const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

test('CANONICAL_ROUTE: /tv is canonical entry point and /tv/cast2 acts as compatible alias', async () => {
  const { isPresentationLocation } = require('../src/utils/presentationRoute.ts')

  for (const route of ['/tv', '/tv/', '/tv/cast2', '/tv/cast2/']) {
    const url = new URL(route, 'https://dev.gtar-web.pages.dev')
    assert.equal(isPresentationLocation(url), true, `Route ${route} must be recognized as presentation location`)
  }

  assert.equal(isPresentationLocation(new URL('/tvision', 'https://dev.gtar-web.pages.dev')), false)
  assert.equal(isPresentationLocation(new URL('/other', 'https://dev.gtar-web.pages.dev')), false)
})

test('TV_TYPOGRAPHY: independent TV font zoom controls, boundaries, presets, and reset', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/tv' })
  const keys = ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const prior = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))

  const store = new Map()
  const mockStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  }

  for (const [k, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    localStorage: mockStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })

  try {
    const bundled = await build({
      stdin: {
        contents: `export { stageCast2Controller } from './src/utils/stageCast2Controller'; export { TvPresentationOptions } from './src/components/TvPresentationOptions';`,
        resolveDir: path.resolve(__dirname, '..'),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      jsx: 'automatic',
      loader: { '.css': 'empty' },
      define: {
        'import.meta.env.DEV': 'true',
        'import.meta.env.VITE_CAST2_LOCAL_REVIEW': '"true"',
      },
    })

    const compiled = new Module(path.join(__dirname, 'tv-options-memory.cjs'), module)
    compiled.filename = path.join(__dirname, 'tv-options-memory.cjs')
    compiled.paths = module.paths
    compiled._compile(bundled.outputFiles[0].text, compiled.filename)
    const { stageCast2Controller, TvPresentationOptions } = compiled.exports

    stageCast2Controller.resetForTesting()
    assert.equal(stageCast2Controller.getTvFontSize(), 32, 'Default TV font size must be 32px')

    stageCast2Controller.setTvFontSize(10)
    assert.equal(stageCast2Controller.getTvFontSize(), 20, 'TV font size must be clamped at min 20px')

    stageCast2Controller.setTvFontSize(80)
    assert.equal(stageCast2Controller.getTvFontSize(), 56, 'TV font size must be clamped at max 56px')

    stageCast2Controller.setTvFontSize(24)
    assert.equal(stageCast2Controller.getTvFontSize(), 24, 'Preset S (24px) applies')
    assert.equal(mockStorage.getItem('gtar_tv_font_size'), '24', 'Persists to localStorage')

    stageCast2Controller.setTvFontSize(32)
    assert.equal(stageCast2Controller.getTvFontSize(), 32, 'Reset to 32px works')

    const root = createRoot(document.getElementById('root'))
    await act(async () => root.render(React.createElement(TvPresentationOptions)))

    assert.ok(document.body.textContent.includes('TV Zoom'))
    assert.ok(document.body.textContent.includes('32px'))

    const sBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'S')
    const xlBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'XL')
    assert.ok(sBtn, 'S preset button exists')
    assert.ok(xlBtn, 'XL preset button exists')

    await act(async () => xlBtn.click())
    assert.equal(stageCast2Controller.getTvFontSize(), 48, 'XL preset sets 48px')

    const aMinus = [...document.querySelectorAll('button')].find(b => b.textContent === 'A-')
    await act(async () => aMinus.click())
    assert.equal(stageCast2Controller.getTvFontSize(), 46, 'A- steps down by 2px')

    const resetBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('px'))
    await act(async () => resetBtn.click())
    assert.equal(stageCast2Controller.getTvFontSize(), 32, 'Clicking display resets to default 32px')

    await act(async () => root.unmount())
    stageCast2Controller.resetForTesting()
  } finally {
    for (const k of keys) {
      if (prior[k]) Object.defineProperty(globalThis, k, prior[k])
      else delete globalThis[k]
    }
    dom.window.close()
  }
})

test('TV_RECEIVER_UX: section anchor scroll, title pill, and auto-hide behavior', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/tv/cast2' })
  const keys = ['window', 'document', 'history', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', 'setInterval', 'clearInterval', 'WebSocket']
  const prior = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const timers = new Map()
  let nextTimer = 0
  const sockets = []
  const ref = 'f'.repeat(64)
  let receiverState = 'WAITING_FOR_CONTROLLER'

  for (const [k, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    history: dom.window.history,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearInterval: id => timers.delete(id),
    WebSocket: class {
      readyState = 0; send() {} close() {}
      constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
    },
    fetch: async (url) => {
      if (url.endsWith('/create')) {
        return Response.json({
          ref, pin: '999888', receiverCredential: 'c'.repeat(64),
          pairingExpiresAt: Date.now() + 120000, expiresAt: Date.now() + 600000,
        })
      }
      if (url.endsWith('/status')) {
        return Response.json({ sessionId: ref, state: receiverState, requestId: 'd'.repeat(64), inboundSequence: 0 })
      }
      if (url.endsWith('/ticket')) {
        return Response.json({ ticket: 'e'.repeat(64) })
      }
      return Response.json({ state: 'PAIRED' })
    },
  })) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })

  const root = createRoot(document.getElementById('root'))

  try {
    const bundled = await build({
      stdin: {
        contents: `export { StageCast2Panel } from './src/components/StageCast2Panel';`,
        resolveDir: path.resolve(__dirname, '..'),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      jsx: 'automatic',
      loader: { '.css': 'empty' },
      define: {
        'import.meta.env.DEV': 'true',
        'import.meta.env.VITE_CAST2_LOCAL_REVIEW': '"true"',
      },
    })

    const compiled = new Module(path.join(__dirname, 'tv-polish-ui-memory.cjs'), module)
    compiled.filename = path.join(__dirname, 'tv-polish-ui-memory.cjs')
    compiled.paths = module.paths
    compiled._compile(bundled.outputFiles[0].text, compiled.filename)
    const { StageCast2Panel } = compiled.exports

    await act(async () => root.render(React.createElement(StageCast2Panel, { receiver: true })))

    // 1. Alias redirect check: /tv/cast2 redirected to /tv
    assert.equal(dom.window.location.pathname, '/tv', 'Must alias redirect /tv/cast2 to /tv')

    // Create pairing
    await act(async () => [...document.querySelectorAll('button')].find(b => /Create TV/.test(b.textContent)).click())

    // Transition receiver to PAIRED so websocket connects
    receiverState = 'PAIRED'
    await act(async () => {
      for (const t of timers.values()) {
        if (t.delay === 5000) await t.fn()
      }
    })

    assert.ok(sockets.length > 0, 'Receiver WebSocket must be established')

    // 2. Deliver snapshot with song title, section header, and lyrics
    const snapshot = {
      songId: 'song-amazing-grace',
      displayTitle: 'Amazing Grace (My Chains Are Gone)',
      lines: [
        { type: 'SECTION_HEADER', title: 'Verse 1' },
        { type: 'CHORD_PRO', raw: '[G]Amazing [G/B]grace', segments: [{ chord: 'G', text: 'Amazing ' }, { chord: 'G/B', text: 'grace' }] },
        { type: 'SECTION_HEADER', title: 'Verse 2' },
        { type: 'CHORD_PRO', raw: '[C]My chains are [G]gone', segments: [{ chord: 'C', text: 'My chains are ' }, { chord: 'G', text: 'gone' }] },
      ],
      chordsVisible: true,
      transpose: { offset: 0, effectiveKey: 'G' },
      position: { lineIndex: 2 }, // Pointing to Verse 2
      scroll: { top: 0, fraction: 0.5 },
      mode: { columns: 1, notation: 'chords', fontSize: 36 },
    }

    await act(async () => sockets[0].onmessage({
      data: JSON.stringify({
        version: 1,
        type: 'PRESENTATION_SNAPSHOT',
        direction: 'SERVER_TO_RECEIVER',
        sessionId: ref,
        timestamp: Date.now(),
        sequence: 1,
        payload: { snapshot },
      }),
    }))

    // 3. Verify mobile-fullscreen inspired title pill
    const titlePill = document.querySelector('.cast2-tv-title-pill')
    assert.ok(titlePill, 'Title pill must exist')
    const titleText = document.querySelector('.cast2-tv-title-text')
    assert.equal(titleText.textContent, 'Amazing Grace (My Chains Are Gone)')
    assert.ok(document.querySelector('h1.sr-only'), 'Accessible sr-only heading must exist')

    // 4. Verify section lines rendered with data attributes
    const sectionEls = document.querySelectorAll('[data-stage-section="true"]')
    assert.equal(sectionEls.length, 2, 'Two section headers rendered')
    assert.equal(sectionEls[1].getAttribute('data-section-title'), 'Verse 2')

    // 5. Verify section anchor scroll math
    const viewport = document.querySelector('.cast2-lyrics')
    Object.defineProperty(viewport, 'scrollHeight', { value: 1200, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 600, configurable: true })

    // Simulate section header offset
    const verse2El = sectionEls[1]
    verse2El.getBoundingClientRect = () => ({ top: 400, bottom: 430, left: 0, right: 800, width: 800, height: 30 })
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 })

    await act(async () => dom.window.dispatchEvent(new dom.window.Event('resize')))

    // Section anchor targetScrollTop = offsetFromTop - clearance (72) = 400 - 72 = 328
    assert.equal(viewport.scrollTop, 328, 'Section anchor applies top clearance (72px) so section and chords are visible')

    // 6. Test title auto-hide on scroll
    viewport.scrollTop = 100
    await act(async () => viewport.dispatchEvent(new dom.window.Event('scroll')))
    assert.ok(
      document.querySelector('.cast2-tv-title-container').classList.contains('cast2-tv-title-hidden'),
      'Title pill hides when scrolled down past 30px'
    )

    viewport.scrollTop = 10
    await act(async () => viewport.dispatchEvent(new dom.window.Event('scroll')))
    assert.ok(
      document.querySelector('.cast2-tv-title-container').classList.contains('cast2-tv-title-visible'),
      'Title pill reveals when scrolled back to top'
    )

    await act(async () => root.unmount())
  } finally {
    for (const k of keys) {
      if (prior[k]) Object.defineProperty(globalThis, k, prior[k])
      else delete globalThis[k]
    }
    dom.window.close()
  }
})
