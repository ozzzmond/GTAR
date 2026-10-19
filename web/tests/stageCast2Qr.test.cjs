const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const QRCode = require('qrcode')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

async function load(entry) {
  const output = await build({ stdin: { contents: entry, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    define: { 'import.meta.env.DEV': 'true', 'import.meta.env.VITE_CAST2_LOCAL_REVIEW': '"true"' } })
  const compiled = new Module(path.join(__dirname, 'tv-qr-memory.cjs'), module)
  compiled.filename = path.join(__dirname, 'tv-qr-memory.cjs'); compiled.paths = module.paths
  compiled._compile(output.outputFiles[0].text, compiled.filename)
  return compiled.exports
}
const origin = 'https://gtar.test', ref = 'a'.repeat(64), safe = origin + '/#cast2=' + ref
function pixels(value) {
  const qr = QRCode.create(value), scale = 4, margin = 4
  const width = (qr.modules.size + margin * 2) * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin
    if (row >= 0 && col >= 0 && row < qr.modules.size && col < qr.modules.size && qr.modules.get(row, col)) {
      const i = (y * width + x) * 4; data[i] = data[i+1] = data[i+2] = 0
    }
  }
  return { data, width, height: width }
}

test('QR payload accepts only same-site TV reference; secrets, extra keys and foreign URLs rejected', async () => {
  const { parseTvQr } = await load("export { parseTvQr } from './src/utils/stageCast2Qr'")
  assert.equal(parseTvQr(safe, origin), ref)
  for (const bad of ['garbage', ref, safe + '&pin=123456', safe + '&credential=secret', safe + '&cast2=' + ref,
    safe.replace('gtar.test', 'evil.test'), safe.replace('/#', '/elsewhere#'), safe.replace('/#', '/?token=secret#'),
    safe.replace('https://', 'https://user:pass@'), origin + '/#cast2=bad']) assert.equal(parseTvQr(bad, origin), null)
})

test('camera/photo decoder, cancellation, permission denial and manual fallback; TV options update existing preference', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: origin })
  const keys = ['window', 'document', 'navigator', 'Image', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL
  URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}
  let data = pixels(safe), image, stopped = 0
  Object.defineProperty(globalThis, 'Image', { configurable: true, writable: true, value: class {
    naturalWidth = 400; naturalHeight = 400; constructor() { image = this } set src(value) { this.url = value }
  } })
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData() { return data } })
  dom.window.HTMLMediaElement.prototype.play = async () => {}
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoWidth', { get: () => 400 })
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoHeight', { get: () => 400 })
  const root = createRoot(document.getElementById('root'))
  try {
    const { TvQrScanner, TvPresentationOptions, stageCast2Controller } = await load(`
      export { TvQrScanner } from './src/components/TvQrScanner';
      export { TvPresentationOptions } from './src/components/TvPresentationOptions';
      export { stageCast2Controller } from './src/utils/stageCast2Controller';`)
    const found = []
    const render = () => act(async () => root.render(React.createElement(TvQrScanner, { onReference: value => found.push(value) })))
    const click = text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click())
    await render(); await click('Scan TV QR')
    assert.match(document.body.textContent, /Camera unavailable.*manually/)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new dom.window.DOMException('denied', 'NotAllowedError') } } })
    // Browser DOMException identity must match the browser realm.
    const nativeException = globalThis.DOMException
    globalThis.DOMException = dom.window.DOMException
    await click('Scan TV QR'); globalThis.DOMException = nativeException
    assert.match(document.body.textContent, /permission denied/)
    let resolve
    navigator.mediaDevices.getUserMedia = () => new Promise(r => { resolve = r })
    await click('Scan TV QR'); await click('Cancel scan')
    await act(async () => resolve({ getTracks: () => [{ stop() { stopped++ } }] }))
    assert.equal(stopped, 1); assert.match(document.body.textContent, /cancelled/)
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() { stopped++ } }] })
    await click('Scan TV QR')
    assert.deepEqual(found, [ref]); assert.equal(stopped, 2); assert.equal(document.querySelector('video'), null)
    const file = document.querySelector('input[type=file]')
    const props = () => file[Object.keys(file).find(k => k.startsWith('__reactProps'))]
    await act(async () => props().onChange({ target: { files: [], value: '' } }))
    assert.deepEqual(found, [ref])
    await act(async () => props().onChange({ target: { files: [{ type: 'text/plain', size: 10 }], value: '' } }))
    assert.match(document.body.textContent, /Choose an image/)
    const choose = () => act(async () => props().onChange({ target: { files: [{ type: 'image/png', size: 100 }], value: '' } }))
    await choose(); await act(async () => image.onload()); assert.deepEqual(found, [ref, ref])
    data = pixels('https://evil.test/#cast2=' + ref)
    await choose(); await act(async () => image.onload()); assert.match(document.body.textContent, /not a TV QR/)
    data = { data: new Uint8ClampedArray(400 * 400 * 4).fill(255), width: 400, height: 400 }
    await choose(); await act(async () => image.onload()); assert.match(document.body.textContent, /No readable QR/)
    await choose(); await act(async () => image.onerror()); assert.match(document.body.textContent, /could not be read/)
    await act(async () => root.render(React.createElement(TvPresentationOptions)))
    assert.match(document.body.textContent, /TV Presentation \/ TV Sync/)
    await click('Show chords'); assert.equal(stageCast2Controller.getChords(), true)
    assert.equal([...document.querySelectorAll('button')].find(b => b.textContent === 'Show chords').getAttribute('aria-pressed'), 'true')
    stageCast2Controller.resetForTesting()
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl
    for (const key of keys) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key] }
  }
})
