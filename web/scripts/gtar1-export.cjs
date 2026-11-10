#!/usr/bin/env node
// Owner-run sanitized snapshot export from GTAR PROD to GTAR1 (#445).
// Dry run by default. Never pushes, tags or deploys; it only writes into an empty --out directory.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SOURCE_TAG = /^v1\.2\.(0|[1-9]\d*)$/
// Paths (exact file, or directory prefix ending in "/") that must never reach the public repo.
const DENY = [
  '.agents/', '.impeccable/', '.pafs/', '.github/', 'design/', 'docs/', 'tests/',
  'AGENTS.md', 'CLAUDE.md', 'GLOSSARY.md', 'RELEASE_WORKFLOW_README.md', 'SYNC_RECOVERY.md',
  'gtar_standing_protocol_v1.md', 'plan.md',
  // Public docs are owned by GTAR1 itself (#419); the export never overwrites them.
  'README.md', 'LICENSE', 'LICENSE.md',
  'web/tests/', 'web/docs/', 'web/GOOGLE_SYNC.md', 'web/LEGACY_IMPORT_COMPATIBILITY.md',
  'web/wrangler.stage-cast2-dev.jsonc',
]
const DENY_PATTERNS = [/^web\/STAGE_CAST2_.*\.md$/, /(^|\/)\.dev\.vars/, /(^|\/)\.env(\..*)?$/]
const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AIza[0-9A-Za-z_-]{35}/, /\bgh[pousr]_[0-9A-Za-z]{36,}\b/, /\bsk-[A-Za-z0-9]{32,}\b/]
const CREATE_REQUIRE_IMPORT = "import { createRequire } from 'node:module'\n"
const VITE_IMPORT = "const { resolveReleaseIdentity, resolveDevIdentity, getCommittedDevVersion } = createRequire(import.meta.url)('../.github/release_identity.cjs')"
const VITE_SHIM = [
  "import { readFileSync as gtar1ReadFileSync } from 'node:fs'",
  "// GTAR1 build identity: exported snapshots have no GTAR history or tags, so the version comes from",
  "// gtar1-release.json (written by the export script) instead of GTAR's tag-verified identity.",
  "const gtar1Release = JSON.parse(gtar1ReadFileSync(path.resolve(import.meta.dirname, 'gtar1-release.json'), 'utf8'))",
  "const resolveReleaseIdentity = (_root: string, env: Record<string, string | undefined> = process.env) => env.CF_PAGES_BRANCH === 'main'",
  "  ? { version: gtar1Release.version, sourceTag: gtar1Release.sourceTag, sha: gtar1Release.sourceSha }",
  '  : null',
  'type Gtar1DevIdentity = { tag?: string; version?: string; tagStatus?: string; shortSha?: string; deploymentId?: string } | null',
  'const resolveDevIdentity = (..._args: unknown[]): Gtar1DevIdentity => null',
  'const getCommittedDevVersion = (..._args: unknown[]): string => gtar1Release.version',
].join('\n')

function mapSourceTag(tag) {
  if (!SOURCE_TAG.test(tag || '')) throw new Error('source tag must be a canonical GTAR PROD tag v1.2.N')
  const patch = tag.slice('v1.2.'.length)
  return { sourceTag: tag, gtar1Tag: `v1.0.${patch}`, version: `1.0.${patch}` }
}

function isExcluded(file) {
  return DENY.some(rule => (rule.endsWith('/') ? file.startsWith(rule) : file === rule)) || DENY_PATTERNS.some(re => re.test(file))
}

function patchViteConfig(source) {
  if (source.split(VITE_IMPORT).length !== 2) throw new Error('vite.config.ts identity import not found exactly once; export design needs review')
  if (source.split(CREATE_REQUIRE_IMPORT).length !== 2) throw new Error('vite.config.ts createRequire import not found exactly once; export design needs review')
  return source.replace(CREATE_REQUIRE_IMPORT, '').replace(VITE_IMPORT, VITE_SHIM)
}

function patchPackageVersion(text, version) {
  const json = JSON.parse(text)
  json.version = version
  if (json.packages && json.packages['']) json.packages[''].version = version
  return JSON.stringify(json, null, 2) + '\n'
}

function scanForSecrets(file, buffer) {
  if (buffer.includes(0)) return []
  const text = buffer.toString('utf8')
  return SECRET_PATTERNS.filter(re => re.test(text)).map(re => `${file}: matches ${re}`)
}

function annotation(map, sha) {
  return `GTAR1 ${map.gtar1Tag} = GTAR PROD ${map.sourceTag} @ ${sha}`
}

function plan(repo, sourceTag) {
  const map = mapSourceTag(sourceTag)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const sha = git('rev-parse', 'HEAD')
  if (git('rev-parse', `refs/tags/${sourceTag}^{commit}`) !== sha) throw new Error(`HEAD must be exactly ${sourceTag}`)
  if (git('status', '--porcelain')) throw new Error('working tree must be clean')
  const all = git('ls-files', '-z').split('\0').filter(Boolean)
  const included = all.filter(f => !isExcluded(f))
  const excluded = all.filter(isExcluded)
  const problems = []
  for (const f of included) problems.push(...scanForSecrets(f, fs.readFileSync(path.join(repo, f))))
  if (problems.length) throw new Error('possible secrets in export set:\n' + problems.join('\n'))
  for (const f of ['web/vite.config.ts', 'web/package.json']) if (!included.includes(f)) throw new Error(`${f} missing from export set`)
  return { ...map, sha, included, excluded, annotation: annotation(map, sha) }
}

function writeSnapshot(repo, out, result) {
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('--out must not exist or must be empty')
  for (const f of result.included) {
    const target = path.join(out, f)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(repo, f), target)
  }
  const patch = (rel, fn) => { const p = path.join(out, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))) }
  patch('web/vite.config.ts', patchViteConfig)
  patch('web/package.json', t => patchPackageVersion(t, result.version))
  if (result.included.includes('web/package-lock.json')) patch('web/package-lock.json', t => patchPackageVersion(t, result.version))
  fs.writeFileSync(path.join(out, 'web/gtar1-release.json'), JSON.stringify({
    version: result.version, gtar1Tag: result.gtar1Tag, sourceTag: result.sourceTag, sourceSha: result.sha,
  }, null, 2) + '\n')
}

function main(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 2) opts[argv[i]] = argv[i + 1]
  const repo = path.resolve(opts['--repo'] || path.join(__dirname, '../..'))
  const result = plan(repo, opts['--source-tag'])
  if (opts['--out']) writeSnapshot(repo, path.resolve(opts['--out']), result)
  console.log(JSON.stringify({
    mode: opts['--out'] ? 'WROTE_SNAPSHOT' : 'DRY_RUN', gtar1Tag: result.gtar1Tag, sourceTag: result.sourceTag, sha: result.sha,
    included: result.included.length, excluded: result.excluded.length, annotation: result.annotation,
    note: 'No tag, push or deploy performed. Create the GTAR1 tag manually with the annotation above after owner authorization.',
  }, null, 2))
  if (!opts['--out']) console.log('EXCLUDED:\n' + result.excluded.join('\n'))
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (e) { console.error('EXPORT FAILED: ' + e.message); process.exit(1) }
}

module.exports = { mapSourceTag, isExcluded, patchViteConfig, patchPackageVersion, scanForSecrets, annotation, plan, writeSnapshot, VITE_IMPORT }
