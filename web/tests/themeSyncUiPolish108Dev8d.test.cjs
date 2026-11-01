const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webDir = path.resolve(__dirname, '..')

// 2. PAPER CREAM LIGHT READABILITY & CONTRAST
test('PAPER_CREAM_LIGHT_THEME: color ownership belongs to the shared semantic runtime', () => {
  const css = fs.readFileSync(path.join(webDir, 'src/index.css'), 'utf8')
  assert.ok(!css.includes('body.theme-paper-light'))
  for (const token of ['--custom-stage-bg', '--custom-card-song-bg', '--custom-uiPrimaryText', '--custom-uiSecondaryText', '--custom-card-selected-bg', '--custom-chrome-filter-bg']) {
    assert.ok(css.includes(`var(${token}`), token)
  }
})

test('PAPER_CREAM_LIGHT_THEME: ThemeModal preset definition aligns with readable tokens', () => {
  const themeModal = fs.readFileSync(path.join(webDir, 'src/components/ThemeModal.tsx'), 'utf8')

  assert.ok(themeModal.includes("id: 'paper-light'"), 'ThemeModal contains paper-light preset')
  assert.ok(themeModal.includes("name: 'Paper Cream Light'"), 'Preset name is Paper Cream Light')
  assert.ok(themeModal.includes("surfaceHex: '#FFFDF7'"), 'Preset surfaceHex is #FFFDF7')
  assert.ok(themeModal.includes("textHex: '#172033'"), 'Preset textHex is #172033')
  assert.ok(themeModal.includes("bgHex: '#f4ecd8'"), 'Preset bgHex is #f4ecd8')
})

// 3. CLOUD SYNC MANUAL ACTION SAFETY


// 4. HEADER CLOUD SYNC STATUS INDICATOR
