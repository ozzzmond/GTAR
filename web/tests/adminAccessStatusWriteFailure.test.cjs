// #453 A1: approve/deny/restore must not report success when D1 does not confirm the write.
// #453 A3: the functions/workers TypeScript project is part of `npm run build`. Synthetic data only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)

const { createSessionToken, hashSessionToken } = require('../functions/lib/authCore.ts')
const handlers = {
  approve: require('../functions/api/admin/approve.ts'),
  deny: require('../functions/api/admin/deny.ts'),
  restore: require('../functions/api/admin/restore.ts'),
}

const AUTH_SECRET = 'synthetic-test-secret-0123456789abcdef'
const ISO = '2026-11-01T00:00:00.000Z'
const account = (id, role, access_status) => ({ id, google_sub: `${id}-sub`, email: `${id}@example.com`, display_name: id,
  picture_url: null, role, access_status, created_at: ISO, updated_at: ISO, last_login_at: ISO, sessions_revoked_at: null })

/** Minimal D1 double: `failing(sql)` makes that statement report an unconfirmed write. */
function createDb(failing = () => false) {
  const users = new Map([['admin-1', account('admin-1', 'admin', 'active')], ['member-1', account('member-1', 'member', 'pending')]])
  const sessions = new Map()
  const prepare = sql => {
    let args = []
    const statement = {
      bind(...values) { args = values; return statement },
      async first() {
        if (/FROM sessions/.test(sql)) return sessions.get(args[0]) || null
        if (/FROM users WHERE id/.test(sql)) return users.get(args[0]) || null
        throw new Error(`Unexpected read: ${sql}`)
      },
      async run() {
        if (failing(sql)) return { success: false }
        if (/UPDATE users SET access_status/.test(sql)) users.get(args[2]).access_status = args[0]
        else if (/UPDATE users SET sessions_revoked_at/.test(sql)) users.get(args[1]).sessions_revoked_at = args[0]
        else if (!/UPDATE sessions SET is_revoked/.test(sql)) throw new Error(`Unexpected write: ${sql}`)
        return { success: true, meta: { changes: 1 } }
      },
    }
    return statement
  }
  return { prepare, users, sessions }
}

async function call(action, db) {
  const token = await createSessionToken(db.users.get('admin-1'), AUTH_SECRET, undefined, 'sid-admin-1')
  const hash = await hashSessionToken(token)
  db.sessions.set(hash, { id: 'sid-admin-1', user_id: 'admin-1', session_token_hash: hash, created_at: ISO,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), last_seen_at: ISO, is_revoked: 0, revoked_at: null })
  const request = new Request(`http://localhost/api/admin/${action}`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'member-1' }) })
  const response = await handlers[action].onRequestPost({ request, env: { DB: db, AUTH_SECRET } })
  return { status: response.status, body: await response.json() }
}

for (const [action, status] of [['approve', 'active'], ['deny', 'denied'], ['restore', 'active']]) {
  test(`admin ${action}: confirmed write still succeeds`, async () => {
    const db = createDb()
    const result = await call(action, db)
    assert.equal(result.status, 200)
    assert.equal(result.body.success, true)
    assert.equal(db.users.get('member-1').access_status, status)
  })

  test(`admin ${action}: unconfirmed access_status write returns 500, not success`, async () => {
    const db = createDb(sql => /UPDATE users SET access_status/.test(sql))
    const result = await call(action, db)
    assert.equal(result.status, 500)
    assert.equal(result.body.success, false)
    assert.equal(db.users.get('member-1').access_status, 'pending')
  })
}

test('admin deny: unconfirmed session revocation returns 500 and leaves the account unchanged', async () => {
  const db = createDb(sql => /UPDATE sessions SET is_revoked/.test(sql))
  const result = await call('deny', db)
  assert.equal(result.status, 500)
  assert.equal(result.body.success, false)
  assert.equal(db.users.get('member-1').access_status, 'pending')
})

test('build type-checks Pages Functions and Workers', () => {
  const web = path.join(__dirname, '..')
  const read = file => JSON.parse(fs.readFileSync(path.join(web, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
  assert.ok(read('tsconfig.json').references.some(reference => reference.path === './tsconfig.functions.json'))
  assert.deepEqual(read('tsconfig.functions.json').include, ['functions', 'workers'])
  assert.match(read('package.json').scripts.build, /^tsc -b && /)
})
