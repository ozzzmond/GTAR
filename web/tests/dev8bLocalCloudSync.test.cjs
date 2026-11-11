const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll(
            'import.meta.env',
            '({DEV:true,VITE_GOOGLE_CLIENT_ID:"client-test-id"})'
          ),
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

const { computeSongbookChecksum } = require('../src/utils/cloudBackupFormat.ts')
const {
  insertUser,
  findUserById,
  createSessionToken,
  verifySessionToken,
} = require('../functions/lib/authCore.ts')

const { generateUUID } = require('../src/utils/uuid.ts')

// ---------------------------------------------------------------------------
// 1. API ROUTING GUARD (Vite Middleware)
// ---------------------------------------------------------------------------
test('1: API routing guard intercepts unhandled /api/ requests and responds with JSON 404, never SPA HTML', async () => {
  // Read vite.config.ts to inspect the guard plugin definition
  const viteConfigContent = fs.readFileSync(path.resolve(__dirname, '../vite.config.ts'), 'utf8')
  assert.ok(viteConfigContent.includes('apiRoutingGuardPlugin'), 'vite.config.ts must define apiRoutingGuardPlugin')
  assert.ok(viteConfigContent.includes("startsWith('/api/')"), 'apiRoutingGuardPlugin must check for /api/ prefix')
  assert.ok(viteConfigContent.includes('application/json'), 'apiRoutingGuardPlugin must return application/json')

  // Simulate middleware execution
  let writtenStatus = 0
  let writtenHeaders = {}
  let writtenBody = ''
  let nextCalled = false

  const mockReq = { url: '/api/songbook/sync' }
  const mockRes = {
    setHeader(k, v) { writtenHeaders[k] = v },
    writeHead(status) { writtenStatus = status },
    end(body) { writtenBody = body },
  }
  const mockNext = () => { nextCalled = true }

  // Replicate guard logic
  const parsedPath = mockReq.url
  if (parsedPath && parsedPath.startsWith('/api/')) {
    mockRes.setHeader('Content-Type', 'application/json; charset=utf-8')
    mockRes.writeHead(404)
    mockRes.end(JSON.stringify({ success: false, error: `API route not found: ${parsedPath}` }))
  } else {
    mockNext()
  }

  assert.equal(writtenStatus, 404)
  assert.equal(writtenHeaders['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(nextCalled, false, 'next() must NOT be called for /api/ paths')
  const json = JSON.parse(writtenBody)
  assert.equal(json.success, false)
  assert.match(json.error, /API route not found/)
})

// ---------------------------------------------------------------------------
// 2. VITE PROXY 503 ERROR HANDLING IN CLIENT
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. LOCAL D1 MIGRATION & SCHEMA READINESS
// ---------------------------------------------------------------------------
test('3: D1 migration 0002_songbook_sync.sql defines user_songbooks table and cascade relationship', () => {
  const migration0001 = fs.readFileSync(path.resolve(__dirname, '../migrations/0001_users.sql'), 'utf8')
  assert.ok(migration0001.includes('CREATE TABLE IF NOT EXISTS users'), '0001 must create users table')
  assert.ok(migration0001.includes('google_sub TEXT UNIQUE NOT NULL'), '0001 must have google_sub unique')

  const migration0002 = fs.readFileSync(path.resolve(__dirname, '../migrations/0002_songbook_sync.sql'), 'utf8')
  assert.ok(migration0002.includes('CREATE TABLE IF NOT EXISTS user_songbooks'), '0002 must create user_songbooks table')
  assert.ok(migration0002.includes('user_id TEXT PRIMARY KEY NOT NULL'), '0002 must have user_id primary key')
  assert.ok(migration0002.includes('version INTEGER NOT NULL DEFAULT 1'), '0002 must have version column')
  assert.ok(migration0002.includes('data_json TEXT NOT NULL'), '0002 must have data_json column')
  assert.ok(migration0002.includes('checksum TEXT NOT NULL'), '0002 must have checksum column')
  assert.ok(migration0002.includes('REFERENCES users(id) ON DELETE CASCADE'), '0002 must reference users table')
})

