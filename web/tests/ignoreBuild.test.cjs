const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const scriptPath = path.resolve(__dirname, '../scripts/ignore-build.cjs')

test('Cloudflare Pages ignore rule proceeds on authoritative branches dev and main', () => {
  for (const branch of ['dev', 'main']) {
    const res = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, CF_PAGES_BRANCH: branch },
      encoding: 'utf-8',
    })
    assert.equal(res.status, 1, `Branch ${branch} should exit with code 1 to proceed with build`)
    assert.match(res.stdout, /Authoritative branch/)
  }
})

test('Cloudflare Pages ignore rule skips build on tag pushes and non-authoritative refs', () => {
  for (const ref of ['web-v1.0.87-dev.7', 'app-v1.0.87-dev.7', 'refs/tags/web-v1.0.87-dev.7', 'feature-branch']) {
    const res = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, CF_PAGES_BRANCH: ref },
      encoding: 'utf-8',
    })
    assert.equal(res.status, 0, `Ref ${ref} should exit with code 0 to skip redundant build`)
    assert.match(res.stdout, /Skipping redundant build/)
  }
})

test('Cloudflare Pages ignore rule proceeds in local or non-Cloudflare environments', () => {
  const res = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, CF_PAGES_BRANCH: '' },
    encoding: 'utf-8',
  })
  assert.equal(res.status, 1, 'Empty branch should exit with code 1 to proceed locally')
})
