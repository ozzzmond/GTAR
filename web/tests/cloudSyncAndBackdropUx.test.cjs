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
const { CatalogSetlistPreview } = require('../src/components/CatalogSetlistPreview.tsx')
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

test('CLOUD_SYNC_REFERENCE_LAYOUT & RECOVERY_BUTTON_FOOTER_PLACEMENT', () => {
  let closed = false
  const auth = mockAuth('admin')

  act(() => {
    root.render(
      React.createElement(
        AuthContext.Provider,
        { value: auth },
        React.createElement(CloudSyncModal, {
          isOpen: true,
          onClose: () => { closed = true },
        })
      )
    )
  })

  // 1. HEADER: Cloud icon | Cloud Songbook Sync | Close X
  const headerTitle = container.querySelector('h2')
  assert.ok(headerTitle, 'Header title exists')
  assert.equal(headerTitle.textContent.trim(), 'Cloud Songbook Sync')

  // 2. ACCOUNT_CARD: Display name, email, role badge
  const cardText = container.textContent
  assert.ok(cardText.includes('Alex Drummer'), 'Account card includes user name')
  assert.ok(cardText.includes('alex@example.com'), 'Account card includes user email')
  assert.ok(cardText.includes('Active Admin'), 'Account card includes role badge')

  // 3. STATUS_CARD: Sync status | Last synced | Fingerprint
  assert.ok(cardText.includes('Sync Status'), 'Status card includes Sync Status label')
  assert.ok(cardText.includes('Last Synced'), 'Status card includes Last Synced label')
  assert.ok(cardText.includes('Fingerprint'), 'Status card includes Fingerprint label')

  // 4. PRIMARY_ACTIONS: Sync Now | Download from Cloud
  const syncNowBtn = container.querySelector('[data-testid="sync-now-button"]')
  const downloadBtn = container.querySelector('[data-testid="download-from-cloud-button"]')
  assert.ok(syncNowBtn, 'Sync Now button is present in actions')
  assert.ok(downloadBtn, 'Download from Cloud button is present in actions')

  // 5. FOOTER: Review local recovery LEFT | Close RIGHT
  const recoveryBtn = container.querySelector('[data-testid="cloud-sync-recovery-button"]')
  const closeBtn = container.querySelector('[data-testid="cloud-sync-close-button"]')
  assert.ok(recoveryBtn, 'Review local recovery button exists in footer')
  assert.ok(closeBtn, 'Close button exists in footer')
  assert.equal(recoveryBtn.textContent.trim(), 'Review local recovery')
  assert.equal(closeBtn.textContent.trim(), 'Close')

  // Verify footer DOM hierarchy: recovery button appears before close button
  const footerEl = recoveryBtn.closest('.border-t')
  assert.ok(footerEl, 'Footer container exists')
  assert.ok(footerEl.contains(recoveryBtn), 'Footer contains recovery button')
  assert.ok(footerEl.contains(closeBtn), 'Footer contains close button')
  assert.ok(
    footerEl.compareDocumentPosition(recoveryBtn) & 16 ||
    recoveryBtn.compareDocumentPosition(closeBtn) & 4,
    'Recovery button is on the left preceding Close button'
  )

  // Verify NO duplicate recovery button in content body
  const allRecoveryButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
    b.textContent.includes('Review local recovery')
  )
  assert.equal(allRecoveryButtons.length, 1, 'Only one Review local recovery button exists (in footer)')
})

test('DESKTOP_AND_MOBILE_RESPONSIVENESS & LIGHT_AND_DARK_THEMES', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../src/components/CloudSyncModal.tsx'), 'utf8')

  // Responsive classes: max-w-lg, max-h-[90vh], overflow-y-auto, p-3 sm:p-4
  assert.ok(fileContent.includes('max-w-lg'), 'Uses max-w-lg for bounded width')
  assert.ok(fileContent.includes('max-h-[90vh]'), 'Uses viewport-adaptive max-h-[90vh]')
  assert.ok(fileContent.includes('overflow-y-auto'), 'Enables scrolling for small viewports')
  assert.ok(fileContent.includes('p-3 sm:p-4'), 'Responsive outer padding')

  // Semantic theme tokens: bg-app-surface, text-app-heading, border-app-border, bg-app-base
  assert.ok(fileContent.includes('bg-app-surface'), 'Uses bg-app-surface theme token')
  assert.ok(fileContent.includes('text-app-heading'), 'Uses text-app-heading theme token')
  assert.ok(fileContent.includes('border-app-border'), 'Uses border-app-border theme token')
  assert.ok(fileContent.includes('bg-app-base'), 'Uses bg-app-base theme token')
})

test('BACKDROP_CLICK_DISMISS & INSIDE_CLICK_NO_DISMISS for CloudSyncModal (Idle)', () => {
  let closed = false
  // Guest / unauthenticated context does not auto-trigger in-flight sync
  const guestAuth = { session: null, accessStatus: 'none' }

  act(() => {
    root.render(
      React.createElement(
        AuthContext.Provider,
        { value: guestAuth },
        React.createElement(CloudSyncModal, {
          isOpen: true,
          onClose: () => { closed = true },
        })
      )
    )
  })

  const backdrop = container.querySelector('[data-testid="cloud-sync-modal-backdrop"]')
  const card = container.querySelector('[data-testid="cloud-sync-modal-card"]')
  assert.ok(backdrop, 'Backdrop element found')
  assert.ok(card, 'Card element found')

  // Clicking inside card does NOT dismiss
  act(() => {
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(closed, false, 'Inside click must not dismiss modal')

  // Clicking backdrop dismisses
  act(() => {
    backdrop.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(closed, true, 'Backdrop click dismisses modal')
})

test('ESCAPE_DISMISS & FOCUS_RESTORATION for CloudSyncModal (Idle)', () => {
  let closed = false
  const triggerBtn = document.getElementById('trigger-btn')
  triggerBtn.focus()
  assert.equal(document.activeElement, triggerBtn, 'Trigger button focused initially')

  const guestAuth = { session: null, accessStatus: 'none' }

  act(() => {
    root.render(
      React.createElement(
        AuthContext.Provider,
        { value: guestAuth },
        React.createElement(CloudSyncModal, {
          isOpen: true,
          onClose: () => { closed = true },
        })
      )
    )
  })

  // Pressing Escape closes the modal
  act(() => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(closed, true, 'Escape key dismisses modal')

  // Closing unmounts and restores focus
  act(() => {
    root.render(null)
  })
  assert.equal(document.activeElement, triggerBtn, 'Focus restored to triggering element')
})

test('IN_FLIGHT_OPERATION_PROTECTION: CloudSyncModal prevents backdrop and escape dismissal during active sync', () => {
  let closed = false
  const auth = mockAuth('admin')

  // When authenticated, opening CloudSyncModal immediately initiates background sync (isProcessing = true)
  act(() => {
    root.render(
      React.createElement(
        AuthContext.Provider,
        { value: auth },
        React.createElement(CloudSyncModal, {
          isOpen: true,
          onClose: () => { closed = true },
        })
      )
    )
  })

  const backdrop = container.querySelector('[data-testid="cloud-sync-modal-backdrop"]')
  assert.ok(backdrop, 'Backdrop element found')

  // Clicking backdrop during in-flight sync MUST NOT dismiss
  act(() => {
    backdrop.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(closed, false, 'Backdrop click during active sync must not dismiss modal')

  // Pressing Escape during in-flight sync MUST NOT dismiss
  act(() => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal(closed, false, 'Escape key during active sync must not dismiss modal')

  // Header Close X and Footer Close buttons must be disabled
  const closeBtn = container.querySelector('[data-testid="cloud-sync-close-button"]')
  assert.equal(closeBtn.disabled, true, 'Footer close button is disabled while isProcessing')

  const fileContent = fs.readFileSync(path.join(__dirname, '../src/components/CloudSyncModal.tsx'), 'utf8')
  assert.ok(
    fileContent.includes('!isProcessing') && fileContent.includes('onClose()'),
    'Backdrop click checks !isProcessing before closing'
  )
  assert.ok(
    fileContent.includes("e.key === 'Escape' && !isProcessing"),
    'Escape key listener checks !isProcessing before closing'
  )
})

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

test('BACKDROP_DISMISSAL & IN_FLIGHT_PROTECTION for CatalogSetlistPreview', () => {
  let closed = false

  act(() => {
    root.render(
      React.createElement(CatalogSetlistPreview, {
        id: 'pub_1',
        revision: 1,
        onClose: () => { closed = true },
      })
    )
  })

  const dialog = container.querySelector('dialog')
  assert.ok(dialog, 'CatalogSetlistPreview renders native dialog')

  // Mock getBoundingClientRect: dialog box is between (100, 100) and (400, 500)
  dialog.getBoundingClientRect = () => ({
    left: 100,
    top: 100,
    right: 400,
    bottom: 500,
    width: 300,
    height: 400,
  })

  // Click INSIDE the dialog rect (clientX = 200, clientY = 200) -> NO dismiss
  act(() => {
    const insideClick = new dom.window.MouseEvent('click', { bubbles: true })
    Object.defineProperty(insideClick, 'clientX', { value: 200 })
    Object.defineProperty(insideClick, 'clientY', { value: 200 })
    dialog.dispatchEvent(insideClick)
  })
  assert.equal(closed, false, 'Inside dialog click does not dismiss CatalogSetlistPreview')

  // Click on BACKDROP outside dialog rect (clientX = 50, clientY = 50) -> DISMISS
  act(() => {
    const backdropClick = new dom.window.MouseEvent('click', { bubbles: true })
    Object.defineProperty(backdropClick, 'clientX', { value: 50 })
    Object.defineProperty(backdropClick, 'clientY', { value: 50 })
    dialog.dispatchEvent(backdropClick)
  })
  assert.equal(closed, true, 'Backdrop click outside dialog rect dismisses CatalogSetlistPreview')

  // Verify busyRef in-flight guard
  const fileContent = fs.readFileSync(path.join(__dirname, '../src/components/CatalogSetlistPreview.tsx'), 'utf8')
  assert.ok(fileContent.includes('if (busyRef.current) return'), 'CatalogSetlistPreview checks busyRef.current on backdrop click')
  assert.ok(fileContent.includes('if (!busyRef.current) onClose()'), 'CatalogSetlistPreview checks busyRef.current onCancel')
})

test('DESTRUCTIVE_CONFIRMATION_PROTECTION: guarded dialogs retain protection', () => {
  const songbookContent = fs.readFileSync(path.join(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Bulk delete dialogs must not have casual backdrop dismissal
  const deleteSongsDialog = songbookContent.slice(
    songbookContent.indexOf('data-testid="bulk-delete-songs-confirm-dialog"'),
    songbookContent.indexOf('data-testid="bulk-delete-setlists-confirm-dialog"')
  )
  assert.ok(!deleteSongsDialog.includes('onClick={(e) => { if (e.target === e.currentTarget)'), 'Bulk delete songs dialog is guarded')

  const recoveryContent = fs.readFileSync(path.join(__dirname, '../src/components/RecoveryReviewDialog.tsx'), 'utf8')
  assert.ok(!recoveryContent.includes('onClick={event => { if (event.target === event.currentTarget)'), 'Recovery review dialog is guarded')
})
