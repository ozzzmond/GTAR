// #224: redundant helper copy removed from the TV pairing modal; pairing steps are on demand.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.join(__dirname, '..', 'src', 'components', file), 'utf8')

test('TV pairing modal: no subtitle, no URL paragraph, no long pop-out paragraph', () => {
  const modal = read('TvPresentationModal.tsx')
  assert.doesNotMatch(modal, /Open the stage presentation page on a secondary display/)
  assert.doesNotMatch(modal, /Open this bookmarkable URL/)
  assert.doesNotMatch(modal, /Drag the window there/)
  assert.match(modal, /TV \/ External Display/, 'title kept')
  assert.match(modal, /aria-label="TV Page URL"/, 'URL field keeps its accessible name')
  assert.match(modal, /HDMI or second screen/, 'short pop-out hint kept')
})

test('TV pairing controls: status, labels and errors kept; steps behind a native "How to pair" disclosure', () => {
  const panel = read('StageCast2Panel.tsx')
  assert.match(panel, /'Ready to pair'/)
  assert.match(panel, /TV reference/)
  assert.match(panel, /Six-digit TV PIN/)
  assert.match(panel, /role="alert"/)
  assert.doesNotMatch(panel, /Manual reference entry is always available/)
  assert.match(panel, /<details data-testid="cast2-how-to-pair"[\s\S]*<summary[^>]*>How to pair<\/summary>/)
})

// #224 slice 2: no hover tooltips (title on HTML elements) except on truncated text, where it shows the full value.
test('no title tooltips on HTML elements, except truncated text', () => {
  const ts = require('typescript')
  const dir = path.join(__dirname, '..', 'src')
  const found = []
  for (const rel of fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.tsx'))) {
    const file = path.join(dir, rel)
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[a-z]/.test(node.tagName.getText(sf))) {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
        const title = attrs.find(a => a.name.getText(sf) === 'title')
        const cls = attrs.find(a => a.name.getText(sf) === 'className')
        if (title && !/truncate/.test(cls ? cls.getText(sf) : '')) found.push(`${rel}:${sf.getLineAndCharacterOfPosition(title.getStart(sf)).line + 1}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  assert.deepEqual(found, [])
})

// #224 slice 3: redundant subtitles and explanations removed or shortened (owner-approved wording 2026-10-25).
test('redundant helper copy is gone; shortened wording in place; safety text kept', () => {
  const all = fs.readdirSync(path.join(__dirname, '..', 'src', 'components')).filter(f => f.endsWith('.tsx')).map(read).join('\n')
  for (const gone of ['Tailor stage, chrome, cards, inputs', 'Fine-grained performance colors', 'Real-time console errors, window events',
    'Server-authoritative Google account management', 'Open chords online with 1-tap', 'Choose an import method for your songs',
    'Manage your GTAR songbook and setlists backup', 'Setlists stay completely separate', 'deferred backend tasks', 'Sync Now is enough for normal use',
    'immutable QR code and link snapshot', 'Historical song content and original imported snapshots']) assert.ok(!all.includes(gone), gone)
  for (const kept of ['Tap a string to hear its pitch.', 'Follow an Android Stage Leader on the same Wi-Fi or hotspot.', 'Replaces all songs, setlists and trash.',
    'Adds and updates songs; deletes nothing.', 'Team members can view it and save their own copy. Yours stays unchanged.', 'Choose a setlist to share:',
    'Applies to the TV only.', 'Create a song or import charts.', 'a copy is kept in Review local recovery', 'Scan with mobile camera']) assert.ok(all.includes(kept), kept)
})
