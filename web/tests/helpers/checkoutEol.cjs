// Child-process fixture: emulate checkout line endings without editing files.
const fs = require('node:fs')
const path = require('node:path')
const originalRead = fs.readFileSync
const root = path.resolve(__dirname, '../../..')
const eol = process.env.GTAR_TEST_CHECKOUT_EOL === 'CRLF' ? '\r\n' : '\n'
fs.readFileSync = function (filename, options) {
  const result = originalRead.call(this, filename, options)
  if (typeof filename !== 'string' || typeof result !== 'string') return result
  const relative = path.relative(root, filename).replace(/\\/g, '/')
  if (!relative.startsWith('web/src/') && relative !== 'RELEASE_WORKFLOW_README.md' && relative !== '.github/workflows/release.yml') return result
  return result.replace(/\r\n/g, '\n').replace(/\n/g, eol)
}
