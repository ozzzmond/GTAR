const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const ts = require('typescript')
const fs = require('fs')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
global.window = dom.window
global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
global.Node = dom.window.Node
global.Event = dom.window.Event
global.MouseEvent = dom.window.MouseEvent
global.KeyboardEvent = dom.window.KeyboardEvent
global.TouchEvent = dom.window.TouchEvent
global.IS_REACT_ACT_ENVIRONMENT = true

const { SwipeableActionCard } = require('../src/components/SwipeableActionCard.tsx')

let root, host
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const find = (id) => host.querySelector(`[data-testid="${id}"]`)

async function touch(el, type, x, y = 20) {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  const point = { identifier: 1, clientX: x, clientY: y }
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : [point] },
    changedTouches: { value: [point] },
  })
  await act(async () => el.dispatchEvent(event))
  return event
}

async function swipe(el, deltaX) {
  await touch(el, 'touchstart', 200, 20)
  await touch(el, 'touchmove', 200 + deltaX, 20)
}

test('SWIPE_MUST_FIX_1A: Partial swipe left settles OPEN with tappable Rename and Delete buttons', async () => {
  let renameCalled = 0
  let deleteCalled = 0

  await act(async () => {
    root.render(
      React.createElement(
        SwipeableActionCard,
        {
          id: 'test-card-1',
          dataTestId: 'card-1',
          secondaryRightAction: {
            icon: null,
            label: 'Rename',
            testId: 'swipe-rename-btn',
            onAction: () => {
              renameCalled++
            },
          },
          rightAction: {
            icon: null,
            label: 'Delete',
            isDestructive: true,
            testId: 'swipe-delete-btn',
            onAction: () => {
              deleteCalled++
            },
          },
        },
        React.createElement('div', null, 'Song Title')
      )
    )
  })

  const card = find('card-1')
  // Partial swipe left by -70px (beyond open threshold 40px, but well below arm threshold 160px)
  await swipe(card, -70)
  await touch(card, 'touchend', 130, 20)

  // Card front stays offset at -140px (OPEN)
  assert.equal(card.style.transform, 'translateX(-140px)', 'Card front remains offset -140px')

  // Both Rename and Delete buttons are rendered and visible in underlayer
  const renameBtn = find('swipe-rename-btn')
  const deleteBtn = find('swipe-delete-btn')
  assert.ok(renameBtn, 'Rename button is visible and rendered')
  assert.ok(deleteBtn, 'Delete button is visible and rendered')
  assert.equal(renameCalled, 0, 'No action triggered on release alone')
  assert.equal(deleteCalled, 0, 'No action triggered on release alone')
})

test('SWIPE_MUST_FIX_1B: Tap Rename on open card calls handler exactly once', async () => {
  let renameCalled = 0
  let deleteCalled = 0

  await act(async () => {
    root.render(
      React.createElement(
        SwipeableActionCard,
        {
          id: 'test-card-2',
          dataTestId: 'card-2',
          secondaryRightAction: {
            icon: null,
            label: 'Rename',
            testId: 'swipe-rename-btn',
            onAction: () => {
              renameCalled++
            },
          },
          rightAction: {
            icon: null,
            label: 'Delete',
            isDestructive: true,
            testId: 'swipe-delete-btn',
            onAction: () => {
              deleteCalled++
            },
          },
        },
        React.createElement('div', null, 'Song Title')
      )
    )
  })

  const card = find('card-2')
  await swipe(card, -60)
  await touch(card, 'touchend', 140, 20)

  const renameBtn = find('swipe-rename-btn')
  assert.ok(renameBtn)
  await act(async () => renameBtn.click())

  assert.equal(renameCalled, 1, 'Rename action handler called exactly once')
  assert.equal(deleteCalled, 0, 'Delete action handler not called')
  assert.equal(card.style.transform, 'translateX(0px)', 'Card resets to 0 after tapping Rename')
})

test('SWIPE_MUST_FIX_1C: Full swipe past arm threshold triggers Delete confirm only, no rename', async () => {
  let renameCalled = 0
  let deleteCalled = 0

  await act(async () => {
    root.render(
      React.createElement(
        SwipeableActionCard,
        {
          id: 'test-card-3',
          dataTestId: 'card-3',
          secondaryRightAction: {
            icon: null,
            label: 'Rename',
            testId: 'swipe-rename-btn',
            onAction: () => {
              renameCalled++
            },
          },
          rightAction: {
            icon: null,
            label: 'Delete',
            isDestructive: true,
            testId: 'swipe-delete-btn',
            onAction: () => {
              deleteCalled++
            },
          },
        },
        React.createElement('div', null, 'Song Title')
      )
    )
  })

  const card = find('card-3')
  // Full swipe left by -180px (past arm threshold 160px)
  await swipe(card, -180)
  await touch(card, 'touchend', 20, 20)

  assert.equal(deleteCalled, 1, 'Delete confirmation handler called once on full swipe release')
  assert.equal(renameCalled, 0, 'Rename handler never called on full swipe')
  assert.equal(card.style.transform, 'translateX(0px)', 'Card resets to 0 after armed release')
})

test('SWIPE_MUST_FIX_1D: Outside pointerdown or Escape closes open card', async () => {
  await act(async () => {
    root.render(
      React.createElement(
        'div',
        null,
        React.createElement(
          SwipeableActionCard,
          {
            id: 'test-card-4',
            dataTestId: 'card-4',
            secondaryRightAction: {
              icon: null,
              label: 'Rename',
              testId: 'swipe-rename-btn',
              onAction: () => {},
            },
            rightAction: {
              icon: null,
              label: 'Delete',
              isDestructive: true,
              testId: 'swipe-delete-btn',
              onAction: () => {},
            },
          },
          React.createElement('div', null, 'Song Title')
        ),
        React.createElement('button', { 'data-testid': 'outside-elem' }, 'Outside')
      )
    )
  })

  const card = find('card-4')
  await swipe(card, -70)
  await touch(card, 'touchend', 130, 20)
  assert.equal(card.style.transform, 'translateX(-140px)', 'Card open at -140px')

  // Outside pointerdown
  const outside = find('outside-elem')
  await act(async () => {
    outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }))
  })
  assert.equal(card.style.transform, 'translateX(0px)', 'Card closed after outside pointerdown')

  // Re-open and test Escape
  await swipe(card, -70)
  await touch(card, 'touchend', 130, 20)
  assert.equal(card.style.transform, 'translateX(-140px)', 'Card re-opened')

  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(card.style.transform, 'translateX(0px)', 'Card closed after Escape key')
})

test('SWIPE_MUST_FIX_1E: Cards without secondaryRightAction behave exactly as before', async () => {
  let deleteCalled = 0

  await act(async () => {
    root.render(
      React.createElement(
        SwipeableActionCard,
        {
          id: 'test-card-5',
          dataTestId: 'card-5',
          rightAction: {
            icon: null,
            label: 'Delete',
            isDestructive: true,
            onAction: () => {
              deleteCalled++
            },
          },
        },
        React.createElement('div', null, 'Card without secondary')
      )
    )
  })

  const card = find('card-5')
  // Partial swipe below 75px: resets immediately, does not stay open
  await swipe(card, -50)
  await touch(card, 'touchend', 150, 20)
  assert.equal(card.style.transform, 'translateX(0px)', 'Resets to 0 immediately')
  assert.equal(deleteCalled, 0)

  // Full swipe past 75px: arms and calls delete
  await swipe(card, -90)
  await touch(card, 'touchend', 110, 20)
  assert.equal(deleteCalled, 1, 'Armed delete triggered on release')
  assert.equal(card.style.transform, 'translateX(0px)')
})
