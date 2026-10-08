const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { normalizeSource } = require('./helpers/sourceText.cjs')

test('source normalization preserves contract content and only removes CRLF pairs', () => {
  const lf = 'guard() {\n  action()\n}\n'
  assert.equal(normalizeSource(lf), lf)
  assert.equal(normalizeSource(lf.replace(/\n/g, '\r\n')), lf)
  assert.equal(normalizeSource('a\rb\r\nc\n'), 'a\rb\nc\n')
  assert.notEqual(normalizeSource(lf.replace('guard', 'unguarded').replace(/\n/g, '\r\n')), lf)
})

for (const eol of ['LF', 'CRLF']) {
  test(`source contracts retain all assertions with ${eol} checkout input`, () => {
    const env = { ...process.env, GTAR_TEST_CHECKOUT_EOL: eol }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, [
      '--require', path.join(__dirname, 'helpers/checkoutEol.cjs'),
      '--test', '--test-reporter=tap',
      '--test-name-pattern=DEV3A_SETLIST_HIDE_BEHAVIOR|DEV3A_NEW_BLANK_SONG_EDITOR_ACTION|workflow isolates|DEV5C_QA_1_2|single-state binding|DEV3_SETLIST_DRAWER_NAVIGATION|MENU_CLICK_DOES_NOT_LAUNCH_STAGE|RESPONSIVE_RENDER_GUARDS_WHERE_EXISTING',
      ...['dev3aFieldFixes', 'prodPromotionWorkflow', 'dev5cFieldQaUiCorrections', 'transposeKeyCorrectness', 'dev3QolNavigationStageControls', 'librarySetlistDensityQol'].map(name => path.join(__dirname, `${name}.test.cjs`)),
    ], { encoding: 'utf8', env, timeout: 60000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /# fail 0/)
    assert.match(result.stdout, /# tests 8\b/)
  })
}
