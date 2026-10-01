#!/usr/bin/env node
/**
 * GTAR Local Dev Test Identity Bootstrap
 * 
 * Safely marks or toggles an explicit test identity in LOCAL D1 (SQLite under .wrangler/state/v3/d1).
 * Strictly local-only: refuses to run against remote/preview/production D1.
 * 
 * Usage:
 *   node scripts/bootstrap-local-admin.cjs <email> [--role=admin|member] [--status=active|pending|denied]
 *   node scripts/bootstrap-local-admin.cjs <email> --revert
 *   node scripts/bootstrap-local-admin.cjs <email> --check
 */

const { execSync } = require('child_process')
const path = require('path')

// Guard: Disallow execution if remote flags or production env detected
const rawArgs = process.argv.slice(2)
const lowerArgs = rawArgs.map(a => a.toLowerCase())

if (lowerArgs.some(a => a.includes('--remote') || a.includes('prod') || a.includes('production'))) {
  console.error('ERROR: bootstrap-local-admin is STRICTLY LOCAL-ONLY. Remote/production targeting is forbidden.')
  process.exit(1)
}

if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: Cannot run bootstrap-local-admin when NODE_ENV=production.')
  process.exit(1)
}

let targetEmail = ''
let role = 'admin'
let status = 'active'
let checkOnly = false
let revert = false

for (const arg of rawArgs) {
  if (arg === '--revert' || arg === '--pending') {
    revert = true
    role = 'member'
    status = 'pending'
  } else if (arg === '--check' || arg === '--inspect') {
    checkOnly = true
  } else if (arg.startsWith('--role=')) {
    role = arg.split('=')[1].toLowerCase()
  } else if (arg.startsWith('--status=')) {
    status = arg.split('=')[1].toLowerCase()
  } else if (!arg.startsWith('--') && !targetEmail) {
    targetEmail = arg.trim()
  }
}

if (!targetEmail) {
  console.error('Usage: node scripts/bootstrap-local-admin.cjs <email> [--role=admin|member] [--status=active|pending|denied] [--revert] [--check]')
  console.error('Example: node scripts/bootstrap-local-admin.cjs user@example.com')
  console.error('Revert:  node scripts/bootstrap-local-admin.cjs user@example.com --revert')
  process.exit(1)
}

// Strict email format validation (prevent injection & wildcards)
if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(targetEmail)) {
  console.error(`ERROR: Invalid explicit email address: "${targetEmail}". Blanket or wildcard approval is forbidden.`)
  process.exit(1)
}

if (!['admin', 'member'].includes(role)) {
  console.error(`ERROR: Invalid role "${role}". Allowed roles: admin, member`)
  process.exit(1)
}

if (!['active', 'pending', 'denied'].includes(status)) {
  console.error(`ERROR: Invalid status "${status}". Allowed statuses: active, pending, denied`)
  process.exit(1)
}

const safeEmail = targetEmail.toLowerCase().replace(/'/g, "''")
const webDir = path.resolve(__dirname, '..')

function runLocalD1(sqlCommand) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const escapedCmd = sqlCommand.replace(/"/g, '""')
  const commandLine = `${npxCmd} wrangler d1 execute DB --local --command="${escapedCmd}"`
  const output = execSync(commandLine, {
    cwd: webDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return output
}

try {
  console.log(`[LOCAL D1] Verifying user "${safeEmail}" in local database...`)
  const checkSql = `SELECT id, email, role, access_status, updated_at FROM users WHERE lower(email) = lower('${safeEmail}');`
  const initialResult = runLocalD1(checkSql)

  let rows = []
  try {
    const jsonMatch = initialResult.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      rows = parsed[0]?.results || []
    }
  } catch {
    // Parser fallback
  }

  if (rows.length === 0) {
    console.log(`[LOCAL D1] No existing user record found for "${safeEmail}".`)
    console.log(`[LOCAL D1] Creating initial local test identity for "${safeEmail}"...`)
    const insertSql = `INSERT INTO users (id, google_sub, email, display_name, role, access_status, created_at, updated_at, last_login_at) VALUES ('local_' || substr(hex(randomblob(8)), 1, 16), 'local_sub_' || lower('${safeEmail}'), lower('${safeEmail}'), 'Local Test User', '${role}', '${status}', datetime('now'), datetime('now'), datetime('now'));`
    runLocalD1(insertSql)
  } else if (!checkOnly) {
    console.log(`[LOCAL D1] Updating existing user "${safeEmail}" -> role=${role}, access_status=${status}...`)
    const updateSql = `UPDATE users SET role = '${role}', access_status = '${status}', updated_at = datetime('now') WHERE lower(email) = lower('${safeEmail}');`
    runLocalD1(updateSql)
  }

  // Verify and print final state
  const verifyResult = runLocalD1(checkSql)
  const verifyMatch = verifyResult.match(/\[[\s\S]*\]/)
  if (verifyMatch) {
    const verifiedRows = JSON.parse(verifyMatch[0])[0]?.results || []
    console.log('[LOCAL D1] Current local test identity state:')
    console.table(verifiedRows)
  } else {
    console.log(verifyResult)
  }

  console.log(`[LOCAL D1] SUCCESS: Local test identity for "${safeEmail}" is configured.`)
  if (revert) {
    console.log(`[LOCAL D1] (Account reverted to pending status in local SQLite).`)
  }
} catch (err) {
  console.error('[LOCAL D1] Execution failed:', err.message || err)
  process.exit(1)
}
