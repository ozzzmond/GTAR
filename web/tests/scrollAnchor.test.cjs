const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      filename
    )
}

const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const {
  findBestAnchorElement,
  restoreScrollAnchor,
  ScrollAnchorController,
} = require('../src/utils/scrollAnchor.ts')
const { SongLineRenderer } = require('../src/components/SongLineRenderer.tsx')
const { parseGtarSong } = require('../src/utils/songParser.ts')

// Helper to construct a mock DOM element hierarchy with getBoundingClientRect
function createMockElement(tag, attrs = {}, rect = { top: 0, bottom: 20, height: 20, width: 200 }) {
  const children = []
  const element = {
    tagName: tag.toUpperCase(),
    attributes: { ...attrs },
    scrollTop: 0,
    getAttribute(name) {
      return this.attributes[name] ?? null
    },
    setAttribute(name, val) {
      this.attributes[name] = String(val)
    },
    hasAttribute(name) {
      return name in this.attributes
    },
    getBoundingClientRect() {
      return { ...rect }
    },
    _setRect(newRect) {
      Object.assign(rect, newRect)
    },
    appendChild(child) {
      children.push(child)
      child.parentElement = element
      return child
    },
    querySelector(selector) {
      const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/)
      if (!match) return null
      const [, attr, val] = match
      return this.querySelectorAll(selector)[0] || null
    },
    querySelectorAll(selector) {
      const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/)
      if (!match) return []
      const [, attr, val] = match
      const results = []
      function search(node) {
        if (node.hasAttribute && node.hasAttribute(attr)) {
          if (val === undefined || node.getAttribute(attr) === val) {
            results.push(node)
          }
        }
        for (const c of node.children || []) {
          search(c)
        }
      }
      for (const c of children) {
        search(c)
      }
      return results
    },
    children,
  }
  return element
}

test('SongLineRenderer renders data-song-line, data-section and overflow-anchor on all lines', () => {
  const raw = '[Verse 1]\n[G]Amazing [D/F#]grace, how [Em]sweet the sound\n\n[Chorus]\n[C]Praise God, [D]praise God'
  const parsed = parseGtarSong(raw)

  const html = renderToStaticMarkup(
    React.createElement(SongLineRenderer, {
      lines: parsed.lines,
      fontSizePx: 20,
      lineIndexOffset: 10,
    })
  )

  // Verify lineIndexOffset applied to data-song-line
  assert.match(html, /data-song-line="10"/, 'First line has lineIndexOffset 10')
  assert.match(html, /data-section="Verse 1"/, 'Section header carries data-section="Verse 1"')
  assert.match(html, /data-section="Chorus"/, 'Chorus header carries data-section="Chorus"')
  assert.match(html, /overflow-anchor:none/, 'Lines enforce overflow-anchor:none to prevent browser scroll jump')
})

test('findBestAnchorElement locks to top of page when scrollTop <= 2', () => {
  const container = createMockElement('div', {}, { top: 100, bottom: 600, height: 500, width: 800 })
  container.scrollTop = 0

  const line0 = createMockElement('div', { 'data-song-line': '0' }, { top: 100, bottom: 130, height: 30, width: 800 })
  container.appendChild(line0)

  const anchor = findBestAnchorElement(container)
  assert.ok(anchor, 'Anchor should be detected')
  assert.equal(anchor.isTop, true, 'isTop should be true at top of page')
  assert.equal(anchor.offsetFromViewportTop, 0)
  assert.equal(anchor.selector, '[data-song-line="0"]')
})

test('findBestAnchorElement identifies content line near reading edge', () => {
  const container = createMockElement('div', {}, { top: 100, bottom: 600, height: 500, width: 800 })
  container.scrollTop = 250

  // Line 3 is scrolled past top (above viewport)
  const line3 = createMockElement('div', { 'data-song-line': '3' }, { top: 60, bottom: 90, height: 30, width: 800 })
  // Line 4 intersects the reading edge (container top is 100, line4 top is 115 -> relTop = 15px)
  const line4 = createMockElement('div', { 'data-song-line': '4' }, { top: 115, bottom: 150, height: 35, width: 800 })
  // Line 5 is further down
  const line5 = createMockElement('div', { 'data-song-line': '5' }, { top: 155, bottom: 190, height: 35, width: 800 })

  container.appendChild(line3)
  container.appendChild(line4)
  container.appendChild(line5)

  const anchor = findBestAnchorElement(container)
  assert.ok(anchor)
  assert.equal(anchor.isTop, false)
  assert.equal(anchor.selector, '[data-song-line="4"]', 'Line 4 should be chosen as best anchor near reading edge')
  assert.equal(anchor.offsetFromViewportTop, 15, 'Offset from viewport top should be 15px')
})

test('restoreScrollAnchor compensates for layout drift exactly', () => {
  const container = createMockElement('div', {}, { top: 100, bottom: 600, height: 500, width: 800 })
  container.scrollTop = 250

  // Target element initially at relTop = 15px
  const line4 = createMockElement('div', { 'data-song-line': '4' }, { top: 115, bottom: 150, height: 35, width: 800 })
  container.appendChild(line4)

  const snapshot = {
    songId: 'song-1',
    selector: '[data-song-line="4"]',
    offsetFromViewportTop: 15,
    isTop: false,
    timestamp: Date.now(),
  }

  // Case 1: No change in layout -> 0 drift
  const drift0 = restoreScrollAnchor(container, snapshot)
  assert.equal(drift0, 0, 'No drift when line remains at exact same position')
  assert.equal(container.scrollTop, 250)

  // Case 2: Font size increases, preceding lines expand, pushing line 4 down by 28px (top becomes 143 instead of 115)
  line4._setRect({ top: 143, bottom: 180, height: 37, width: 800 })
  const driftEnlarge = restoreScrollAnchor(container, snapshot)
  assert.equal(driftEnlarge, 28, 'Drift of 28px detected and compensated')
  assert.equal(container.scrollTop, 278, 'Container scrollTop increased by 28px')

  // Now line 4 is at top 143, container is scrolled to 278, new offset is 15px!
  line4._setRect({ top: 115, bottom: 152, height: 37, width: 800 }) // visual position restored

  // Case 3: Font size decreases, pulling line 4 up by 10px (top becomes 105 instead of 115)
  line4._setRect({ top: 105, bottom: 135, height: 30, width: 800 })
  const driftShrink = restoreScrollAnchor(container, snapshot)
  assert.equal(driftShrink, -10, 'Drift of -10px detected and compensated')
  assert.equal(container.scrollTop, 268, 'Container scrollTop decreased by 10px')
})

test('ScrollAnchorController locks anchor against compound drift during high-frequency steppers', () => {
  const container = createMockElement('div', {}, { top: 100, bottom: 600, height: 500, width: 800 })
  container.scrollTop = 300

  const line7 = createMockElement('div', { 'data-song-line': '7' }, { top: 120, bottom: 155, height: 35, width: 800 })
  const line8 = createMockElement('div', { 'data-song-line': '8' }, { top: 160, bottom: 195, height: 35, width: 800 })
  container.appendChild(line7)
  container.appendChild(line8)

  const controller = new ScrollAnchorController(500)

  // Step 1: Initial capture (user taps A+)
  const snap1 = controller.capture(container, 'song-42')
  assert.ok(snap1)
  assert.equal(snap1.selector, '[data-song-line="7"]')
  assert.equal(snap1.offsetFromViewportTop, 20)

  // Simulate layout change
  line7._setRect({ top: 128, bottom: 165, height: 37, width: 800 })
  const drift1 = controller.restore(container, 'song-42')
  assert.equal(drift1, 8)
  assert.equal(container.scrollTop, 308)

  // Step 2: High-frequency rapid tap (e.g. 50ms later, holding A+)
  // Even if line 7 moved in DOM, capture() MUST reuse the locked anchor snapshot
  const snap2 = controller.capture(container, 'song-42')
  assert.equal(snap2, snap1, 'Controller must reuse locked anchor across rapid clicks')
  assert.equal(snap2.offsetFromViewportTop, 20, 'Target offset remains pinned at 20px')

  // Step 3: Clear releases the lock
  controller.clear()
  assert.equal(controller.getActiveAnchor(), null, 'Lock is released after clear')
})

test('ScrollAnchorController clears anchor on song change', () => {
  const container = createMockElement('div', {}, { top: 100, bottom: 600, height: 500, width: 800 })
  container.scrollTop = 150
  const line1 = createMockElement('div', { 'data-song-line': '1' }, { top: 110, bottom: 140, height: 30, width: 800 })
  container.appendChild(line1)

  const controller = new ScrollAnchorController(500)
  controller.capture(container, 'song-A')
  assert.equal(controller.getActiveAnchor()?.songId, 'song-A')

  // Attempt to restore for a different song -> must return 0 and skip
  const drift = controller.restore(container, 'song-B')
  assert.equal(drift, 0, 'No drift applied when songId does not match')
})
