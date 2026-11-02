const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { availableParallelism } = require('node:os')

const tiers = ['fast', 'scale', 'release', 'workerd']
const directory = path.resolve(__dirname, '../tests')
const manifestPath = path.join(directory, 'tiers.json')

function discover(dir = directory) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.cjs'))
    .map(entry => entry.name).sort()
}

function partition(files, manifest) {
  if (manifest.default !== 'fast' || !Array.isArray(manifest.files)) throw new Error('Expected default fast and a files array')
  const known = new Set(files)
  if (known.size !== files.length) throw new Error('Duplicate discovered file')
  const overrides = new Map()
  for (const entry of manifest.files) {
    if (!entry || !known.has(entry.file)) throw new Error(`Unknown test file: ${entry?.file}`)
    if (!tiers.includes(entry.tier)) throw new Error(`Unknown tier: ${entry.tier}`)
    if (overrides.has(entry.file)) throw new Error(`Duplicate tier assignment: ${entry.file}`)
    overrides.set(entry.file, entry.tier)
  }
  return Object.fromEntries(tiers.map(tier => [tier, files.filter(file => (overrides.get(file) ?? manifest.default) === tier)]))
}

// Isolated processes retain each file's globals, hooks and complete test selection.
// Bound concurrency to avoid launching the whole suite (and its DOMs) at once.
async function runFiles(files, { concurrency = 4, report = console.log } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer')
  const started = performance.now()
  const results = []
  let next = 0
  async function worker() {
    while (next < files.length) {
      const file = files[next++]
      const start = performance.now()
      const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { env: { ...process.env, NODE_TEST_CONTEXT: undefined } })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
      const result = { file, code, ms: performance.now() - start }
      for (const key of ['tests', 'pass', 'fail', 'skipped']) result[key] = Number(output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? 0)
      results.push(result)
      report(`${code === 0 ? 'PASS' : 'FAIL'} ${path.basename(file)} ${(result.ms / 1000).toFixed(3)} s`)
      if (code !== 0) report(output)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  return { results, ms: performance.now() - started, success: results.every(result => result.code === 0) }
}

async function main(args) {
  const [tier = 'fast', ...flags] = args
  if (![...tiers, 'all'].includes(tier) || flags.some(flag => flag !== '--timing') || new Set(flags).size !== flags.length) {
    throw new Error('Usage: node scripts/run-tests.cjs [fast|scale|release|workerd|all] [--timing]')
  }
  const files = discover()
  const groups = partition(files, JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  // The human category catalog still covers every file exactly once, regardless of tier.
  require('./test-catalog.cjs').run('--check')
  const selected = tier === 'all' ? files : groups[tier]
  const concurrency = process.env.GTAR_TEST_CONCURRENCY === undefined ? Math.min(4, availableParallelism()) : Number(process.env.GTAR_TEST_CONCURRENCY)
  console.log(`Test tier ${tier}: ${selected.length}/${files.length} files; concurrency ${concurrency}`)
  const result = await runFiles(selected.map(file => path.join(directory, file)), { concurrency })
  const totals = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(key => [key, result.results.reduce((n, row) => n + row[key], 0)]))
  console.log(`Test tier ${tier}: ${result.success ? 'PASS' : 'FAIL'}; ${result.results.length} files; ${JSON.stringify(totals)}; ${(result.ms / 1000).toFixed(3)} s`)
  if (flags.includes('--timing')) {
    console.log('25 slowest files (wall time, includes setup):')
    for (const row of [...result.results].sort((a, b) => b.ms - a.ms).slice(0, 25)) console.log(`${(row.ms / 1000).toFixed(3)} s ${path.basename(row.file)}`)
  }
  if (!result.success) process.exitCode = 1
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { tiers, discover, partition, runFiles }
