const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')

// Disposable SQLite: executes production SQL rather than emulating CAS in a Map.
function createSongbookSqlite(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename)
  sqlite.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY); PRAGMA foreign_keys = OFF;')
  sqlite.exec(fs.readFileSync(path.join(__dirname, '../../migrations/0002_songbook_sync.sql'), 'utf8'))
  return {
    sqlite,
    prepare(sql) {
      let bound = []
      return {
        bind(...args) { bound = args; return this },
        async first() { return sqlite.prepare(sql).get(...bound) ?? null },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...bound) } },
        async run() { return { success: true, meta: sqlite.prepare(sql).run(...bound) } },
      }
    },
  }
}
module.exports = { createSongbookSqlite }
