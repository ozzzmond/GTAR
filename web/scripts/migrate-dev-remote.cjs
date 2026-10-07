#!/usr/bin/env node
/**
 * Safe DEV Remote D1 Migration Runner for GTAR
 *
 * Enforces exact targeting:
 * - Environment: preview
 * - Database Name: gtar-db-dev
 * - Database UUID: 455b9901-9018-4e73-9ac1-a684f7335def
 * - Config: wrangler.jsonc
 *
 * Strictly prevents accidental remote migrations on PROD or unspecified targets.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const EXPECTED_ENV = 'preview'
const EXPECTED_DB_NAME = 'gtar-db-dev'
const EXPECTED_DB_UUID = '455b9901-9018-4e73-9ac1-a684f7335def'
const CONFIG_FILE = 'wrangler.jsonc'

function runValidation(rootDirOverride) {
  const rootDir = rootDirOverride || path.resolve(__dirname, '..')
  const configPath = path.join(rootDir, CONFIG_FILE)

  if (!fs.existsSync(configPath)) {
    throw new Error(`Target config file not found: ${CONFIG_FILE}`)
  }

  // Verify CLI arguments: do not allow arbitrary overrides
  const extraArgs = process.argv.slice(2)
  if (extraArgs.length > 0) {
    throw new Error(`Target override rejected. migrate-dev-remote does not accept extra arguments: [${extraArgs.join(' ')}]`)
  }

  const content = fs.readFileSync(configPath, 'utf8')
  // Strip simple JSON comments if present
  const cleanedJson = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1')
  let config
  try {
    config = JSON.parse(cleanedJson)
  } catch (err) {
    throw new Error(`Failed to parse ${CONFIG_FILE}: ${err.message}`)
  }

  const previewEnv = config.env && config.env[EXPECTED_ENV]
  if (!previewEnv) {
    throw new Error(`Environment '${EXPECTED_ENV}' not found in ${CONFIG_FILE}`)
  }

  const d1Databases = previewEnv.d1_databases
  if (!Array.isArray(d1Databases) || d1Databases.length === 0) {
    throw new Error(`No d1_databases configured under env.${EXPECTED_ENV} in ${CONFIG_FILE}`)
  }

  const devDb = d1Databases.find((db) => db.database_name === EXPECTED_DB_NAME)
  if (!devDb) {
    throw new Error(`Expected database '${EXPECTED_DB_NAME}' not found under env.${EXPECTED_ENV} in ${CONFIG_FILE}`)
  }

  if (devDb.database_id !== EXPECTED_DB_UUID) {
    throw new Error(
      `Database UUID mismatch for '${EXPECTED_DB_NAME}'. Expected: ${EXPECTED_DB_UUID}, Found: ${devDb.database_id}`
    )
  }

  return {
    databaseName: EXPECTED_DB_NAME,
    databaseId: EXPECTED_DB_UUID,
    env: EXPECTED_ENV,
    configFile: CONFIG_FILE,
  }
}

function main() {
  const target = runValidation()

  console.log('--------------------------------------------------')
  console.log('GTAR DEV Remote D1 Migration Guard')
  console.log(`Target Database: ${target.databaseName} (${target.databaseId})`)
  console.log(`Target Environment: ${target.env}`)
  console.log(`Config: ${target.configFile}`)
  console.log('Note: Pages deployments do not automatically apply remote D1 migrations.')
  console.log('PROD is NOT targeted by this command.')
  console.log('--------------------------------------------------')

  const isDryRun = process.env.DRY_RUN === '1'
  if (isDryRun) {
    console.log('[DRY_RUN] Verification passed. Wrangler command was not executed.')
    process.exit(0)
  }

  const cmd = 'npx'
  const args = [
    'wrangler',
    'd1',
    'migrations',
    'apply',
    target.databaseName,
    '--remote',
    '--env',
    target.env,
    '--config',
    target.configFile,
  ]

  console.log(`Executing: ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    console.error(`Migration command failed with exit code ${result.status}`)
    process.exit(result.status || 1)
  }
}

if (require.main === module) {
  try {
    main()
  } catch (err) {
    console.error(`[MIGRATION GUARD REJECTED] ${err.message}`)
    process.exit(1)
  }
}

module.exports = { runValidation, EXPECTED_DB_NAME, EXPECTED_DB_UUID, EXPECTED_ENV }
