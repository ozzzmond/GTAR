const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const obsolete = /(^|\/)(android|app|gradle|\.gradle|\.idea|buildSrc)(\/|$)|(^|\/)(gradlew(?:\.bat)?|[^/]*\.gradle(?:\.kts)?|gradle\.properties|local\.properties|AndroidManifest\.xml|release_web\.py|push_release\.py|deploy(?:_web)?\.py|test_release_scripts\.py|test_deploy_and_push\.py|release_metadata\.py)$|\.(apk|aab|kt|keystore|jks)$/i
function violations(paths) { return paths.filter(p => obsolete.test(p)) }
test('tracked repository contains no native Android/Gradle or obsolete local release tooling', () => {
  // Deleted files in an uncommitted PR worktree are intentionally excluded.
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(p => p && fs.existsSync(path.join(root, p)))
  assert.deepEqual(violations(files), [])
  for (const required of ['web/package.json', 'web/vite.config.ts', 'web/public/manifest.json', '.github/release_metadata.cjs']) assert.ok(fs.existsSync(path.join(root, required)), required)
})
test('boundary rejects representative native and local-release regressions while allowing Android browser support', () => {
  const bad = ['app/src/main/AndroidManifest.xml', 'gradle/wrapper/gradle-wrapper.jar', 'gradlew.bat', 'settings.gradle.kts', '.gradle/cache', 'release_web.py', 'deploy.py', 'deploy_web.py', 'push_release.py', '.github/release_metadata.py']
  assert.deepEqual(violations(bad), bad)
  assert.deepEqual(violations(['web/src/utils/stageCast.ts', 'web/tests/backupRoundTrip.test.cjs', 'audit_local.py']), [])
})
