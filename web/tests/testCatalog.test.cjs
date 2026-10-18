const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { generate, run } = require('../scripts/test-catalog.cjs')

const source = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')
const blank = source.replace(/(<!-- test-catalog:\w+:start -->)[\s\S]*?(<!-- test-catalog:\w+:end -->)/g, '$1\n$2')
const link = name => `- [${name}](${name})\n`
const put = (text, group, names) => text.replace(`<!-- test-catalog:${group}:start -->\n`, marker => marker + names.map(link).join(''))
const human = text => text.replace(/(<!-- test-catalog:\w+:start -->)[\s\S]*?(<!-- test-catalog:\w+:end -->)/g, '$1$2')

function fixture(t, readme = blank) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-test-catalog-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'README.md'), readme)
  return {
    directory,
    add: name => fs.writeFileSync(path.join(directory, name), ''),
    read: () => fs.readFileSync(path.join(directory, 'README.md'), 'utf8'),
  }
}

test('addition uses deterministic sorted fallback; write is byte-idempotent and preserves human text', t => {
  const original = put(blank, 'AUTH', ['known.test.cjs']) + '\nHuman footer: café 🎵\n'
  const f = fixture(t, original)
  for (const name of ['zNew.test.cjs', 'known.test.cjs', 'aNew.test.cjs']) f.add(name)
  assert.throws(() => run('--check', f.directory), /missing: aNew\.test\.cjs/)
  run('--write', f.directory)
  const first = f.read()
  assert.equal(human(first), human(original))
  assert.match(first, /test-catalog:AUTH:start -->\n- \[known/)
  assert.match(first, /test-catalog:UNCLASSIFIED:start -->\n- \[aNew[^\n]+\n- \[zNew/)
  assert.equal(first.includes('\r'), false)
  run('--write', f.directory)
  assert.equal(f.read(), first)
  assert.equal(generate(original, ['known.test.cjs', 'aNew.test.cjs', 'zNew.test.cjs']).output, first)
  assert.equal(run('--check', f.directory), 3)
})

test('rename detects stale and missing names, then moves replacement to fallback', t => {
  const f = fixture(t, put(blank, 'STAGE', ['old.test.cjs']))
  f.add('old.test.cjs')
  fs.renameSync(path.join(f.directory, 'old.test.cjs'), path.join(f.directory, 'renamed.test.cjs'))
  assert.throws(() => run('--check', f.directory), /stale: old\.test\.cjs[\s\S]*missing: renamed\.test\.cjs/)
  run('--write', f.directory)
  assert.equal(f.read().includes(link('old.test.cjs')), false)
  assert.match(f.read(), /test-catalog:UNCLASSIFIED:start -->\n- \[renamed/)
  run('--check', f.directory)
})

test('deletion and stale entries are removed without losing category prose', t => {
  const original = put(blank, 'THEMES', ['deleted.test.cjs', 'stale.test.cjs'])
  const f = fixture(t, original)
  f.add('deleted.test.cjs')
  fs.unlinkSync(path.join(f.directory, 'deleted.test.cjs'))
  assert.throws(() => run('--check', f.directory), /stale: deleted\.test\.cjs[\s\S]*stale: stale\.test\.cjs/)
  run('--write', f.directory)
  assert.equal(f.read(), blank)
})

test('duplicates within and across categories fail check; write keeps first category', t => {
  const original = put(put(blank, 'AUTH', ['same.test.cjs', 'same.test.cjs']), 'STAGE', ['same.test.cjs'])
  const f = fixture(t, original)
  f.add('same.test.cjs')
  assert.throws(() => run('--check', f.directory), /duplicate: same\.test\.cjs/)
  run('--write', f.directory)
  assert.equal(f.read().split(link('same.test.cjs')).length - 1, 1)
  assert.match(f.read(), /test-catalog:AUTH:start -->\n- \[same/)
  run('--check', f.directory)
})

test('check never changes README bytes or mtime on either success or drift', t => {
  const f = fixture(t)
  const file = path.join(f.directory, 'README.md')
  fs.utimesSync(file, new Date(0), new Date(0))
  const before = fs.statSync(file).mtimeMs
  run('--check', f.directory)
  f.add('new.test.cjs')
  assert.throws(() => run('--check', f.directory), /catalog drift/)
  assert.equal(f.read(), blank)
  assert.equal(fs.statSync(file).mtimeMs, before)
})

test('discovery remains flat and limited to regular .test.cjs files', t => {
  const f = fixture(t)
  f.add('real.test.cjs')
  f.add('helper.cjs')
  fs.mkdirSync(path.join(f.directory, 'nested'))
  fs.writeFileSync(path.join(f.directory, 'nested/hidden.test.cjs'), '')
  fs.mkdirSync(path.join(f.directory, 'directory.test.cjs'))
  assert.equal(run('--write', f.directory), 1)
  assert.match(f.read(), /\[real\.test\.cjs\]/)
  assert.doesNotMatch(f.read(), /\[(?:hidden|directory|helper)\./)
})

test('unsorted catalog entries fail check and are sorted by write', t => {
  const f = fixture(t, put(blank, 'AUTH', ['z.test.cjs', 'a.test.cjs']))
  f.add('a.test.cjs')
  f.add('z.test.cjs')
  assert.throws(() => run('--check', f.directory), /not sorted\/canonical/)
  run('--write', f.directory)
  assert.match(f.read(), /test-catalog:AUTH:start -->\n- \[a[^\n]+\n- \[z/)
})

test('malformed markers and unexpected managed prose fail closed without writing', t => {
  for (const damaged of [
    blank.replace('<!-- test-catalog:AUTH:end -->', ''),
    blank + '\n<!-- test-catalog:AUTH:start -->',
    blank.replace('<!-- test-catalog:AUTH:start -->\n', '<!-- test-catalog:AUTH:start -->\nKeep this prose\n'),
    blank.replace('<!-- test-catalog:AUTH:end -->', '<!-- test-catalog:STAGE:end -->'),
  ]) {
    const f = fixture(t, damaged)
    assert.throws(() => run('--write', f.directory), /Invalid catalog markers|Unexpected content|overlap/)
    assert.equal(f.read(), damaged)
  }
})

test('CLI rejects unknown, absent, or extra arguments with nonzero status', () => {
  for (const args of [[], ['--oops'], ['--write', '--check']]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/test-catalog.cjs'), ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /argument|Usage/)
  }
})
