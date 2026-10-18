const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
for(const ext of ['.ts','.tsx']) require.extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8').replaceAll('import.meta.env','({DEV:false})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename)
require.extensions['.png']=module=>{module.exports='/logo.png'}
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5173/'})
Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:fn=>fn()})
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
const {DesktopEditor}=require('../src/components/DesktopEditor.tsx'),{KeyPickerModal}=require('../src/components/KeyPickerModal.tsx')
const {transposeContext,resolveSongKeys}=require('../src/utils/songKeySemantics.ts'),{keysArePitchEquivalent}=require('../src/utils/musicalKey.ts'),{transposeChordToken}=require('../src/utils/chordTransposer.ts'),{parseGtarSong}=require('../src/utils/songParser.ts')
const {persistLibrary,readPersistedLibrary,getLastKnownPersistedLibraryRaw}=require('../src/utils/syncJournal.ts')
const song={id:'109',title:'Fixture',artist:'Artist',key:'G',originalKey:'E',rawContent:'{title: Fixture}\n{key: G}\n{original_key: E}\n[G]My [D/F#]song',format:'CHORD_PRO',transposeOffset:0,capo:'',bpm:'',tags:''}
const change=async(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}))})
const shortcut=async(key,el=window)=>act(async()=>el.dispatchEvent(new window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true})))
const click=async selector=>act(async()=>{assert.ok(document.querySelector(selector));document.querySelector(selector).click()})

test('109: deletion autosaves and Save/reload preserve absent directive, cleared chart metadata, original E and chord body',async()=>{
 localStorage.clear();persistLibrary({songs:[song],setlists:[]});let stored=readPersistedLibrary().songs[0]
 const update=partial=>{stored={...stored,...partial};persistLibrary({songs:[stored],setlists:[]});return true}
 let root=createRoot(document.getElementById('root'))
 try{
  await act(async()=>root.render(React.createElement(DesktopEditor,{song:stored,transposeOffset:0,onUpdateSong:update,onSaveSong:update})))
  await change(document.querySelector('textarea'),song.rawContent.replace('{key: G}\n',''));assert.doesNotMatch(stored.rawContent,/\{key:/)
  await shortcut('s');assert.equal(stored.key,'');assert.equal(stored.originalKey,'E');assert.doesNotMatch(stored.rawContent,/\{key:/);assert.match(stored.rawContent,/\[G\]My \[D\/F#\]song/)
  await act(async()=>root.unmount());root=createRoot(document.getElementById('root'))
  await act(async()=>root.render(React.createElement(DesktopEditor,{song:readPersistedLibrary().songs[0],transposeOffset:0,onUpdateSong:update})))
  assert.doesNotMatch(document.querySelector('textarea').value,/\{key:/);assert.match(document.body.textContent,/Original Key: E.*Chart Key: G \(estimated\).*Performance Key: G/)
 }finally{await act(async()=>root.unmount())}
})
test('109: raw original edit/remove/undo/redo and explicit form edit synchronize without chord mutation',async()=>{
 let stored={...song};const update=partial=>{stored={...stored,...partial};return true},root=createRoot(document.getElementById('root'))
 try{
  await act(async()=>root.render(React.createElement(DesktopEditor,{song:stored,transposeOffset:0,onUpdateSong:update,onSaveSong:update})))
  const textarea=document.querySelector('textarea');await change(textarea,song.rawContent.replace('original_key: E','original_key: F#'));assert.equal(stored.originalKey,'F#');await shortcut('s')
  await change(textarea,textarea.value.replace('{original_key: F#}\n',''));assert.equal(stored.originalKey,'');assert.match(document.body.textContent,/Original Key: Unknown/)
  await shortcut('z',textarea);assert.equal(stored.originalKey,'F#');await shortcut('y',textarea);assert.equal(stored.originalKey,'')
  await shortcut('s');assert.equal(stored.originalKey,undefined);assert.doesNotMatch(stored.rawContent,/original_key/)
  await click('[aria-label="Song Details & Metadata"]');await change(document.querySelector('[aria-label="Original Key"]'),'Bb')
  assert.equal(stored.originalKey,'Bb');assert.match(stored.rawContent,/\{original_key: Bb\}/);assert.match(stored.rawContent,/\[G\]My \[D\/F#\]song/)
 }finally{await act(async()=>root.unmount())}
})
test('109: rejected saves and cross-tab CAS retain failed draft, recovery, navigation and same-ID protection',async()=>{
 localStorage.clear();persistLibrary({songs:[song],setlists:[]});const baseline=getLastKnownPersistedLibraryRaw();let fail=true,closed=0
 const guard={current:null},recovery={current:null},update=partial=>{if(fail)return false;persistLibrary({songs:[{...song,...partial}],setlists:[]},undefined,{expectedRaw:baseline});return true},root=createRoot(document.getElementById('root'))
 try{
  const props={song,transposeOffset:0,onUpdateSong:update,onSaveSong:update,navigationGuardRef:guard,recoveryDraftRef:recovery}
  await act(async()=>root.render(React.createElement(DesktopEditor,props)))
  const raw=song.rawContent.replace('{key: G}\n','').replace('original_key: E','original_key: F#')
  await change(document.querySelector('textarea'),raw);await shortcut('s');assert.equal(document.querySelector('textarea').value,raw);assert.equal(recovery.current().originalKey,'F#')
  const unload=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true)
  await act(async()=>guard.current(()=>closed++));assert.equal(closed,0);const cancel=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel');await act(async()=>cancel.click())
  fail=false;localStorage.setItem('gtar_library_v1',JSON.stringify({songs:[{...song,title:'Other tab'}],setlists:[]}));await shortcut('s')
  assert.equal(readPersistedLibrary().songs[0].title,'Other tab');assert.equal(recovery.current().rawContent,raw)
  await act(async()=>root.render(React.createElement(DesktopEditor,{...props,song:{...song,title:'Other tab'}})));assert.equal(document.querySelector('textarea').value,raw)
 }finally{await act(async()=>root.unmount())}
})
test('109: invalid/duplicate/entity conflicts block writes and preserve raw provenance; raw-only original resolves',async()=>{
 for(const raw of [song.rawContent+'\n{originalkey: F#}',song.rawContent.replace('original_key: E','original_key: H'),song.rawContent+'\n{key: A}']){
  let writes=0;const root=createRoot(document.getElementById('root'))
  try{await act(async()=>root.render(React.createElement(DesktopEditor,{song:{...song,rawContent:raw},transposeOffset:0,onUpdateSong:()=>{writes++;return true}})))
   await shortcut('s');assert.equal(writes,0);await change(document.querySelector('textarea'),raw+'\nlyrics');assert.equal(writes,0);assert.equal(document.querySelector('textarea').value,raw+'\nlyrics');assert.match(document.body.textContent,/Resolve conflicting/)
  }finally{await act(async()=>root.unmount())}
 }
 assert.equal(resolveSongKeys({...song,originalKey:'F#'}).originalConflict,true);assert.equal(resolveSongKeys({...song,originalKey:undefined}).originalKey,'E');assert.equal(resolveSongKeys({rawContent:'{original_key: }'}).originalConflict,false)
})
test('109: existing playback G survives; deliberate zero/reset renders E including slash bass; +2 renders F#',()=>{
 const c=transposeContext(song,0);assert.equal(c.displayOffset,3);assert.equal(c.performanceKey,'G');assert.equal(c.resetOffset,-3);assert.equal(c.toStoredOffset(0),-3);assert.equal(c.toStoredOffset(2),-1)
 for(const [ui,root,slash] of [[0,'E','B/D#'],[2,'F#','C#/E#']]){
  const t=c.toStoredOffset(ui);assert.equal(transposeChordToken('G',t,root),root);assert.equal(transposeChordToken('D/F#',t,root),slash);assert.ok(JSON.stringify(parseGtarSong(song.rawContent,t)).includes(ui===2?'C#/F':slash))
 }
 for(const t of [-13,-6,-1,0,6,12,25]){const c=transposeContext(song,t);assert.ok(keysArePitchEquivalent(c.performanceKey,transposeContext(song,c.toStoredOffset(c.displayOffset)).performanceKey))}
 assert.match(song.rawContent,/\[G\]My \[D\/F#\]song/)
})
test('109: minor/enharmonic/boundaries and unknown/conflicting/mode fallback never invent original provenance',()=>{
 for(const [originalKey,key,expected] of [['Em','Gm',3],['Cb','B',0],['B','C',1],['F#','C',-6],['Bbm','A#m',0]]){
  const c=transposeContext({originalKey,key},0);assert.equal(c.originalRelative,true);assert.equal(c.displayOffset,expected);assert.ok(keysArePitchEquivalent(transposeContext({originalKey,key},c.resetOffset).performanceKey,originalKey))
 }
 for(const data of [{key:'G'},{key:'G',originalKey:'Em'},{...song,originalKey:'F#'},{originalKey:'E',rawContent:'[G]song'}]){const c=transposeContext(data,2);assert.equal(c.originalRelative,false);assert.equal(c.toStoredOffset(0),0);assert.equal(c.resetOffset,0)}
})
test('109: picker labels +3 G; zero and Reset return -3; unknown original stays Unknown with chart-relative labels',async()=>{
 const root=createRoot(document.getElementById('root'));let selected,reset
 const props={isOpen:true,song,currentOffset:0,onClose(){},onSelectOffset:n=>{selected=n},onReset:()=>{reset=transposeContext(song,0).resetOffset}}
 try{
  await act(async()=>root.render(React.createElement(KeyPickerModal,props)));assert.match(document.body.textContent,/Original KeyE.*Chart Key: G.*Performance KeyG\+3/)
  const zero=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('(Original)'));assert.match(zero.textContent,/0.*E/);await act(async()=>zero.click());assert.equal(selected,-3)
  const resetButton=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Reset (0)'));await act(async()=>resetButton.click());assert.equal(reset,-3)
  await act(async()=>root.render(React.createElement(KeyPickerModal,{...props,song:{key:'G'}})));assert.match(document.body.textContent,/Original KeyUnknown/);assert.match(document.body.textContent,/relative to Chart Key/);assert.doesNotMatch(document.body.textContent,/\(Original\)/)
 }finally{await act(async()=>root.unmount())}
})

test('109: actual stage picker and controls use original-relative zero, reset, arrows and unchanged raw chords',async()=>{
 const {StageView}=require('../src/components/StageView.tsx')
 localStorage.clear();const root=createRoot(document.getElementById('root'));let t=0
 const render=async()=>act(async()=>root.render(React.createElement(StageView,{song:{...song,transposeOffset:t},songs:[song],activeSongIndex:0,onSelectSongIndex(){},onOpenSetlistDrawer(){},transposeOffset:t,onTransposeChange:n=>{t=n}})))
 try{
  await render();assert.match(document.body.textContent,/Transpose: \+3/)
  const opener=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Transpose: +3'));assert.ok(opener);await act(async()=>opener.click())
  assert.match(document.body.textContent,/Original KeyE.*Chart Key: G.*Performance KeyG/)
  const zero=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('(Original)'));await act(async()=>zero.click());assert.equal(t,-3)
  await render();assert.match(document.body.textContent,/Transpose: 0/);assert.ok(document.body.textContent.includes('B/D#'))
  t=0;await render();const reset=document.querySelector('[title="Reset Transposition to Original Key"]');assert.ok(reset);await act(async()=>reset.click());assert.equal(t,-3)
  await render();const up=document.querySelector('[title="Step Key Up (+1 semitone)"], [title="Transpose Up (+1)"]');assert.ok(up);await act(async()=>up.click());assert.equal(t,-2)
 }finally{await act(async()=>root.unmount())}
 // Both production call sites supply the same full source and storage-relative offset contract.
 const app=fs.readFileSync(require.resolve('../src/App.tsx'),'utf8'),stage=fs.readFileSync(require.resolve('../src/components/StageView.tsx'),'utf8')
 assert.match(app,/song=\{currentSong\}[\s\S]*?currentOffset=\{currentSong.transposeOffset \|\| 0\}/)
 assert.match(app,/onReset=\{\(\) => handleTransposeChange\(transposeContext\(currentSong, currentSong.transposeOffset \|\| 0\).resetOffset\)\}/)
 assert.match(stage,/song=\{song\}[\s\S]*?currentOffset=\{transposeOffset\}/)
})

test('109 field QA: raw E without key G reconciles preview, Save/reload, picker zero and Reset with stored offsets',async()=>{
 const raw='{title: Fixture}\n{key: G}\n{original_key: E}\n[E]My [Esus4]song'
 for(const offset of [-3,-1,0,2]){
  localStorage.clear()
  let stored={...song,rawContent:raw,transposeOffset:offset},root=createRoot(document.getElementById('root'))
  persistLibrary({songs:[stored],setlists:[]})
  const update=partial=>{stored={...stored,...partial};persistLibrary({songs:[stored],setlists:[]});return true}
  const mount=async()=>act(async()=>root.render(React.createElement(DesktopEditor,{song:stored,transposeOffset:stored.transposeOffset,onUpdateSong:update,onSaveSong:update})))
  const rendered=()=>[...document.querySelectorAll('.stage-chord-token')].map(e=>e.textContent)
  const expected=new Map([[-3,['C#','C#sus4']],[-1,['D#','D#sus4']],[0,['E','Esus4']],[2,['F#','F#sus4']]])
  try{
   await mount();await change(document.querySelector('textarea'),raw.replace('{key: G}\n',''))
   assert.equal(stored.key,'');assert.equal(stored.originalKey,'E');assert.equal(stored.transposeOffset,offset)
   assert.match(document.body.textContent,/Original Key: E.*Chart Key: E \(estimated\)/)
   const displayed=document.body.textContent.match(/Performance Key: ([A-G][#b]?m?)/)[1];assert.ok(keysArePitchEquivalent(displayed,expected.get(offset)[0]))
   assert.deepEqual(rendered(),expected.get(offset))
   // Undo/redo must reconcile both raw and entity chart metadata.
   await shortcut('z',document.querySelector('textarea'));assert.equal(stored.key,'G')
   await shortcut('y',document.querySelector('textarea'));assert.equal(stored.key,'')
   // A same-ID offset change must survive Save while the editor stays mounted.
   update({transposeOffset:0});await mount();assert.deepEqual(rendered(),['E','Esus4'])
   await shortcut('s');assert.equal(stored.transposeOffset,0)
   update({transposeOffset:offset});await mount()
   await shortcut('s');assert.equal(stored.key,'');assert.doesNotMatch(stored.rawContent,/\{key:/)
   await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));stored=readPersistedLibrary().songs[0]
   await mount();assert.deepEqual(rendered(),expected.get(offset));assert.equal(stored.transposeOffset,offset)
   // Exercise the real picker adapter against the saved song, then the editor renderer.
   await act(async()=>root.render(React.createElement(KeyPickerModal,{isOpen:true,song:stored,currentOffset:offset,onClose(){},onSelectOffset:n=>update({transposeOffset:n}),onReset:()=>update({transposeOffset:transposeContext(stored,stored.transposeOffset).resetOffset})})))
   assert.match(document.body.textContent,/Chart Key: E \(estimated\)/);assert.doesNotMatch(document.body.textContent,/\(Original\)/)
   const zero=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('(Chart)'));assert.match(zero.textContent,/0.*E/)
   await act(async()=>zero.click());assert.equal(stored.transposeOffset,0)
   await mount();assert.deepEqual(rendered(),['E','Esus4']);await shortcut('s');assert.equal(stored.transposeOffset,0)
   await act(async()=>root.render(React.createElement(KeyPickerModal,{isOpen:true,song:stored,currentOffset:-3,onClose(){},onSelectOffset(){},onReset:()=>update({transposeOffset:transposeContext(stored,-3).resetOffset})})))
   const reset=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Reset (0)'));await act(async()=>reset.click())
   await mount();assert.deepEqual(rendered(),['E','Esus4']);assert.equal(stored.originalKey,'E')
  }finally{await act(async()=>root.unmount())}
 }
})

test('109 field QA: pre-existing stale no-directive entity cannot supply the original-relative adapter baseline',()=>{
 const stale={...song,rawContent:'{original_key: E}\n[E]My [Esus4]song'}
 const c=transposeContext(stale,-3)
 assert.equal(c.chartKey,'E');assert.equal(c.chartEstimated,true);assert.equal(c.originalKey,'E');assert.equal(c.performanceKey,'C#');assert.equal(c.displayOffset,-3);assert.equal(c.originalRelative,false);assert.equal(c.toStoredOffset(0),0);assert.equal(c.resetOffset,0)
 assert.equal(transposeContext({...stale,originalKey:undefined,rawContent:'[E]song'},0).originalKey,'')
})


test('109 field QA: actual stage renders the same raw E performance as its picker, zero and Reset',async()=>{
 const {StageView}=require('../src/components/StageView.tsx')
 const stale={...song,rawContent:'{original_key: E}\n[E]My [Esus4]song'}
 localStorage.clear();const root=createRoot(document.getElementById('root'));let offset=-3
 const render=async()=>act(async()=>root.render(React.createElement(StageView,{song:{...stale,transposeOffset:offset},songs:[stale],activeSongIndex:0,onSelectSongIndex(){},onOpenSetlistDrawer(){},transposeOffset:offset,onTransposeChange:n=>{offset=n}})))
 const chords=()=>[...document.querySelectorAll('.stage-chord-token')].map(e=>e.textContent)
 try{
  await render();assert.deepEqual(chords(),['C#','C#sus4']);assert.match(document.body.textContent,/Transpose: -3/)
  const open=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Transpose: -3'));await act(async()=>open.click())
  assert.match(document.body.textContent,/Original KeyE.*Chart Key: E \(estimated\).*Performance KeyC#/)
  const zero=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('(Chart)'));await act(async()=>zero.click());assert.equal(offset,0)
  await render();assert.deepEqual(chords(),['E','Esus4'])
  offset=-3;await render();const reset=document.querySelector('[title="Reset Transposition to Chart Key"]');assert.ok(reset);await act(async()=>reset.click());assert.equal(offset,0)
  await render();assert.deepEqual(chords(),['E','Esus4']);assert.equal(stale.key,'G');assert.equal(stale.originalKey,'E')
 }finally{await act(async()=>root.unmount())}
})


test('111: confirmed chart key authorizes original zero without changing authored text or saved playback',()=>{
 const raw='{original_key: E}\n[G] [D] [Em]'
 const legacy={...song,rawContent:raw}
 assert.equal(transposeContext(legacy,0).originalRelative,false)
 const confirmed={...legacy,confirmedChartKey:'G'}
 const c=transposeContext(confirmed,0)
 assert.equal(c.originalRelative,true);assert.equal(c.displayOffset,3);assert.equal(c.performanceKey,'G')
 for(const [ui,expected] of [[0,['E','B','C#m']],[2,['F#','C#','D#m']]]){
  const parsed=parseGtarSong(raw,c.toStoredOffset(ui));assert.deepEqual(parsed.lines.flatMap(l=>l.chords || (l.segments || []).filter(s=>s.chord).map(s=>s.chord)),expected)
 }
 assert.equal(confirmed.rawContent,raw)
})

test('111: explicit chart E confirmation preserves raw and C# playback; original zero then saves/reloads E',async()=>{
 localStorage.clear();const raw='{title: Fixture}\n{original_key: E}\n[E]My [Esus4]song'
 let stored={...song,rawContent:raw,transposeOffset:-3},root=createRoot(document.getElementById('root'))
 const update=partial=>{stored={...stored,...partial};persistLibrary({songs:[stored],setlists:[]});return true}
 const mount=()=>act(async()=>root.render(React.createElement(DesktopEditor,{song:stored,transposeOffset:stored.transposeOffset,onUpdateSong:update,onSaveSong:update})))
 const chords=()=>[...document.querySelectorAll('.stage-chord-token')].map(e=>e.textContent)
 try{
  await mount();await click('[aria-label="Song Details & Metadata"]')
  await change(document.querySelector('[aria-label="Confirm authored Chart Key"]'),'E')
  await click('[data-testid="confirm-chart-key"]')
  assert.equal(stored.confirmedChartKey,'E');assert.equal(stored.rawContent,raw);assert.equal(stored.transposeOffset,-3);assert.deepEqual(chords(),['C#','C#sus4'])
  assert.equal(transposeContext(stored,-3).displayOffset,-3)
  await act(async()=>root.render(React.createElement(KeyPickerModal,{isOpen:true,song:stored,currentOffset:-3,onClose(){},onSelectOffset:n=>update({transposeOffset:n}),onReset(){}})))
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('(Original)')).click())
  await mount();assert.deepEqual(chords(),['E','Esus4']);await shortcut('s');assert.equal(stored.transposeOffset,0)
  const reloaded=readPersistedLibrary().songs[0];assert.equal(reloaded.confirmedChartKey,'E');assert.equal(transposeContext(reloaded,0).originalRelative,true);assert.doesNotMatch(reloaded.rawContent,/\{key:/)
 }finally{await act(async()=>root.unmount())}
})


test('111: text transposition rebases nonzero offset once, including slash bass, Save/reload and recovery',async()=>{
 for(const fail of [false,true]){
  localStorage.clear();let stored={...song,transposeOffset:2};const recovery={current:null},root=createRoot(document.getElementById('root'))
  const update=partial=>{if(fail)return false;stored={...stored,...partial};persistLibrary({songs:[stored],setlists:[]});return true}
  const mount=()=>act(async()=>root.render(React.createElement(DesktopEditor,{song:stored,transposeOffset:stored.transposeOffset,onUpdateSong:update,onSaveSong:update,recoveryDraftRef:recovery})))
  const chords=()=>[...document.querySelectorAll('.stage-chord-token')].map(e=>e.textContent)
  try{
   await mount();const before=chords();assert.deepEqual(before,['A','E/G#'])
   await click('[aria-label="Song Details & Metadata"]');await click('[data-testid="transpose-chart-to-original"]')
   assert.deepEqual(chords(),before);await shortcut('s')
   const result=fail?recovery.current():readPersistedLibrary().songs[0]
   assert.equal(result.key,'E');assert.equal(result.originalKey,'E');assert.equal(result.transposeOffset,5)
   assert.match(result.rawContent,/\[E\]My \[B\/D#\]song/)
   if(!fail){
    await mount();assert.deepEqual(chords(),before);await shortcut('s');assert.equal(stored.transposeOffset,5)
    await shortcut('z',document.querySelector('textarea'));await mount();assert.equal(stored.transposeOffset,2);assert.equal(stored.key,'G');assert.deepEqual(chords(),before)
    await shortcut('y',document.querySelector('textarea'));await mount();assert.equal(stored.transposeOffset,5);assert.equal(stored.key,'E');assert.deepEqual(chords(),before)
   }
   else{assert.equal(stored.transposeOffset,2);assert.equal(stored.rawContent,song.rawContent)}
  }finally{await act(async()=>root.unmount())}
 }
})

test('111: confirmed chart survives backup and sync; confirmation-only changes are not discarded',()=>{
 const {normalizeBackupSong,createBackupPayload}=require('../src/utils/jsonBackup.ts')
 const {computeSongbookChecksum,songEquals}=require('../src/utils/cloudSongbookSync.ts')
 const raw='{original_key: E}\n[E]My [Esus4]song',confirmed={...song,key:'E',confirmedChartKey:'E',rawContent:raw,transposeOffset:-3}
 const normalized=normalizeBackupSong(confirmed);assert.equal(normalized.confirmedChartKey,'E');assert.equal(normalized.rawContent,raw);assert.equal(normalized.transposeOffset,-3)
 const backup=createBackupPayload([confirmed],[{id:'list',name:'List',songs:[{id:song.id,title:song.title}]}])
 assert.equal(backup.songs[0].confirmedChartKey,'E');assert.equal(backup.setlists[0].songs[0].id,song.id)
 const legacy={...confirmed};delete legacy.confirmedChartKey
 assert.notEqual(require('../src/utils/songbookFoundation.ts').computeSemanticSongFingerprint(legacy),require('../src/utils/songbookFoundation.ts').computeSemanticSongFingerprint(confirmed));assert.equal(songEquals(legacy,confirmed),false);assert.notEqual(computeSongbookChecksum({songs:[legacy],setlists:[]}),computeSongbookChecksum({songs:[confirmed],setlists:[]}))
 localStorage.clear();persistLibrary({songs:[normalized],setlists:[]});assert.equal(readPersistedLibrary().songs[0].confirmedChartKey,'E')
})

test('111: confirmed E/E zero, non-tonic first chord, capo, minor and enharmonic spelling keep semantic basis',()=>{
 for(const data of [
  {key:'E',originalKey:'E',confirmedChartKey:'E',rawContent:'[E]My [Esus4]song',capo:'2'},
  {key:'G',originalKey:'E',confirmedChartKey:'G',rawContent:'[D]intro [G]song'},
  {key:'Gm',originalKey:'Em',confirmedChartKey:'Gm',rawContent:'[Dm]intro [Gm]song'},
  {key:'C#',originalKey:'Db',confirmedChartKey:'C#',rawContent:'[G#]intro'}]){
  const c=transposeContext(data,0);assert.equal(c.originalRelative,true)
  assert.equal(transposeContext(data,c.toStoredOffset(0)).performanceKey,data.originalKey)
 }
 const invalid=transposeContext({...song,confirmedChartKey:'H'},0);assert.equal(invalid.originalRelative,false);assert.equal(invalid.chartConflict,true)
})

test('111: stage cast broadcasts the same performance key and actual offset as rendered chords',async()=>{
 const {StageView}=require('../src/components/StageView.tsx'),{stageCast}=require('../src/utils/stageCast.ts')
 const previous=stageCast.broadcastState;let received;stageCast.broadcastState=state=>{received=state}
 const root=createRoot(document.getElementById('root'))
 try{
  await act(async()=>root.render(React.createElement(StageView,{song, songs:[song],activeSongIndex:0,onSelectSongIndex(){},onOpenSetlistDrawer(){},transposeOffset:-3,onTransposeChange(){}})))
  assert.equal(received.effectiveKey,'E');assert.equal(received.transposeOffset,-3);assert.equal(received.song.rawContent,song.rawContent)
  assert.deepEqual([...document.querySelectorAll('.stage-chord-token')].map(e=>e.textContent),['E','B/D#'])
  const app=fs.readFileSync(require.resolve('../src/App.tsx'),'utf8');assert.match(app,/effectiveKey: transposeContext\(currentSong, currentSong.transposeOffset \|\| 0\).performanceKey/)
 }finally{stageCast.broadcastState=previous;await act(async()=>root.unmount())}
})


test('111: conflicting raw confirmation is rejected; failed confirmation keeps recoverable draft and CAS baseline',async()=>{
 for(const conflict of [true,false]){
  localStorage.clear();const raw=conflict?song.rawContent:'{original_key: E}\n[E]My [Esus4]song'
  const stale={...song,rawContent:raw,transposeOffset:-3};persistLibrary({songs:[stale],setlists:[]})
  const baseline=getLastKnownPersistedLibraryRaw(),recovery={current:null},root=createRoot(document.getElementById('root'));let writes=0
  try{
   await act(async()=>root.render(React.createElement(DesktopEditor,{song:stale,transposeOffset:-3,recoveryDraftRef:recovery,onUpdateSong:()=>{writes++;return false}})))
   await click('[aria-label="Song Details & Metadata"]');await change(document.querySelector('[aria-label="Confirm authored Chart Key"]'),'E');await click('[data-testid="confirm-chart-key"]')
   assert.equal(writes,conflict?0:1);assert.equal(getLastKnownPersistedLibraryRaw(),baseline);assert.equal(readPersistedLibrary().songs[0].key,'G')
   if(conflict)assert.match(document.body.textContent,/Correct or remove the conflicting raw key directive/)
   else{assert.equal(recovery.current().confirmedChartKey,'E');assert.equal(recovery.current().rawContent,raw);assert.equal(recovery.current().transposeOffset,-3)}
  }finally{await act(async()=>root.unmount())}
 }
 const {validateBackupEntries}=require('../src/utils/jsonBackup.ts');assert.ok(validateBackupEntries([{...song,confirmedChartKey:'H'}],[]).some(e=>e.includes('confirmedChartKey')))
})


test('111 prior review: key shorthand survives Save, repairs synchronize stale entity, steppers wrap stored boundaries',async()=>{
 for(const raw of [song.rawContent.replace('{key: G}','{k: G}'),song.rawContent+'\n{key: A}']){
  let stored={...song,key:raw.includes('{key: A}')?'A':'G',rawContent:raw};const root=createRoot(document.getElementById('root'))
  const update=partial=>{stored={...stored,...partial};return true}
  try{
   await act(async()=>root.render(React.createElement(DesktopEditor,{song:stored,transposeOffset:0,onUpdateSong:update,onSaveSong:update})))
   if(raw.includes('{key: A}'))await change(document.querySelector('textarea'),raw.replace('\n{key: A}',''))
   await shortcut('s');assert.equal(stored.key,'G');assert.equal(transposeContext(stored,0).originalRelative,true);assert.match(stored.rawContent,/\[(?:G)\]My \[D\/F#\]song/)
  }finally{await act(async()=>root.unmount())}
 }
 const {StageView}=require('../src/components/StageView.tsx')
 for(const [offset,delta] of [[11,1],[-11,-1]]){
  const root=createRoot(document.getElementById('root'));let selected
  try{
   await act(async()=>root.render(React.createElement(StageView,{song,songs:[song],activeSongIndex:0,onSelectSongIndex(){},onOpenSetlistDrawer(){},transposeOffset:offset,onTransposeChange:n=>{selected=n}})))
   const button=document.querySelector(delta===1?'[title="Step Key Up (+1 semitone)"], [title="Transpose Up (+1)"]':'[title="Step Key Down (-1 semitone)"], [title="Transpose Down (-1)"]');assert.ok(button);await act(async()=>button.click())
   assert.equal(selected,transposeContext(song,offset).toStoredOffset(transposeContext(song,offset).displayOffset+delta));assert.ok(selected>=-11 && selected<=11)
  }finally{await act(async()=>root.unmount())}
 }
})
