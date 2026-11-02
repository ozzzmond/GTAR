// PR-C / D4: catalog UI requires explicit sign-in; device-library controls remain available.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
global.CustomEvent = dom.window.CustomEvent
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { AuthContext } = require('../src/utils/authContext.ts')
const { SharedCatalogBrowser } = require('../src/components/SharedCatalogBrowser.tsx')
const { sharedCatalogService } = require('../src/utils/sharedCatalogService.ts')
test('catalog sign-in boundary prevents requests, loads after sign-in, clears on sign-out and blocks pending', async () => {
 let calls=0, signIns=0
 sharedCatalogService.getCatalogSongs=async()=>{calls++;return {songs:[{id:'song',title:'Visible shared song',artist:'Artist',publisher_user_id:'A',revision:1}],state:'ONLINE',total:1}}
 const requests=[];global.fetch=async url=>{requests.push(url);throw new Error('Unexpected catalog request')}
 const root=createRoot(document.getElementById('root'))
 const render=async(session,status='pending',role='NONE')=>act(async()=>{root.render(React.createElement(AuthContext.Provider,{value:{session,accessStatus:status,role,signIn:async()=>{signIns++}}},React.createElement(SharedCatalogBrowser,{onImportSong(){}})))})
 await render(null)
 assert.match(document.body.textContent,/Sign in to use the Shared Catalog/)
 assert.equal(calls,0)
 await act(async()=>document.querySelector('button').click());assert.equal(signIns,1)
 const session={user:{id:'A'},token:'test'}
 await render(session,'active','USER');assert.equal(calls,1);assert.match(document.body.textContent,/Visible shared song/)
 await render(null);assert.doesNotMatch(document.body.textContent,/Visible shared song/);assert.equal(calls,1)
 await render(null,'pending','USER');assert.equal(calls,1);assert.match(document.body.textContent,/Access Approval Pending/);assert.equal(document.querySelector('[data-testid="catalog-sign-in-card"]'),null)
 await render(null,'denied','USER');assert.equal(calls,1);assert.match(document.body.textContent,/Access Denied/);assert.equal(document.querySelector('[data-testid="catalog-sign-in-card"]'),null);assert.deepEqual(requests,[])
 await act(async()=>root.unmount())
})
const { ReportContentButton } = require('../src/components/ReportContentButton.tsx')
test('signed-out report is hidden without a hint',async()=>{
 const root=createRoot(document.getElementById('root'))
 await act(async()=>root.render(React.createElement(ReportContentButton,{kind:'song',id:'song',revision:1,label:'Song'})))
 assert.equal(document.body.textContent,'')
 assert.equal(document.querySelector('[data-testid="report-song-btn"]'),null)
 await act(async()=>root.unmount())
})
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
test('local setlists remain available but signed-out QR is hidden and link import is disabled',async()=>{
 const root=createRoot(document.getElementById('root'))
 await act(async()=>root.render(React.createElement(SongbookHomeView,{songs:[],setlists:[{id:'s',name:'Local setlist',songs:[]}],view:{type:'ALL_SETLISTS'},onShareSetlist(){},onOpenSetlists(){}})))
 // #319: setlist actions live in the setlist workspace ⋯ menu.
 assert.match(document.body.textContent,/Local setlist/)
 await act(async()=>document.querySelector('[data-testid="workspace-scope-menu-btn"]').click())
 assert.equal(document.querySelector('[data-testid="workspace-menu-share"]'),null,'signed-out QR is hidden')
 await act(async()=>document.querySelector('[data-testid="workspace-menu-import"]').click())
 assert.ok(document.querySelector('[data-testid="load-share-link-btn"]').disabled)
 assert.ok(document.querySelector('[data-testid="paste-share-link-input"]').disabled)
 assert.match(document.body.textContent,/Sign in to use the Shared Catalog/)
 assert.equal(document.querySelector('[data-testid="choose-setlist-json-file"]').disabled,false,'local JSON import available')
 await act(async()=>root.unmount())
})
test('local song actions stay available while publishing is hidden signed out',async()=>{
 const root=createRoot(document.getElementById('root'))
 await act(async()=>root.render(React.createElement(SongbookHomeView,{songs:[{id:'local',title:'Local song',artist:'Artist',rawContent:'[C]Local chart',transpose:0}],setlists:[],onOpenSetlists(){}})))
 await act(async()=>document.querySelector('[data-testid="song-menu-0"]').click())
 const publish=document.querySelector('[data-testid="menu-publish-song-0"]')
 assert.equal(publish,null)
 assert.equal(document.querySelector('[data-testid="menu-add-to-setlist-0"]').disabled,false)
 assert.match(document.body.textContent,/Local song/)
 assert.doesNotMatch(document.body.textContent,/Sign in to use the Shared Catalog/)
 await act(async()=>document.querySelector('[data-testid="toggle-song-selection-mode"]').click())
 assert.equal(document.querySelector('[data-testid="bulk-publish-to-shared"]'),null)
 await act(async()=>root.unmount())
})

const { renderToString } = require('react-dom/server')
for (const status of ['pending','denied']) test(`${status} masked session hides local catalog actions without extra hints`,()=>{
 const value={session:null,accessStatus:status,role:'USER'}
 const setlists=[{id:'s',name:'Local setlist',songs:[]}]
 for (const [Component,props] of [[SongbookHomeView,{view:{type:'ALL_SETLISTS'}}]]) {
  const html=renderToString(React.createElement(AuthContext.Provider,{value},React.createElement(Component,{...props,songs:[],setlists,onShareSetlist(){},onPublishSetlist(){},onClose(){}})))
  assert.doesNotMatch(html,/main-share-setlist-btn|Share Setlist \(QR Code\)|Publish .* to Shared|Sign in to use the Shared Catalog/)
  assert.match(html,/Local setlist/)
 }
})
