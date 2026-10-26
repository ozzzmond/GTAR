const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const { resolveSetlistPublicationStatus, SETLIST_STATUS_DESCRIPTORS } = require('../src/utils/setlistPublicationStatus.ts')
const { SetlistCloudStatusBadge } = require('../src/components/SetlistCloudStatusBadge.tsx')
const api = require('../src/utils/sharedSetlistPublishing.ts')
const { snapshotFromSongbook } = require('../src/utils/sharedSetlistSnapshot.ts')
const { computeSongbookChecksum } = require('../src/utils/cloudSongbookSync.ts')
const { LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
const { bindOwner, OWNER_KEY } = require('./helpers/libraryOwner.cjs')

let dom, root, library, cloud, version, calls, responder

const id = 'publication_1234567890123456'
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function session(account = 'account-edge-admin', role = 'admin', access = 'active') {
  const value = {
    version: 1,
    user: { id: account, sub: account, email: `${account}@test.app`, role, access_status: access, email_verified: true },
    authenticatedAt: Date.now(),
    lastVerifiedAt: Date.now(),
    localExpiresAt: Date.now() + 3600000,
    expiresAt: Date.now() + 3600000,
    sessionToken: `token-${account}`,
    role,
    access_status: access,
  }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
  // #247: the device library belongs to the first account signed in on this test device.
  if (!localStorage.getItem(OWNER_KEY)) bindOwner(localStorage, account)
  return value
}

function persist() {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library))
}

function sourceResponse() {
  return response({
    success: true,
    userId: 'account-edge-admin',
    cloudRecord: {
      userId: 'account-edge-admin',
      version,
      checksum: computeSongbookChecksum(cloud),
      data: cloud,
    },
  })
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.sessionStorage = dom.window.sessionStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }

  library = {
    version: 1,
    songs: [
      { id: 'song-1', title: 'Alpha', artist: 'Artist A', rawContent: 'C\nAlpha chords', format: 'CHORD_PRO' },
      { id: 'song-2', title: 'Beta', artist: 'Artist B', rawContent: 'G\nBeta chords', format: 'TWO_LINE' },
    ],
    setlists: [
      {
        id: 'imported-set-1',
        name: 'TEST 10212026',
        songs: [{ id: 'song-1', title: 'Alpha' }, { id: 'song-2', title: 'Beta' }],
        catalogSource: {
          environmentScope: 'https://gtar.test',
          setlistId: 'publication_1234567890123456',
          revision: 1,
        },
      },
    ],
  }
  cloud = structuredClone(library)
  version = 4
  calls = []
  session()
  persist()

  responder = (url) => {
    if (url === '/api/songbook/sync') return sourceResponse()
    return response({ setlists: [] })
  }

  global.fetch = async (url, options = {}) => {
    calls.push({ url, ...options })
    return responder(url, options)
  }
})

afterEach(async () => {
  if (root) {
    await act(async () => { root.unmount() })
    root = null
  }
  dom.window.close()
})

test('resolveSetlistPublicationStatus identifies imported catalog setlists as IMPORTED_FROM_CATALOG', () => {
  const importedSetlist = library.setlists[0]
  const status = resolveSetlistPublicationStatus({
    setlist: importedSetlist,
    songs: library.songs,
    isOnline: true,
    catalogEnabled: true,
    publishedSetlists: [],
  })

  assert.equal(status, 'IMPORTED_FROM_CATALOG')
  const descriptor = SETLIST_STATUS_DESCRIPTORS[status]
  assert.equal(descriptor.title, 'Imported from Shared Catalog')
  assert.equal(descriptor.ariaLabel, 'Imported from Shared Catalog')
})

test('resolveSetlistPublicationStatus preserves offline/unverified state for published and imported setlists', () => {
  const importedSetlist = library.setlists[0]

  const statusImportedOffline = resolveSetlistPublicationStatus({
    setlist: importedSetlist,
    songs: library.songs,
    isOnline: false,
  })
  assert.equal(statusImportedOffline, 'IMPORTED_FROM_CATALOG')

  const publishedLocalLink = {
    account: 'account-edge-admin',
    sourceId: 'imported-set-1',
    result: { id, revision: 1, unpublished: false },
    snapshot: snapshotFromSongbook(library, 'imported-set-1'),
  }
  const statusPublishedOffline = resolveSetlistPublicationStatus({
    setlist: importedSetlist,
    songs: library.songs,
    isOnline: false,
    localLink: publishedLocalLink,
  })
  assert.equal(statusPublishedOffline, 'UNKNOWN_OR_OFFLINE')
})

test('resolveSetlistPublicationStatus distinguishes own published setlists from imported copies', () => {
  const snapshot = snapshotFromSongbook(library, 'imported-set-1')
  const confirmedLink = {
    account: 'account-edge-admin',
    sourceId: 'imported-set-1',
    result: { id, revision: 1, unpublished: false },
    snapshot,
  }

  const catalogPublications = [
    {
      id,
      name: 'TEST 10212026',
      revision: 1,
      occurrences: 2,
      updated_at: '2026-10-21T07:00:00.000Z',
    },
  ]

  const statusConfirmed = resolveSetlistPublicationStatus({
    setlist: library.setlists[0],
    songs: library.songs,
    isOnline: true,
    catalogEnabled: true,
    publishedSetlists: catalogPublications,
    localLink: confirmedLink,
  })
  assert.equal(statusConfirmed, 'CONFIRMED_PUBLISHED')

  const modifiedSetlist = {
    ...library.setlists[0],
    name: 'TEST 10212026 (Modified)',
  }
  const statusPending = resolveSetlistPublicationStatus({
    setlist: modifiedSetlist,
    songs: library.songs,
    isOnline: true,
    catalogEnabled: true,
    publishedSetlists: catalogPublications,
    localLink: confirmedLink,
  })
  assert.equal(statusPending, 'LOCAL_CHANGES_NOT_PUBLISHED')
})

test('SetlistCloudStatusBadge renders accessible popover without native title tooltip and supports interaction', async () => {
  const importedSetlist = library.setlists[0]
  const container = document.getElementById('root')
  root = createRoot(container)

  await act(async () => {
    root.render(
      React.createElement(SetlistCloudStatusBadge, {
        status: 'IMPORTED_FROM_CATALOG',
        setlistId: 'imported-set-1',
        setlist: importedSetlist,
      })
    )
  })

  const button = container.querySelector('[data-status="IMPORTED_FROM_CATALOG"]')
  assert.ok(button, 'Interactive button with data-status exists')

  assert.equal(button.getAttribute('title'), null, 'Native title attribute must not be present')
  assert.equal(button.getAttribute('aria-expanded'), 'false')

  await act(async () => {
    button.click()
  })
  assert.equal(button.getAttribute('aria-expanded'), 'true')

  assert.ok(document.body.textContent.includes('Imported from Shared Catalog'))
  assert.ok(document.body.textContent.includes('Independent personal copy'))
  assert.ok(document.body.textContent.includes('Revision 1'))

  await act(async () => {
    button.click()
  })
  assert.equal(button.getAttribute('aria-expanded'), 'false')
})

test('preparePublication throws actionable Cloud Sync error instead of ambiguous source error when local has unsynced imported setlist', async () => {
  cloud = {
    version: 1,
    songs: library.songs,
    setlists: [],
  }

  await assert.rejects(
    async () => {
      await api.preparePublication('imported-set-1', () => library, () => false)
    },
    (err) => {
      assert.ok(err instanceof Error)
      assert.ok(
        err.message.includes('Local and cloud versions differ. Use existing Cloud Sync'),
        `Unexpected error message: ${err.message}`
      )
      assert.ok(!err.message.includes('Missing or ambiguous source setlist'))
      return true
    }
  )
})

test('preparePublication creates independent new publication preview when imported copy is synced to cloud', async () => {
  const preview = await api.preparePublication('imported-set-1', () => library, () => false)

  assert.equal(preview.account, 'account-edge-admin')
  assert.equal(preview.sourceId, 'imported-set-1')
  assert.equal(preview.version, 4)
  assert.equal(preview.snapshot.name, 'TEST 10212026')
  assert.equal(preview.snapshot.entries.length, 2)
  assert.deepEqual(preview.snapshot.entries.map(s => s.title), ['Alpha', 'Beta'])
})

test('preparePublication fails closed if local source setlist is truly missing', async () => {
  await assert.rejects(
    async () => {
      await api.preparePublication('non-existent-setlist-999', () => library, () => false)
    },
    (err) => {
      assert.ok(err instanceof Error)
      assert.ok(
        err.message.includes('Missing or ambiguous source setlist'),
        `Unexpected error message: ${err.message}`
      )
      return true
    }
  )
})
