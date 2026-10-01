const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client')
const metadata = require('../src/utils/songMetadata.ts')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')
const { acceptOriginalKey, alignChartKey, establishChartKey, trustworthyChartKey, transposeChartText } = require('../src/utils/chartKeyAlignment.ts')
const { parseGtarSong } = require('../src/utils/songParser.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const { normalizeBackupSong, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const { computeSongbookChecksum, reconcileSongbook } = require('../src/utils/cloudSongbookSync.ts')
const song = { id: 'aligned', title: 'Song', artist: 'Band', key: 'G', originalKey: 'A', rawContent: '{key: G}\n[G]One [C]two [D/F#]three [Em7]four', format: 'CHORD_PRO', transposeOffset: 0, capo: '', bpm: '', tags: 'User edit' }
const apply = (s, key) => ({ ...s, ...acceptOriginalKey(s, key).changes })

test('8h trusted G to D changes chords and both keys atomically; D to D and repeated D are idempotent', () => {
 const aligned = apply(song, 'D')
 assert.equal(aligned.rawContent, '{key: D}\n[D]One [G]two [A/C#]three [Bm7]four')
 assert.equal(aligned.key, 'D'); assert.equal(aligned.originalKey, 'D')
 assert.deepEqual(apply(aligned, 'D'), aligned)
 assert.equal(parseGtarSong(aligned.rawContent).key, 'D')
 assert.equal(parseGtarSong(aligned.rawContent).lines[0].segments[0].chord, 'D')
})
test('8h manual D to E preserves Original Key and unrelated user fields', () => {
 const aligned = apply(song, 'D'), manual = { ...aligned, ...alignChartKey(aligned, 'E').changes }
 assert.equal(manual.rawContent, '{key: E}\n[E]One [A]two [B/D#]three [C#m7]four')
 assert.equal(manual.originalKey, 'D'); assert.equal(manual.key, 'E'); assert.equal(manual.tags, song.tags)
})
test('8h legacy labels, inferred tonic, invalid and conflicting declarations are untrusted', () => {
 for (const s of [{...song, key:''}, {...song, key:'H'}, {...song, rawContent:'[G] [C] [D]'}, {...song, rawContent:'{key: C}\n[G] [C]'}, {...song, rawContent:'{key: G}\n{key: C}\n[G]'}]) {
  assert.equal(trustworthyChartKey(s), null)
  const result = acceptOriginalKey(s, 'D')
  assert.equal(result.needsSource, true); assert.deepEqual(result.changes, { originalKey: 'D' })
 }
})
test('8h explicit source establishment or confirmation of already aligned chords is safe and persistent', () => {
 const unknown = {...song, key:'', rawContent:'[G] [C] [D]'}
 const established = {...unknown, key:'G', rawContent:establishChartKey(unknown.rawContent, 'G')}
 assert.equal(apply(established, 'D').rawContent, '{key: D}\n[D] [G] [A]')
 assert.equal(alignChartKey({...unknown, rawContent:'[D] [G] [A]'}, 'D', 'D').changes.rawContent, '{key: D}\n[D] [G] [A]')
 assert.deepEqual(alignChartKey(unknown, 'D', 'H').changes, {})
})
test('8h extensions, alterations, slash bass, enharmonics and minor keys retain musical meaning', () => {
 const raw = '{key: G}\n[Gmaj7/B] [Em7b5] [D7#9/F#] [C6/9] [Bbadd9/F]'
 assert.equal(apply({...song,rawContent:raw}, 'D').rawContent, '{key: D}\n[Dmaj7/F#] [Bm7b5] [A7#9/C#] [G6/9] [Fadd9/C]')
 assert.equal(acceptOriginalKey({...song,key:'Am',rawContent:'{key: Am}\n[Am] [Dm] [E7]'}, 'Bm').changes.rawContent, '{key: Bm}\n[Bm] [Em] [F#7]')
 const enharmonic = {...song,key:'A#',rawContent:'{key: Bb}\n[Bb] [Eb]'}
 assert.equal(acceptOriginalKey(enharmonic,'Bb').changes.rawContent, enharmonic.rawContent)
})
test('8h two-line, combined sections and angle notation transpose; Nashville, lyrics, directives and tabs stay intact', () => {
 const raw = '{title: G}\r\n[Intro] G C D/F#\r\nG    C    D\r\nGrace and Dear Friends\r\n<Em7>lyrics [C]here\r\n[1] [4] [5/7] 1 4 5\r\n{comment: [G]}\r\n{sot}\r\n[G] tab annotation\r\ne|--3--5--|\r\n{eot}\r\nChords:\r\n[G] diagram\r\n\r\n[Chorus]\r\n[G]end'
 const changed = transposeChartText(raw, 7)
 assert.match(changed, /\[Intro\] D G A\/C#/)
 assert.match(changed, /D    G    A/)
 for (const unchanged of ['{title: G}', 'Grace and Dear Friends', '[1] [4] [5/7] 1 4 5', '{comment: [G]}', '[G] tab annotation', 'e|--3--5--|', '[G] diagram']) assert.ok(changed.includes(unchanged), unchanged)
 assert.ok(changed.includes('<Bm7>lyrics [G]here')); assert.ok(changed.endsWith('[D]end'))
 assert.equal(changed.split('\r\n').length, raw.split('\r\n').length)
})
test('8h missing or invalid provider key and invalid manual target cause no key/chord mutation', () => {
 for (const key of [undefined, '', 'H', 'not a key']) assert.deepEqual(acceptOriginalKey(song,key).changes, {})
 assert.deepEqual(alignChartKey(song, 'H').changes, {})
})
test('8h aligned save/reload, backup round trip and cloud reconciliation retain chords and keys', () => {
 localStorage.clear()
 const aligned = apply({...song,transposeOffset:2}, 'D'), library = {songs:[aligned],setlists:[]}
 persistLibrary(library)
 assert.deepEqual(readPersistedLibrary().songs[0], aligned)
 const backup = parseBackupJson(JSON.stringify({version:'1.0', songs:[normalizeBackupSong(aligned)], setlists:[]}))
 assert.equal(backup.isValid, true); assert.equal(backup.songs[0].rawContent, aligned.rawContent); assert.equal(backup.songs[0].key, 'D'); assert.equal(backup.songs[0].originalKey, 'D')
 const merged = reconcileSongbook({songs:[song],setlists:[]}, library, {songs:[song],setlists:[]})
 assert.equal(merged.hasConflicts, false)
 assert.equal(merged.merged.songs[0].rawContent, aligned.rawContent)
 assert.equal(computeSongbookChecksum(merged.merged), computeSongbookChecksum(library))
 assert.equal(merged.merged.songs[0].transposeOffset, 2)
})
const click = async selector => { const el=document.querySelector(selector); assert.ok(el,selector); await act(async()=>el.click()) }
const change = async (el,value) => act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}))})
async function editor(s, run) {
 let stored = {...s}, writes=[]
 const root = createRoot(document.getElementById('root'))
 try {
  await act(async()=>root.render(React.createElement(DesktopEditor,{song:s,transposeOffset:s.transposeOffset,onUpdateSong:update=>{writes.push(update);stored={...stored,...update};return true}})))
  await click('[aria-label="Song Details & Metadata"]')
  await run(()=>stored,writes)
 } finally { await act(async()=>root.unmount()) }
}
const found = {success:true,candidates:[{id:'candidate',title:'Song',artist:'Band',originalKey:'D'}]}
test('8h real editor acceptance, second acceptance, manual key change and rendered draft agree with persisted chords', async()=>{
 metadata.fetchSongMetadataFromProvider = async()=>found
 await editor(song,async(get,writes)=>{
  await click('[data-testid="editor-lookup-metadata-btn"]')
  assert.equal(writes.length,0)
  await click('[data-testid="editor-apply-metadata-btn"]')
  assert.equal(get().key,'D');assert.equal(get().originalKey,'D');assert.equal(document.querySelector('textarea').value,get().rawContent)
  const raw=get().rawContent
  await click('[data-testid="editor-apply-metadata-btn"]');assert.equal(get().rawContent,raw)
  await change(document.querySelector('input[placeholder="e.g. G"]'),'E')
  assert.equal(get().key,'E');assert.equal(get().originalKey,'D');assert.match(get().rawContent,/\[E\]One/)
 })
})
test('8h editor unknown source preserves chords; establish-source cancel is inert; explicit source enables acceptance', async()=>{
 metadata.fetchSongMetadataFromProvider = async()=>found
 await editor({...song,rawContent:'[G]One [C]two'},async(get,writes)=>{
  await click('[data-testid="editor-lookup-metadata-btn"]');await click('[data-testid="editor-apply-metadata-btn"]')
  assert.equal(get().key,'G');assert.equal(get().rawContent,'[G]One [C]two');assert.match(document.body.textContent,/chords preserved/)
  window.prompt=()=>null
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Establish source key')
  const count=writes.length;await act(async()=>button.click());assert.equal(writes.length,count)
  window.prompt=()=> 'G';await act(async()=>button.click());await click('[data-testid="editor-apply-metadata-btn"]')
  assert.equal(get().key,'D');assert.equal(get().rawContent,'{key: D}\n[D]One [G]two')
 })
})
test('8h editor failed lookup, missing result/key and canceling manual source confirmation preserve song', async()=>{
 for (const result of [{success:false,candidates:[],error:'Unavailable'}, {success:true,candidates:[]}, {success:true,candidates:[{id:'empty',title:'Song',artist:'Band'}]}]) {
  metadata.fetchSongMetadataFromProvider=async()=>result
  await editor({...song,rawContent:'[G]text'},async(get,writes)=>{
   await click('[data-testid="editor-lookup-metadata-btn"]')
   if(result.candidates.length) await click('[data-testid="editor-apply-metadata-btn"]')
   assert.equal(writes.length,0)
   window.prompt=()=>null
   await change(document.querySelector('input[placeholder="e.g. G"]'),'E')
   assert.equal(writes.length,0);assert.equal(get().key,'G');assert.equal(get().rawContent,'[G]text')
  })
 }
})
test('8h library applies alignment against current song content and presents unknown-source resolution',()=>{
 const app=fs.readFileSync(require.resolve('../src/App.tsx'),'utf8')
 assert.match(app,/acceptOriginalKey\(song, changes\.originalKey\)/)
 const modal=fs.readFileSync(require.resolve('../src/components/LibraryMetadataModal.tsx'),'utf8')
 assert.match(modal,/Unknown source key: chords are preserved/)
 assert.match(modal,/Establish source key/)
})

test('8h embedded directives never cause adjacent lyric words to transpose',()=>{
 const raw='[G]A word {comment: [C]} A friend\n[C]Go {title: G} Dear friend'
 assert.equal(transposeChartText(raw,7),'[D]A word {comment: [C]} A friend\n[G]Go {title: G} Dear friend')
})
test('8h failed persistence leaves atomic alignment draft retryable without double transposition',async()=>{
 metadata.fetchSongMetadataFromProvider=async()=>found
 let saved={...song}, fail=true, attempted=[]
 const root=createRoot(document.getElementById('root'))
 try {
  await act(async()=>root.render(React.createElement(DesktopEditor,{song,transposeOffset:0,onUpdateSong:update=>{attempted.push(update);if(fail)return false;saved={...saved,...update};return true}})))
  await click('[aria-label="Song Details & Metadata"]');await click('[data-testid="editor-lookup-metadata-btn"]');await click('[data-testid="editor-apply-metadata-btn"]')
  assert.deepEqual(saved,song);assert.equal(attempted[0].key,'D');assert.equal(attempted[0].originalKey,'D');assert.match(attempted[0].rawContent,/\[D\]One/)
  assert.match(document.body.textContent,/Unsaved/)
  fail=false;await click('[aria-label="Save changes"]')
  assert.equal(saved.rawContent,'{key: D}\n[D]One [G]two [A/C#]three [Bm7]four');assert.equal(saved.key,'D');assert.equal(saved.originalKey,'D')
 } finally { await act(async()=>root.unmount()) }
})
test('8h lookup arriving after song switch cannot offer metadata for the previous song',async()=>{
 let resolve
 metadata.fetchSongMetadataFromProvider=()=>new Promise(r=>{resolve=r})
 const root=createRoot(document.getElementById('root')),props={transposeOffset:0,onUpdateSong:()=>true}
 try {
  await act(async()=>root.render(React.createElement(DesktopEditor,{...props,song})))
  await click('[aria-label="Song Details & Metadata"]');await click('[data-testid="editor-lookup-metadata-btn"]')
  await act(async()=>root.render(React.createElement(DesktopEditor,{...props,song:{...song,id:'other',title:'Other'}})))
  await act(async()=>resolve(found))
  assert.equal(document.querySelector('[data-testid="editor-apply-metadata-btn"]'),null)
 } finally { await act(async()=>root.unmount()) }
})

test('8h real library metadata review is read-only until confirmation; cancel is inert; accepted key aligns current chords',async()=>{
 const {LibraryMetadataModal}=require('../src/components/LibraryMetadataModal.tsx')
 metadata.fetchSongMetadataFromProvider=async()=>({...found,status:'MATCH'})
 let current={...song},applied=0,closed=0
 const root=createRoot(document.getElementById('root'))
 try {
  await act(async()=>root.render(React.createElement(LibraryMetadataModal,{isOpen:true,songs:[song],onClose:()=>closed++,onApplyUpdates:updates=>{applied++;for(const update of updates) current={...current,...update.changes,...acceptOriginalKey(current,update.changes.originalKey).changes}}})))
  const scan=document.querySelector('[data-testid="start-metadata-scan-btn"]')
  assert.ok(scan,'scan button');await act(async()=>{scan.click();await new Promise(r=>setTimeout(r,230))});assert.equal(applied,0)
  current={...current,rawContent:'{key: G}\n[G]Latest user edit [D/F#]'}
  await click('[data-testid="apply-metadata-updates-btn"]')
  const cancel=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Cancel').at(-1)
  await act(async()=>cancel.click());assert.equal(applied,0)
  await click('[data-testid="apply-metadata-updates-btn"]');await click('[data-testid="confirm-apply-metadata-btn"]')
  assert.equal(applied,1);assert.equal(closed,1);assert.equal(current.key,'D');assert.equal(current.originalKey,'D');assert.equal(current.rawContent,'{key: D}\n[D]Latest user edit [A/C#]')
 } finally {await act(async()=>root.unmount())}
})


test('8h discarding failed metadata alignment restores the persisted key/chord/reference pair',async()=>{
 metadata.fetchSongMetadataFromProvider=async()=>({...found,candidates:[{...found.candidates[0],year:'1985'}]})
 const guard={current:null},root=createRoot(document.getElementById('root'))
 let navigated=0
 try {
  await act(async()=>root.render(React.createElement(DesktopEditor,{song,transposeOffset:0,navigationGuardRef:guard,onUpdateSong:()=>false})))
  await click('[aria-label="Song Details & Metadata"]');await click('[data-testid="editor-lookup-metadata-btn"]');await click('[data-testid="editor-apply-metadata-btn"]')
  await act(async()=>guard.current(()=>navigated++))
  const discard=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Discard')
  await act(async()=>discard.click())
  assert.equal(navigated,1);assert.equal(document.querySelector('textarea').value,song.rawContent)
  assert.equal(document.querySelector('input[placeholder="e.g. G"]').value,'G')
  assert.equal(document.querySelector('input[placeholder="e.g. E"]').value,'A')
  assert.doesNotMatch(document.body.textContent,/Unsaved/)
 } finally {await act(async()=>root.unmount())}
})
