const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript')
for(const ext of ['.ts','.tsx']) require.extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8').replaceAll('import.meta.env','({DEV:false})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename)
require.extensions['.png']=module=>{module.exports='/logo.png'}
const {JSDOM}=require('jsdom')
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5173/'})
Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:fn=>fn()})
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
window.prompt=(_message,source)=>source
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
const {DesktopEditor}=require('../src/components/DesktopEditor.tsx')
const {SongbookHomeView}=require('../src/components/SongbookHomeView.tsx')
const {TextHistory,indentText}=require('../src/utils/editorText.ts')
const {normalizeMusicalKey}=require('../src/utils/musicalKey.ts')
const {hasActionableRecovery,recoveryData,persistLibrary,readPersistedLibrary,retireRepresentedCloudSnapshots}=require('../src/utils/syncJournal.ts')
const song={id:'s1',title:'Original',artist:'Artist',key:'C',rawContent:'[C]  line\n[G] next',capo:'',bpm:'',tags:'',format:'CHORD_PRO',transposeOffset:0}
const click=async text=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(button,text);await act(async()=>button.click())}
const change=async(el,value)=>{await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}))})}
const key=async(el,k,options={})=>{let event;await act(async()=>{event=new window.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...options});el.dispatchEvent(event)});return event}

test('8e indentation preserves line breaks, alignment and selected-line boundaries',()=>{
 const text='[C]  lyric\n[G] next\nlast'
 const edit=indentText(text,0,19)
 assert.equal(edit.text,'  [C]  lyric\n  [G] next\nlast')
 assert.deepEqual(indentText(edit.text,edit.start,edit.end,true),{text,start:0,end:19})
 assert.equal(indentText('\n[C]',0,0,true).text,'\n[C]')
 assert.deepEqual(indentText('abc',1,1),{text:'a  bc',start:3,end:3})
 assert.deepEqual(indentText('  abc',1,1,true),{text:'abc',start:0,end:0})
})
test('8e history preserves exact text, redo branches and bounded history',()=>{
 const history=new TextHistory(2),e=text=>({text,start:0,end:0})
 history.record(e('a'),e('b'));history.record(e('b'),e('c'));history.record(e('c'),e('d'))
 assert.equal(history.undo(e('d')).text,'c');assert.equal(history.undo(e('c')).text,'b');assert.equal(history.undo(e('b')),undefined)
 assert.equal(history.redo(e('b')).text,'c');history.record(e('c'),e('new'));assert.equal(history.redo(e('new')),undefined)
})
test('8e key normalization: case, enharmonics, minor quality, rejection and persistence',()=>{
 for(const [input,output] of Object.entries({a:'A',b:'B',c:'C','f#':'F#','g#':'G#',bb:'A#',eb:'D#',ab:'G#',db:'C#',gb:'F#',bbm:'A#m','F#MIN':'F#m',cmaj:'C'})) assert.equal(normalizeMusicalKey(input),output)
 for(const invalid of ['H','C7','G major','##','Bm7']) assert.equal(normalizeMusicalKey(invalid),null)
 localStorage.clear();persistLibrary({songs:[{...song,key:'bb'}],setlists:[]})
 assert.equal(JSON.parse(localStorage.getItem('gtar_library_v1')).songs[0].key,'A#')
 assert.equal(readPersistedLibrary().songs[0].rawContent,song.rawContent)
})
test('8e recovery: healthy canonical data, retained represented snapshots, unique/conflicting/unknown archives and export preservation',()=>{
 localStorage.clear();const lib={songs:[song],setlists:[]};persistLibrary(lib)
 assert.equal(hasActionableRecovery(),false)
 localStorage.setItem('gtar_sync_library_owner','owner');assert.equal(hasActionableRecovery(),false)
 const archive=JSON.stringify(lib);localStorage.setItem('gtar_sync_recovery:plain',archive)
 assert.equal(hasActionableRecovery(),false);assert.equal(recoveryData()['gtar_sync_recovery:plain'],archive)
 localStorage.setItem('gtar_restore_safety_snapshot_v1','retained restore');assert.equal(hasActionableRecovery(),false)
 retireRepresentedCloudSnapshots();assert.equal(localStorage.getItem('gtar_sync_recovery:plain'),null);assert.equal(localStorage.getItem('gtar_restore_safety_snapshot_v1'),'retained restore')
 persistLibrary({songs:[{...song,title:'Later edit'}],setlists:[]});assert.equal(hasActionableRecovery(),false)
 persistLibrary(lib)
 localStorage.setItem('gtar_sync_recovery:plain',JSON.stringify({songs:[{...song,title:'Lost edit'}],setlists:[]}));assert.equal(hasActionableRecovery(),true)
 localStorage.setItem('gtar_sync_recovery:plain',JSON.stringify({songs:[song,{...song,id:'lost'}],setlists:[]}));assert.equal(hasActionableRecovery(),true)
 localStorage.setItem('gtar_sync_recovery:plain','unknown raw');assert.equal(hasActionableRecovery(),true);assert.equal(recoveryData()['gtar_sync_recovery:plain'],'unknown raw')
})
test('8e editor: autosave truth, text shortcuts, metadata dirty reversion, navigation choices and failure guard',async()=>{
 localStorage.clear();let persisted={...song},fail=false,closed=0;const guard={current:null}
 const props={song: persisted,transposeOffset:0,navigationGuardRef:guard,onClose:()=>closed++,onUpdateSong:update=>{if(fail)return false;persisted={...persisted,...update};return true},onSaveSong:update=>{if(fail)return false;persisted=update;return true}}
 const root=createRoot(document.getElementById('root'))
 try {
  await act(async()=>root.render(React.createElement(DesktopEditor,props)))
  const textarea=document.querySelector('textarea');textarea.focus();textarea.setSelectionRange(0,0)
  assert.equal((await key(textarea,'Tab')).defaultPrevented,true);assert.equal(textarea.value,'  '+song.rawContent);assert.equal(persisted.rawContent,textarea.value)
  await key(textarea,'z',{ctrlKey:true});assert.equal(textarea.value,song.rawContent)
  await key(textarea,'y',{ctrlKey:true});assert.equal(textarea.value,'  '+song.rawContent)
  await key(textarea,'z',{ctrlKey:true});await key(textarea,'z',{ctrlKey:true,shiftKey:true});assert.equal(textarea.value,'  '+song.rawContent)
  await change(textarea,'[D] lyric\n  spaces');assert.equal(persisted.rawContent,textarea.value)
  await key(textarea,'z',{ctrlKey:true});assert.equal(textarea.value,'  '+song.rawContent)
  assert.match(document.body.textContent,/Saved/)
  let unload=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,false)
  await act(async()=>guard.current(()=>closed++));assert.equal(closed,1);assert.equal(document.querySelector('[role="dialog"]'),null)
  await act(async()=>document.querySelector('[aria-label="Song Details & Metadata"]').click())
  await click('OPM');assert.match(document.body.textContent,/Unsaved/)
  unload=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true)
  await click('OPM');assert.doesNotMatch(document.body.textContent,/Unsaved/)
  await click('OPM');await act(async()=>guard.current(()=>closed++));await click('Cancel');assert.equal(closed,1)
  await act(async()=>guard.current(()=>closed++));fail=true;await click('Save');assert.equal(closed,1);assert.ok(document.querySelector('[aria-label="Unsaved changes"]'))
  fail=false;const actions=[];await act(async()=>{guard.current(()=>actions.push('select'));guard.current(()=>actions.push('view'))});await click('Save');assert.deepEqual(actions,['select','view']);assert.equal(closed,2);assert.equal(persisted.tags,'OPM');assert.doesNotMatch(document.body.textContent,/Unsaved/)
  await click('Rock');await act(async()=>guard.current(()=>closed++));await click('Discard');assert.equal(closed,3);assert.equal(persisted.tags,'OPM');assert.doesNotMatch(document.body.textContent,/Unsaved/)
  const keyInput=document.querySelector('input[placeholder="e.g. G"]');await change(keyInput,'bb');assert.equal(keyInput.value,'A#');assert.equal(persisted.key,'A#')
  await change(keyInput,'H');assert.equal(persisted.key,'A#');assert.match(document.body.textContent,/Unsaved/)
  const saveButton=document.querySelector('[aria-label="Save changes"]');await act(async()=>saveButton.click());assert.equal(persisted.key,'A#');assert.match(document.body.textContent,/Enter a valid key/)
  await change(keyInput,'A#');fail=true;await change(textarea,'failed text');assert.match(document.body.textContent,/Unsaved/);assert.notEqual(persisted.rawContent,'failed text')
  await change(textarea,persisted.rawContent);assert.doesNotMatch(document.body.textContent,/Unsaved/)
  const title=document.querySelector('input[placeholder="Song Title *"]');fail=false;await change(title,'Renamed');await act(async()=>root.render(React.createElement(DesktopEditor,{...props,song:{...persisted,title:'Renamed'}})));assert.equal(textarea.value,persisted.rawContent)
 } finally {await act(async()=>root.unmount())}
})
test('8e setlists: collapse is presentation-only, preference survives remount, expansion and open remain usable',async()=>{
 localStorage.clear();const lists=[{id:'list',name:'Gig',songs:[song]}],snapshot=JSON.stringify(lists);let opened=0
 const props={songs:[song],setlists:lists,searchQuery:'',activeSongIndex:0,onSelectSong(){},onNewSong(){},onOpenSetlists(){},onSelectSetlistSong(){opened++},onDeleteSong(){}}
 const root=createRoot(document.getElementById('root'))
 try {
  await act(async()=>root.render(React.createElement(SongbookHomeView,props)))
  await click('Hide');assert.equal(document.getElementById('gig-setlist-cards').hidden,true);assert.match(document.body.textContent,/Gig Setlists \(1\)/)
  assert.equal(localStorage.getItem('gtar_songbook_setlists_collapsed'),'true');assert.equal(JSON.stringify(lists),snapshot);assert.match(document.body.textContent,/Songs Library/)
  await act(async()=>root.render(null));await act(async()=>root.render(React.createElement(SongbookHomeView,props)))
  assert.equal(document.getElementById('gig-setlist-cards').hidden,true);await click('Show');assert.equal(document.getElementById('gig-setlist-cards').hidden,false)
  await act(async()=>document.querySelector('[data-testid="setlist-card-list"]').click());assert.equal(opened,1);assert.equal(JSON.stringify(lists),snapshot)
 } finally {await act(async()=>root.unmount())}
})
test('8e startup banner refreshes when recovery becomes represented; raw archive export remains available',async()=>{
 localStorage.clear();const lost={...song,id:'lost'};persistLibrary({songs:[song],setlists:[]});const archive=JSON.stringify({songs:[lost],setlists:[]});localStorage.setItem('gtar_sync_recovery:plain',archive)
 const App=require('../src/App.tsx').default,root=createRoot(document.getElementById('root'))
 let blob;const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:recovery'};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){}
 try {
  await act(async()=>root.render(React.createElement(App)));assert.match(document.querySelector('aside[role="alert"]').textContent,/Recovery data is available/)
  await click('Export recovery data');assert.equal(JSON.parse(await blob.text())['gtar_sync_recovery:plain'],archive)
  await act(async()=>persistLibrary({songs:[song,lost],setlists:[]}));assert.equal(document.querySelector('aside[role="alert"]'),null);assert.equal(localStorage.getItem('gtar_sync_recovery:plain'),null)
 } finally {await act(async()=>root.unmount());URL.createObjectURL=create;URL.revokeObjectURL=revoke}
})
