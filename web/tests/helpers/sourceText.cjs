const fs = require('node:fs')

// Preserve every source-contract byte except checkout-dependent CRLF pairs.
function normalizeSource(text) {
  return text.replace(/\r\n/g, '\n')
}
function readSource(filename) {
  return normalizeSource(fs.readFileSync(filename, 'utf8'))
}
module.exports = { normalizeSource, readSource }
