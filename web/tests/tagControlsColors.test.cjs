const {test}=require('node:test')
const assert=require('node:assert/strict')
const h=require('./helpers/tabHarness.cjs')
test('file colors round trip and legacy file remains colorless',()=>{
 h.freshStorage()
 const b=require('../src/utils/jsonBackup.ts'), lib=h.library(2,1), colors={rock:'#abcdef'}
 const p=b.createBackupPayload(lib.songs,lib.setlists,'test',undefined,undefined,colors)
 assert.deepEqual(p.tagColors,colors)
 const parsed=b.parseBackupJson(JSON.stringify(p))
 assert.equal(parsed.isValid,true,parsed.error);assert.deepEqual(parsed.tagColors,colors)
 assert.deepEqual(parsed.ignoredFields,[])
 assert.doesNotThrow(()=>b.verifyBackupJson(JSON.stringify(p),p))
 assert.equal(b.parseBackupJson(JSON.stringify(lib)).tagColors,undefined)
})
test('colors survive B3 reload and sync validation rejects ambiguous or unsafe colors',async()=>{
 const storage=h.freshStorage(), factory=new h.Factory(), tab=h.newTab()
 await tab.sj.prepareLibraryStorage(storage,{factory})
 const lib={...h.library(2,1),tagColors:{rock:'#aabbcc'}}
 tab.sj.persistLibrary(lib,storage);await tab.store.flushLibraryStore()
 const other=h.newTab();await other.sj.prepareLibraryStorage(storage,{factory})
 assert.deepEqual(other.sj.readPersistedLibrary(storage).tagColors,lib.tagColors)
 for(const colors of [null,[],{Rock:'#abcdef'},{rock:'red'},{rock:'#fff'},{rock:'url(x)'}]) assert.throws(()=>other.sj.validateLibrary({...lib,tagColors:colors}))
 assert.doesNotThrow(()=>other.sj.validateLibrary(h.library(1,0)))
})
test('restore replace, merge, safety snapshot and cloud payload retain colors',()=>{
 const storage=h.freshStorage(), b=require('../src/utils/jsonBackup.ts'), ex=require('../src/utils/backupExport.ts'), cloud=require('../src/utils/cloudBackupFormat.ts')
 const before={...h.library(2,1),tagColors:{rock:'#aabbcc',jazz:'#ffffff'}}
 const incoming={...h.library(2,1),tagColors:{rock:'#112233',new:'#ff0000'}}
 assert.deepEqual(ex.expectedRestoredLibrary(before,incoming,'replace').tagColors,incoming.tagColors)
 assert.deepEqual(ex.expectedRestoredLibrary(before,incoming,'merge').tagColors,{rock:'#112233',jazz:'#ffffff',new:'#ff0000'})
 b.createRestoreSafetySnapshot(before,storage);assert.deepEqual(b.restoreFromSafetySnapshot(storage).tagColors,before.tagColors)
 assert.deepEqual(JSON.parse(cloud.songbookUploadBody('upload',incoming,cloud.computeSongbookChecksum(incoming),0,null)).data.tagColors,incoming.tagColors)
 assert.ok(cloud.estimateSongbookUploadBytes(incoming)<10000)
})
test('sidebar rename and remove stay inline, cancel safely and report save failure',async()=>{
 h.freshStorage();global.IS_REACT_ACT_ENVIRONMENT=true
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{MusicExplorerNav}=require('../src/components/MusicExplorerNav.tsx')
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host), calls=[]
 const props={songs:[{...h.library(1,0).songs[0],tags:['rock']}],setlists:[],currentSelection:{type:'ALL_SONGS'},onSelect(){},onNewSong(){},onNewSetlist(){},onChangeTag:(...args)=>{calls.push(args);return false}}
 const click=async label=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);assert.ok(b,label);await act(async()=>b.click())}
 try{
 await act(async()=>root.render(React.createElement(MusicExplorerNav,props)))
 await click('Tag actions for rock');assert.ok(host.querySelector('[aria-label="Tag name"]'))
 await click('Cancel');assert.deepEqual(calls,[])
 await click('Tag actions for rock');await click('Remove');assert.deepEqual(calls,[])
 await click('Confirm remove tag');assert.deepEqual(calls,[['rock']]);assert.match(host.textContent,/not saved/i)
 }finally{await act(async()=>root.unmount());host.remove()}
})
test('Select mode Add to tag sends all selected songs with canonical existing or new tags',async()=>{
 h.freshStorage();global.IS_REACT_ACT_ENVIRONMENT=true
 global.sessionStorage=h.dom.window.sessionStorage
 global.requestAnimationFrame=callback=>setTimeout(callback,0);global.cancelAnimationFrame=clearTimeout
 window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{SongbookHomeView}=require('../src/components/SongbookHomeView.tsx'),{TagLibraryContext}=require('../src/utils/tagLibraryContext.ts')
 const songs=h.library(3,0).songs.map((s,i)=>({...s,tags:i===0?['rock']:['jazz']})), calls=[]
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const click=async id=>{const b=host.querySelector(`[data-testid="${id}"]`);assert.ok(b,id);await act(async()=>b.click())}
 try{
 await act(async()=>root.render(React.createElement(TagLibraryContext.Provider,{value:{colors:{rock:'#112233'},onAddToTag:(ids,tag)=>{calls.push({ids,tag});return true}}},React.createElement(SongbookHomeView,{songs,setlists:[],activeSongIndex:0,onSongMembershipChange(){},onCreateSetlistForSong(){},onSelectSong(){},onNewSong(){},onOpenSetlists(){},onDeleteSong(){}}))))
 assert.equal(host.querySelector('[data-testid="bulk-add-to-tag"]'),null)
 await click('toggle-song-selection-mode');assert.equal(host.querySelector('[data-testid="bulk-add-to-tag"]').disabled,true)
 await click('select-all-songs')
 for(const name of [' ##New Tag ','rock']){
 await click('bulk-add-to-tag')
 const input=host.querySelector('[aria-label="Existing or new tag"]')
 assert.deepEqual([...host.querySelectorAll('#songbook-tag-options option')].map(o=>o.value),['jazz','rock'])
 await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,name);input.dispatchEvent(new window.Event('input',{bubbles:true}))})
 await act(async()=>host.querySelector('[data-testid="bulk-add-to-tag-dialog"] form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
 }
 assert.deepEqual(calls,[{ids:songs.map(s=>s.id),tag:'new tag'},{ids:songs.map(s=>s.id),tag:'rock'}])
 }finally{await act(async()=>root.unmount());host.remove()}
})
test('rename moves colors, collisions preserve destination, removal keeps unrelated colors and contrast stays readable',()=>{
 const t=require('../src/utils/songTags.ts'), colors={rock:'#ffffff',jazz:'#000000'}
 assert.deepEqual(t.changeTagColorKey(colors,'rock','folk'),{folk:'#ffffff',jazz:'#000000'})
 assert.deepEqual(t.changeTagColorKey(colors,'rock','jazz'),{jazz:'#000000'})
 assert.deepEqual(t.changeTagColorKey(colors,'rock'),{jazz:'#000000'})
 assert.equal(t.tagChipStyle(colors,'rock').color,'#000000');assert.equal(t.tagChipStyle(colors,'jazz').color,'#ffffff')
 for(const hex of ['#ff0000','#00ff00','#0000ff','#abcdef','#777777']){
 const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
 const l=.2126*v[0]+.7152*v[1]+.0722*v[2]
 const contrast=t.tagChipStyle({tag:hex},'tag').color==='#000000'?(l+.05)/.05:1.05/(l+.05)
 assert.ok(contrast>=4.5,`${hex} contrast=${contrast}`)
 }
})
test('inline rename submits canonical name and color picker applies presets/custom hex without dialogs',async()=>{
 h.freshStorage();global.IS_REACT_ACT_ENVIRONMENT=true
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{MusicExplorerNav}=require('../src/components/MusicExplorerNav.tsx'),{TagLibraryContext}=require('../src/utils/tagLibraryContext.ts')
 const changes=[],colors=[],host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const click=async label=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);assert.ok(b,label);await act(async()=>b.click())}
 const fill=async(label,value)=>{const input=host.querySelector(`[aria-label="${label}"]`);await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}))})}
 try{
 await act(async()=>root.render(React.createElement(TagLibraryContext.Provider,{value:{colors:{rock:'#112233'},onColorChange:(...args)=>{colors.push(args);return true}}},React.createElement(MusicExplorerNav,{songs:[{...h.library(1,0).songs[0],tags:['rock']}],setlists:[],currentSelection:{type:'ALL_SONGS'},onSelect(){},onNewSong(){},onNewSetlist(){},onChangeTag:(...args)=>{changes.push(args);return true}}))))
 await click('Tag actions for rock');await fill('Tag name',' #FOLK ')
 await act(async()=>host.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
 assert.deepEqual(changes,[['rock','folk']]);assert.equal(host.querySelector('form'),null)
 await click('Tag actions for rock');await click('Color')
 await fill('Custom tag hex color','bad');await click('Apply color');assert.equal(colors.length,0);assert.match(host.textContent,/six-digit/)
 await fill('Custom tag hex color','#ABCDEF');await click('Apply color');assert.deepEqual(colors.pop(),['rock','#abcdef'])
 document.documentElement.style.setProperty('--custom-actionColor','#123456')
 await click('Action tag color');assert.deepEqual(colors.pop(),['rock','#123456'])
 await click('Reset color');assert.deepEqual(colors.pop(),['rock',undefined])
 }finally{await act(async()=>root.unmount());host.remove()}
})
for(const mode of ['replace','merge'])test(`real import hook persists ${mode} colors and verifies restore`,async()=>{
 const storage=h.freshStorage(),sj=require('../src/utils/syncJournal.ts'),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
 const {useLibraryImports}=require('../src/utils/useLibraryImports.ts'),{verifyRestoredLibrary}=require('../src/utils/backupExport.ts')
 global.IS_REACT_ACT_ENVIRONMENT=true
 const before={...h.library(2,1),tagColors:{rock:'#123456',jazz:'#ffffff'}};sj.persistLibrary(before,storage)
 let actions,state;const baseline={current:sj.libraryRevision(storage)},noop=()=>{}
 function Harness(){const [songs,setSongs]=React.useState(before.songs),[deletedSongs,setDeletedSongs]=React.useState([]),[setlists,setSetlists]=React.useState(before.setlists),[tagColors,setTagColors]=React.useState(before.tagColors),[folders,setFolders]=React.useState([])
 actions=useLibraryImports({songs,deletedSongs,setlists,tagColors,setTagColors,folders,setFolders,setSongs,setDeletedSongs,setSetlists,persistedBaselineRef:baseline,setCrossTabConflict:noop,setToastMessage:noop,setActiveSongIndex:noop,setActiveSetlistId:noop,setActiveSetlistSongIndex:noop,setQueueMode:noop,setIncomingSharedSetlist:noop});state={songs,setlists,tagColors};return null}
 const host=document.createElement('div'),root=createRoot(host)
 try{await act(async()=>root.render(React.createElement(Harness)))
 const incoming={...h.library(1,0),tagColors:{rock:'#abcdef',folk:'#000000'}}
 incoming.songs=incoming.songs.map(require('../src/utils/jsonBackup.ts').normalizeBackupSong)
 await act(async()=>actions[mode==='replace'?'handleFullRestore':'handleSmartMerge'](incoming.songs,incoming.setlists,undefined,incoming.tagColors))
 const expected=mode==='replace'?incoming.tagColors:{rock:'#abcdef',jazz:'#ffffff',folk:'#000000'}
 assert.deepEqual(sj.readPersistedLibrary(storage).tagColors,expected);assert.deepEqual(state.tagColors,expected)
 assert.deepEqual(verifyRestoredLibrary(before,incoming,mode,storage),[])
 // Old backup merge preserves colors; old backup replace clears them explicitly.
 await act(async()=>actions[mode==='replace'?'handleFullRestore':'handleSmartMerge'](incoming.songs,incoming.setlists))
 assert.deepEqual(sj.readPersistedLibrary(storage).tagColors,mode==='replace'?{}:expected)
 }finally{await act(async()=>root.unmount())}
})
test('App saves bulk tags, colors, rename and removal without changing other song fields',async()=>{
 const storage=h.freshStorage();global.sessionStorage=window.sessionStorage;global.HTMLElement=window.HTMLElement;global.CustomEvent=window.CustomEvent;global.Event=window.Event
 global.IS_REACT_ACT_ENVIRONMENT=true
 window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
 const originalFetch=global.fetch;global.fetch=async()=>{throw new Error('offline')}
 const tab=h.newTab(),lib=h.library(3,0)
 lib.songs=lib.songs.map((s,i)=>({...s,tags:i===2?['jazz']:['rock','keep']}));tab.sj.persistLibrary(lib,storage)
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),App=require('../src/App.tsx').default
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const click=async selector=>{const b=host.querySelector(selector);assert.ok(b,selector);await act(async()=>b.click())}
 const fill=async(label,value)=>{const input=host.querySelector(`[aria-label="${label}"]`);assert.ok(input,label);await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}))})}
 const named=async text=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(b,text);await act(async()=>b.click())}
 try{
 await act(async()=>root.render(React.createElement(App)))
 await click('[data-testid="toggle-song-selection-mode"]');await click('[data-testid="select-all-songs"]');await click('[data-testid="bulk-add-to-tag"]')
 await fill('Existing or new tag',' #LIVE ')
 await act(async()=>host.querySelector('[data-testid="bulk-add-to-tag-dialog"] form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
 assert.ok(tab.sj.readPersistedLibrary(storage).songs.every(s=>s.tags.includes('live')))
 await click('[aria-label="Tag actions for rock"]');await named('Color');await fill('Custom tag hex color','#123456');await named('Apply color')
 assert.deepEqual(tab.sj.readPersistedLibrary(storage).tagColors,{rock:'#123456'})
 await fill('Tag name',' #FOLK ');await named('Save')
 let saved=tab.sj.readPersistedLibrary(storage)
 assert.deepEqual(saved.tagColors,{folk:'#123456'});assert.deepEqual(saved.songs[0].tags,['folk','keep','live'])
 await click('[aria-label="Tag actions for folk"]');await named('Remove');await named('Confirm remove tag')
 saved=tab.sj.readPersistedLibrary(storage)
 assert.deepEqual(saved.tagColors,{});assert.deepEqual(saved.songs[0].tags,['keep','live']);assert.deepEqual(saved.songs[2].tags,['jazz','live'])
 for(let i=0;i<lib.songs.length;i++){const {tags:_old,...old}=lib.songs[i],{tags:_new,...newSong}=saved.songs[i];assert.deepEqual(newSong,old)}
 }finally{await act(async()=>root.unmount());host.remove();global.fetch=originalFetch}
})
test('offline cloud upload/read and replace/merge restore round trip colors; legacy checksum stays compatible',async()=>{
 const storage=h.freshStorage(),sj=require('../src/utils/syncJournal.ts'),cloud=require('../src/utils/manualCloudBackup.ts'),fmt=require('../src/utils/cloudBackupFormat.ts'),ex=require('../src/utils/backupExport.ts'),jb=require('../src/utils/jsonBackup.ts')
 const lib={...h.library(2,1),tagColors:{rock:'#abcdef'}};lib.songs=lib.songs.map(jb.normalizeBackupSong)
 const {tagColors:_colors,...legacy}=lib
 assert.equal(fmt.computeSongbookChecksum(lib),fmt.computeSongbookChecksum(legacy))
 const originalFetch=global.fetch;let record
 global.fetch=async(_url,options)=>{
 if(options.method==='POST'){const payload=JSON.parse(options.body);record={data:payload.data,checksum:payload.clientChecksum,version:1,updatedAt:'2026-11-03'};return{ok:true,json:async()=>({success:true})}}
 return{ok:true,json:async()=>({success:true,cloudRecord:record})}
 }
 try{
 const saved=await cloud.writeCloudBackup({token:'test',userId:'test'},lib,null)
 assert.deepEqual(saved.data.tagColors,lib.tagColors)
 for(const mode of ['replace','merge']){
 const before={...h.library(3,0),tagColors:{jazz:'#000000'}};sj.persistLibrary(before,storage)
 await cloud.restoreCloudBackup(before,saved.data,mode,incoming=>sj.persistLibrary(ex.expectedRestoredLibrary(before,incoming,mode),storage),storage)
 assert.deepEqual(sj.readPersistedLibrary(storage).tagColors,mode==='replace'?{rock:'#abcdef'}:{jazz:'#000000',rock:'#abcdef'})
 }
 // A server dropping colors must not be reported as a verified upload.
 global.fetch=async(_url,options)=>options.method==='POST'?{ok:true,json:async()=>({success:true})}:{ok:true,json:async()=>({success:true,cloudRecord:{...record,data:legacy}})}
 await assert.rejects(()=>cloud.writeCloudBackup({token:'test',userId:'test'},lib,null),/verification failed/)
 }finally{global.fetch=originalFetch}
})
test('canonical tag names matching object properties remain valid color keys',()=>{
 const t=require('../src/utils/songTags.ts'),colors=JSON.parse('{"__proto__":"#abcdef","constructor":"#123456"}')
 assert.equal(t.validTagColors(colors),true)
 assert.equal(t.tagChipStyle(colors,'__proto__').backgroundColor,'#abcdef')
 assert.equal(t.tagChipStyle({},'constructor'),undefined)
 assert.deepEqual(t.changeTagColorKey(colors,'__proto__','prototype'),{constructor:'#123456',prototype:'#abcdef'})
 assert.equal(Object.getPrototypeOf(t.changeTagColorKey({},'other','__proto__')),Object.prototype)
})
test('tag editor panel and Add to tag modal use pill inputs, pill buttons and 44px hit areas',async()=>{
 h.freshStorage();global.IS_REACT_ACT_ENVIRONMENT=true
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{MusicExplorerNav}=require('../src/components/MusicExplorerNav.tsx'),{TagLibraryContext}=require('../src/utils/tagLibraryContext.ts')
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
 await act(async()=>root.render(React.createElement(TagLibraryContext.Provider,{value:{colors:{rock:'#112233'},onColorChange:()=>true}},React.createElement(MusicExplorerNav,{songs:[{...h.library(1,0).songs[0],tags:['rock']}],setlists:[],currentSelection:{type:'ALL_SONGS'},onSelect(){},onNewSong(){},onNewSetlist(){},onChangeTag:()=>true}))))
 const actionBtn=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Tag actions for rock')
 assert.ok(actionBtn);await act(async()=>actionBtn.click())
 const form=host.querySelector('form[aria-label="Edit tag rock"]')
 assert.ok(form,'Tag editor form is open')
 assert.match(form.className,/pl-3.5/)
 const tagInput=host.querySelector('input[aria-label="Tag name"]')
 assert.ok(tagInput)
 assert.match(tagInput.className,/rounded-xl border border-app-border hover:border-app-border\/80 bg-app-surface/)
 assert.match(tagInput.className,/min-h-\[36px\]/)
 const saveBtn=[...form.querySelectorAll('button')].find(b=>b.textContent==='Save')
 assert.match(saveBtn.className,/rounded-xl bg-app-action/)
 assert.match(saveBtn.className,/h-7/)
 const cancelBtn=[...form.querySelectorAll('button')].find(b=>b.textContent==='Cancel')
 assert.match(cancelBtn.className,/rounded-xl bg-app-surface/)
 const colorBtn=[...form.querySelectorAll('button')].find(b=>b.textContent==='Color')
 assert.ok(colorBtn);await act(async()=>colorBtn.click())
 const swatches=[...host.querySelectorAll('[aria-label$="tag color"]')]
 assert.equal(swatches.length,6)
 for(const sw of swatches){
  assert.match(sw.className,/rounded-full/)
  const dot=sw.querySelector('span.rounded-full')
  assert.ok(dot,'Inner swatch dot exists')
 }
 const hexInput=host.querySelector('input[aria-label="Custom tag hex color"]')
 assert.ok(hexInput)
 assert.match(hexInput.className,/rounded-xl border border-app-border/)
 const applyBtn=[...form.querySelectorAll('button')].find(b=>b.textContent==='Apply color')
 assert.match(applyBtn.className,/rounded-xl bg-app-surface/)
 }finally{await act(async()=>root.unmount());host.remove()}
})
