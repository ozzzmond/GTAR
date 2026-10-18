const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// Opt-in real-browser coverage; use an existing external Playwright installation.
// GTAR_PLAYWRIGHT_MODULE=<absolute module path> node --test tests/issue107ToolbarBrowser.test.cjs
// No browser downloads or dependency changes are needed in the application.
test('ISSUE107_BROWSER: responsive toolbar geometry, input, tooltips and shared view transitions', {
  skip: !process.env.GTAR_PLAYWRIGHT_MODULE,
  timeout: 180000,
}, async () => {
  const { chromium } = require(process.env.GTAR_PLAYWRIGHT_MODULE)
  const { createServer } = await import('vite')
  const server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0 } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    await page.addInitScript(() => {
      localStorage.setItem('gtar_setlists_store', '[]')
      localStorage.setItem('gtar_songs_store', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({
        id: `qa-${i}`, title: `Toolbar QA ${i}`, artist: 'QA', key: 'C', capo: '0', bpm: '90',
        rawContent: Array(80).fill('[C]Toolbar regression [G]lyrics').join('\n'), format: 'CHORD_PRO', transposeOffset: 0,
      }))))
    })
    await page.goto(server.resolvedUrls.local[0])
    await page.getByRole('button', { name: 'Continue offline (local development)' }).click()
    const reproduction = await page.evaluate(() => {
      const scroller = document.createElement('div')
      scroller.style.cssText = 'position:fixed;left:0;top:0;width:300px;overflow-x:auto;padding:4px 0;box-sizing:content-box'
      scroller.innerHTML = '<button style="position:relative;display:block;width:36px;height:36px;padding:0;border:0"><span style="position:absolute;bottom:-30px;left:0;height:22px;opacity:0;white-space:nowrap;font-size:10px;line-height:1">Hidden tooltip</span></button>'
      document.body.append(scroller)
      scroller.scrollTop = 100
      const before = [scroller.clientHeight, scroller.scrollHeight, scroller.scrollTop]
      scroller.querySelector('span').remove()
      scroller.scrollTop = 100
      const after = [scroller.clientHeight, scroller.scrollHeight, scroller.scrollTop]
      scroller.remove()
      return { before, after }
    })
    assert.deepEqual(reproduction, { before: [44, 70, 26], after: [44, 44, 0] })
    const scroller = page.getByTestId('main-toolbar-scroll')
    const buttons = scroller.locator('button')
    const tooltip = page.getByRole('tooltip')
    const cdp = await context.newCDPSession(page)
    const checkGeometry = async () => {
      const metrics = await scroller.evaluate(el => {
        el.scrollTop = 100
        el.scrollBy(0, 100)
        const bounds = el.getBoundingClientRect()
        return { height: el.clientHeight, scrollHeight: el.scrollHeight, top: el.scrollTop,
          iconsInside: [...el.querySelectorAll('svg')].every(icon => {
            const r = icon.getBoundingClientRect(); return r.top >= bounds.top && r.bottom <= bounds.bottom
          }) }
      })
      assert.equal(metrics.scrollHeight, metrics.height, JSON.stringify(metrics))
      assert.equal(metrics.top, 0)
      assert.equal(metrics.iconsInside, true)
      return metrics
    }
    const dimensions = [[320, 740], [360, 800], [390, 844], [640, 960], [768, 1024], [1024, 1366], [1440, 900]]
    for (const [w, h] of dimensions.flatMap(([w, h]) => [[w, h], [h, w]])) {
      await page.mouse.move(0, 0)
      await buttons.evaluateAll(elements => elements.forEach(el => el.blur()))
      await page.setViewportSize({ width: w, height: h })
      await checkGeometry()
      for (let i = 0; i < await buttons.count(); i++) {
        await buttons.nth(i).scrollIntoViewIfNeeded()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await buttons.nth(i).evaluate(el => el.focus({ preventScroll: true }))
        await tooltip.waitFor().catch(error => { throw new Error(`${w}x${h} action ${i}: ${error.message}`) })
        const info = await page.evaluate(() => {
          const el = document.querySelector('.toolbar-tooltip')
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { text: el.textContent, parent: el.parentElement.tagName, x: r.x, y: r.y, width: r.width, height: r.height }
        })
        assert.ok(info, `tooltip disappeared at ${w}x${h} action ${i}`)
        assert.equal(info.text, await buttons.nth(i).getAttribute('aria-label'))
        assert.equal(info.parent, 'BODY', JSON.stringify(info))
        assert.ok(info.x >= 0 && info.x + info.width <= w && info.y >= 0 && info.y + info.height <= h, JSON.stringify(info))
        await checkGeometry()
        await page.keyboard.press('Escape')
        await tooltip.waitFor({ state: 'detached' })
        assert.equal(await buttons.nth(i).evaluate(el => el === document.activeElement), true)
      }
      await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth })
      assert.equal(await buttons.last().evaluate(el => {
        const a = el.getBoundingClientRect(), b = el.closest('[data-testid="main-toolbar-scroll"]').getBoundingClientRect()
        return a.left >= b.left && a.right <= b.right
      }), true)
      const box = await scroller.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(25, 120)
      await checkGeometry()
      for (const dx of [0, 50]) {
        const x = box.x + box.width / 2, y = box.y + box.height / 2
        await cdp.send('Input.synthesizeScrollGesture', {
          x, y, yDistance: 60, xDistance: -dx, gestureSourceType: 'touch', preventFling: true,
        })
        await checkGeometry()
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    // The app scrolls the document; the offline bypass banner precedes the sticky header.
    await page.evaluate(() => window.scrollTo(0, 100))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const toolbarBeforeScroll = await scroller.boundingBox()
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.ok(await page.evaluate(() => window.scrollY >= 300), 'page content still scrolls')
    await checkGeometry()
    assert.equal((await scroller.boundingBox()).y, toolbarBeforeScroll.y, 'header remains pinned while content scrolls')
    await page.setViewportSize({ width: 320, height: 740 })
    assert.ok(await scroller.evaluate(el => el.scrollWidth > el.clientWidth), 'exercise actual horizontal overflow')
    await buttons.first().hover()
    await tooltip.waitFor()
    await page.mouse.move(0, 0)
    await buttons.first().blur(); await buttons.first().focus(); await tooltip.waitFor()
    await scroller.evaluate(el => { el.scrollLeft = el.scrollLeft === 0 ? 20 : 0 })
    await tooltip.waitFor({ state: 'detached' })
    for (const event of ['resize', 'scroll']) {
      await buttons.first().blur(); await buttons.first().focus(); await tooltip.waitFor()
      await page.evaluate(event => window.visualViewport.dispatchEvent(new Event(event)), event)
      await tooltip.waitFor({ state: 'detached' })
    }
    await buttons.first().blur(); await buttons.first().focus(); await tooltip.waitFor()
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.25 })
    await tooltip.waitFor({ state: 'detached' })
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await buttons.first().blur(); await buttons.first().focus(); await tooltip.waitFor()
    await page.setViewportSize({ width: 844, height: 390 })
    await tooltip.waitFor({ state: 'detached' })
    await buttons.first().focus()
    await page.keyboard.press('Tab')
    assert.equal(await buttons.nth(1).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Start autoscroll', exact: true }).click()
    await page.getByRole('button', { name: 'Pause autoscroll', exact: true }).waitFor()
    await checkGeometry()
    await page.getByRole('button', { name: 'Pause autoscroll', exact: true }).click()
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click()
    await page.waitForFunction(() => !!document.fullscreenElement)
    await page.evaluate(() => document.exitFullscreen())
    await scroller.waitFor(); await checkGeometry()
    await buttons.nth(2).focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(() => history.state?.gtarView === 'editor')
    await checkGeometry()
    await buttons.nth(6).focus(); await page.keyboard.press('Space')
    await page.waitForFunction(() => history.state?.gtarView === 'trash')
    await checkGeometry()
    await page.getByTestId('canonical-sidepanel-toggle-btn').click()
    await page.getByRole('button', { name: /^Setlists \(/ }).click()
    await page.getByRole('button', { name: /^Songbook \(/ }).click()
    await page.getByTitle('Close Drawer', { exact: true }).click()
    await checkGeometry()
    console.log('ISSUE107_BROWSER: 14 portrait/landscape sizes; geometry=44/44/0; hover/focus/Escape/Tab/Enter/Space; visualViewport/resize/scroll; stage/autoscroll/fullscreen/editor/trash/setlists')
  } finally {
    await browser?.close()
    await server.close()
  }
})
