// #204 S2: capture starts before sign-in; exports redact emails and the signed-in account's ids; Share exists.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
const logger = require('../src/utils/logger.ts')
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

test('emails and account identifier fields are redacted; song and record ids are kept', () => {
  const songId = 'f6704a66-15cd-4275-bae4-012feb9e9b69'
  const out = logger.redactSensitiveData(`login failed for someone@example.com {"userId":"89ecf749-8c31","google_sub":"1166703328","songId":"${songId}"} user_id=abc123`)
  assert.doesNotMatch(out, /someone@example\.com|89ecf749-8c31|1166703328|abc123/)
  assert.match(out, /\[REDACTED_EMAIL\]/)
  assert.ok(out.includes(songId), 'record ids stay useful for debugging')
})

test('identifiers registered at sign-in are redacted wherever they appear', () => {
  logger.registerRedactedIdentifiers('89ecf749-8c31-4b39-a56f-c1d823cc6ee2', '116670332858522496560', null, 'abc')
  const out = logger.redactSensitiveData('records for 89ecf749-8c31-4b39-a56f-c1d823cc6ee2 (sub 116670332858522496560) ok')
  assert.equal(out, 'records for [REDACTED_ID] (sub [REDACTED_ID]) ok')
  assert.equal(logger.redactSensitiveData('abc stays'), 'abc stays', 'too short to register')
})

test('capture starts at startup, before sign-in; AuthGate no longer suspends it', () => {
  const main = read('src/main.tsx')
  assert.match(main, /import\('\.\/utils\/logger'\)\.then\(\(\{ appLogger \}\) => appLogger\.resume\(\)\)/)
  const gate = read('src/components/AuthGate.tsx')
  assert.doesNotMatch(gate, /appLogger\.suspend\(\)/)
  assert.match(gate, /registerRedactedIdentifiers\(sessionUserId, sessionUserSub\)/)
})

test('a second resume keeps entries captured in memory (no reload from storage)', () => {
  const Engine = logger.appLogger.constructor
  const engine = new Engine()
  engine.resume()
  for (let i = 0; i < 40; i++) engine.warn('T', `w${i}`)
  engine.resume()
  assert.ok(engine.getLogs().filter(l => /^w\d+$/.test(l.message)).length >= 40)
})

test('Debug Logs has a Share action that exports everything stored', () => {
  const modal = read('src/components/DebugLogsModal.tsx')
  assert.match(modal, /data-testid="debug-logs-share"/)
  assert.match(modal, /exportAllLogsAsText\(\)[\s\S]*navigator\.share/)
})

test('Share sends only the log file (no title, which iOS adds as an extra text.txt)', () => {
  const modal = read('src/components/DebugLogsModal.tsx')
  assert.match(modal, /navigator\.share\(\{ files: \[file\] \}\)/)
})
