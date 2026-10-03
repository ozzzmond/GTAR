const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const webDir = path.resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// 1. CANONICAL 5173 STRICT PORT
// ---------------------------------------------------------------------------
test('canonical_5173_strict_port: Vite config and batch runners enforce port 5173 without silent fallback', () => {
  const viteConfigContent = fs.readFileSync(path.join(webDir, 'vite.config.ts'), 'utf8')
  assert.ok(
    /port:\s*(isDebug\s*\?\s*5174\s*:\s*)?5173/.test(viteConfigContent),
    'vite.config.ts must configure canonical port 5173'
  )
  assert.ok(
    /strictPort:\s*true/.test(viteConfigContent),
    'vite.config.ts must set strictPort: true to prevent silent port fallback to 5174/5175'
  )

  const fullStackBat = fs.readFileSync(path.join(webDir, 'Run_Full_Stack_Dev.bat'), 'utf8')
  assert.ok(
    fullStackBat.includes('5173'),
    'Run_Full_Stack_Dev.bat must check or target port 5173'
  )
  assert.ok(
    fullStackBat.includes('Port 5173 is already in use'),
    'Run_Full_Stack_Dev.bat must provide actionable error message on port 5173 conflict'
  )
  assert.ok(
    !fullStackBat.includes('taskkill /F /IM'),
    'Run_Full_Stack_Dev.bat must not kill unrelated processes'
  )

  const webDevBat = fs.readFileSync(path.join(webDir, 'Run_Web_Dev.bat'), 'utf8')
  assert.ok(
    webDevBat.includes('5173'),
    'Run_Web_Dev.bat must check or target port 5173'
  )
  assert.ok(
    webDevBat.includes('Port 5173 is already in use'),
    'Run_Web_Dev.bat must provide actionable error message on port 5173 conflict'
  )
})

// ---------------------------------------------------------------------------
// 2. VERSION ALIGNMENT: 1.0.108-dev.10
// ---------------------------------------------------------------------------
test('current_version_108_dev_8b: DEV checkpoint is consistently aligned to v1.0.108-dev.10', () => {
  const gtarTypesContent = fs.readFileSync(path.join(webDir, 'src/types/gtar.ts'), 'utf8')
  assert.ok(
    gtarTypesContent.includes("export const GTAR_DEV_VERSION = '1.0.108-dev.10'"),
    'gtar.ts must define GTAR_DEV_VERSION as 1.0.108-dev.10'
  )
  assert.ok(
    gtarTypesContent.includes("export const GTAR_APP_VERSION = '1.1.108'"),
    'gtar.ts must preserve PROD version as 1.1.108'
  )

  const packageJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(packageJson.version, '1.0.108-dev.10', 'package.json version must be 1.0.108-dev.10')

  const authCoreContent = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(
    authCoreContent.includes('v1.0.108-dev.10'),
    'authCore.ts must reference v1.0.108-dev.10'
  )
})

// ---------------------------------------------------------------------------
// 3. PENDING AUTH POLLING: NO HIGH-FREQUENCY REQUEST LOOP
// ---------------------------------------------------------------------------
test('pending_auth_no_request_loop: AuthGate suppresses automatic background session polling for pending users', () => {
  const authGateContent = fs.readFileSync(path.join(webDir, 'src/components/AuthGate.tsx'), 'utf8')

  // Background recheck must reject pending and denied users
  assert.ok(
    authGateContent.includes("current.access_status === 'pending'"),
    'backgroundRecheck must guard against pending access status'
  )
  assert.ok(
    authGateContent.includes("current.access_status === 'denied'"),
    'backgroundRecheck must guard against denied access status'
  )

  // Mount effect must not invoke backgroundRecheck for pending candidates
  assert.ok(
    authGateContent.includes("candidate.access_status !== 'pending'"),
    'Mount effect must not background-recheck pending candidates'
  )

  // Periodic event listener effect must not register/fire for pending sessions
  assert.ok(
    authGateContent.includes("session.access_status === 'pending'"),
    'Event listeners effect must skip pending sessions'
  )

  // Cooldown timer ref must be present
  assert.ok(
    authGateContent.includes('lastRecheckTimestamp'),
    'AuthGate must maintain shared lastRecheckTimestamp ref to prevent overlapping or rapid rechecks'
  )
})

// ---------------------------------------------------------------------------
// 4. CONTROLLED CHECK STATUS & PENDING UI
// ---------------------------------------------------------------------------
test('controlled_check_status: Check Status button is debounced and pending screen provides debug logs', () => {
  const authGateContent = fs.readFileSync(path.join(webDir, 'src/components/AuthGate.tsx'), 'utf8')

  // Debounced manual check
  assert.ok(
    authGateContent.includes('lastManualCheckRef'),
    'checkStatus must use lastManualCheckRef to debounce user clicks'
  )

  // Pending screen UI features
  assert.ok(
    authGateContent.includes('Access Approval Pending'),
    'Pending screen heading must exist'
  )
  assert.ok(
    authGateContent.includes('Check Status'),
    'Pending screen must render Check Status button'
  )
  assert.ok(
    authGateContent.includes('View Debug Logs'),
    'Pending screen must offer View Debug Logs button for local diagnostics'
  )
})

// ---------------------------------------------------------------------------
// 5. LOCAL TEST IDENTITY SAFETY
// ---------------------------------------------------------------------------
test('local_test_identity_safety: bootstrap script enforces local-only execution and target validation', () => {
  const scriptContent = fs.readFileSync(path.join(webDir, 'scripts/bootstrap-local-admin.cjs'), 'utf8')

  // Rejects remote/prod
  assert.ok(
    scriptContent.includes('--remote') && scriptContent.includes('production'),
    'Script must check for and reject remote/production arguments'
  )
  assert.ok(
    scriptContent.includes('NODE_ENV'),
    'Script must check NODE_ENV'
  )

  // Explicit email validation
  assert.ok(
    scriptContent.includes('Invalid explicit email address'),
    'Script must validate explicit email format'
  )

  // Local D1 target
  assert.ok(
    scriptContent.includes('--local'),
    'Script must strictly target local D1 with --local flag'
  )

  // Revert support
  assert.ok(
    scriptContent.includes('--revert'),
    'Script must support --revert to reset status back to pending'
  )

  // Package.json script wiring
  const packageJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.ok(
    packageJson.scripts['admin:bootstrap:local'],
    'package.json must contain admin:bootstrap:local script'
  )
})
