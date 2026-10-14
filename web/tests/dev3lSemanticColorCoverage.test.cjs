const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { compile } = require('@tailwindcss/node')
const { JSDOM } = require('jsdom')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const theme = require('../src/components/ThemeModal.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { CustomPaletteEditor } = require('../src/components/CustomPaletteEditor.tsx')
const { FretboardDiagramModal } = require('../src/components/FretboardDiagramModal.tsx')
const paletteJson = require('../src/utils/customPaletteJson.ts')
const { stageCast } = require('../src/utils/stageCast.ts')
const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8')
const sources = fs.readdirSync(path.join(__dirname, '../src/components')).filter(f => f.endsWith('.tsx')).map(f => path.join(__dirname, '../src/components', f)).concat(path.join(__dirname, '../src/App.tsx'))
const legacy = /#(?:002B36|073642|2AA198|1A4A55|094352|EEE8D5|FDF6E3|93A1A1|B58900)\b/i
const noop = () => {}
const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')
const rgb = hex => `rgb(${[1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(', ')})`

test('Runtime guard inspects JSX/inline styling, allowing canonical definitions, status and brand artwork', () => {
  for (const filename of sources) {
    const text = fs.readFileSync(filename, 'utf8')
    assert.ok(!/(?:bg|text|border|ring|fill|stroke|placeholder|shadow)-\[#(?:002B36|073642|2AA198|1A4A55|094352|EEE8D5|FDF6E3|93A1A1|B58900)\]/i.test(text), filename)
    const ast = ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
    const walk = node => {
      if (ts.isJsxAttribute(node) && ['style','fill','stroke'].includes(node.name.getText(ast))) assert.ok(!legacy.test(node.getText(ast).replace(/var\([^)]*\)/g, '')), `${filename}: ${node.getText(ast)}`)
      ts.forEachChild(node,walk)
    }
    walk(ast)
  }
  // Fallbacks inside var() are legitimate defaults; raw legacy declarations are not.
  const withoutFallbacks = css.replace(/var\([^;]+?\)/g, '')
  assert.ok(!legacy.test(withoutFallbacks))
  for (const preset of theme.THEME_OPTIONS) assert.ok(!css.includes(`body.theme-${preset.id}`))
  assert.ok(!css.includes('[class*="bg-[#'))
  assert.ok(!css.includes('[style*="color:'))
})

test('Compiled utilities preserve hover/focus/selection variants and consume existing semantic roles', async () => {
  const compiler = await compile(css, { base: path.join(__dirname,'..'), onDependency() {} })
  const compiled = compiler.build(['bg-app-base','bg-app-surface','bg-app-button','text-app-button-text','text-app-action','border-app-border','hover:bg-app-action/20','focus:border-app-accent','selection:bg-app-action/30','disabled:text-app-muted','fill-app-action','ring-app-selected-border'])
  for (const variable of ['stage-bg','stage-surface','control-button-bg','control-button-text','actionColor','card-border','control-accent','uiMutedText','card-selected-border']) assert.ok(compiled.includes(`var(--custom-${variable})`), variable)
  assert.ok(compiled.includes('.hover\\:bg-app-action\\/20:hover'))
  assert.ok(compiled.includes('.focus\\:border-app-accent:focus'))
  assert.ok(compiled.includes('.disabled\\:text-app-muted:disabled'))
  assert.ok(compiled.includes('.selection\\:bg-app-action\\/30::selection'))
  assert.ok(css.includes('outline: 2px solid var(--custom-control-accent)'))
})

for (const [name, colors] of [
  ['dark/high contrast', theme.presetToCustomPalette(theme.THEME_OPTIONS[2])],
  ['light', theme.presetToCustomPalette(theme.THEME_OPTIONS[3])],
  ['strong custom', theme.normalizeCustomThemeColors({ ...theme.DEFAULT_CUSTOM_COLORS, bgHex:'#F7E3FF', headerBg:'#43005E', uiPrimaryText:'#240033', uiSectionText:'#570057', uiMutedText:'#71446A', buttonBg:'#72005D', buttonText:'#FFFFFF', inputBg:'#FFF1FF', inputText:'#320029', inputBorder:'#9B287D', songCardBg:'#FDC8E9', setlistCardBg:'#F5C7FF', selectedCardBg:'#ECCFFF', selectedCardBorder:'#8F00AD', actionColor:'#BA0078', selectionColor:'#DC91EE', cardBorder:'#92356F', chordHex:'#9A004C' })],
]) test(`Rendered modal/card/input/button/icon surfaces resolve ${name} palette through production rules`, async () => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', {url:'https://gtar.test'})
  Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage})
  try {
    theme.applyThemeRuntime('custom',colors)
    document.getElementById('root').innerHTML = renderToStaticMarkup(React.createElement(React.Fragment,null,
      React.createElement(theme.ThemeModal,{isOpen:true,currentTheme:'custom',customColors:colors,onClose:noop}),
      React.createElement(CustomPaletteEditor,{isOpen:true,customColors:colors,onClose:noop,onSaveAndApply:noop}),
      React.createElement(SongbookHomeView,{songs:[{id:'a',title:'Song A',artist:'Artist',rawContent:'[C]Hello',key:'C'}],activeSongIndex:0,setlists:[{id:'gig',name:'Sunday',songs:[{id:'a',title:'Song A'}]}],onSelectSong:noop,onNewSong:noop,onOpenSetlists:noop,onDeleteSong:noop,onSongMembershipChange:noop,onCreateSetlistForSong:noop}),
      React.createElement(FretboardDiagramModal,{voicing:{chord:'C',frets:[-1,3,2,0,1,0],fingers:[0,3,2,0,1,0],baseFret:1},onClose:noop})
    ))
    const candidates = [...new Set([...document.querySelectorAll('[class]')].flatMap(el=>[...el.classList]))]
    const compiler = await compile(css,{base:path.join(__dirname,'..'),onDependency(){}})
    const compiled = compiler.build(candidates)
    // jsdom has no variable/cascade-layer engine. Use production rules with emitted
    // variables substituted; extract flat rules, retaining explicit specificity.
    let rules = [...compiled.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(m=> !m[1].includes('@') && !m[1].includes(':root') && !m[1].includes('%')).map(m=>`${m[1].trim()}{${m[2]}}`).join('\n')
    for(let i=0;i<8;i++) rules=rules.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g,(_,key,fallback)=>document.documentElement.style.getPropertyValue(key)||fallback||'Arial')
    const sheet=document.createElement('style');sheet.textContent=rules;document.head.appendChild(sheet)
    const style=selector=>{const el=document.querySelector(selector);assert.ok(el,selector);return window.getComputedStyle(el)}
    assert.equal(style('[data-testid="theme-selector"] h2').color,rgb(colors.uiSectionText))
    assert.equal(style('.ui-setlist-card').backgroundColor,rgb(colors.setlistCardBg))
    assert.equal(style('.ui-song-card').backgroundColor,rgb(colors.selectedCardBg))
    assert.equal(style('.ui-song-card').borderColor,rgb(colors.selectedCardBorder))
    assert.equal(style('[data-testid="theme-save-apply-btn"]').backgroundColor,rgb(colors.buttonBg))
    assert.equal(style('[data-testid="theme-save-apply-btn"]').color,rgb(colors.buttonText))
    assert.equal(style('input[type="text"]').backgroundColor,rgb(colors.inputBg))
    assert.equal(style('.ui-section-icon').color,rgb(colors.sectionIconColor))
    for(const el of document.querySelectorAll('svg [fill],svg [stroke]')) for(const attr of ['fill','stroke']) if(el.hasAttribute(attr)) assert.ok(!legacy.test(el.getAttribute(attr)))
    assert.ok(document.querySelector('svg [fill="var(--custom-stage-chord)"]'))
    const payload=paletteJson.exportCustomPaletteJson(colors)
    assert.equal(payload.version,2)
    assert.deepEqual(paletteJson.importCustomPaletteJson(payload).colors,theme.normalizeCustomThemeColors(colors))
    assert.equal(paletteJson.CANONICAL_CUSTOM_PALETTE_FIELDS.length,38)
  } finally {dom.window.close();delete global.window;delete global.document;delete global.localStorage}
})

test('Auth startup and cast updates retain one semantic runtime including full factory/custom palette snapshot', () => {
  const main=source('main.tsx'),app=source('App.tsx'),receiver=source('components/StagePresentationView.tsx')
  assert.ok(main.indexOf('applyThemeRuntime(initialTheme.mode') < main.indexOf('_win.__GTAR_REACT_ROOT__.render'))
  assert.ok(app.includes('stageCast.setThemeSnapshot(stageTheme, appliedPalette)'))
  assert.ok(!receiver.includes('applyCustomThemeStyles'))
  assert.ok(receiver.includes("applyThemeRuntime('custom', payload.customThemeColors)"))
  const colors=theme.presetToCustomPalette(theme.THEME_OPTIONS[3])
  const state={song:{title:'C',rawContent:'[C]Hello'},effectiveKey:'C',transposeOffset:0,fontSizePx:22,fontStyle:'mono',isTwoColumn:false}
  stageCast.setThemeSnapshot('paper-light', colors)
  stageCast.broadcastState(state)
  stageCast.broadcastState({...state,fontSizePx:28})
  assert.deepEqual(stageCast.getCachedState().customThemeColors,colors)
  assert.equal(stageCast.getCachedState().themeMode,'paper-light')
})


test('Reserved status text preserves meaning and contrast without new configurable palette fields', () => {
  const luminance = hex => {
    const c = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    return c[0]*.2126+c[1]*.7152+c[2]*.0722
  }
  const pairs = [...css.matchAll(/--color-status-(\w+): light-dark\((#[A-F0-9]+), (#[A-F0-9]+)\)/g)]
  assert.equal(pairs.length,4)
  for(const [,role,light,dark] of pairs) for(const [fg,bg] of [[light,'#F7E3FF'],[dark,'#000000']]) {
    const l1=luminance(fg),l2=luminance(bg)
    assert.ok((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)>=4.5,role)
  }
  const sync=source('components/BandSyncModal.tsx')
  assert.ok(sync.includes("? 'bg-amber-400 animate-ping'"))
  assert.ok(sync.includes('text-status-warning'))
  assert.ok(!paletteJson.CANONICAL_CUSTOM_PALETTE_FIELDS.some(field=>field.startsWith('status')))
})
