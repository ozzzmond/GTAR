// #453 A3: `npm run build` (tsc -b) must type-check Pages Functions and Workers, not only src/.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('build type-checks Pages Functions and Workers', () => {
  const web = path.join(__dirname, '..')
  const read = file => JSON.parse(fs.readFileSync(path.join(web, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
  assert.ok(read('tsconfig.json').references.some(reference => reference.path === './tsconfig.functions.json'))
  assert.deepEqual(read('tsconfig.functions.json').include, ['functions', 'workers'])
  assert.match(read('package.json').scripts.build, /^tsc -b && /)
})
