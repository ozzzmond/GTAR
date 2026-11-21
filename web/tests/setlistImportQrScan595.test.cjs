const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' })
  const compiled = new Module(path.join(__dirname, 'setlist-qr-memory.cjs'), module)
  compiled.filename = path.join(__dirname, 'setlist-qr-memory.cjs'); compiled.paths = module.paths
  compiled._compile(output.outputFiles[0].text, compiled.filename)
  return compiled.exports
}
const origin = 'https://gtar.test', token = 'a1b2c3d4e5f60718', shareUrl = `${origin}?share=${token}`
function pixels(value) {
  const qr = QRCode.create(value), scale = 4, margin = 4
  const width = (qr.modules.size + margin * 2) * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin
    if (row >= 0 && col >= 0 && row < qr.modules.size && col < qr.modules.size && qr.modules.get(row, col)) {
      const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0
    }
  }
  return { data, width, height: width }
}

test('import modal wires the QR scanner through the existing share-link pipeline', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')
  assert.match(src, /<QrScanner\b/)
  assert.match(src, /extractShareToken\(text\)/)
  assert.match(src, /handleResolvePastedShareLink\(text\)/)
  assert.match(src, /Paste GTAR Share Link/)
  assert.match(src, /Legacy JSON file import/)
})

test('Scan QR Code: valid, invalid, permission-denied, cancel and unmount paths', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: origin })
  const keys = ['window', 'document', 'navigator', 'Image', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL
  URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {}
  let data = pixels(shareUrl), image, stopped = 0
  Object.defineProperty(globalThis, 'Image', { configurable: true, writable: true, value: class {
    naturalWidth = 400; naturalHeight = 400; constructor() { image = this } set src(value) { this.url = value }
  } })
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData() { return data } })
  dom.window.HTMLMediaElement.prototype.play = async () => {}
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoWidth', { get: () => 400 })
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoHeight', { get: () => 400 })
  const root = createRoot(document.getElementById('root'))
  try {
    const { QrScanner, extractShareToken } = await load(`
      export { QrScanner } from './src/components/QrScanner';
      export { extractShareToken } from './src/utils/sharedSetlist';`)
    const accepted = []
    const onText = text => {
      const extracted = extractShareToken(text)
      if (!extracted.isValid) throw new Error('This QR is not a GTAR setlist share code.')
      accepted.push(extracted.token)
      return 'QR scanned.'
    }
    const render = () => act(async () => root.render(React.createElement(QrScanner, { onText })))
    const click = text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click())
    await render()
    assert.ok([...document.querySelectorAll('button')].some(b => b.textContent === 'Scan QR Code'))
    assert.equal(document.querySelector('video'), null, 'camera does not start before user action')

    await click('Scan QR Code')
    assert.match(document.body.textContent, /Camera unavailable/)
    const nativeException = globalThis.DOMException
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new dom.window.DOMException('denied', 'NotAllowedError') } } })
    globalThis.DOMException = dom.window.DOMException
    await click('Scan QR Code'); globalThis.DOMException = nativeException
    assert.match(document.body.textContent, /permission denied/)

    let resolve
    navigator.mediaDevices.getUserMedia = () => new Promise(r => { resolve = r })
    await click('Scan QR Code'); await click('Cancel scan')
    await act(async () => resolve({ getTracks: () => [{ stop() { stopped++ } }] }))
    assert.equal(stopped, 1); assert.match(document.body.textContent, /cancelled/)
    assert.deepEqual(accepted, [])

    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() { stopped++ } }] })
    await click('Scan QR Code')
    assert.deepEqual(accepted, [token]); assert.equal(stopped, 2); assert.equal(document.querySelector('video'), null)

    data = pixels('https://evil.test/?share=' + token)
    await click('Scan QR Code')
    assert.deepEqual(accepted, [token]); assert.match(document.body.textContent, /not a GTAR setlist share code/); assert.equal(stopped, 3)
    data = pixels('hello world')
    await click('Scan QR Code')
    assert.deepEqual(accepted, [token]); assert.match(document.body.textContent, /not a GTAR setlist share code/)

    data = pixels(shareUrl)
    const file = document.querySelector('input[type=file]')
    const props = () => file[Object.keys(file).find(k => k.startsWith('__reactProps'))]
    const choose = () => act(async () => props().onChange({ target: { files: [{ type: 'image/png', size: 100 }], value: '' } }))
    await choose(); await act(async () => image.onload()); assert.deepEqual(accepted, [token, token])
    data = { data: new Uint8ClampedArray(400 * 400 * 4).fill(255), width: 400, height: 400 }
    await choose(); await act(async () => image.onload()); assert.match(document.body.textContent, /No readable QR/)
    await act(async () => props().onChange({ target: { files: [{ type: 'text/plain', size: 10 }], value: '' } }))
    assert.match(document.body.textContent, /Choose an image/)

    data = pixels(shareUrl)
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {})
    const before = stopped
    await click('Scan QR Code'); await act(async () => root.render(React.createElement('div')))
    assert.equal(stopped, before)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl
    for (const key of keys) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key] }
  }
})
