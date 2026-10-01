const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client')
const metadata = require('../src/utils/songMetadata.ts')
const lookup = metadata.fetchSongMetadataFromProvider
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')
const { LibraryMetadataModal } = require('../src/components/LibraryMetadataModal.tsx')
const { acceptOriginalKey } = require('../src/utils/chartKeyAlignment.ts')
const { computePlaybackKey } = require('../src/utils/songbookFoundation.ts')
const song = { id:'d1080001-0001-4000-8000-000000000001', title:'Everlasting God', artist:'', key:'D', rawContent:'[D] [Gsus] [D]', originalKey:'', bpm:'90', year:'1990', format:'CHORD_PRO', transposeOffset:0 }
const candidate = { id:'provider', title:'Everlasting God', artist:'Lincoln Brewster', originalKey:'B', bpm:'109', year:'2006', confidence:'MEDIUM' }
const click = async selector => { const el=document.querySelector(selector); assert.ok(el,selector); await act(async()=>el.click()) }
const textButton = text => [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
const change = async (el,value) => act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}))})
async function editor(s, run, failure=false) {
 let current={...s}, writes=[]
 const root=createRoot(document.getElementById('root'))
 metadata.fetchSongMetadataFromProvider=async()=>({success:true,candidates:[candidate],status:'REVIEW'})
 try {
  await act(async()=>root.render(React.createElement(DesktopEditor,{song:s,transposeOffset:0,onUpdateSong:update=>{writes.push(update);if(failure)return false;current={...current,...update};return true}})))
  await click('[aria-label="Song Details & Metadata"]')
  await click('[data-testid="editor-lookup-metadata-btn"]')
  await run(()=>current,writes)
 } finally {await act(async()=>root.unmount())}
}
test('8i normalized artist corroboration, wrong artist and uncorroborated same title stay review only',()=>{
 const wrong={title:'Beneath The Waters',artist:'Dawn of Disease',confidence:'HIGH'}
 assert.equal(metadata.artistConflict('Hillsong Worship',wrong.artist),true)
 assert.equal(metadata.computeMatchConfidence(wrong,'Beneath the Waters','Hillsong Worship'),'MEDIUM')
 assert.equal(metadata.classifyMatchStatus([wrong],'Beneath the Waters','Hillsong Worship'),'REVIEW')
 assert.equal(metadata.computeMatchConfidence(wrong,'Beneath the Waters (I Will Rise)','Hillsong Worship'),'LOW')
 assert.equal(metadata.computeMatchConfidence(candidate,song.title,''),'MEDIUM')
 assert.equal(metadata.artistConflict('  Hillsong-Worship ', 'HILLSONG WORSHIP'),false)
 assert.equal(metadata.artistConflict('Hillsong', 'Hillsong Worship'),true)
 assert.equal(metadata.classifyMatchStatus([]),'NO_MATCH')
 assert.equal(metadata.computeMatchConfidence({title:'BENEATH, THE WATERS!',artist:'Hillsong-Worship'},'Beneath the Waters','Hillsong Worship'),'HIGH')
 assert.equal(metadata.artistConflict('東京', '大阪'),true)
 assert.equal(metadata.computeMatchConfidence({title:'Other Song',artist:'Hillsong Worship'},'Beneath the Waters','Hillsong Worship'),'LOW')
})
test('8i provider title variants discover candidates but cannot override artist conflict or ambiguity',async()=>{
 let url
 global.fetch=async u=>{url=u;return{ok:true,json:async()=>({success:true,results:[{...candidate,title:'Beneath The Waters',artist:'Dawn of Disease'},{...candidate,id:'valid',title:'Beneath The Waters',artist:'Hillsong Worship'}]})}}
 const result=await lookup('Beneath the Waters (I Will Rise)','Hillsong Worship')
 assert.equal(new URL(url,'http://localhost').searchParams.get('title'),'Beneath the Waters')
 assert.equal(result.status,'REVIEW');assert.equal(result.candidates.some(c=>c.confidence==='HIGH'),false)
 global.fetch=async()=>({ok:true,json:async()=>({success:true,results:[]})})
 assert.equal((await lookup(song.title)).status,'NO_MATCH')
})
test('8i blank artist autofill, D to B direct confirmation, stage zero, repeat and reopen are safe',async()=>{
 await editor(song,async(get,writes)=>{
  await click('[data-testid="editor-apply-metadata-btn"]')
  assert.equal(get().artist,'Lincoln Brewster');assert.equal(get().originalKey,'B');assert.equal(get().rawContent,song.rawContent)
  window.prompt=()=>null;const count=writes.length
  await act(async()=>textButton('Confirm current chords & align').click());assert.equal(writes.length,count)
  window.prompt=()=> 'H'
  await act(async()=>textButton('Confirm current chords & align').click());assert.equal(writes.length,count)
  window.prompt=()=> 'D'
  await act(async()=>textButton('Confirm current chords & align').click())
  assert.equal(get().rawContent,'{key: B}\n[B] [Esus] [B]');assert.equal(get().key,'B');assert.equal(get().originalKey,'B')
  assert.equal(computePlaybackKey(get().key, 0),'B')
  const raw=get().rawContent;await click('[data-testid="editor-apply-metadata-btn"]');assert.equal(get().rawContent,raw)
  await click('button[title="Close"]');await click('[aria-label="Song Details & Metadata"]')
  await click('[data-testid="editor-apply-metadata-btn"]');assert.equal(get().rawContent,raw)
 })
})
test('8i editor selective fields and artist preservation; artist replacement is explicitly selected',async()=>{
 await editor({...song,artist:'User artist'},async(get,writes)=>{
  assert.equal(document.querySelector('[aria-label="Apply artist"]').checked,false)
  window.confirm=()=>false
  await click('[data-testid="editor-apply-metadata-btn"]');assert.equal(writes.length,0)
  window.confirm=()=>true
  await click('[aria-label="Apply originalKey"]');await click('[aria-label="Apply year"]')
  await click('[data-testid="editor-apply-metadata-btn"]')
  assert.equal(get().artist,'User artist');assert.equal(get().bpm,'109');assert.equal(get().year,'1990');assert.equal(get().originalKey,'');assert.equal(get().rawContent,song.rawContent)
  await click('[aria-label="Apply artist"]');await click('[data-testid="editor-apply-metadata-btn"]');assert.equal(get().artist,'Lincoln Brewster')
 })
})
test('8i source alignment failure retains an atomic draft with persisted song unchanged',async()=>{
 await editor({...song,originalKey:'B'},async(get,writes)=>{
  window.prompt=()=> 'D';await act(async()=>textButton('Confirm current chords & align').click())
  assert.deepEqual(get(),{...song,originalKey:'B'})
  assert.equal(writes[0].key,'B');assert.equal(writes[0].originalKey,'B');assert.equal(writes[0].rawContent,'{key: B}\n[B] [Esus] [B]')
  assert.equal(document.querySelector('textarea').value,writes[0].rawContent);assert.match(document.body.textContent,/Unsaved/)
 },true)
})
test('8i all four metadata fields remain manually correctable and clearable',async()=>{
 await editor(song,async(get)=>{
  for(const [selector,field,value] of [['input[placeholder="Artist / Band"]','artist','Manual'],['input[placeholder="e.g. E"]','originalKey','F'],['input[placeholder="120"]','bpm','112'],['input[placeholder="e.g. 1979"]','year','2010']]) {
   const input=document.querySelector(selector);assert.ok(input,selector)
   await change(input,value);assert.equal(get()[field],value)
   await change(input,'');assert.equal(get()[field],'')
  }
  assert.equal(get().rawContent,song.rawContent)
 })
})
async function library(s, cand, run) {
 const root=createRoot(document.getElementById('root'));let attempts=[],closed=0, current={...s},fail=false
 metadata.fetchSongMetadataFromProvider=async()=>({success:true,candidates:[cand],status:'MATCH'})
 try {
  await act(async()=>root.render(React.createElement(LibraryMetadataModal,{isOpen:true,songs:[s],onClose:()=>closed++,onApplyUpdates:updates=>{attempts.push(updates);if(fail)return false;for(const u of updates)current={...current,...u.changes,...acceptOriginalKey(current,u.changes.originalKey,u.confirmedSource).changes};return true}})))
  await click('[data-testid="start-metadata-scan-btn"]');await act(async()=>{await new Promise(r=>setTimeout(r,230))})
  await run(()=>current,attempts,()=>closed,value=>{fail=value})
 } finally {await act(async()=>root.unmount())}
}
test('8i library ignores claimed HIGH on wrong artist; review and conflict cancel leave chords untouched',async()=>{
 await library({...song,title:'Beneath the Waters',artist:'Hillsong Worship'},{...candidate,title:'Beneath The Waters',artist:'Dawn of Disease',confidence:'HIGH'},async(get,attempts)=>{
  assert.equal(document.querySelector('[data-testid="apply-metadata-updates-btn"]').disabled,true)
  assert.match(document.body.textContent,/REVIEW/);assert.match(document.body.textContent,/Dawn of Disease/)
  await click('input[type="checkbox"]');await click('[data-testid="apply-metadata-updates-btn"]')
  window.confirm=()=>false;await click('[data-testid="confirm-apply-metadata-btn"]')
  assert.equal(attempts.length,0);assert.equal(get().rawContent,song.rawContent)
 })
})
test('8i library selected fields, cancelled/invalid source, persistence failure and direct alignment retry',async()=>{
 await library(song,candidate,async(get,attempts,closed,setFail)=>{
  assert.equal(document.querySelector('[data-testid="apply-metadata-updates-btn"]').disabled,true)
  await click('input[type="checkbox"]')
  const year=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Year:')).querySelector('input');await act(async()=>year.click())
  await click('[data-testid="apply-metadata-updates-btn"]')
  window.prompt=()=>null;await click('[data-testid="confirm-apply-metadata-btn"]');assert.equal(attempts.length,0)
  window.prompt=()=> 'invalid';await click('[data-testid="confirm-apply-metadata-btn"]');assert.equal(attempts.length,0)
  window.prompt=()=> 'D';setFail(true);await click('[data-testid="confirm-apply-metadata-btn"]')
  assert.deepEqual(get(),song);assert.equal(closed(),0);assert.ok(document.querySelector('[data-testid="confirm-apply-metadata-btn"]'))
  setFail(false);await click('[data-testid="confirm-apply-metadata-btn"]')
  assert.equal(closed(),1);assert.equal(get().artist,'Lincoln Brewster');assert.equal(get().bpm,'109');assert.equal(get().year,'1990')
  assert.equal(get().key,'B');assert.equal(get().originalKey,'B');assert.equal(get().rawContent,'{key: B}\n[B] [Esus] [B]')
 })
})

test('8i real App applies confirmed source atomically; storage failure retains library and review for retry',async()=>{
 require.extensions['.png']=module=>{module.exports='/logo.png'}
 Object.assign(global,{Node:window.Node,sessionStorage:window.sessionStorage,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout})
 window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
 const journal=require('../src/utils/syncJournal.ts'),persist=journal.persistLibrary
 localStorage.clear();persist({songs:[song],setlists:[]})
 const App=require('../src/App.tsx').default
 const root=createRoot(document.getElementById('root'));let fail=true
 const errors=[],priorError=console.error,priorWarn=console.warn
 console.error=(...args)=>errors.push(args.map(String).join(' '))
 console.warn=(...args)=>errors.push(args.map(String).join(' '))
 metadata.fetchSongMetadataFromProvider=async()=>({success:true,candidates:[candidate],status:'REVIEW'})
 try {
  await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(App))))
  await click('button:has(svg.lucide-ellipsis-vertical),button:has(svg.lucide-more-vertical)')
  await click('[data-testid="header-open-metadata-review-btn"]')
  await click('[data-testid="start-metadata-scan-btn"]');await act(async()=>{await new Promise(r=>setTimeout(r,230))})
  await click('input[type="checkbox"]');await click('[data-testid="apply-metadata-updates-btn"]')
  window.prompt=()=> 'D'
  journal.persistLibrary=value=>{if(fail)throw new Error('fixture persistence failure');return persist(value)}
  await click('[data-testid="confirm-apply-metadata-btn"]')
  assert.deepEqual(journal.readPersistedLibrary().songs[0],song)
  assert.ok(document.querySelector('[data-testid="confirm-apply-metadata-btn"]'))
  fail=false;await click('[data-testid="confirm-apply-metadata-btn"]')
  const saved=journal.readPersistedLibrary().songs[0]
  assert.equal(saved.rawContent,'{key: B}\n[B] [Esus] [B]');assert.equal(saved.key,'B');assert.equal(saved.originalKey,'B');assert.equal(saved.artist,'Lincoln Brewster')
  assert.equal(document.querySelector('[data-testid="start-metadata-scan-btn"]'),null)
  assert.equal(errors.length,1);assert.match(errors[0],/Storage write failed/);assert.doesNotMatch(errors[0],/React|hook/);
 } finally {journal.persistLibrary=persist;await act(async()=>root.unmount());console.error=priorError;console.warn=priorWarn}
})
