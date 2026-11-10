// #418 (partial): About GTAR panel with authoritative version/build metadata, licensing, offline information.
const { test, after } = require('node:test')
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
const globalKeys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT', 'navigator']
const originalGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]))
after(() => {
  dom.window.close()
  for (const [key, descriptor] of originalGlobals) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key] }
})
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { AboutModal } = require('../src/components/AboutModal.tsx')
const { GTAR_APP_VERSION, GTAR_DEV_VERSION } = require('../src/types/gtar.ts')

test('AboutModal renders application identity, dynamic version metadata, and local-first architecture notice', async () => {
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  let closed = false
  await act(async () => {
    root.render(React.createElement(AboutModal, {
      isOpen: true,
      onClose: () => { closed = true },
    }))
  })

  try {
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog, 'dialog rendered')
    assert.equal(dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby'), 'about-modal-title')

    // App identity
    assert.match(dialog.textContent, /GTAR Live Stage Companion/)
    assert.match(dialog.textContent, /Offline-First Stage Teleprompter/)

    // Environment row
    const envEl = document.querySelector('[data-testid="about-environment-string"]')
    assert.ok(envEl, 'environment element present')
    assert.equal(envEl.textContent.trim(), 'Development')

    // Authoritative version string (not hardcoded or invented)
    const versionEl = document.querySelector('[data-testid="about-version-string"]')
    assert.ok(versionEl, 'version element present')
    assert.match(versionEl.textContent.trim(), new RegExp(`(?:${GTAR_DEV_VERSION}|${GTAR_APP_VERSION})`))

    // Storage architecture
    assert.match(dialog.textContent, /Local-First Storage/)
    assert.match(dialog.textContent, /GTAR runs 100% offline/)
    assert.match(dialog.textContent, /No mandatory login/)

    // Licensing and GitHub link
    assert.equal(dialog.textContent.includes('MIT License'), false, 'About panel must not claim unverified MIT License')
    const ghLink = dialog.querySelector('a[href*="github.com/ozzzmond/GTAR"]')
    assert.ok(ghLink, 'GitHub repo link present')

    // Close button
    const closeBtn = document.querySelector('[data-testid="about-modal-close"]')
    assert.ok(closeBtn, 'Close button present')
    await act(async () => {
      closeBtn.click()
    })
    assert.equal(closed, true, 'onClose called when clicking close button')
  } finally {
    await act(async () => root.unmount())
  }
})

test('AboutModal dismisses on Escape key and backdrop click', async () => {
  const container = document.getElementById('root')
  container.innerHTML = ''
  let closeCount = 0
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(AboutModal, {
      isOpen: true,
      onClose: () => { closeCount++ },
    }))
  })

  try {
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(closeCount, 1, 'Escape dismisses modal')

    const backdrop = document.querySelector('[data-testid="about-modal-backdrop"]')
    assert.ok(backdrop, 'backdrop present')
    await act(async () => {
      backdrop.click()
    })
    assert.equal(closeCount, 2, 'Backdrop click dismisses modal')
  } finally {
    await act(async () => root.unmount())
  }
})
