#!/usr/bin/env node
// Read-only metadata for an explicitly requested canonical GitHub DEV tag.
const { execFileSync } = require('node:child_process')
const { readFileSync, appendFileSync } = require('node:fs')
const path = require('node:path')

function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 2 || args[0] !== '--tag') throw new Error('Require exactly --tag <canonical DEV tag>')
    const tag = args[1]
    const match = /^v1\.0\.([1-9]\d*)-dev\.([1-9]\d*)([a-z]?)$/.exec(tag)
    if (!match) throw new Error('Invalid canonical DEV tag')
    const root = path.resolve(__dirname, '..')
    const git = (...argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    // Exact ref lookup accepts lightweight and annotated tags, and rejects branch aliases.
    git('show-ref', '--verify', `refs/tags/${tag}`)
    const taggedCommit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
    if (taggedCommit !== git('rev-parse', '--verify', 'HEAD')) throw new Error('Peeled tag commit must equal HEAD')
    const version = JSON.parse(readFileSync(path.join(root, 'web/package.json'), 'utf8')).version
    if (version !== tag.slice(1)) throw new Error('web/package.json version must equal tag without leading v')
    const output = `RELEASE_TAG=${tag}\nRELEASE_TITLE=GTAR ${tag}\nIS_PRERELEASE=true\nIS_PROMOTABLE=${match[3] === ''}\n`
    // No metadata is emitted or appended until every validation above succeeds.
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, output, 'utf8')
    process.stdout.write(output)
    return 0
  } catch (error) {
    process.stderr.write(`Release metadata error: ${error.message}\n`)
    return 1
  }
}
if (require.main === module) process.exitCode = main()
module.exports = { main }
