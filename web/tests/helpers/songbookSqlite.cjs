const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')

// Disposable SQLite: executes production SQL rather than emulating CAS in a Map.
function createSongbookSqlite(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename)
  sqlite.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY); PRAGMA foreign_keys = OFF;')
  sqlite.exec(fs.readFileSync(path.join(__dirname, '../../migrations/0002_songbook_sync.sql'), 'utf8'))
  // RFC #188 S4: per-record tables (additive).
  sqlite.exec(fs.readFileSync(path.join(__dirname, '../../migrations/0009_songbook_records.sql'), 'utf8'))
  const db = {
    sqlite,
    /** Test hook: runs before each statement of a batch (index), e.g. to simulate a racing writer. */
    beforeBatchStatement: null,
    prepare(sql) {
      let bound = []
      return {
        sql,
        get bound() { return bound },
        bind(...args) { bound = args; return this },
        async first() { return sqlite.prepare(sql).get(...bound) ?? null },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...bound) } },
        async run() { return { success: true, meta: sqlite.prepare(sql).run(...bound) } },
      }
    },
    // D1 batch: one transaction, statements in order, rolled back as a whole on error.
    async batch(statements) {
      const results = []
      sqlite.exec('BEGIN')
      try {
        statements.forEach((statement, index) => {
          if (db.beforeBatchStatement) db.beforeBatchStatement(index, statement)
          const prepared = sqlite.prepare(statement.sql)
          if (/^\s*(SELECT|WITH)/i.test(statement.sql) || /RETURNING/i.test(statement.sql)) {
            results.push({ success: true, results: prepared.all(...statement.bound), meta: {} })
          } else {
            const info = prepared.run(...statement.bound)
            results.push({ success: true, results: [], meta: { changes: Number(info.changes) } })
          }
        })
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
      return results
    },
  }
  return db
}
module.exports = { createSongbookSqlite }
