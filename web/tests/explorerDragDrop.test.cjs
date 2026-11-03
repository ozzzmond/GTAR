const {test}=require('node:test')
const assert=require('node:assert/strict')
const h=require('./helpers/tabHarness.cjs')
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
global.IS_REACT_ACT_ENVIRONMENT=true
window.requestAnimationFrame=cb=>window.setTimeout(()=>cb(0),16)
window.cancelAnimationFrame=id=>window.clearTimeout(id)
async function fixture(run){
 h.freshStorage()
 const {ExplorerDragDrop}=require('../src/components/ExplorerDragDrop.tsx')
 const songs=h.library(2,0).songs.map((s,i)=>({...s,id:`song-${i}`,tags:i?['Rock']:[]}))
 const calls=[]; const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const props={songs,setlists:[{id:'set',name:'Set',songs:[]}],folders:[{id:'folder',name:'Folder',parentId:null}],onTag:(...args)=>calls.push(['tag',...args]),onSetlist:(...args)=>calls.push(['setlist',...args]),onFolder:(...args)=>calls.push(['folder',...args]),onTrash:(...args)=>calls.push(['trash',...args]),onTouchDrag(){}}
 await act(async()=>root.render(React.createElement(ExplorerDragDrop,props)))
 host.insertAdjacentHTML('beforeend',`<div draggable="true" data-explorer-drag-songs='["song-0","song-1"]'>Songs</div><div data-explorer-drop-tag="Rock">Rock</div>`)
 const source=host.querySelector('[draggable]'),target=host.querySelector('[data-explorer-drop-tag]')
 const fire=(el,type)=>{const event=new window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{setData(){},effectAllowed:'',dropEffect:''}});el.dispatchEvent(event);return event}
 try{await run({host,source,target,calls,fire,root,props})}finally{await act(async()=>root.unmount());host.remove()}
}
test('song selection drops onto a tag; existing memberships are omitted',()=>fixture(async({source,target,calls,fire})=>{
 fire(source,'dragstart');assert.equal(fire(target,'dragover').defaultPrevented,true)
 assert.equal(target.dataset.explorerDropActive,'true');fire(target,'drop')
 assert.deepEqual(calls,[['tag',['song-0'],'Rock']]);assert.equal(target.dataset.explorerDropActive,undefined)
}))
test('song selection drops onto a setlist as shortcuts',()=>fixture(async({source,target,calls,fire})=>{
 target.removeAttribute('data-explorer-drop-tag');target.dataset.explorerDropSetlist='set'
 fire(source,'dragstart');fire(target,'drop');assert.deepEqual(calls,[['setlist','set',['song-0','song-1']]])
}))
test('setlists move to a folder and Unfiled; song and unknown folder targets reject them',()=>fixture(async({source,target,calls,fire,root,props})=>{
 source.removeAttribute('data-explorer-drag-songs');source.dataset.explorerDragSetlist='set'
 fire(source,'dragstart');assert.equal(fire(target,'dragover').defaultPrevented,false);fire(target,'drop');assert.deepEqual(calls,[])
 target.removeAttribute('data-explorer-drop-tag');target.dataset.explorerDropFolder='missing'
 fire(source,'dragstart');fire(target,'drop');assert.deepEqual(calls,[])
 target.dataset.explorerDropFolder='folder';fire(source,'dragstart');fire(target,'drop');assert.deepEqual(calls,[['folder','set','folder']])
 await act(async()=>root.render(React.createElement(require('../src/components/ExplorerDragDrop.tsx').ExplorerDragDrop,{...props,setlists:[{...props.setlists[0],folderId:'folder'}]})))
 target.dataset.explorerDropFolder='';fire(source,'dragstart');fire(target,'drop');assert.deepEqual(calls[1],['folder','set',null])
}))
test('cancelled or invalid drops change nothing and clear feedback',()=>fixture(async({source,target,calls,fire})=>{
 fire(source,'dragstart');fire(target,'dragover');fire(source,'dragend');fire(target,'drop');assert.deepEqual(calls,[]);assert.equal(target.dataset.explorerDropActive,undefined)
 fire(source,'dragstart');document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));fire(target,'drop');assert.deepEqual(calls,[])
 fire(source,'dragstart');fire(document.body,'drop');assert.deepEqual(calls,[])
}))
test('duplicate tag drop is a no-op',()=>fixture(async({source,target,calls,fire})=>{
 source.dataset.explorerDragSongs='["song-1"]';fire(source,'dragstart');fire(target,'drop');assert.deepEqual(calls,[])
}))
test('400ms touch hold lifts; tap, scroll and touch cancellation leave data unchanged',()=>fixture(async({source,target,calls})=>{
 const touch=(type,x=10,y=10)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});const point={identifier:1,clientX:x,clientY:y};Object.defineProperties(e,{touches:{value:type==='touchend'?[]:[point]},changedTouches:{value:[point]}});source.dispatchEvent(e);return e}
 touch('touchstart');touch('touchend');await h.settle(420);assert.equal(document.querySelector('.explorer-drag-ghost'),null)
 touch('touchstart');assert.equal(touch('touchmove',10,40).defaultPrevented,false);await h.settle(420);assert.equal(document.querySelector('.explorer-drag-ghost'),null);touch('touchend')
 touch('touchstart');await h.settle(420);assert.ok(document.querySelector('.explorer-drag-ghost'));document.elementFromPoint=()=>target
 assert.equal(touch('touchmove',30,30).defaultPrevented,true);touch('touchcancel');assert.deepEqual(calls,[]);assert.equal(document.querySelector('.explorer-drag-ghost'),null)
 touch('touchstart');await h.settle(420);touch('touchmove',30,30);touch('touchend',30,30);assert.deepEqual(calls,[['tag',['song-0'],'Rock']])
}))
test('Trash drop asks first; cancel preserves songs and confirm uses the existing bulk trash flow',async()=>{
 h.freshStorage();Object.assign(global,{HTMLElement:window.HTMLElement,Node:window.Node});Object.defineProperty(global,'navigator',{configurable:true,value:window.navigator})
 window.matchMedia=window.matchMedia||(()=>({matches:false,addEventListener(){},removeEventListener(){}}))
 const {ExplorerDragDrop}=require('../src/components/ExplorerDragDrop.tsx'),{SongbookHomeView}=require('../src/components/SongbookHomeView.tsx'),{MusicExplorerNav}=require('../src/components/MusicExplorerNav.tsx'),{Header}=require('../src/components/Header.tsx')
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let removed=[]
 const songs=h.library(2,0).songs.map((s,i)=>({...s,id:`song-${i}`,tags:['Rock']}))
 function Harness(){const [pending,setPending]=React.useState(null);return React.createElement(React.Fragment,null,
  React.createElement(ExplorerDragDrop,{songs,setlists:[],folders:[],onTag(){},onSetlist(){},onFolder(){},onTrash:setPending,onTouchDrag(){}}),
  React.createElement(MusicExplorerNav,{songs,setlists:[],folders:[],currentSelection:{type:'ALL_SONGS'},onSelect(){}}),
  React.createElement(Header,{activeView:'songs',searchQuery:'',onViewChange(){},onSearchQueryChange(){}}),
  React.createElement(SongbookHomeView,{songs,setlists:[],activeSongIndex:0,onSelectSong(){},onNewSong(){},onOpenSetlists(){},onDeleteSong(){throw Error('bulk expected')},onBulkDeleteSongs:ids=>{removed.push(ids)},onSongMembershipChange(){},onCreateSetlistForSong(){},trashDropIds:pending,onDismissTrashDrop:()=>setPending(null)}))}
 const find=id=>host.querySelector(`[data-testid="${id}"]`)
 const fire=(el,type)=>el.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}))
 try{
  await act(async()=>root.render(React.createElement(Harness)))
  await act(async()=>find('toggle-song-selection-mode').click())
  await act(async()=>find('song-card-0').click());await act(async()=>find('song-card-1').click())
  assert.deepEqual(JSON.parse(find('song-card-0').dataset.explorerDragSongs),['song-0','song-1'])
  const trash=host.querySelector('[data-explorer-drop-trash]')
  assert.ok(trash,'Header must render a drop-trash target')
  assert.equal(trash.dataset.explorerDropTrash,'true')
  assert.ok(trash.closest('header'),'Trash drop target must be in the header')
  assert.match(trash.getAttribute('aria-label')||'',/^Trash/)
  await act(async()=>{fire(find('song-card-0'),'dragstart');fire(trash,'drop')})
  assert.ok(find('bulk-delete-songs-confirm-dialog'));assert.deepEqual(removed,[])
  await act(async()=>find('cancel-bulk-delete-songs').click());assert.deepEqual(removed,[])
  await act(async()=>{fire(find('song-card-0'),'dragstart');fire(trash,'drop')})
  await act(async()=>find('confirm-bulk-delete-songs').click());assert.deepEqual(removed,[['song-0','song-1']])
  assert.equal(find('bulk-delete-songs-confirm-dialog'),null)
 }finally{await act(async()=>root.unmount());host.remove()}
})
test('mouse drag opens compact Explorer asynchronously, stays open during drag, and leaves wide sidebar unchanged',()=>fixture(async({host,source,fire,root,props})=>{
 const {ExplorerDragDrop}=require('../src/components/ExplorerDragDrop.tsx'),{ExplorerNavigation}=require('../src/components/ExplorerNavigation.tsx')
 const width=window.innerWidth;let opened=0,reject=false
 function Harness(){const [open,setOpen]=React.useState(false);return React.createElement(React.Fragment,null,
  React.createElement(ExplorerDragDrop,{...props,onTouchDrag(){opened++;setOpen(true)},onTag:(...args)=>reject?false:props.onTag(...args),onDropComplete:()=>setOpen(false)}),
  React.createElement(ExplorerNavigation,{songs:props.songs,setlists:props.setlists,folders:props.folders,currentSelection:{type:'ALL_SONGS'},onSelect(){},isOpen:open,onClose:()=>setOpen(false)}))}
 const drawer=()=>host.querySelector('[data-testid="music-explorer-drawer"]')
 try{
  window.innerWidth=600;await act(async()=>root.render(React.createElement(Harness)))
  fire(source,'dragstart');assert.equal(drawer(),null,'native dragstart must finish before opening')
  await act(async()=>h.settle(10));assert.ok(drawer());assert.equal(opened,1)
  await act(async()=>h.settle(10));assert.ok(drawer(),'stays open while dragging')
  reject=true;await act(async()=>fire(host.querySelector('[data-explorer-drop-tag]'),'drop'));assert.ok(drawer(),'failed drop keeps drawer open')
  await act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  assert.equal(drawer(),null)
  fire(source,'dragstart');fire(source,'dragend');await act(async()=>h.settle(10));assert.equal(drawer(),null,'cancel clears pending open')
  source.removeAttribute('data-explorer-drag-songs');source.dataset.explorerDragSetlist='set'
  fire(source,'dragstart');await act(async()=>h.settle(10));assert.ok(drawer(),'setlist mouse drag opens drawer too')
  await act(async()=>fire(host.querySelector('[data-explorer-drop-folder="folder"]'),'drop'));assert.equal(drawer(),null,'successful drop closes drawer')
  window.innerWidth=1024;fire(source,'dragstart');await act(async()=>h.settle(10));assert.equal(opened,2);assert.equal(drawer(),null)
 }finally{window.innerWidth=width}
}))
test('edge scrolling follows mouse and held touch, refreshes targets and stops outside the zone or on reset',()=>fixture(async({host,source,target,fire})=>{
 const raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame,hit=document.elementFromPoint
 const frames=new Map();let next=0
 window.requestAnimationFrame=cb=>{frames.set(++next,cb);return next};window.cancelAnimationFrame=id=>frames.delete(id)
 const tick=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(cb=>cb(0))}
 const scroller=document.createElement('div');scroller.style.overflowY='auto';host.append(scroller);scroller.append(target)
 Object.defineProperties(scroller,{scrollHeight:{value:1000},clientHeight:{value:200},scrollTop:{value:0,writable:true}})
 scroller.getBoundingClientRect=()=>({top:0,bottom:200,left:0,right:300,width:300,height:200})
 const lower=document.createElement('div');lower.dataset.explorerDropSetlist='set';scroller.append(lower)
 document.elementFromPoint=()=>scroller.scrollTop>0?lower:target
 const over=y=>{const e=new window.Event('dragover',{bubbles:true,cancelable:true});Object.defineProperties(e,{clientX:{value:50},clientY:{value:y}});target.dispatchEvent(e)}
 const touch=type=>{const e=new window.Event(type,{bubbles:true,cancelable:true}),point={identifier:1,clientX:50,clientY:195};Object.defineProperties(e,{touches:{value:type==='touchend'?[]:[point]},changedTouches:{value:[point]}});source.dispatchEvent(e)}
 try{
  over(195);tick();assert.equal(scroller.scrollTop,0,'no active drag')
  fire(source,'dragstart');over(195);tick();assert.ok(scroller.scrollTop>0&&scroller.scrollTop<=16)
  assert.equal(lower.dataset.explorerDropActive,'true','hit testing updates after content moves')
  over(100);const stopped=scroller.scrollTop;tick();assert.equal(scroller.scrollTop,stopped);assert.equal(frames.size,0)
  for(const end of ['dragend','drop','touchcancel','touchend','Escape']){
   fire(source,'dragstart');over(195);tick();const before=scroller.scrollTop
   if(end==='Escape')window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));else fire(document.body,end)
   tick();assert.equal(scroller.scrollTop,before,end);assert.equal(frames.size,0,end)
  }
  touch('touchstart');tick();assert.equal(frames.size,0,'normal scrolling before hold stays untouched')
  await h.settle(420);touch('touchmove');tick();const held=scroller.scrollTop;assert.ok(held>stopped)
  touch('touchcancel');tick();assert.equal(scroller.scrollTop,held);assert.equal(frames.size,0)
 }finally{window.requestAnimationFrame=raf;window.cancelAnimationFrame=caf;document.elementFromPoint=hit}
}))
test('setlist Trash drop requests confirmation once; invalid, aborted and external drops do nothing',()=>fixture(async({source,target,calls,fire,root,props})=>{
 await act(async()=>root.render(React.createElement(require('../src/components/ExplorerDragDrop.tsx').ExplorerDragDrop,{...props,onTrashSetlist:id=>calls.push(['request',id])})))
 source.removeAttribute('data-explorer-drag-songs');source.dataset.explorerDragSetlist='set'
 target.removeAttribute('data-explorer-drop-tag');target.dataset.explorerDropTrash='true'
 fire(target,'drop');assert.deepEqual(calls,[])
 fire(source,'dragstart');fire(target,'dragover');assert.equal(target.dataset.explorerDropActive,'true')
 fire(source,'dragend');fire(target,'drop');assert.deepEqual(calls,[])
 fire(source,'dragstart');fire(document.body,'drop');assert.deepEqual(calls,[])
 fire(source,'dragstart');fire(target,'drop');fire(target,'drop');assert.deepEqual(calls,[['request','set']])
 assert.equal(target.dataset.explorerDropActive,undefined)
}))
test('setlist confirmation focuses Cancel, traps keyboard, cancels with Escape and guards duplicate confirmation',async()=>{
 Object.assign(global,{HTMLElement:window.HTMLElement})
 const {SetlistTrashConfirmation}=require('../src/components/SetlistTrashConfirmation.tsx')
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 let mutations=0,cancellations=0
 const props={setlist:{id:'set',name:'Selected Set',songs:[]},onCancel:()=>cancellations++,onConfirm:()=>mutations++}
 try{
  await act(async()=>root.render(React.createElement(SetlistTrashConfirmation,props)))
  const cancel=host.querySelector('[data-testid="cancel-trash-setlist"]'),confirm=host.querySelector('[data-testid="confirm-trash-setlist"]')
  assert.equal(document.activeElement,cancel)
  window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',cancelable:true}));assert.equal(document.activeElement,confirm)
  window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',cancelable:true}));assert.equal(cancellations,1);assert.equal(mutations,0)
  cancel.click();assert.equal(cancellations,2);assert.equal(mutations,0)
  confirm.click();confirm.click();assert.equal(mutations,1)
 }finally{await act(async()=>root.unmount());host.remove()}
})
