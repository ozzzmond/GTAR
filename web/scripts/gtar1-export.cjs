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
  'web/scripts/migrate-dev-remote.cjs', // hard-codes GTAR's dev D1 name and UUID
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
  'const gtar1IsDemo = process.env.CF_PAGES_BRANCH === \'demo\'',
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
  if (json.scripts) delete json.scripts['d1:migrate:dev:remote'] // its script is excluded from the snapshot
  if (json.packages && json.packages['']) json.packages[''].version = version
  return JSON.stringify(json, null, 2) + '\n'
}

// Public branding: GTAR1 is the public name. Every replacement must match exactly `count` times (fail closed).
const BRANDING = [
  { file: 'web/index.html', from: '<title>GTAR Live Stage Companion</title>', to: '<title>GTAR1 Live Stage Companion</title>' },
  { file: 'web/index.html', from: 'name="apple-mobile-web-app-title" content="GTAR"', to: 'name="apple-mobile-web-app-title" content="GTAR1"' },
  { file: 'web/public/manifest.json', from: '"name": "GTAR Live Stage Companion"', to: '"name": "GTAR1 Live Stage Companion"' },
  { file: 'web/public/manifest.json', from: '"short_name": "GTAR"', to: '"short_name": "GTAR1"' },
  // Applied after patchViteConfig. Demo (branch `demo`) shows the release version and a Demo label.
  { file: 'web/vite.config.ts', from: "'<title>GTAR Live Stage Companion</title>'", to: "'<title>' + (gtar1IsDemo ? 'GTAR1 Demo' : 'GTAR1 Live Stage Companion') + '</title>'" },
  { file: 'web/vite.config.ts', from: "'GTAR-Dev Live Stage Companion' : 'GTAR Live Stage Companion'", to: "'GTAR-Dev Live Stage Companion' : (gtar1IsDemo ? 'GTAR1 Demo' : 'GTAR1 Live Stage Companion')" },
  { file: 'web/vite.config.ts', from: "'GTAR-Dev' : 'GTAR'", to: "'GTAR-Dev' : (gtar1IsDemo ? 'GTAR1 Demo' : 'GTAR1')" },
  { file: 'web/vite.config.ts', from: 'JSON.stringify(releaseIdentity?.version ?? null)', to: 'JSON.stringify(releaseIdentity?.version ?? gtar1Release.version)' },
  { file: 'web/src/components/Header.tsx', from: 'aria-label="GTAR home"', to: 'aria-label="GTAR1 home"' },
  { file: 'web/src/components/Header.tsx', from: 'alt="GTAR Logo"', to: 'alt="GTAR1 Logo"' },
  { file: 'web/src/components/Header.tsx', from: 'transition-colors">\n                GTAR\n              </span>', to: 'transition-colors">\n                GTAR1\n              </span>' },
  { file: 'web/src/components/Header.tsx', from: 'border border-app-accent/40">DEV</span>', to: 'border border-app-accent/40">DEMO</span>' },
  { file: 'web/src/components/Header.tsx', from: '<span>About GTAR</span>', to: '<span>About GTAR1</span>' },
  { file: 'web/src/components/AboutModal.tsx', from: '\n              About GTAR\n', to: '\n              About GTAR1\n' },
  { file: 'web/src/components/AboutModal.tsx', from: '<span>GTAR Live Stage Companion</span>', to: '<span>GTAR1 Live Stage Companion</span>' },
  { file: 'web/src/components/AboutModal.tsx', from: 'alt="GTAR Logo"', to: 'alt="GTAR1 Logo"' },
  { file: 'web/src/components/AboutModal.tsx', from: "? 'Preview'", to: "? 'Demo'" },
  { file: 'web/src/utils/headerFormatters.ts', from: 'PREVIEW · ', to: 'DEMO · ', count: 3 },
  { file: 'web/src/main.tsx', from: "'GTAR-Dev Live Stage Companion' : 'GTAR Live Stage Companion'", to: "'GTAR-Dev Live Stage Companion' : (import.meta.env.VITE_GTAR1_DEMO === '1' ? 'GTAR1 Demo' : 'GTAR1 Live Stage Companion')" },
  { file: 'web/src/components/StagePresentationView.tsx', from: "'GTAR Stage Display'", to: "'GTAR1 Stage Display'" },
  { file: 'web/src/components/AboutModal.tsx', from: 'GTAR runs 100% offline.', to: 'GTAR1 runs 100% offline.' },
  { file: 'web/src/components/AuthGate.tsx', from: '<h1 className="text-3xl font-bold">GTAR</h1>', to: '<h1 className="text-3xl font-bold">GTAR1</h1>' },
]

// GTAR1 icon (bebegirl2). Assets live next to this script, not in the source tag, so older tags export too.
const ICON_DIR = path.join(__dirname, 'gtar1-assets')
const ICONS = [
  ...['', '-prod', '-dev'].flatMap(v => [
    [`web/public/pwa${v}-192x192.png`, 'gtar1-icon-192.png'], [`web/public/pwa${v}-512x512.png`, 'gtar1-icon-512.png'],
    [`web/public/apple-touch-icon${v}.png`, 'gtar1-icon-180.png'], [`web/public/favicon${v}.png`, 'gtar1-icon-64.png'],
    [`web/public/favicon${v}.ico`, 'gtar1-favicon.ico'],
  ]),
  ...['web/public/prod-logo.png', 'web/public/dev-logo.png', 'web/src/assets/prod-logo.png', 'web/src/assets/dev-logo.png',
    'web/src/assets/bebeboy-transparent.png', 'web/src/assets/bebegirl1-transparent.png'].map(f => [f, 'gtar1-icon-512.png']),
]

// Demo sample content (#417). Seeds only the demo build; GTAR core ships no sample songs (#228).
const DEMO_SEED_DIR = path.join(__dirname, 'gtar1-assets', 'demo-seed')
const DEMO_SONGS_DECL = 'export const DEFAULT_SETLIST: ActiveSongState[] = []'
const DEMO_SETLISTS_DECL = 'export const DEFAULT_SAMPLE_SETLISTS: WebSetlist[] = []'
const VITE_DEFINE_ANCHOR = "'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),"

function once(file, source, needle) {
  const found = source.split(needle).length - 1
  if (found !== 1) throw new Error(`${file}: "${needle.slice(0, 50)}" found ${found}x, expected 1; export design needs review`)
}

function demoSeedModule(dir = DEMO_SEED_DIR) {
  const songs = JSON.parse(fs.readFileSync(path.join(dir, 'songs.json'), 'utf8'))
  const setlists = JSON.parse(fs.readFileSync(path.join(dir, 'setlists.json'), 'utf8'))
  return "import type { ActiveSongState, WebSetlist } from '../types/gtar'\n\n// Generated by gtar1-export.cjs from demo-seed/. Original or public-domain content only.\n" +
    `export const GTAR1_DEMO_SONGS: ActiveSongState[] = ${JSON.stringify(songs, null, 2)}\n\n` +
    `export const GTAR1_DEMO_SETLISTS: WebSetlist[] = ${JSON.stringify(setlists, null, 2)}\n`
}

function patchDefaultLibrary(source) {
  once('defaultLibrary.ts', source, DEMO_SONGS_DECL)
  once('defaultLibrary.ts', source, DEMO_SETLISTS_DECL)
  const importLine = "import { GTAR1_DEMO_SETLISTS, GTAR1_DEMO_SONGS } from './gtar1DemoSeed'\n"
  return source
    .replace("import type { ActiveSongState, WebSetlist } from '../types/gtar'\n", m => m + importLine)
    .replace(DEMO_SONGS_DECL, "export const DEFAULT_SETLIST: ActiveSongState[] = import.meta.env.VITE_GTAR1_DEMO === '1' ? GTAR1_DEMO_SONGS : []")
    .replace(DEMO_SETLISTS_DECL, "export const DEFAULT_SAMPLE_SETLISTS: WebSetlist[] = import.meta.env.VITE_GTAR1_DEMO === '1' ? GTAR1_DEMO_SETLISTS : []")
}

function patchViteDemoFlag(source) {
  once('vite.config.ts', source, VITE_DEFINE_ANCHOR)
  return source.replace(VITE_DEFINE_ANCHOR, `${VITE_DEFINE_ANCHOR}\n      'import.meta.env.VITE_GTAR1_DEMO': JSON.stringify(gtar1IsDemo ? '1' : ''),`)
}

function applyIcons(out, included) {
  for (const [target, asset] of ICONS) {
    if (!included.includes(target)) throw new Error(`${target} missing from export set; icon mapping needs review`)
    fs.copyFileSync(path.join(ICON_DIR, asset), path.join(out, target))
  }
}

function patchBranding(file, source) {
  let out = source
  for (const rule of BRANDING.filter(r => r.file === file)) {
    const expected = rule.count || 1
    const found = out.split(rule.from).length - 1
    if (found !== expected) throw new Error(`${file}: branding text "${rule.from.slice(0, 40)}" found ${found}x, expected ${expected}; export design needs review`)
    out = out.split(rule.from).join(rule.to)
  }
  return out
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const D1_RENAMES = { 'gtar-db-prod': ['gtar1-db-prod', 'prod'], 'gtar-db-dev': ['gtar1-db-dev', 'dev'] }

// GTAR1 must never bind GTAR's D1 databases or its Cast2 Durable Object worker.
const ABOUT_REPO_LINK = 'href="https://github.com/ozzzmond/GTAR"'
function patchAboutModal(source) {
  if (source.split(ABOUT_REPO_LINK).length !== 2) throw new Error('AboutModal repo link not found exactly once; export design needs review')
  return source.replace(ABOUT_REPO_LINK, 'href="https://github.com/ozzzmond/GTAR1"')
}

function patchWrangler(text, ids) {
  for (const key of ['prod', 'dev']) if (!UUID.test(ids?.[key] || '')) throw new Error(`--d1-${key}-id must be a UUID`)
  const json = JSON.parse(text) // plain JSON only; a JSONC comment makes this fail closed
  const sourceIds = []
  const fix = node => {
    if (Array.isArray(node.d1_databases)) {
      node.d1_databases = node.d1_databases.map(db => {
        const rename = D1_RENAMES[db.database_name]
        if (!rename) throw new Error(`unexpected D1 database ${db.database_name}; export design needs review`)
        sourceIds.push(db.database_id)
        return { ...db, database_name: rename[0], database_id: ids[rename[1]] }
      })
    }
    delete node.durable_objects
    if (node.vars) delete node.vars.CAST2_ORIGIN
  }
  json.name = 'gtar1'
  fix(json)
  for (const env of Object.values(json.env || {})) fix(env)
  const out = JSON.stringify(json, null, 2) + '\n'
  for (const bad of [...sourceIds, 'gtar-db-', 'gtar-stage-cast2', 'gtar-web']) {
    if (bad && out.includes(bad)) throw new Error(`GTAR identifier ${bad} still present in wrangler.jsonc`)
  }
  return out
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

function writeSnapshot(repo, out, result, ids) {
  // Validate before writing anything.
  if (result.included.includes('web/wrangler.jsonc')) patchWrangler(fs.readFileSync(path.join(repo, 'web/wrangler.jsonc'), 'utf8'), ids)
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('--out must not exist or must be empty')
  for (const f of result.included) {
    const target = path.join(out, f)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(repo, f), target)
  }
  applyIcons(out, result.included)
  const patch = (rel, fn) => { const p = path.join(out, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))) }
  patch('web/vite.config.ts', t => patchViteDemoFlag(patchBranding('web/vite.config.ts', patchViteConfig(t))))
  if (!result.included.includes('web/src/data/defaultLibrary.ts')) throw new Error('web/src/data/defaultLibrary.ts missing from export set')
  patch('web/src/data/defaultLibrary.ts', patchDefaultLibrary)
  fs.writeFileSync(path.join(out, 'web/src/data/gtar1DemoSeed.ts'), demoSeedModule())
  for (const f of [...new Set(BRANDING.map(r => r.file))].filter(f => f !== 'web/vite.config.ts')) {
    if (!result.included.includes(f)) throw new Error(`${f} missing from export set`)
    patch(f, t => patchBranding(f, f === 'web/src/components/AboutModal.tsx' ? patchAboutModal(t) : t))
  }
  if (result.included.includes('web/wrangler.jsonc')) patch('web/wrangler.jsonc', t => patchWrangler(t, ids))
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
  if (opts['--out']) writeSnapshot(repo, path.resolve(opts['--out']), result, { prod: opts['--d1-prod-id'], dev: opts['--d1-dev-id'] })
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

module.exports = { mapSourceTag, isExcluded, patchViteConfig, patchPackageVersion, patchWrangler, patchAboutModal, patchBranding, BRANDING, patchDefaultLibrary, patchViteDemoFlag, demoSeedModule, DEMO_SEED_DIR, ICONS, ICON_DIR, scanForSecrets, annotation, plan, writeSnapshot, VITE_IMPORT }
