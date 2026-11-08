const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll('import.meta.env', '({DEV:false})'),
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
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
const { ShareSetlistModal } = require('../src/components/ShareSetlistModal.tsx')
const { AuthContext } = require('../src/utils/authContext.ts')

let dom, root, container

beforeEach(() => {
  dom = new JSDOM(
    '<!DOCTYPE html><html><body><button id="trigger-btn">Open Dialog</button><div id="root"></div></body></html>',
    { url: 'https://gtar.test' }
  )
  global.window = dom.window
  global.document = dom.window.document
  global.navigator = dom.window.navigator
  global.localStorage = dom.window.localStorage
  global.sessionStorage = dom.window.sessionStorage
  global.CustomEvent = dom.window.CustomEvent
  global.KeyboardEvent = dom.window.KeyboardEvent
  global.MouseEvent = dom.window.MouseEvent
  global.HTMLElement = dom.window.HTMLElement
  global.HTMLDialogElement = dom.window.HTMLDialogElement
  global.IS_REACT_ACT_ENVIRONMENT = true

  // Stub dialog methods for JSDOM
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }

  container = document.getElementById('root')
  root = createRoot(container)
})

afterEach(() => {
  if (root) {
    act(() => {
      root.unmount()
    })
  }
})

function mockAuth(userRole = 'admin') {
  return {
    session: {
      user: {
        id: 'usr_1',
        name: 'Alex Drummer',
        email: 'alex@example.com',
        role: userRole,
      },
      sessionToken: 'token_123',
    },
    accessStatus: 'active',
  }
}











test('BACKDROP_CLICK_DISMISS & ESCAPE_DISMISS for ShareSetlistModal', () => {
  let closed = false
  const triggerBtn = document.getElementById('trigger-btn')
  triggerBtn.focus()

  const dummySetlist = { id: 'sl_1', name: 'Sunday Service', songs: [] }

  act(() => {
    root.render(
      React.createElement(ShareSetlistModal, {
        setlist: dummySetlist,
        allSongs: [],
        onClose: () => { closed = true },
      })
    )
  })

  const backdrop = container.querySelector('[data-testid="share-setlist-modal-backdrop"]')
  const card = container.querySelector('[data-testid="share-setlist-modal-card"]')
  assert.ok(backdrop, 'Share modal backdrop exists')
  assert.ok(card, 'Share modal card exists')

  // Inside click does not dismiss
  act(() => {
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(closed, false, 'Inside click does not dismiss ShareSetlistModal')

  // Pressing Escape dismisses
  act(() => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(closed, true, 'Escape dismisses ShareSetlistModal')

  // Unmounting restores focus
  act(() => {
    root.render(null)
  })
  assert.equal(document.activeElement, triggerBtn, 'Focus restored after ShareSetlistModal closes')
})

test('IN_FLIGHT_OPERATION_PROTECTION for ShareSetlistModal', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../src/components/ShareSetlistModal.tsx'), 'utf8')

  // Backdrop click checks !loading && !revoking
  assert.ok(
    fileContent.includes('!loading && !revoking'),
    'ShareSetlistModal backdrop click is guarded against loading and revoking'
  )

  // Escape key checks !loading && !revoking
  assert.ok(
    fileContent.includes("e.key === 'Escape' && !loading && !revoking"),
    'ShareSetlistModal Escape handler is guarded against loading and revoking'
  )

  // Buttons are disabled during in-flight operations
  assert.ok(
    fileContent.includes('disabled={loading || revoking}'),
    'ShareSetlistModal close buttons disabled during loading or revoking'
  )
})

test('DESTRUCTIVE_CONFIRMATION_PROTECTION: guarded dialogs retain protection', () => {
  const songbookContent = fs.readFileSync(path.join(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Bulk delete dialogs must not have casual backdrop dismissal
  const deleteSongsDialog = songbookContent.slice(
    songbookContent.indexOf('data-testid="bulk-delete-songs-confirm-dialog"'),
    songbookContent.indexOf('data-testid="bulk-delete-setlists-confirm-dialog"')
  )
  assert.ok(!deleteSongsDialog.includes('onClick={(e) => { if (e.target === e.currentTarget)'), 'Bulk delete songs dialog is guarded')

  // #304: the Recovery data panel closes on its backdrop only while no delete is running.
  const recoveryContent = fs.readFileSync(path.join(__dirname, '../src/components/RecoveryDataPanel.tsx'), 'utf8')
  assert.ok(recoveryContent.includes('if (event.target === event.currentTarget && !busyRef.current) onClose()'), 'Recovery data panel is guarded while busy')
})
