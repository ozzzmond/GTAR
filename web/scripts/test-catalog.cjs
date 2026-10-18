const fs = require('node:fs')
const path = require('node:path')

const groups = [
  'AUTH', 'CLOUD_SYNC_AND_STORAGE', 'THEMES', 'STAGE',
  'SONGBOOK_AND_EDITOR', 'SECURITY_AND_API', 'INFRASTRUCTURE', 'UNCLASSIFIED',
]
const start = group => `<!-- test-catalog:${group}:start -->`
const end = group => `<!-- test-catalog:${group}:end -->`
const entry = /^- \[([^\]\r\n]+\.test\.cjs)\]\(\1\)$/

function generate(readme, files) {
  const names = [...files].sort() // Code-unit ordering, independent of locale.
  const existing = new Set(names)
  const assigned = new Set()
  const regions = []
  const problems = []
  for (const group of groups) {
    const begin = readme.indexOf(start(group))
    const finish = readme.indexOf(end(group))
    if (begin < 0 || finish < begin ||
        readme.indexOf(start(group), begin + 1) !== -1 ||
        readme.indexOf(end(group), finish + 1) !== -1) {
      throw new Error(`Invalid catalog markers: ${group}`)
    }
    const from = begin + start(group).length
    const body = readme.slice(from, finish)
    const members = []
    for (const line of body.split('\n').filter(line => line.trim())) {
      const match = entry.exec(line)
      if (!match || /[/\\]/.test(match[1])) {
        throw new Error(`Unexpected content in generated region: ${group}`)
      }
      const name = match[1]
      if (assigned.has(name)) problems.push(`duplicate: ${name}`)
      else if (existing.has(name)) members.push(name)
      if (!existing.has(name)) problems.push(`stale: ${name}`)
      assigned.add(name)
    }
    regions.push({ from, to: finish, members, group })
  }
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].from <= regions[i - 1].to) throw new Error('Catalog regions overlap or are out of order')
  }
  const fallback = regions.at(-1).members
  for (const name of names) {
    if (!assigned.has(name)) {
      problems.push(`missing: ${name}`)
      fallback.push(name)
    }
  }
  let output = readme
  for (const region of [...regions].reverse()) {
    const lines = region.members.sort().map(name => `- [${name}](${name})`)
    output = output.slice(0, region.from) + '\n' + lines.join('\n') + (lines.length ? '\n' : '') + output.slice(region.to)
  }
  return { output, problems }
}

function run(mode, directory = path.join(__dirname, '../tests')) {
  if (!['--write', '--check'].includes(mode)) throw new Error('Usage: node web/scripts/test-catalog.cjs --write|--check')
  const readmePath = path.join(directory, 'README.md')
  const readme = fs.readFileSync(readmePath, 'utf8')
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter(file => file.isFile() && file.name.endsWith('.test.cjs'))
    .map(file => file.name)
  const { output, problems } = generate(readme, files)
  if (mode === '--write') {
    if (output !== readme) fs.writeFileSync(readmePath, output, 'utf8')
  } else if (output !== readme) {
    throw new Error(`Test catalog drift; run node web/scripts/test-catalog.cjs --write\n${problems.join('\n') || 'Generated entries are not sorted/canonical'}`)
  }
  return files.length
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected exactly one argument: --write or --check')
    console.log(`Test catalog OK: ${run(process.argv[2])} files (${process.argv[2]})`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { generate, run }
