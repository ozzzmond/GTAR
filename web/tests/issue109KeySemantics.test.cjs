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
