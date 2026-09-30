// Draws the release / nightly banner (banner.html, in this folder) to a PNG.
// Used by release.yml and nightly.yml; needs Playwright's Chromium.
//
//   BANNER_VERSION=v3.2.1 BANNER_TYPE=release node .github/banner/render.js
//
// Env: BANNER_VERSION (tag), BANNER_TYPE (release | nightly), BANNER_REF
// (branch, nightly only), BANNER_OUT (default release-banner.png),
// BANNER_CHROMIUM (optional Chromium path). Exits 0 without a file if it
// can't draw it: a missing banner must never block a release.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  let browser
  const out = process.env.BANNER_OUT || 'release-banner.png'
  try {
    const { chromium } = require('playwright')
    browser = await chromium.launch(process.env.BANNER_CHROMIUM ? { executablePath: process.env.BANNER_CHROMIUM } : {})
    const page = await browser.newPage({ viewport: { width: 1200, height: 600 } })
    const url = pathToFileURL(path.join(__dirname, 'banner.html'))
    url.search = new URLSearchParams({
      v: process.env.BANNER_VERSION || '',
      type: process.env.BANNER_TYPE === 'nightly' ? 'nightly' : 'release',
      ref: process.env.BANNER_REF || '',
      date: new Date().toISOString().slice(0, 10),
    }).toString()
    // The page's fonts come from Google Fonts: wait for them a little, but
    // draw with the fallback fonts rather than not at all.
    await page.goto(url.toString(), { waitUntil: 'load', timeout: 20000 }).catch(() => {})
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 5000))])).catch(() => {})
    await page.waitForFunction(() => [...document.images].every(img => img.complete), null, { timeout: 5000 }).catch(() => {})
    await page.locator('.title-card').screenshot({ path: out, timeout: 15000 })
    console.log(`[banner] ${out}`)
  } catch (err) {
    console.warn('[banner] Skipping banner, could not draw it:', err.message)
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
})()
