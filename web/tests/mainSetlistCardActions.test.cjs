const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename
  )

const { GTAR_DEV_VERSION, GTAR_APP_VERSION } = require('../src/types/gtar.ts')

test('PROD_SOURCE_VERSION: package permits DEV source or PROD identity', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
  const validVersions = [GTAR_DEV_VERSION, GTAR_APP_VERSION]
  assert.ok(
    validVersions.includes(pkg.version) || (GTAR_DEV_VERSION === 'untagged-dev' && /^1\.0\.\d+-dev\./.test(pkg.version)),
    `package.json version (${pkg.version}) must match GTAR_DEV_VERSION (${GTAR_DEV_VERSION}) or GTAR_APP_VERSION (${GTAR_APP_VERSION})`
  )
})

test('SHARE_SETLIST: Requires explicit click on Share Setlist in menu to invoke export', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  assert.ok(viewCode.includes('Share Setlist'), 'Three-dot menu must include Share Setlist option')
  assert.ok(
    viewCode.includes('exportSingleSetlistJson(sl, songs)'),
    'Share setlist option must reuse existing exportSingleSetlistJson'
  )
})

