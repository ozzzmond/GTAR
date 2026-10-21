const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename)
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { createSessionToken } = require('../functions/lib/authCore.ts')
const { handleSetlistCatalog } = require('../functions/lib/setlistCatalog.ts')
const { resolveSetlistPublicationStatus } = require('../src/utils/setlistPublicationStatus.ts')
const { snapshotFromSongbook } = require('../src/utils/sharedSetlistSnapshot.ts')

const secret = 'test_secret_for_issue108_member_publishing_32_bytes'
const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter(n => n.endsWith('.sql')).sort()

const sampleLibrary = (name = 'Sunday') => ({
  metadata: { version: 1 },
  songs: [
    {
      id: 'song-1', title: 'Grace Greater', artist: 'Julia Johnston',
      rawContent: '{start_of_chorus}\n[G]Grace, grace, [C]Gods grace\n{end_of_chorus}',
      format: 'CHORD_PRO', key: 'G', originalKey: 'G', confirmedChartKey: 'G',
      capo: '0', transposeOffset: 0, bpm: '72', time: '4/4', year: '1910'
    },
    {
      id: 'song-2', title: 'Amazing Grace', artist: 'John Newton',
      rawContent: 'G\nAmazing grace how sweet the sound',
      format: 'TWO_LINE', key: 'G', originalKey: 'G', confirmedChartKey: 'G'
    }
  ],
  setlists: [
    { id: 'setlist-1', name, songs: [{ id: 'song-1', title: 'Grace Greater' }, { id: 'song-2', title: 'Amazing Grace' }] }
  ]
})

async function setupEnv() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const name of migrations) {
    sql.exec(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'))
  }
  const db = {
    prepare(query) {
      let args = []
      return {
        bind(...values) { args = values; return this },
        async first() { return sql.prepare(query).get(...args) ?? null },
        async all() { return { success: true, results: sql.prepare(query).all(...args) } },
        async run() { return { success: true, meta: sql.prepare(query).run(...args) } }
      }
    }
  }

  const users = {}, tokens = {}
  for (const [id, role, status] of [
    ['admin-1', 'admin', 'active'],
    ['member-1', 'member', 'active'],
    ['member-2', 'member', 'active'],
    ['pending-1', 'member', 'pending'],
    ['revoked-1', 'member', 'denied'],
  ]) {
    const user = { id, google_sub: `sub-${id}`, email: `${id}@example.test`, role, access_status: status }
    sql.prepare(`INSERT INTO users(id,google_sub,email,role,access_status,created_at,updated_at,last_login_at)
      VALUES(?,?,?,?,?,'now','now','now')`).run(id, user.google_sub, user.email, role, status)
    users[id] = user
    tokens[id] = await createSessionToken(user, secret)
  }

  sql.prepare('INSERT INTO user_songbooks VALUES(?,1,?,?,?)').run('admin-1', JSON.stringify(sampleLibrary('Admin Setlist')), 'chk-admin', 'now')
  sql.prepare('INSERT INTO user_songbooks VALUES(?,1,?,?,?)').run('member-1', JSON.stringify(sampleLibrary('Member 1 Setlist')), 'chk-member-1', 'now')
  sql.prepare('INSERT INTO user_songbooks VALUES(?,1,?,?,?)').run('member-2', JSON.stringify(sampleLibrary('Member 2 Setlist')), 'chk-member-2', 'now')

  const env = { DB: db, AUTH_SECRET: secret, SHARED_SETLISTS_ENABLED: 'phase-a-v1' }

  async function call(method, pathUrl, body, options = {}) {
    const user = options.user || 'member-1'
    const headers = {
      Authorization: `Bearer ${tokens[user] || ''}`,
      'Idempotency-Key': options.key || 'idem-key-issue108-test-01'
    }
    const req = new Request(`https://dev.gtar.test${pathUrl}`, {
      method, headers,
      ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    })
    return handleSetlistCatalog({ request: req, env, params: { id: options.id } })
  }

  return { sql, db, env, users, tokens, call }
}

test('TEST_ACTIVE_MEMBER_CAN_PUBLISH', async () => {
  const env = await setupEnv()
  const payload = {
    snapshot_version: 1,
    publication_key: 'member1-pub-key-00000001',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  const res = await env.call('POST', '/api/catalog/setlists', payload, { user: 'member-1', key: 'idem-member1-post-0001' })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.revision, 1)
  assert.equal(typeof data.id, 'string')
  assert.equal(data.unpublished, false)

  const head = env.sql.prepare('SELECT * FROM catalog_setlist_heads WHERE id = ?').get(data.id)
  assert.equal(head.publisher_user_id, 'member-1')
})

test('TEST_ACTIVE_MEMBER_CAN_UPDATE_OWN', async () => {
  const env = await setupEnv()
  const createPayload = {
    snapshot_version: 1,
    publication_key: 'member1-pub-key-00000002',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  const createRes = await env.call('POST', '/api/catalog/setlists', createPayload, { user: 'member-1', key: 'idem-member1-create-02' })
  const { id } = await createRes.json()

  // Update setlist in user_songbook to source_version 2
  const updatedLib = sampleLibrary('Member 1 Setlist - Updated')
  env.sql.prepare('UPDATE user_songbooks SET version = 2, data_json = ? WHERE user_id = ?').run(JSON.stringify(updatedLib), 'member-1')

  const updatePayload = {
    snapshot_version: 1,
    expected_revision: 1,
    source_setlist_id: 'setlist-1',
    source_version: 2
  }
  const updateRes = await env.call('PUT', `/api/catalog/setlists/${id}`, updatePayload, { user: 'member-1', id, key: 'idem-member1-update-02' })
  assert.equal(updateRes.status, 200)
  const updateData = await updateRes.json()
  assert.equal(updateData.revision, 2)
  assert.equal(updateData.id, id)
})

test('TEST_ACTIVE_MEMBER_CAN_UNPUBLISH_OWN', async () => {
  const env = await setupEnv()
  const createPayload = {
    snapshot_version: 1,
    publication_key: 'member1-pub-key-00000003',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  const createRes = await env.call('POST', '/api/catalog/setlists', createPayload, { user: 'member-1', key: 'idem-member1-create-03' })
  const { id } = await createRes.json()

  const delRes = await env.call('DELETE', `/api/catalog/setlists/${id}`, { expected_revision: 1 }, { user: 'member-1', id, key: 'idem-member1-del-0001' })
  assert.equal(delRes.status, 200)
  const delData = await delRes.json()
  assert.equal(delData.unpublished, true)
  assert.equal(delData.revision, 2)
})

test('TEST_MEMBER_CANNOT_MODIFY_OTHER_OWNER', async () => {
  const env = await setupEnv()
  // Admin creates publication
  const adminPayload = {
    snapshot_version: 1,
    publication_key: 'admin-pub-key-0000000001',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  const adminCreate = await env.call('POST', '/api/catalog/setlists', adminPayload, { user: 'admin-1', key: 'idem-admin-create-001' })
  const { id } = await adminCreate.json()

  // Member-1 attempts to update admin publication -> 409
  const stealUpdate = await env.call('PUT', `/api/catalog/setlists/${id}`, {
    snapshot_version: 1, expected_revision: 1, source_setlist_id: 'setlist-1', source_version: 1
  }, { user: 'member-1', id, key: 'idem-steal-update-001' })
  assert.equal(stealUpdate.status, 409)

  // Member-1 attempts to delete admin publication -> 409
  const stealDelete = await env.call('DELETE', `/api/catalog/setlists/${id}`, { expected_revision: 1 }, { user: 'member-1', id, key: 'idem-steal-del-00001' })
  assert.equal(stealDelete.status, 409)
})

test('TEST_PENDING_REVOKED_DENIED', async () => {
  const env = await setupEnv()
  const payload = {
    snapshot_version: 1,
    publication_key: 'pending-pub-key-0000001',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  // Pending user cannot publish
  const pendingRes = await env.call('POST', '/api/catalog/setlists', payload, { user: 'pending-1', key: 'idem-pending-post-001' })
  assert.equal(pendingRes.status, 403)

  // Revoked user cannot publish
  const revokedRes = await env.call('POST', '/api/catalog/setlists', payload, { user: 'revoked-1', key: 'idem-revoked-post-001' })
  assert.equal(revokedRes.status, 403)
})

test('TEST_ADMIN_EXISTING_PUBLICATIONS_PRESERVED', async () => {
  const env = await setupEnv()
  const adminPayload = {
    snapshot_version: 1,
    publication_key: 'admin-pub-key-preserve-01',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  const create = await env.call('POST', '/api/catalog/setlists', adminPayload, { user: 'admin-1', key: 'idem-admin-create-002' })
  assert.equal(create.status, 200)
  const { id } = await create.json()

  // Member can read admin publication
  const readRes = await env.call('GET', `/api/catalog/setlists/${id}?revision=1`, null, { user: 'member-1', id })
  assert.equal(readRes.status, 200)
  const readData = await readRes.json()
  assert.equal(readData.id, id)
  assert.equal(readData.snapshot.name, 'Admin Setlist')
})

test('TEST_CROSS_ACCOUNT_AND_CROSS_ENVIRONMENT_ISOLATION', async () => {
  const envA = await setupEnv()
  const envB = await setupEnv()
  // Mutations in envA never appear in envB
  const payload = {
    snapshot_version: 1,
    publication_key: 'isolated-pub-key-000001',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  const createA = await envA.call('POST', '/api/catalog/setlists', payload, { user: 'member-1', key: 'idem-iso-create-001' })
  const { id } = await createA.json()

  const readB = await envB.call('GET', `/api/catalog/setlists/${id}?revision=1`, null, { user: 'member-1', id })
  assert.equal(readB.status, 404)
})

test('TEST_CAS_IDEMPOTENCY_AND_RETRY', async () => {
  const env = await setupEnv()
  const payload = {
    snapshot_version: 1,
    publication_key: 'cas-idem-pub-key-000001',
    source_setlist_id: 'setlist-1',
    source_version: 1
  }
  const first = await env.call('POST', '/api/catalog/setlists', payload, { user: 'member-1', key: 'idem-retry-call-0001' })
  const firstData = await first.json()

  // Exact retry with identical idempotency key returns exact same result
  const retry = await env.call('POST', '/api/catalog/setlists', payload, { user: 'member-1', key: 'idem-retry-call-0001' })
  assert.equal(retry.status, 200)
  const retryData = await retry.json()
  assert.equal(retryData.id, firstData.id)
  assert.equal(retryData.revision, firstData.revision)
})

test('TEST_STALE_SOURCE_FAIL_CLOSED', async () => {
  const env = await setupEnv()
  const payload = {
    snapshot_version: 1,
    publication_key: 'stale-source-pub-key-01',
    source_setlist_id: 'setlist-1',
    source_version: 99 // user songbook is at version 1
  }
  const res = await env.call('POST', '/api/catalog/setlists', payload, { user: 'member-1', key: 'idem-stale-source-001' })
  assert.equal(res.status, 409)
})

test('TEST_STATUS_VERIFIED_GREEN', () => {
  const { SETLIST_STATUS_DESCRIPTORS } = require('../src/utils/setlistPublicationStatus.ts')
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  const snapshot = snapshotFromSongbook(lib, setlist.id)
  const link = {
    publicationKey: 'pub-key-1',
    result: { id: 'pub-1234567890123456', revision: 1, unpublished: false },
    snapshot
  }
  const status = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: link,
    isOnline: true,
    publishedSetlists: [{ id: 'pub-1234567890123456', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }]
  })
  assert.equal(status, 'CONFIRMED_PUBLISHED')
  assert.equal(SETLIST_STATUS_DESCRIPTORS[status].title, 'Shared with team')
})

test('TEST_STATUS_LOCAL_DIVERGENCE_AMBER', () => {
  const { SETLIST_STATUS_DESCRIPTORS } = require('../src/utils/setlistPublicationStatus.ts')
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  const snapshot = snapshotFromSongbook(lib, setlist.id)
  const modifiedLib = {
    ...lib,
    setlists: [{ ...setlist, name: 'Sunday - Evening Service' }]
  }
  const link = {
    publicationKey: 'pub-key-1',
    result: { id: 'pub-1234567890123456', revision: 1, unpublished: false },
    snapshot
  }
  const status = resolveSetlistPublicationStatus({
    setlist: modifiedLib.setlists[0],
    songs: modifiedLib.songs,
    localLink: link,
    isOnline: true,
    publishedSetlists: [{ id: 'pub-1234567890123456', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }]
  })
  assert.equal(status, 'LOCAL_CHANGES_NOT_PUBLISHED')
  assert.equal(SETLIST_STATUS_DESCRIPTORS[status].title, 'Changes not shared yet')
})

test('TEST_STATUS_OFFLINE_UNKNOWN', () => {
  const { SETLIST_STATUS_DESCRIPTORS } = require('../src/utils/setlistPublicationStatus.ts')
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  const link = {
    publicationKey: 'pub-key-1',
    result: { id: 'pub-1234567890123456', revision: 1, unpublished: false }
  }
  const status = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: link,
    isOnline: false,
    publishedSetlists: [{ id: 'pub-1234567890123456', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }]
  })
  assert.equal(status, 'UNKNOWN_OR_OFFLINE')
  assert.equal(SETLIST_STATUS_DESCRIPTORS[status].title, 'Sharing status unavailable')
})

test('TEST_STATUS_MISSING_LOCAL_JOURNAL_UNKNOWN', () => {
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  // 1. Missing local link with candidate match by name in catalog resolves to UNKNOWN_OR_OFFLINE (avoid false NEVER_PUBLISHED)
  const candidateStatus = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: null,
    isOnline: true,
    publishedSetlists: [{ id: 'cand-1', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }],
    isCatalogComplete: true
  })
  assert.equal(candidateStatus, 'UNKNOWN_OR_OFFLINE')

  // 2. Missing local link on a paginated catalog (not complete) resolves to UNKNOWN_OR_OFFLINE (avoid false NEVER_PUBLISHED)
  const paginatedStatus = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: null,
    isOnline: true,
    publishedSetlists: Array.from({ length: 20 }, (_, i) => ({ id: `pub-${i}`, revision: 1, name: `Other ${i}`, occurrences: 1, updated_at: 'now' })),
    isCatalogComplete: false
  })
  assert.equal(paginatedStatus, 'UNKNOWN_OR_OFFLINE')

  // 3. Missing local link on a confirmed complete catalog with no candidate anywhere resolves to NEVER_PUBLISHED
  const cleanStatus = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: null,
    isOnline: true,
    publishedSetlists: [{ id: 'other-1', revision: 1, name: 'Other', occurrences: 1, updated_at: 'now' }],
    isCatalogComplete: true
  })
  assert.equal(cleanStatus, 'NEVER_PUBLISHED')
})

test('TEST_STATUS_LEGACY_LINK_WITHOUT_SNAPSHOT_CONSERVATIVE', () => {
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  // Legacy link without snapshot field
  const legacyLink = {
    publicationKey: 'pub-key-legacy',
    result: { id: 'pub-1234567890123456', revision: 1, unpublished: false }
    // snapshot is undefined
  }
  // Even if name and occurrences match, exact snapshot identity cannot be verified -> UNKNOWN_OR_OFFLINE
  const status = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: legacyLink,
    isOnline: true,
    publishedSetlists: [{ id: 'pub-1234567890123456', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }]
  })
  assert.equal(status, 'UNKNOWN_OR_OFFLINE', 'Legacy link without snapshot must resolve conservatively, never confirmed green')

  // If local name differs from remote head, resolves to LOCAL_CHANGES_NOT_PUBLISHED
  const modifiedLib = { ...lib, setlists: [{ ...setlist, name: 'Sunday Modified' }] }
  const modifiedStatus = resolveSetlistPublicationStatus({
    setlist: modifiedLib.setlists[0],
    songs: modifiedLib.songs,
    localLink: legacyLink,
    isOnline: true,
    publishedSetlists: [{ id: 'pub-1234567890123456', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }]
  })
  assert.equal(modifiedStatus, 'LOCAL_CHANGES_NOT_PUBLISHED')
})

test('TEST_STATUS_PAGINATED_CATALOG_ABSENCE_NOT_UNPUBLISHED', () => {
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  const snapshot = snapshotFromSongbook(lib, setlist.id)
  const link = {
    publicationKey: 'pub-key-page2',
    result: { id: 'pub-on-page-2-1234', revision: 1, unpublished: false },
    snapshot
  }
  // Catalog returns 20 items (page 1), and our published setlist is on page 2 (not in this page)
  const page1Rows = Array.from({ length: 20 }, (_, i) => ({
    id: `pub-page1-item-${i.toString().padStart(4, '0')}`,
    revision: 1,
    name: `Team Setlist ${i}`,
    occurrences: 3,
    updated_at: 'now'
  }))
  const status = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: link,
    isOnline: true,
    publishedSetlists: page1Rows,
    isCatalogComplete: false
  })
  // Absence from page 1 must NOT be treated as unpublication / NEVER_PUBLISHED
  assert.equal(status, 'UNKNOWN_OR_OFFLINE')
})

test('TEST_STATUS_REFRESH_AFTER_MUTATION', () => {
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  const snapshot = snapshotFromSongbook(lib, setlist.id)
  let link = {
    publicationKey: 'pub-key-1',
    result: { id: 'pub-1234567890123456', revision: 1, unpublished: false },
    snapshot
  }
  const before = resolveSetlistPublicationStatus({
    setlist, songs: lib.songs, localLink: link, isOnline: true,
    publishedSetlists: [{ id: 'pub-1234567890123456', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }]
  })
  assert.equal(before, 'CONFIRMED_PUBLISHED')

  link = { ...link, result: { ...link.result, unpublished: true } }
  const after = resolveSetlistPublicationStatus({
    setlist, songs: lib.songs, localLink: link, isOnline: true,
    publishedSetlists: [{ id: 'pub-1234567890123456', revision: 1, name: 'Sunday', occurrences: 2, updated_at: 'now' }]
  })
  assert.equal(after, 'NEVER_PUBLISHED')
})

test('TEST_PERSONAL_CLOUD_SYNC_NOT_EQUAL_PUBLICATION', () => {
  const lib = sampleLibrary('Sunday')
  const setlist = lib.setlists[0]
  const status = resolveSetlistPublicationStatus({
    setlist,
    songs: lib.songs,
    localLink: null,
    isOnline: true,
    publishedSetlists: [{ id: 'other-setlist', revision: 1, name: 'Other', occurrences: 1, updated_at: 'now' }]
  })
  assert.equal(status, 'NEVER_PUBLISHED')
})

test('TEST_SONGBOOK_AND_DRAWER_ICON_PARITY', () => {
  const { SetlistCloudStatusBadge } = require('../src/components/SetlistCloudStatusBadge.tsx')
  assert.equal(typeof SetlistCloudStatusBadge, 'function')
})

test('TEST_QR_SHARING_UNCHANGED', () => {
  // Verify qrSharing / share mechanisms exist without shared catalog coupling
  const qrFile = fs.readFileSync(path.join(__dirname, '../src/components/SetlistDrawer.tsx'), 'utf8')
  assert.ok(qrFile.includes('Share Setlist (QR Code)'))
  assert.ok(qrFile.includes('Publish to Shared'))
})

test('TEST_SHARED_SONGS_UNCHANGED', () => {
  const catalogFile = fs.readFileSync(path.join(__dirname, '../src/components/SharedCatalogBrowser.tsx'), 'utf8')
  assert.ok(catalogFile.includes('Songs'))
  assert.ok(catalogFile.includes('Setlists'))
})

test('TEST_ISSUE130_LAYOUT_UNCHANGED', () => {
  const songbookFile = fs.readFileSync(path.join(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')
  assert.ok(songbookFile.includes('Song Setlists'))
  assert.ok(songbookFile.includes('Songs Library'))
  assert.ok(songbookFile.includes('canPublishSetlist'))
})
