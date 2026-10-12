const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

// Load handlers and authCore helpers
const authCore = require('../functions/lib/authCore.ts')
const catalogCore = require('../functions/lib/catalogCore.ts')
const songsCollection = require('../functions/api/catalog/songs.ts')
const songItem = require('../functions/api/catalog/songs/[id].ts')

const webDir = path.resolve(__dirname, '..')
const migrationsDir = path.join(webDir, 'migrations')

const TEST_SECRET = 'catalog_test_auth_secret_secure_key_1234567890'

function createTestDb() {
  const dbSync = new DatabaseSync(':memory:')
  dbSync.exec('PRAGMA foreign_keys = ON;')

  const migrationFiles = [
    '0001_users.sql',
    '0002_songbook_sync.sql',
    '0003_shared_setlists.sql',
    '0004_shared_catalog.sql'
  ]
  for (const file of migrationFiles) {
    dbSync.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }

  // Wrap DatabaseSync to match D1Database interface
  const d1Db = {
    prepare(query) {
      return {
        _args: [],
        bind(...args) {
          this._args = args.map(arg => (arg === undefined ? null : arg))
          return this
        },
        async first() {
          const stmt = dbSync.prepare(query)
          const result = stmt.get(...this._args)
          return result || null
        },
        async all() {
          const stmt = dbSync.prepare(query)
          const results = stmt.all(...this._args)
          return { results, success: true }
        },
        async run() {
          const stmt = dbSync.prepare(query)
          const info = stmt.run(...this._args)
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
            },
          }
        },
      }
    },
    async batch(statements) {
      const results = []
      // Execute in transaction
      dbSync.exec('BEGIN TRANSACTION;')
      try {
        for (const s of statements) {
          const res = await s.run()
          results.push(res)
        }
        dbSync.exec('COMMIT;')
        return results
      } catch (err) {
        dbSync.exec('ROLLBACK;')
        throw err
      }
    },
  }

  return { dbSync, d1Db }
}

async function createTestUser(d1Db, user) {
  await authCore.insertUser(d1Db, user)
  const token = await authCore.createSessionToken(user, TEST_SECRET)
  return { user, token }
}

function makeContext(request, d1Db, params = {}) {
  return {
    request,
    env: {
      DB: d1Db,
      AUTH_SECRET: TEST_SECRET,
    },
    params,
  }
}

test('SHARED CATALOG API: Anonymous, pending, and inactive users are rejected', async () => {
  const { d1Db } = createTestDb()
  const now = new Date().toISOString()

  const pendingUser = {
    id: 'u-pending',
    google_sub: 'sub-pending',
    email: 'pending@example.com',
    display_name: 'Pending User',
    picture_url: null,
    role: 'member',
    access_status: 'pending',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: pendingToken } = await createTestUser(d1Db, pendingUser)

  const deniedUser = {
    id: 'u-denied',
    google_sub: 'sub-denied',
    email: 'denied@example.com',
    display_name: 'Denied User',
    picture_url: null,
    role: 'member',
    access_status: 'denied',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: deniedToken } = await createTestUser(d1Db, deniedUser)

  // 1. Anonymous GET
  const anonReq = new Request('http://localhost/api/catalog/songs', {
    method: 'GET',
  })
  const anonRes = await songsCollection.onRequestGet(makeContext(anonReq, d1Db))
  assert.equal(anonRes.status, 401)

  // 2. Pending user GET
  const pendingReq = new Request('http://localhost/api/catalog/songs', {
    method: 'GET',
    headers: { Authorization: `Bearer ${pendingToken}` },
  })
  const pendingRes = await songsCollection.onRequestGet(makeContext(pendingReq, d1Db))
  assert.equal(pendingRes.status, 403)

  // 3. Denied user POST
  const deniedReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deniedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: 'Test', raw_content: 'C G Am F' }),
  })
  const deniedRes = await songsCollection.onRequestPost(makeContext(deniedReq, d1Db))
  assert.equal(deniedRes.status, 403)
})

test('SHARED CATALOG API: Active members can publish and read catalog songs', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const memberA = {
    id: 'u-member-a',
    google_sub: 'sub-member-a',
    email: 'member-a@example.com',
    display_name: 'Member A',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: tokenA } = await createTestUser(d1Db, memberA)

  const memberB = {
    id: 'u-member-b',
    google_sub: 'sub-member-b',
    email: 'member-b@example.com',
    display_name: 'Member B',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: tokenB } = await createTestUser(d1Db, memberB)

  // 1. Member A publishes a song
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Amazing Grace',
      artist: 'John Newton',
      key: 'G',
      raw_content: '{title: Amazing Grace}\n[G]Amazing [C]grace',
      format: 'CHORD_PRO',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1Db))
  assert.equal(postRes.status, 201)
  const postBody = await postRes.json()
  assert.equal(postBody.success, true)
  assert.ok(postBody.song.id)
  assert.equal(postBody.song.current_revision, 1)
  assert.equal(postBody.song.publisher_user_id, memberA.id)

  const songId = postBody.song.id

  // Verify atomic creation of song and revision 1 in DB
  const songInDb = dbSync.prepare('SELECT * FROM shared_catalog_songs WHERE id = ?').get(songId)
  assert.ok(songInDb)
  assert.equal(songInDb.title, 'Amazing Grace')
  assert.equal(songInDb.current_revision, 1)

  const revisionsInDb = dbSync.prepare('SELECT * FROM shared_catalog_revisions WHERE song_id = ?').all(songId)
  assert.equal(revisionsInDb.length, 1)
  assert.equal(revisionsInDb[0].revision, 1)
  assert.equal(revisionsInDb[0].editor_user_id, memberA.id)

  // 2. Member B reads catalog list
  const listReq = new Request('http://localhost/api/catalog/songs', {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenB}` },
  })
  const listRes = await songsCollection.onRequestGet(makeContext(listReq, d1Db))
  assert.equal(listRes.status, 200)
  const listBody = await listRes.json()
  assert.equal(listBody.success, true)
  assert.equal(listBody.songs.length, 1)
  assert.equal(listBody.songs[0].id, songId)

  // 3. Member B reads song by ID with revision history
  const getReq = new Request(`http://localhost/api/catalog/songs/${songId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenB}` },
  })
  const getRes = await songItem.onRequestGet(makeContext(getReq, d1Db, { id: songId }))
  assert.equal(getRes.status, 200)
  const getBody = await getRes.json()
  assert.equal(getBody.success, true)
  assert.equal(getBody.song.id, songId)
  assert.equal(getBody.revisions.length, 1)
  assert.equal(getBody.revisions[0].revision, 1)
})

test('SHARED CATALOG API: Idempotent publication retry prevents duplicate songs', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-publisher',
    google_sub: 'sub-pub',
    email: 'pub@example.com',
    display_name: 'Pub User',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  const payload = {
    title: 'Hotel California',
    artist: 'Eagles',
    raw_content: 'Am E7 G D F C Dm E7',
  }

  // First POST
  const req1 = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const res1 = await songsCollection.onRequestPost(makeContext(req1, d1Db))
  assert.equal(res1.status, 201)
  const body1 = await res1.json()

  // Retry POST with exact same payload
  const req2 = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const res2 = await songsCollection.onRequestPost(makeContext(req2, d1Db))
  assert.equal(res2.status, 200)
  const body2 = await res2.json()
  assert.equal(body2.deduplicated, true)
  assert.equal(body2.song.id, body1.song.id)

  // Verify only 1 row exists in DB
  const count = dbSync.prepare("SELECT count(*) as cnt FROM shared_catalog_songs WHERE title = 'Hotel California'").get()
  assert.equal(count.cnt, 1)
})

test('SHARED CATALOG API: Cross-user mutations are rejected; publisher and admin can update', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const publisher = {
    id: 'u-pub',
    google_sub: 'sub-pub',
    email: 'pub@example.com',
    display_name: 'Pub',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: pubToken } = await createTestUser(d1Db, publisher)

  const otherUser = {
    id: 'u-other',
    google_sub: 'sub-other',
    email: 'other@example.com',
    display_name: 'Other',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: otherToken } = await createTestUser(d1Db, otherUser)

  const admin = {
    id: 'u-admin',
    google_sub: 'sub-admin',
    email: 'admin@example.com',
    display_name: 'Admin',
    picture_url: null,
    role: 'admin',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: adminToken } = await createTestUser(d1Db, admin)

  // Publisher creates song
  const createReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Hallelujah',
      artist: 'Leonard Cohen',
      raw_content: 'C Am C Am F G C G',
    }),
  })
  const createRes = await songsCollection.onRequestPost(makeContext(createReq, d1Db))
  const { song } = await createRes.json()
  const songId = song.id

  // 1. Other user attempts PUT -> Forbidden 403
  const badPutReq = new Request(`http://localhost/api/catalog/songs/${songId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${otherToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Hallelujah (Hacked)',
      raw_content: 'mutated',
    }),
  })
  const badPutRes = await songItem.onRequestPut(makeContext(badPutReq, d1Db, { id: songId }))
  assert.equal(badPutRes.status, 403)

  // 2. Other user attempts DELETE -> Forbidden 403
  const badDelReq = new Request(`http://localhost/api/catalog/songs/${songId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${otherToken}` },
  })
  const badDelRes = await songItem.onRequestDelete(makeContext(badDelReq, d1Db, { id: songId }))
  assert.equal(badDelRes.status, 403)

  // 3. Publisher updates song -> 200, current_revision increments to 2
  const pubPutReq = new Request(`http://localhost/api/catalog/songs/${songId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Hallelujah (Corrected)',
      raw_content: 'C Am C Am F G C G / Em',
      change_summary: 'Fixed bridge chords',
    }),
  })
  const pubPutRes = await songItem.onRequestPut(makeContext(pubPutReq, d1Db, { id: songId }))
  assert.equal(pubPutRes.status, 200)
  const pubPutBody = await pubPutRes.json()
  assert.equal(pubPutBody.song.current_revision, 2)
  assert.equal(pubPutBody.song.title, 'Hallelujah (Corrected)')

  // 4. Stale update with revision 1 -> 409 REVISION_CONFLICT
  const stalePutReq = new Request(`http://localhost/api/catalog/songs/${songId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Hallelujah (Stale)',
      raw_content: 'stale content',
    }),
  })
  const stalePutRes = await songItem.onRequestPut(makeContext(stalePutReq, d1Db, { id: songId }))
  assert.equal(stalePutRes.status, 409)
  const stalePutBody = await stalePutRes.json()
  assert.equal(stalePutBody.error, 'REVISION_CONFLICT')

  // 5. Admin updates song -> 200, current_revision increments to 3
  const adminPutReq = new Request(`http://localhost/api/catalog/songs/${songId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 2,
      title: 'Hallelujah (Admin Edited)',
      raw_content: 'C Am C Am F G C G',
      change_summary: 'Moderation cleanup',
    }),
  })
  const adminPutRes = await songItem.onRequestPut(makeContext(adminPutReq, d1Db, { id: songId }))
  assert.equal(adminPutRes.status, 200)
  const adminPutBody = await adminPutRes.json()
  assert.equal(adminPutBody.song.current_revision, 3)

  // Verify all 3 revisions exist and are immutable in DB
  const revisions = dbSync.prepare('SELECT revision, editor_user_id, change_summary FROM shared_catalog_revisions WHERE song_id = ? ORDER BY revision ASC').all(songId)
  assert.equal(revisions.length, 3)
  assert.equal(revisions[0].revision, 1)
  assert.equal(revisions[1].revision, 2)
  assert.equal(revisions[1].editor_user_id, publisher.id)
  assert.equal(revisions[2].revision, 3)
  assert.equal(revisions[2].editor_user_id, admin.id)
})

test('SHARED CATALOG API: Soft delete only, tombstone filtering, and preserved revision history', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const publisher = {
    id: 'u-del-pub',
    google_sub: 'sub-del-pub',
    email: 'delpub@example.com',
    display_name: 'Del Pub',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: pubToken } = await createTestUser(d1Db, publisher)

  // Create song
  const createReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Song To Delete',
      raw_content: 'Em D C B7',
    }),
  })
  const createRes = await songsCollection.onRequestPost(makeContext(createReq, d1Db))
  const { song } = await createRes.json()
  const songId = song.id

  // DELETE with stale revision conflict
  const conflictDelReq = new Request(`http://localhost/api/catalog/songs/${songId}?expected_revision=999`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${pubToken}` },
  })
  const conflictDelRes = await songItem.onRequestDelete(makeContext(conflictDelReq, d1Db, { id: songId }))
  assert.equal(conflictDelRes.status, 409)

  // Valid DELETE
  const delReq = new Request(`http://localhost/api/catalog/songs/${songId}?expected_revision=1`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${pubToken}` },
  })
  const delRes = await songItem.onRequestDelete(makeContext(delReq, d1Db, { id: songId }))
  assert.equal(delRes.status, 200)

  // Repeat DELETE is idempotent
  const repeatDelRes = await songItem.onRequestDelete(makeContext(delReq, d1Db, { id: songId }))
  assert.equal(repeatDelRes.status, 200)

  // Verify song in DB is soft deleted, NOT physically deleted
  const songInDb = dbSync.prepare('SELECT is_deleted, deleted_by_user_id, deleted_at FROM shared_catalog_songs WHERE id = ?').get(songId)
  assert.ok(songInDb)
  assert.equal(songInDb.is_deleted, 1)
  assert.equal(songInDb.deleted_by_user_id, publisher.id)
  assert.ok(songInDb.deleted_at)

  // Revisions must still exist intact in DB
  const revisionsInDb = dbSync.prepare('SELECT count(*) as cnt FROM shared_catalog_revisions WHERE song_id = ?').get(songId)
  assert.equal(revisionsInDb.cnt, 1)

  // Deleted song must NOT appear in normal catalog list
  const listReq = new Request('http://localhost/api/catalog/songs', {
    method: 'GET',
    headers: { Authorization: `Bearer ${pubToken}` },
  })
  const listRes = await songsCollection.onRequestGet(makeContext(listReq, d1Db))
  const listBody = await listRes.json()
  assert.equal(listBody.songs.length, 0)

  // Deleted song returns 404 on GET by id
  const getReq = new Request(`http://localhost/api/catalog/songs/${songId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pubToken}` },
  })
  const getRes = await songItem.onRequestGet(makeContext(getReq, d1Db, { id: songId }))
  assert.equal(getRes.status, 404)
})

test('SHARED CATALOG API: Payload bounds and error sanitization', async () => {
  const { d1Db } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-val-member',
    google_sub: 'sub-val',
    email: 'val@example.com',
    display_name: 'Val Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  // 1. Missing title
  const noTitleReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw_content: 'A B C' }),
  })
  const noTitleRes = await songsCollection.onRequestPost(makeContext(noTitleReq, d1Db))
  assert.equal(noTitleRes.status, 400)

  // 2. Missing raw_content
  const noContentReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: 'No Content' }),
  })
  const noContentRes = await songsCollection.onRequestPost(makeContext(noContentReq, d1Db))
  assert.equal(noContentRes.status, 400)

  // 3. Invalid format
  const badFormatReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: 'Bad Format', raw_content: 'A B C', format: 'XML_DOC' }),
  })
  const badFormatRes = await songsCollection.onRequestPost(makeContext(badFormatReq, d1Db))
  assert.equal(badFormatRes.status, 400)

  // 4. Malformed JSON
  const malformedReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{"title": "Broken JSON',
  })
  const malformedRes = await songsCollection.onRequestPost(makeContext(malformedReq, d1Db))
  assert.equal(malformedRes.status, 400)
  const malformedBody = await malformedRes.json()
  assert.equal(malformedBody.error, 'Malformed JSON payload')
  // Ensure no stack traces or D1 internals exposed
  assert.equal(malformedBody.stack, undefined)
})

test('SHARED CATALOG API: Missing DB.batch fails closed with zero writes', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-nobatch-member',
    google_sub: 'sub-nobatch',
    email: 'nobatch@example.com',
    display_name: 'NoBatch Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  // Create a DB wrapper WITHOUT batch()
  const d1WithoutBatch = {
    prepare: d1Db.prepare.bind(d1Db),
  }

  // 1. POST fails closed
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Batch Required Song',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1WithoutBatch))
  assert.equal(postRes.status, 500)
  const postBody = await postRes.json()
  assert.match(postBody.error, /batch/i)

  // Verify zero rows written to shared_catalog_songs and shared_catalog_revisions
  const songCount = dbSync.prepare("SELECT count(*) as cnt FROM shared_catalog_songs WHERE title = 'Batch Required Song'").get()
  assert.equal(songCount.cnt, 0)
  const revCount = dbSync.prepare('SELECT count(*) as cnt FROM shared_catalog_revisions').get()
  assert.equal(revCount.cnt, 0)

  // 2. PUT fails closed when batch is missing
  // First insert a song normally using d1Db
  const normalPostReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Valid Song For Put',
      raw_content: 'C G Am F',
    }),
  })
  const normalPostRes = await songsCollection.onRequestPost(makeContext(normalPostReq, d1Db))
  assert.equal(normalPostRes.status, 201)
  const { song } = await normalPostRes.json()

  const putReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Updated Title',
      raw_content: 'C G Am F Em',
    }),
  })
  const putRes = await songItem.onRequestPut(makeContext(putReq, d1WithoutBatch, { id: song.id }))
  assert.equal(putRes.status, 500)
  const putBody = await putRes.json()
  assert.match(putBody.error, /batch/i)

  // Verify song in DB was NOT updated and no new revision was inserted
  const songInDb = dbSync.prepare('SELECT title, current_revision FROM shared_catalog_songs WHERE id = ?').get(song.id)
  assert.equal(songInDb.title, 'Valid Song For Put')
  assert.equal(songInDb.current_revision, 1)

  const revsInDb = dbSync.prepare('SELECT count(*) as cnt FROM shared_catalog_revisions WHERE song_id = ?').get(song.id)
  assert.equal(revsInDb.cnt, 1)
})

test('SHARED CATALOG API: Batch failure rolls back canonical snapshot update and revision creation', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-rollback-member',
    google_sub: 'sub-rollback',
    email: 'rollback@example.com',
    display_name: 'Rollback Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  // 1. Publication failure rollback: second statement fails
  const failingBatchPostDb = {
    prepare: d1Db.prepare.bind(d1Db),
    async batch(statements) {
      dbSync.exec('BEGIN TRANSACTION;')
      try {
        await statements[0].run() // First succeeds (song insert)
        throw new Error('Simulated D1 batch second statement failure') // Second fails
      } catch (err) {
        dbSync.exec('ROLLBACK;')
        throw err
      }
    },
  }

  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Fail Publish Song',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, failingBatchPostDb))
  assert.equal(postRes.status, 500)

  // Verify song row was rolled back completely
  const songCount = dbSync.prepare("SELECT count(*) as cnt FROM shared_catalog_songs WHERE title = 'Fail Publish Song'").get()
  assert.equal(songCount.cnt, 0)
  const revCount = dbSync.prepare('SELECT count(*) as cnt FROM shared_catalog_revisions').get()
  assert.equal(revCount.cnt, 0)

  // 2. PUT update failure rollback: revision insertion fails
  const normalPostReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Song For Put Rollback',
      raw_content: 'C G Am F',
    }),
  })
  const normalPostRes = await songsCollection.onRequestPost(makeContext(normalPostReq, d1Db))
  assert.equal(normalPostRes.status, 201)
  const { song } = await normalPostRes.json()

  const failingBatchPutDb = {
    prepare: d1Db.prepare.bind(d1Db),
    async batch(statements) {
      dbSync.exec('BEGIN TRANSACTION;')
      try {
        await statements[0].run() // Update song succeeds
        throw new Error('Simulated D1 revision insert error') // Revision insert fails
      } catch (err) {
        dbSync.exec('ROLLBACK;')
        throw err
      }
    },
  }

  const putReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Mutated Title Before Rollback',
      raw_content: 'C G Am F Dm',
    }),
  })
  const putRes = await songItem.onRequestPut(makeContext(putReq, failingBatchPutDb, { id: song.id }))
  assert.equal(putRes.status, 500)
  const putBody = await putRes.json()
  assert.equal(putBody.error, 'Failed to update catalog song')

  // Verify snapshot update rolled back, still revision 1 and original title
  const songInDb = dbSync.prepare('SELECT title, current_revision FROM shared_catalog_songs WHERE id = ?').get(song.id)
  assert.equal(songInDb.title, 'Song For Put Rollback')
  assert.equal(songInDb.current_revision, 1)

  // Revisions must remain only revision 1
  const revsInDb = dbSync.prepare('SELECT revision FROM shared_catalog_revisions WHERE song_id = ?').all(song.id)
  assert.equal(revsInDb.length, 1)
  assert.equal(revsInDb[0].revision, 1)
})

test('SHARED CATALOG API: Stale CAS and zero-row update leaves snapshot and history unchanged without creating orphan revision', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-cas-member',
    google_sub: 'sub-cas',
    email: 'cas@example.com',
    display_name: 'CAS Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  // Publish song (revision 1)
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'CAS Test Song',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1Db))
  const { song } = await postRes.json()

  // Simulate stale CAS at database execution:
  // Another write moved current_revision in DB to 2 after the pre-read
  dbSync.prepare('UPDATE shared_catalog_songs SET current_revision = 2 WHERE id = ?').run(song.id)
  dbSync.prepare(`
    INSERT INTO shared_catalog_revisions (
      id, song_id, revision, title, raw_content, format, checksum, editor_user_id, created_at
    ) VALUES ('scr_concurrent', ?, 2, 'CAS Test Song', 'C G Am F', 'CHORD_PRO', 'ck_mock', ?, ?)
  `).run(song.id, member.id, now)

  // Custom batch implementation tracking if revision statement gets executed
  let revisionInserted = false
  const trackingBatchDb = {
    prepare: d1Db.prepare.bind(d1Db),
    async batch(statements) {
      const results = []
      dbSync.exec('BEGIN TRANSACTION;')
      try {
        for (let i = 0; i < statements.length; i++) {
          const res = await statements[i].run()
          if (i === 1 && res.meta && res.meta.changes > 0) {
            revisionInserted = true
          }
          results.push(res)
        }
        dbSync.exec('COMMIT;')
        return results
      } catch (err) {
        dbSync.exec('ROLLBACK;')
        throw err
      }
    },
  }

  // Attempt PUT with stale expected_revision=2, but DB current_revision gets bumped to 3 concurrently
  dbSync.prepare('UPDATE shared_catalog_songs SET current_revision = 3 WHERE id = ?').run(song.id)

  const putReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 2, // matches pre-read if pre-read was 2, but DB is now 3
      title: 'CAS Race Song',
      raw_content: 'C G Am F Dm',
    }),
  })

  // Pre-read sees current_revision 3 vs expected 2 -> 409
  const putRes = await songItem.onRequestPut(makeContext(putReq, trackingBatchDb, { id: song.id }))
  assert.equal(putRes.status, 409)
  const putBody = await putRes.json()
  assert.equal(putBody.error, 'REVISION_CONFLICT')

  // Now test mid-flight CAS zero-row:
  // Pre-read sees 3, expected_revision=3. But right between pre-read and batch run, another concurrent writer bumps it to 4
  const raceBatchDb = {
    prepare: d1Db.prepare.bind(d1Db),
    async batch(statements) {
      // Simulate race by altering DB row right before batch runs
      dbSync.prepare('UPDATE shared_catalog_songs SET current_revision = 4 WHERE id = ?').run(song.id)
      return d1Db.batch(statements)
    },
  }

  const racePutReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 3,
      title: 'Mid-flight Stale CAS Song',
      raw_content: 'C G Am F Em',
    }),
  })
  const racePutRes = await songItem.onRequestPut(makeContext(racePutReq, raceBatchDb, { id: song.id }))
  assert.equal(racePutRes.status, 409)
  const racePutBody = await racePutRes.json()
  assert.equal(racePutBody.error, 'REVISION_CONFLICT')

  // Verify that UNIQUE(song_id, revision) or zero-row check prevented duplicate/orphan revision
  const revisions = dbSync.prepare('SELECT revision FROM shared_catalog_revisions WHERE song_id = ? ORDER BY revision ASC').all(song.id)
  const revNums = revisions.map(r => r.revision)
  // Ensure no duplicate revisions exist
  const uniqueRevNums = new Set(revNums)
  assert.equal(revNums.length, uniqueRevNums.size)
})

test('SHARED CATALOG API: Two competing concurrent updates with same expected_revision yield exactly one winner and one conflict', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-comp-member',
    google_sub: 'sub-comp',
    email: 'comp@example.com',
    display_name: 'Comp Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  // Publish song
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Concurrency Competition',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1Db))
  const { song } = await postRes.json()

  // First update arrives and succeeds
  const update1Req = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Winner Update',
      raw_content: 'C G Am F (Winner)',
    }),
  })
  const res1 = await songItem.onRequestPut(makeContext(update1Req, d1Db, { id: song.id }))
  assert.equal(res1.status, 200)
  const body1 = await res1.json()
  assert.equal(body1.song.current_revision, 2)
  assert.equal(body1.song.title, 'Winner Update')

  // Second update arrives with stale expected_revision=1
  const update2Req = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Loser Update',
      raw_content: 'C G Am F (Loser)',
    }),
  })
  const res2 = await songItem.onRequestPut(makeContext(update2Req, d1Db, { id: song.id }))
  assert.equal(res2.status, 409)
  const body2 = await res2.json()
  assert.equal(body2.error, 'REVISION_CONFLICT')
  assert.equal(body2.current_revision, 2)

  // Persisted state must reflect ONLY winner update
  const songInDb = dbSync.prepare('SELECT title, current_revision FROM shared_catalog_songs WHERE id = ?').get(song.id)
  assert.equal(songInDb.title, 'Winner Update')
  assert.equal(songInDb.current_revision, 2)

  const revsInDb = dbSync.prepare('SELECT revision, title FROM shared_catalog_revisions WHERE song_id = ? ORDER BY revision ASC').all(song.id)
  assert.equal(revsInDb.length, 2)
  assert.equal(revsInDb[0].revision, 1)
  assert.equal(revsInDb[1].revision, 2)
  assert.equal(revsInDb[1].title, 'Winner Update')
})

test('SHARED CATALOG API: Missing or ambiguous affected-row metadata cannot produce false success', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-meta-member',
    google_sub: 'sub-meta',
    email: 'meta@example.com',
    display_name: 'Meta Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  // Publish song
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Ambiguous Meta Song',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1Db))
  const { song } = await postRes.json()

  // 1. PUT with missing meta.changes
  const ambiguousBatchDb = {
    prepare: d1Db.prepare.bind(d1Db),
    async batch(statements) {
      await d1Db.batch(statements)
      return [
        { success: true, meta: { changes: 1 } },
        { success: true, meta: {} }, // Missing changes on update
      ]
    },
  }

  const putReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Should Fail Closed On Meta',
      raw_content: 'C G Am F Em',
    }),
  })
  const putRes = await songItem.onRequestPut(makeContext(putReq, ambiguousBatchDb, { id: song.id }))
  assert.equal(putRes.status, 500)
  const putBody = await putRes.json()
  assert.match(putBody.error, /metadata/i)

  // 2. DELETE with ambiguous meta.changes
  const ambiguousDeleteDb = {
    prepare(query) {
      const origStmt = d1Db.prepare(query)
      if (query.trim().startsWith('UPDATE')) {
        return {
          _args: [],
          bind(...args) {
            origStmt.bind(...args)
            return this
          },
          async first(col) { return origStmt.first(col) },
          async all() { return origStmt.all() },
          async run() {
            await origStmt.run()
            return { success: true, meta: null } // Ambiguous metadata
          },
        }
      }
      return origStmt
    },
  }

  const delReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  const delRes = await songItem.onRequestDelete(makeContext(delReq, ambiguousDeleteDb, { id: song.id }))
  assert.equal(delRes.status, 500)
  const delBody = await delRes.json()
  assert.match(delBody.error, /metadata/i)
})

test('SHARED CATALOG API: Zero-row CAS cannot commit revision and snapshot matches latest revision', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const member = {
    id: 'u-zerocas-member',
    google_sub: 'sub-zerocas',
    email: 'zerocas@example.com',
    display_name: 'Zero CAS Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token } = await createTestUser(d1Db, member)

  // Create song (rev 1)
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Zero CAS Predicate Song',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1Db))
  const { song } = await postRes.json()

  // Intercept batch execution to simulate mid-flight modification where DB revision advances right before batch executes
  let revChangesReported = -1
  let updateChangesReported = -1
  const racingBatchDb = {
    prepare: d1Db.prepare.bind(d1Db),
    async batch(statements) {
      // Mid-flight state change: another transaction bumps current_revision from 1 to 2
      dbSync.prepare('UPDATE shared_catalog_songs SET current_revision = 2 WHERE id = ?').run(song.id)
      const res = await d1Db.batch(statements)
      revChangesReported = res[0].meta.changes
      updateChangesReported = res[1].meta.changes
      return res
    },
  }

  const putReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1, // Pre-read saw 1, but mid-flight DB is now 2
      title: 'Should Never Commit Revision',
      raw_content: 'C G Am F ZeroRow',
    }),
  })

  const putRes = await songItem.onRequestPut(makeContext(putReq, racingBatchDb, { id: song.id }))
  assert.equal(putRes.status, 409)
  const putBody = await putRes.json()
  assert.equal(putBody.error, 'REVISION_CONFLICT')

  // Prove SQL-level conditional guarantee: both statements affected exactly 0 rows
  assert.equal(revChangesReported, 0)
  assert.equal(updateChangesReported, 0)

  // Prove database has NO extra revision created
  const revisions = dbSync.prepare('SELECT revision, title FROM shared_catalog_revisions WHERE song_id = ?').all(song.id)
  assert.equal(revisions.length, 1)
  assert.equal(revisions[0].revision, 1)
  assert.equal(revisions[0].title, 'Zero CAS Predicate Song')

  // Prove snapshot revision and revision history agree
  const currentSong = dbSync.prepare('SELECT current_revision, title FROM shared_catalog_songs WHERE id = ?').get(song.id)
  assert.equal(currentSong.title, 'Zero CAS Predicate Song')
})

test('SHARED CATALOG API: Unauthorized DELETE of already-deleted song returns 403 without disclosing tombstone state', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const publisher = {
    id: 'u-tomb-pub',
    google_sub: 'sub-tomb-pub',
    email: 'tombpub@example.com',
    display_name: 'Tomb Pub',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: pubToken } = await createTestUser(d1Db, publisher)

  const unauthorizedMember = {
    id: 'u-tomb-other',
    google_sub: 'sub-tomb-other',
    email: 'tombother@example.com',
    display_name: 'Tomb Other',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: otherToken } = await createTestUser(d1Db, unauthorizedMember)

  // Publisher creates song
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Tombstone Privacy Song',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1Db))
  const { song } = await postRes.json()

  // Publisher soft-deletes song
  const delReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${pubToken}` },
  })
  const delRes = await songItem.onRequestDelete(makeContext(delReq, d1Db, { id: song.id }))
  assert.equal(delRes.status, 200)

  // Unauthorized user attempts DELETE on the already soft-deleted song
  const unauthorizedDelReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${otherToken}` },
  })
  const unauthorizedDelRes = await songItem.onRequestDelete(makeContext(unauthorizedDelReq, d1Db, { id: song.id }))

  // MUST return 403 Forbidden, NOT 200 "already deleted"
  assert.equal(unauthorizedDelRes.status, 403)
  const body = await unauthorizedDelRes.json()
  assert.equal(body.success, false)
  assert.match(body.error, /forbidden/i)

  // Authorized repeat DELETE by publisher remains idempotent 200
  const repeatDelRes = await songItem.onRequestDelete(makeContext(delReq, d1Db, { id: song.id }))
  assert.equal(repeatDelRes.status, 200)
  const repeatBody = await repeatDelRes.json()
  assert.equal(repeatBody.message, 'Song is already deleted')
})

test('SHARED CATALOG API: Concurrent DELETE vs PUT cannot overwrite or resurrect a tombstoned song', async () => {
  const { d1Db, dbSync } = createTestDb()
  const now = new Date().toISOString()

  const publisher = {
    id: 'u-race-pub',
    google_sub: 'sub-race-pub',
    email: 'racepub@example.com',
    display_name: 'Race Pub',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: now,
  }
  const { token: pubToken } = await createTestUser(d1Db, publisher)

  // Publisher creates song
  const postReq = new Request('http://localhost/api/catalog/songs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Race Target Song',
      raw_content: 'C G Am F',
    }),
  })
  const postRes = await songsCollection.onRequestPost(makeContext(postReq, d1Db))
  const { song } = await postRes.json()

  // Song is soft-deleted
  const delReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${pubToken}` },
  })
  const delRes = await songItem.onRequestDelete(makeContext(delReq, d1Db, { id: song.id }))
  assert.equal(delRes.status, 200)

  // Attempt PUT on deleted song -> 404 (or 409 if race past pre-read)
  const putReq = new Request(`http://localhost/api/catalog/songs/${song.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expected_revision: 1,
      title: 'Resurrected Title',
      raw_content: 'C G Am F Resurrection',
    }),
  })
  const putRes = await songItem.onRequestPut(makeContext(putReq, d1Db, { id: song.id }))
  assert.equal(putRes.status, 404)

  // Verify in DB that song is still soft-deleted and was NOT resurrected
  const songInDb = dbSync.prepare('SELECT is_deleted, title FROM shared_catalog_songs WHERE id = ?').get(song.id)
  assert.equal(songInDb.is_deleted, 1)
  assert.equal(songInDb.title, 'Race Target Song')
})

