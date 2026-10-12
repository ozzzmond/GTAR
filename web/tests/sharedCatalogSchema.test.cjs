const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { runValidation } = require('../scripts/migrate-dev-remote.cjs')

const webDir = path.resolve(__dirname, '..')
const migrationsDir = path.join(webDir, 'migrations')

test('MIGRATION 0004: All migrations 0001-0004 apply cleanly in sequence on isolated local SQLite', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')

  const migrationFiles = [
    '0001_users.sql',
    '0002_songbook_sync.sql',
    '0003_shared_setlists.sql',
    '0004_shared_catalog.sql'
  ]

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    assert.doesNotThrow(() => db.exec(sql), `Failed applying migration ${file}`)
  }

  // Idempotence: reapplying should not throw
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    assert.doesNotThrow(() => db.exec(sql), `Failed re-applying migration ${file}`)
  }

  // Verify tables exist
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  assert.ok(tables.includes('users'))
  assert.ok(tables.includes('user_songbooks'))
  assert.ok(tables.includes('shared_setlists'))
  assert.ok(tables.includes('shared_catalog_songs'))
  assert.ok(tables.includes('shared_catalog_revisions'))

  // Verify indexes exist
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name)
  assert.ok(indexes.includes('idx_shared_catalog_songs_publisher'))
  assert.ok(indexes.includes('idx_shared_catalog_songs_last_editor'))
  assert.ok(indexes.includes('idx_shared_catalog_songs_is_deleted'))
  assert.ok(indexes.includes('idx_shared_catalog_songs_updated_at'))
  assert.ok(indexes.includes('idx_shared_catalog_revisions_song_id'))
  assert.ok(indexes.includes('idx_shared_catalog_revisions_editor'))
})

test('MIGRATION 0004: Foreign key constraints and ownership enforcement', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')

  const migrationFiles = [
    '0001_users.sql',
    '0002_songbook_sync.sql',
    '0003_shared_setlists.sql',
    '0004_shared_catalog.sql'
  ]
  for (const file of migrationFiles) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }

  // Insert valid user
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO users (id, google_sub, email, role, access_status, created_at, updated_at, last_login_at)
    VALUES ('u-1', 'sub-1', 'u1@example.com', 'member', 'active', ?, ?, ?)
  `).run(now, now, now)

  // Inserting song with non-existent publisher must fail
  assert.throws(() => {
    db.prepare(`
      INSERT INTO shared_catalog_songs (
        id, title, raw_content, checksum, publisher_user_id, last_editor_user_id, created_at, updated_at
      ) VALUES ('s-1', 'Song 1', '{title: Song 1}', 'c1', 'non-existent', 'u-1', ?, ?)
    `).run(now, now)
  }, /FOREIGN KEY constraint failed/)

  // Insert valid song
  assert.doesNotThrow(() => {
    db.prepare(`
      INSERT INTO shared_catalog_songs (
        id, title, raw_content, checksum, publisher_user_id, last_editor_user_id, created_at, updated_at
      ) VALUES ('s-1', 'Song 1', '{title: Song 1}', 'c1', 'u-1', 'u-1', ?, ?)
    `).run(now, now)
  })

  // Inserting revision with non-existent song must fail
  assert.throws(() => {
    db.prepare(`
      INSERT INTO shared_catalog_revisions (
        id, song_id, revision, title, raw_content, checksum, editor_user_id, created_at
      ) VALUES ('r-1', 'non-existent-song', 1, 'Song 1', '{title: Song 1}', 'c1', 'u-1', ?)
    `).run(now)
  }, /FOREIGN KEY constraint failed/)

  // Insert valid revision
  assert.doesNotThrow(() => {
    db.prepare(`
      INSERT INTO shared_catalog_revisions (
        id, song_id, revision, title, raw_content, checksum, editor_user_id, created_at
      ) VALUES ('r-1', 's-1', 1, 'Song 1', '{title: Song 1}', 'c1', 'u-1', ?)
    `).run(now)
  })

  // NO CASCADE: Deleting user when referenced in shared_catalog must be RESTRICTED
  assert.throws(() => {
    db.prepare("DELETE FROM users WHERE id = 'u-1'").run()
  }, /FOREIGN KEY constraint failed/)

  // NO CASCADE: Deleting song when referenced in revisions must be RESTRICTED
  assert.throws(() => {
    db.prepare("DELETE FROM shared_catalog_songs WHERE id = 's-1'").run()
  }, /FOREIGN KEY constraint failed/)
})

test('MIGRATION 0004: CHECK constraints and revision uniqueness validation', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')

  for (const file of ['0001_users.sql', '0002_songbook_sync.sql', '0003_shared_setlists.sql', '0004_shared_catalog.sql']) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }

  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO users (id, google_sub, email, role, access_status, created_at, updated_at, last_login_at)
    VALUES ('u-1', 'sub-1', 'u1@example.com', 'member', 'active', ?, ?, ?)
  `).run(now, now, now)

  // current_revision must be >= 1
  assert.throws(() => {
    db.prepare(`
      INSERT INTO shared_catalog_songs (
        id, title, raw_content, checksum, publisher_user_id, last_editor_user_id, current_revision, created_at, updated_at
      ) VALUES ('s-bad-rev', 'Song Bad', 'content', 'c', 'u-1', 'u-1', 0, ?, ?)
    `).run(now, now)
  }, /CHECK constraint failed/)

  // is_deleted must be 0 or 1
  assert.throws(() => {
    db.prepare(`
      INSERT INTO shared_catalog_songs (
        id, title, raw_content, checksum, publisher_user_id, last_editor_user_id, is_deleted, created_at, updated_at
      ) VALUES ('s-bad-del', 'Song Bad', 'content', 'c', 'u-1', 'u-1', 2, ?, ?)
    `).run(now, now)
  }, /CHECK constraint failed/)

  // Valid insert
  db.prepare(`
    INSERT INTO shared_catalog_songs (
      id, title, raw_content, checksum, publisher_user_id, last_editor_user_id, current_revision, is_deleted, created_at, updated_at
    ) VALUES ('s-1', 'Song 1', 'content 1', 'c1', 'u-1', 'u-1', 1, 0, ?, ?)
  `).run(now, now)

  // Revision must be >= 1
  assert.throws(() => {
    db.prepare(`
      INSERT INTO shared_catalog_revisions (
        id, song_id, revision, title, raw_content, checksum, editor_user_id, created_at
      ) VALUES ('r-0', 's-1', 0, 'Song 1', 'content', 'c', 'u-1', ?)
    `).run(now)
  }, /CHECK constraint failed/)

  // Valid revision 1
  db.prepare(`
    INSERT INTO shared_catalog_revisions (
      id, song_id, revision, title, raw_content, checksum, editor_user_id, created_at
    ) VALUES ('r-1', 's-1', 1, 'Song 1', 'content 1', 'c1', 'u-1', ?)
  `).run(now)

  // Duplicate (song_id, revision) must violate UNIQUE constraint
  assert.throws(() => {
    db.prepare(`
      INSERT INTO shared_catalog_revisions (
        id, song_id, revision, title, raw_content, checksum, editor_user_id, created_at
      ) VALUES ('r-2', 's-1', 1, 'Song 1 - Dup', 'content 2', 'c2', 'u-1', ?)
    `).run(now)
  }, /UNIQUE constraint failed/)

  // Soft delete update succeeds
  db.prepare(`
    UPDATE shared_catalog_songs
    SET is_deleted = 1, deleted_at = ?, deleted_by_user_id = 'u-1'
    WHERE id = 's-1'
  `).run(now)

  const song = db.prepare("SELECT is_deleted, deleted_by_user_id FROM shared_catalog_songs WHERE id = 's-1'").get()
  assert.equal(song.is_deleted, 1)
  assert.equal(song.deleted_by_user_id, 'u-1')
})

test('DEV REMOTE MIGRATION GUARD: Rejects production target, ambiguous config, and overrides', () => {
  // Positive validation on canonical root
  const validTarget = runValidation(webDir)
  assert.equal(validTarget.databaseName, 'gtar-db-dev')
  assert.equal(validTarget.databaseId, '455b9901-9018-4e73-9ac1-a684f7335def')
  assert.equal(validTarget.env, 'preview')

  // Negative validation: reject when NODE_ENV or CF_D1_TARGET set to production
  const origEnv = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'production'
    assert.throws(() => runValidation(webDir), /Cannot execute DEV remote migration when production environment flag is set/)
  } finally {
    process.env.NODE_ENV = origEnv
  }

  // Reject when wrangler config has PROD credentials pointing to dev
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-guard-test-'))
  try {
    const maliciousConfig = {
      d1_databases: [{ binding: 'DB', database_name: 'gtar-db-dev', database_id: '455b9901-9018-4e73-9ac1-a684f7335def' }],
      env: {
        preview: {
          d1_databases: [{ binding: 'DB', database_name: 'gtar-db-dev', database_id: '455b9901-9018-4e73-9ac1-a684f7335def' }]
        }
      }
    }
    fs.writeFileSync(path.join(tmpDir, 'wrangler.jsonc'), JSON.stringify(maliciousConfig))
    assert.throws(() => runValidation(tmpDir), /DEV database configuration cannot match PROD database name or ID/)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
