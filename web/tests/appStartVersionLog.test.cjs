// AppStart logs the real build identity: DEV = GTAR_DEV_VERSION (commit SHA), PROD = GTAR_APP_VERSION; never '1.1.108'.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const src = path.join(__dirname, '../src')

const saved = { console: { error: console.error, warn: console.warn, log: console.log, info: console.info, debug: console.debug } }
afterEach(() => {
  Object.assign(console, saved.console)
  delete globalThis.__GTAR_PREVIEW_IDENTITY__; delete globalThis.__GTAR_PROD_VERSION__; delete globalThis.__GTAR_DEV_VERSION__; delete globalThis.__GTAR_DEV_PROVENANCE__
  for (const key of Object.keys(require.cache)) if (key.startsWith(src)) delete require.cache[key]
})

/** Fresh logger with the build defines and the runtime environment of one build; returns the AppStart message. */
function appStart({ dev, defines }) {
  const dom = new JSDOM('', { url: dev ? 'https://dev.gtar-web.pages.dev' : 'https://gtar-web.pages.dev' })
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
  Object.assign(globalThis, defines)
  const load = Module._load
  Module._load = function (request, parent, ...args) {
    if (request === './env' && parent?.filename?.endsWith(path.join('utils', 'logger.ts'))) return { isDevEnv: dev }
    return load.call(this, request, parent, ...args)
  }
  try {
    const { appLogger } = require('../src/utils/logger.ts')
    appLogger.resume()
    const entry = appLogger.getLogs().find(e => e.tag === 'AppStart')
    assert.ok(entry, 'AppStart logged')
    return entry.message
  } finally { Module._load = load; dom.window.close() }
}

test('DEV: GTAR_DEV_VERSION plus the commit SHA', () => {
  const message = appStart({ dev: true, defines: {
    __GTAR_PROD_VERSION__: null, __GTAR_DEV_VERSION__: '1.1.0-dev.2',
    __GTAR_DEV_PROVENANCE__: { tagStatus: 'UNTAGGED', tagName: null, commitSha: '8b8c2dd', deploymentId: null },
  } })
  assert.equal(message, 'App started. Version: 1.1.0-dev.2 (8b8c2dd); Environment: development')
})

test('PROD: GTAR_APP_VERSION from the release identity', () => {
  const message = appStart({ dev: false, defines: { __GTAR_PROD_VERSION__: '1.0.140', __GTAR_DEV_VERSION__: null, __GTAR_DEV_PROVENANCE__: null } })
  assert.equal(message, 'App started. Version: 1.0.140; Environment: production')
})

test('never the legacy 1.1.108 fallback, even without build identity', () => {
  const prod = appStart({ dev: false, defines: {} })
  assert.doesNotMatch(prod, /1\.1\.108/)
  assert.equal(prod, 'App started. Version: unknown (untagged build); Environment: production')
  for (const key of Object.keys(require.cache)) if (key.startsWith(src)) delete require.cache[key]
  const dev = appStart({ dev: true, defines: {} })
  assert.doesNotMatch(dev, /1\.1\.108|\(unknown\)/)
  assert.match(dev, /^App started\. Version: \d+\.\d+\.\d+-dev\.\d+; Environment: development$/)
})


test('PREVIEW: build SHA without enabling DEV environment', () => {
  const message = appStart({ dev: false, defines: {
    __GTAR_PREVIEW_IDENTITY__: { tagStatus: 'UNTAGGED', commitSha: 'abcdef0', branch: 'fix/example' },
  } })
  assert.equal(message, 'App started. Version: PREVIEW · SHA: abcdef0; Environment: production')
})
