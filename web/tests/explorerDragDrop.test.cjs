const {test}=require('node:test')
const assert=require('node:assert/strict')
const h=require('./helpers/tabHarness.cjs')
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
global.IS_REACT_ACT_ENVIRONMENT=true
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
 const {ExplorerDragDrop}=require('../src/components/ExplorerDragDrop.tsx'),{SongbookHomeView}=require('../src/components/SongbookHomeView.tsx'),{MusicExplorerNav}=require('../src/components/MusicExplorerNav.tsx')
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let removed=[]
 const songs=h.library(2,0).songs.map((s,i)=>({...s,id:`song-${i}`,tags:['Rock']}))
 function Harness(){const [pending,setPending]=React.useState(null);return React.createElement(React.Fragment,null,
  React.createElement(ExplorerDragDrop,{songs,setlists:[],folders:[],onTag(){},onSetlist(){},onFolder(){},onTrash:setPending,onTouchDrag(){}}),
  React.createElement(MusicExplorerNav,{songs,setlists:[],folders:[],currentSelection:{type:'ALL_SONGS'},onSelect(){}}),
  React.createElement('button',{'data-explorer-drop-trash':'true'},'Trash'),
  React.createElement(SongbookHomeView,{songs,setlists:[],activeSongIndex:0,onSelectSong(){},onNewSong(){},onOpenSetlists(){},onDeleteSong(){throw Error('bulk expected')},onBulkDeleteSongs:ids=>{removed.push(ids)},onSongMembershipChange(){},onCreateSetlistForSong(){},trashDropIds:pending,onDismissTrashDrop:()=>setPending(null)}))}
 const find=id=>host.querySelector(`[data-testid="${id}"]`)
 const fire=(el,type)=>el.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}))
 try{
  await act(async()=>root.render(React.createElement(Harness)))
  await act(async()=>find('toggle-song-selection-mode').click())
  await act(async()=>find('song-card-0').click());await act(async()=>find('song-card-1').click())
  assert.deepEqual(JSON.parse(find('song-card-0').dataset.explorerDragSongs),['song-0','song-1'])
  const trash=host.querySelector('[data-explorer-drop-trash]')
  await act(async()=>{fire(find('song-card-0'),'dragstart');fire(trash,'drop')})
  assert.ok(find('bulk-delete-songs-confirm-dialog'));assert.deepEqual(removed,[])
  await act(async()=>find('cancel-bulk-delete-songs').click());assert.deepEqual(removed,[])
  await act(async()=>{fire(find('song-card-0'),'dragstart');fire(trash,'drop')})
  await act(async()=>find('confirm-bulk-delete-songs').click());assert.deepEqual(removed,[['song-0','song-1']])
  assert.equal(find('bulk-delete-songs-confirm-dialog'),null)
 }finally{await act(async()=>root.unmount());host.remove()}
})
