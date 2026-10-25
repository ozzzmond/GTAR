const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
require.extensions['.png'] = module => { module.exports = '/assets/dev-logo.png' }

const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const {
  inspectRecovery,
  hasActionableRecovery,
  recordRecoveryChoice,
  recoveryData,
  LIBRARY_KEY,
  RECOVERY_DECISIONS_KEY,
} = require('../src/utils/syncJournal.ts')
const { RecoveryReviewDialog } = require('../src/components/RecoveryReviewDialog.tsx')
const { SharedSetlistCatalogPanel } = require('../src/components/SharedSetlistCatalogPanel.tsx')
const { CatalogSetlistPreview } = require('../src/components/CatalogSetlistPreview.tsx')
const { CatalogImportContext } = require('../src/utils/catalogImportContext.ts')
const { savePublicationLink } = require('../src/utils/sharedSetlistPublishing.ts')

let dom, root
const baseLibrary = {
  songs: [
    { id: 'song-1', title: 'Amazing Grace', rawContent: '[G]Amazing [C]Grace', format: 'CHORD_PRO' },
    { id: 'song-2', title: 'Hallelujah', rawContent: '[C]Hallelujah', format: 'CHORD_PRO' },
  ],
  setlists: [],
}

function setTestSession(userId = 'test-user', role = 'member') {
  const session = {
    version: 1,
    user: { id: userId, sub: `sub-${userId}`, email: `${userId}@gtar.test`, role, access_status: 'active' },
    authenticatedAt: Date.now(),
    lastVerifiedAt: Date.now(),
    localExpiresAt: Date.now() + 86400000,
    expiresAt: Date.now() + 86400000,
    sessionToken: 'test-session-token-at-least-16-chars',
    role,
    access_status: 'active',
  }
  localStorage.setItem('gtar_auth_session', JSON.stringify(session))
}

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test' })
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (_, options, callback) => {
          assert.equal(options.ifAvailable, true)
          return callback({})
        },
      },
    },
  })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(baseLibrary))
  setTestSession('user-viewer', 'member')
})

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
    root = null
  }
  dom.window.close()
})

const render = async element => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(element))
  return root
}

// =========================================================================
// SCOPE A: SHARED CATALOG SETLIST UX & PUBLISHER TESTS
// =========================================================================

test('CATALOG_REVISION_BADGE & IMPORTED_COPY_NEWER_REVISION & NO_FALSE_UPDATE_NOTIFICATION', async () => {
  const catalogSetlists = [
    { id: 'cat-setlist-0001', revision: 2, name: 'Sunday Praise', occurrences: 2, updated_at: '2026-10-21T00:00:00Z' },
    { id: 'cat-setlist-0002', revision: 1, name: 'Acoustic Night', occurrences: 1, updated_at: '2026-10-20T00:00:00Z' },
  ]
  global.fetch = async url => {
    if (String(url).includes('/api/catalog/setlists')) {
      return new Response(JSON.stringify({ setlists: catalogSetlists }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404 })
  }

  const personalSetlists = [
    {
      id: 'personal-1',
      name: 'Sunday Praise (My Copy)',
      songs: [{ id: 'song-1', title: 'Amazing Grace' }],
      catalogSource: { environmentScope: 'https://gtar.test', setlistId: 'cat-setlist-0001', revision: 1 },
    },
    {
      id: 'personal-2',
      name: 'Acoustic Night (My Copy)',
      songs: [{ id: 'song-2', title: 'Hallelujah' }],
      catalogSource: { environmentScope: 'https://gtar.test', setlistId: 'cat-setlist-0002', revision: 1 },
    },
  ]

  await render(React.createElement(SharedSetlistCatalogPanel, {
    personalSetlists,
    currentUserId: 'user-viewer',
  }))

  await act(async () => { await new Promise(r => setTimeout(r, 40)) })

  // CATALOG_REVISION_BADGE
  const badge1 = document.querySelector('[data-testid="setlist-revision-badge-cat-setlist-0001"]')
  const badge2 = document.querySelector('[data-testid="setlist-revision-badge-cat-setlist-0002"]')
  assert.ok(badge1, 'cat-setlist-0001 revision badge exists')
  assert.ok(badge2, 'cat-setlist-0002 revision badge exists')
  assert.equal(badge1.textContent.trim(), 'r2')
  assert.equal(badge2.textContent.trim(), 'r1')

  // IMPORTED_COPY_NEWER_REVISION: "Update available" shows for cat-setlist-0001 (r1 -> r2)
  const updateNotice = document.querySelector('[data-testid="setlist-update-available-cat-setlist-0001"]')
  assert.ok(updateNotice, 'Update available notice exists for out-of-date import')
  assert.match(updateNotice.textContent, /r1 → r2/)

  // NO_FALSE_UPDATE_NOTIFICATION: cat-setlist-0002 is r1, catalog is r1 -> no update available
  const falseUpdateNotice = document.querySelector('[data-testid="setlist-update-available-cat-setlist-0002"]')
  assert.equal(falseUpdateNotice, null, 'No false update notification for up-to-date import')
  const currentNotice = document.querySelector('[data-testid="setlist-imported-current-cat-setlist-0002"]')
  assert.ok(currentNotice, 'Up-to-date imported copy indicator is shown')
})

test('REVISION_COMPARISON & NO_AUTOMATIC_LOCAL_OVERWRITE & RECOVERY_LAZY_DETAIL_DISCLOSURE', async () => {
  const snapshot = {
    version: 1,
    name: 'Sunday Praise',
    entries: [
      { title: 'Song One', rawContent: '[G]Chart content private 1', format: 'CHORD_PRO', key: 'G' },
      { title: 'Song Two', rawContent: '[D]Chart content private 2', format: 'CHORD_PRO', key: 'D' },
    ],
  }
  global.fetch = async url => {
    if (String(url).includes('/api/catalog/setlists/catalog-setlist-0001')) {
      return new Response(JSON.stringify({ id: 'catalog-setlist-0001', revision: 2, snapshot }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404 })
  }

  // Personal copy exists at r1
  const personalCopy = {
    id: 'personal-copy-1',
    name: 'Sunday Praise (Imported)',
    songs: [{ id: 'song-1', title: 'Song One' }],
    catalogSource: { environmentScope: 'https://gtar.test', setlistId: 'catalog-setlist-0001', revision: 1 },
  }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({
    songs: baseLibrary.songs,
    setlists: [personalCopy],
  }))

  const libraryBefore = localStorage.getItem(LIBRARY_KEY)
  const host = {
    getLocal: () => JSON.parse(localStorage.getItem(LIBRARY_KEY)),
    blocked: () => false,
    applied() {},
    open() {},
  }

  await render(
    React.createElement(
      CatalogImportContext.Provider,
      { value: host },
      React.createElement(CatalogSetlistPreview, {
        id: 'catalog-setlist-0001',
        revision: 2,
        onClose() {},
      })
    )
  )

  await act(async () => { await new Promise(r => setTimeout(r, 40)) })

  // REVISION_COMPARISON: revision badge and diff notice with explicit limitation
  const badge = document.querySelector('[data-testid="preview-revision-badge"]')
  assert.ok(badge, 'Preview revision badge exists')
  assert.equal(badge.textContent.trim(), 'r2')

  const staleNotice = document.querySelector('[data-testid="preview-stale-import-notice"]')
  assert.ok(staleNotice, 'Stale import notice exists')
  assert.match(staleNotice.textContent, /r1 → this is r2/)
  assert.match(staleNotice.textContent, /Only revision numbers and details are compared/)
  assert.match(staleNotice.textContent, /never overwrite existing imported setlists/)

  // RECOVERY_LAZY_DETAIL_DISCLOSURE: Chart details element is closed by default
  const details = document.querySelector('details')
  assert.ok(details, 'Chart details element exists')
  assert.equal(details.open, false, 'Chart contents remain lazy and closed by default')

  // NO_AUTOMATIC_LOCAL_OVERWRITE: Personal library remains completely untouched
  assert.equal(localStorage.getItem(LIBRARY_KEY), libraryBefore, 'Library was never modified automatically')
})

test('PUBLISHER_ONLY_MANAGEMENT & NON_OWNER_ACCESS_DENIED & UNPUBLISH_CONFIRMATION', async () => {
  const catalogSetlists = [
    { id: 'cat-owned-00000001', revision: 1, name: 'Publisher Setlist', occurrences: 1, updated_at: '2026-10-21T00:00:00Z' },
    { id: 'cat-other-00000002', revision: 1, name: 'Other User Setlist', occurrences: 1, updated_at: '2026-10-21T00:00:00Z' },
  ]
  global.fetch = async url => {
    if (String(url).includes('/api/catalog/setlists')) {
      return new Response(JSON.stringify({ setlists: catalogSetlists }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404 })
  }

  // Publisher journal entry exists for cat-owned-00000001 under user-publisher
  savePublicationLink('user-publisher', 'cat-owned-00000001', {
    publicationKey: 'a'.repeat(64),
    result: { id: 'cat-owned-00000001', revision: 1, unpublished: false },
  })

  // 1. Render as NON-OWNER (user-other)
  setTestSession('user-other', 'member')
  await render(React.createElement(SharedSetlistCatalogPanel, {
    personalSetlists: [],
    currentUserId: 'user-other',
  }))
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })

  // NON_OWNER_ACCESS_DENIED: Neither setlist has an Unpublish button for user-other
  assert.equal(document.querySelector('[data-testid="unpublish-setlist-btn-cat-owned-00000001"]'), null)
  assert.equal(document.querySelector('[data-testid="unpublish-setlist-btn-cat-other-00000002"]'), null)

  // 2. Render as OWNER (user-publisher)
  await act(async () => root.unmount())
  setTestSession('user-publisher', 'admin')
  await render(React.createElement(SharedSetlistCatalogPanel, {
    personalSetlists: [],
    currentUserId: 'user-publisher',
  }))
  await act(async () => { await new Promise(r => setTimeout(r, 40)) })

  // PUBLISHER_ONLY_MANAGEMENT: Unpublish button visible for owned setlist, but NOT for cat-other
  const unpublishBtn = document.querySelector('[data-testid="unpublish-setlist-btn-cat-owned-00000001"]')
  assert.ok(unpublishBtn, 'Unpublish button visible for authenticated publisher')
  assert.equal(document.querySelector('[data-testid="unpublish-setlist-btn-cat-other-00000002"]'), null)

  // UNPUBLISH_CONFIRMATION: Clicking unpublish opens confirmation modal dialog via showModal()
  await act(async () => unpublishBtn.click())
  const confirmDialog = document.querySelector('[data-testid="setlist-unpublish-confirm-dialog"]')
  assert.ok(confirmDialog, 'Unpublish confirmation dialog opens')
  assert.equal(confirmDialog.open, true, 'Dialog open property set via showModal')
  assert.match(confirmDialog.textContent, /Remove "Publisher Setlist" \(r1\) from the Shared Catalog\?/)
  assert.doesNotMatch(confirmDialog.textContent, /deferred backend tasks/, '#224: internal note removed')

  // UNPUBLISH_MODAL_ESCAPE_CANCEL & UNPUBLISH_MODAL_FOCUS_RESTORATION
  const cancelBtn = document.querySelector('[data-testid="setlist-unpublish-cancel"]')
  assert.ok(cancelBtn, 'Cancel button exists in unpublish dialog')
  await act(async () => cancelBtn.click())
  assert.equal(document.querySelector('[data-testid="setlist-unpublish-confirm-dialog"]'), null, 'Dialog dismissed on cancel')
  assert.equal(document.activeElement, unpublishBtn, 'Focus restored to triggering unpublish button')

  // UNPUBLISH_MODAL_ESCAPE_CANCEL: native cancel event closes dialog
  await act(async () => unpublishBtn.click())
  const reopenDialog = document.querySelector('[data-testid="setlist-unpublish-confirm-dialog"]')
  assert.ok(reopenDialog)
  const cancelEvent = new dom.window.Event('cancel', { cancelable: true })
  await act(async () => { reopenDialog.dispatchEvent(cancelEvent) })
  assert.equal(document.querySelector('[data-testid="setlist-unpublish-confirm-dialog"]'), null, 'Dialog dismissed on native cancel event')
  assert.equal(document.activeElement, unpublishBtn, 'Focus restored to triggering unpublish button after Escape cancel')
})

test('CROSS_USER_PUBLICATION_ISOLATION', () => {
  savePublicationLink('user-a', 'setlist-1', {
    publicationKey: '1'.repeat(64),
    result: { id: 'pub-a-00000000001', revision: 1, unpublished: false },
  })
  savePublicationLink('user-b', 'setlist-1', {
    publicationKey: '2'.repeat(64),
    result: { id: 'pub-b-00000000002', revision: 1, unpublished: false },
  })

  const rawA = localStorage.getItem('gtar_setlist_publication_v1:user-a:setlist-1')
  const rawB = localStorage.getItem('gtar_setlist_publication_v1:user-b:setlist-1')
  assert.ok(rawA)
  assert.ok(rawB)
  assert.notEqual(rawA, rawB)
})

// =========================================================================
// SCOPE B: LOCAL RECOVERY REVIEW UX TESTS
// =========================================================================

test('RECOVERY_ZERO_ACTIONABLE_STATE & RECOVERY_RESOLVED_HISTORY & ACCESSIBILITY', async () => {
  // Create an archive with a divergent version of song-1
  const archivePayload = {
    songs: [{ id: 'song-1', title: 'Amazing Grace', rawContent: '[A]Different chords', format: 'CHORD_PRO' }],
    setlists: [],
  }
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify(archivePayload))

  // Review before decision: 1 actionable source
  const reviewBefore = inspectRecovery()
  assert.equal(reviewBefore.sources.filter(s => s.status === 'actionable').length, 1)

  // Explicitly choose current library -> resolves the source and retains history
  await recordRecoveryChoice(reviewBefore, 'keep-current', () => false)

  await render(React.createElement(RecoveryReviewDialog, {
    blocked: () => false,
    onClose() {},
  }))

  // Summary metrics
  const metricArchives = document.querySelector('[data-testid="recovery-metric-archives"]')
  const metricActionable = document.querySelector('[data-testid="recovery-metric-actionable"]')
  const metricResolved = document.querySelector('[data-testid="recovery-metric-resolved"]')
  const metricInvalid = document.querySelector('[data-testid="recovery-metric-invalid"]')

  assert.ok(metricArchives)
  assert.ok(metricActionable)
  assert.ok(metricResolved)
  assert.ok(metricInvalid)

  assert.equal(metricActionable.textContent.includes('0'), true, '0 actionable conflicts')
  assert.equal(metricResolved.textContent.includes('1'), true, '1 resolved history')

  // RECOVERY_ZERO_ACTIONABLE_STATE: distinct banner
  const zeroState = document.querySelector('[data-testid="recovery-no-actionable-state"]')
  assert.ok(zeroState, 'Zero-actionable state rendered')
  assert.match(zeroState.textContent, /No active conflicts/)
  assert.match(zeroState.textContent, /1 resolved source is retained as history/)

  // Choose current library is disabled with clear reason
  const chooseBtn = document.querySelector('[data-testid="choose-current-library-btn"]')
  assert.ok(chooseBtn.disabled, 'Choose current library is disabled when no actionable conflicts')
  const disabledReason = document.querySelector('[data-testid="keep-current-disabled-reason"]')
  assert.ok(disabledReason)
  assert.match(disabledReason.textContent, /No actionable conflicts exist/)

  // ACCESSIBILITY: dialog has aria-label, buttons have min-h-11
  const dialog = document.querySelector('dialog')
  assert.equal(dialog.getAttribute('aria-label'), 'Local recovery review')
  assert.ok(chooseBtn.className.includes('min-h-11'))
})

test('RECOVERY_MISSING_RECORD_CLASSIFICATION & RECOVERY_EXPORT_PRESERVATION & NO_RECOVERY_DATA_MUTATION', async () => {
  const missingSong = { id: 'missing-song-id', title: 'Lost In Time', rawContent: 'content', format: 'CHORD_PRO' }
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify({
    songs: [missingSong],
    setlists: [],
  }))

  const beforeStorage = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))

  await render(React.createElement(RecoveryReviewDialog, {
    blocked: () => false,
    onClose() {},
  }))

  // Metric displays 1 actionable conflict
  const metricActionable = document.querySelector('[data-testid="recovery-metric-actionable"]')
  assert.match(metricActionable.textContent, /1/)

  // Missing record count displays
  const missingSummary = document.querySelector('[data-testid="recovery-missing-count"]')
  assert.ok(missingSummary)
  assert.match(missingSummary.textContent, /1 distinct missing records/)

  // Source item displays classified missing record
  const sourceDetails = document.querySelector('[data-testid="recovery-source-0"]')
  assert.ok(sourceDetails)
  assert.match(sourceDetails.textContent, /Currently missing — not present in current library/)

  // RECOVERY_EXPORT_PRESERVATION: Export button works and produces complete raw snapshot
  let exportedBlob = null
  let exportedFilename = null
  const createUrl = URL.createObjectURL
  URL.createObjectURL = blob => { exportedBlob = blob; return 'blob:test' }
  URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () { exportedFilename = this.download }

  try {
    const exportBtn = document.querySelector('[data-testid="export-recovery-btn"]')
    assert.ok(exportBtn, 'Export button exists')
    await act(async () => exportBtn.click())

    assert.equal(exportedFilename, 'GTAR-storage-recovery.json')
    assert.ok(exportedBlob)
    const parsedExport = JSON.parse(await exportedBlob.text())
    assert.deepEqual(parsedExport, recoveryData(localStorage))
  } finally {
    URL.createObjectURL = createUrl
  }

  // NO_RECOVERY_DATA_MUTATION: storage has not been modified
  const afterStorage = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))
  assert.deepEqual(afterStorage, beforeStorage, 'Review and export caused ZERO data mutation')
})

test('RECOVERY_REOPEN_CONFIRMATION', async () => {
  // Create an archive with a divergent version and resolve it
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify({
    songs: [{ id: 'song-1', title: 'Amazing Grace', rawContent: '[E]Alternate', format: 'CHORD_PRO' }],
    setlists: [],
  }))
  await recordRecoveryChoice(inspectRecovery(), 'keep-current', () => false)

  await render(React.createElement(RecoveryReviewDialog, {
    blocked: () => false,
    onClose() {},
  }))

  // Reopen button triggers confirmation step
  const reopenBtn = document.querySelector('[data-testid="reopen-recovery-btn"]')
  assert.ok(reopenBtn, 'Reopen recovery conflicts button exists')
  await act(async () => reopenBtn.click())

  // Confirmation section renders
  const confirmSection = document.querySelector('[data-testid="recovery-confirmation-section"]')
  assert.ok(confirmSection, 'Reopen confirmation section is displayed')
  assert.match(confirmSection.textContent, /Reopen these recovery conflicts/)

  // Cancel button dismisses without reopening
  const cancelBtn = document.querySelector('[data-testid="cancel-recovery-choice-btn"]')
  assert.ok(cancelBtn)
  await act(async () => cancelBtn.click())
  assert.equal(document.querySelector('[data-testid="recovery-confirmation-section"]'), null)
})
