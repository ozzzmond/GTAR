const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client')

test('recovery download keeps healthy B2 and legacy sources when another partition is corrupt', async () => {
  const storage = h.freshStorage(), factory = new h.Factory(), tab = h.newTab()
  tab.sj.persistLibrary(h.library(2, 0), storage)
  const legacy = storage.getItem('gtar_library_v1')
  tab.sj.enableLibraryB2(storage)
  await tab.sj.prepareLibraryB2(storage, { factory })
  // A retained database with missing owner metadata is unreadable, but must not stop other exports.
  const bad = await tab.b2.openB2Database(factory, 'corrupt-copy'); bad.close()
  storage.setItem(tab.b2.b2HeadKey('corrupt-copy'), 'b2|corrupt-copy|0|fixture')
  storage.setItem('gtar_library_b2_last_used::corrupt-copy', '9999999999999')
  const archive = JSON.stringify({ local: h.library(1, 0) })
  storage.setItem('gtar_sync_recovery:review:1', archive)
  const prior = { indexedDB: global.indexedDB, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(global, { indexedDB: factory, IS_REACT_ACT_ENVIRONMENT: true })
  h.dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL, click = h.dom.window.HTMLAnchorElement.prototype.click
  let blob, download
  URL.createObjectURL = value => { blob = value; return 'blob:recovery' }
  URL.revokeObjectURL = () => {}
  h.dom.window.HTMLAnchorElement.prototype.click = function () { download = this.download }
  const el = document.createElement('div'); document.body.append(el)
  const root = createRoot(el)
  try {
    const { RecoveryDataPanel } = require('../src/components/RecoveryDataPanel.tsx')
    await act(async () => root.render(React.createElement(RecoveryDataPanel, { blocked: () => false, onClose() {} })))
    await act(async () => {
      document.querySelector('[data-testid="recovery-data-save"]').click()
      // IndexedDB export spans several queued transactions.
      for (let i = 0; !blob && i < 100; i++) await h.settle(5)
    })
    assert.equal(download, 'GTAR-storage-recovery.json')
    const data = JSON.parse(await blob.text())
    assert.equal(data.gtar_library_v1, legacy)
    assert.equal(data['gtar_sync_recovery:review:1'], archive)
    assert.equal(JSON.parse(data['gtar_library_b2::device']).songs.length, 2)
    const error = JSON.parse(data['gtar_library_b2_error::corrupt-copy'])
    assert.equal(error.scope, 'corrupt-copy')
    assert.match(error.message, /owner/i)
    assert.equal(storage.getItem('gtar_library_v1'), legacy)
    assert.ok(storage.getItem(tab.b2.b2HeadKey('corrupt-copy')), 'corrupt copy preserved')
  } finally {
    await act(async () => root.unmount()); el.remove()
    URL.createObjectURL = create; URL.revokeObjectURL = revoke; h.dom.window.HTMLAnchorElement.prototype.click = click
    Object.assign(global, prior)
  }
})
