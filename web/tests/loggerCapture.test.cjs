const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
test('capture always records WARN/ERROR and only key INFO events without an enabled setting', () => {
  const { appLogger } = require('../src/utils/logger.ts')
  appLogger.resume(); appLogger.clearLogs()
  appLogger.info('Probe', 'routine noise')
  appLogger.debug('Probe', 'debug noise')
  appLogger.warn('Probe', 'warning')
  appLogger.error('Probe', 'error')
  for (const event of ['AppStart', 'BackupSaved', 'RestoreApplied', 'SignIn', 'SignOut', 'StorageSaveFailure']) appLogger.info(event, event)
  assert.deepEqual(appLogger.getLogs().map(e => e.tag), ['Probe', 'Probe', 'AppStart', 'BackupSaved', 'RestoreApplied', 'SignIn', 'SignOut', 'StorageSaveFailure'])
  assert.doesNotMatch(fs.readFileSync(require.resolve('../src/utils/logger.ts'), 'utf8'), /gtar_debug_logs_enabled/)
})
