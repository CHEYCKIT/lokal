// YouTube's "proof of origin" tokens. YouTube serves a song's full audio only
// to a stream link carrying a token that its BotGuard script issued in a real
// browser. Lokal runs BotGuard in a hidden window on www.youtube.com
// (poTokenPreload.js): attested once (about half a second, lasting hours),
// then each song's token is minted locally. Nothing is spoofed: it is this
// app's Chromium, as it is.

const path = require('path')

const PARTITION = 'persist:lokal-youtube-attest'
const PAGE = 'https://www.youtube.com/robots.txt'
const MARGIN_MS = 5 * 60 * 1000 // attest again this long before it runs out
const TIMEOUT_MS = 20000

let window = null
let loaded = null // Promise: the page is there
let attested = null // Promise<expiresAt>

function withTimeout(promise, what) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out.`)), TIMEOUT_MS) })]).finally(() => clearTimeout(timer))
}

function reset() {
  attested = null
  loaded = null
  if (window && !window.isDestroyed()) window.destroy()
  window = null
}

function page() {
  if (window && !window.isDestroyed() && loaded) return loaded
  const { BrowserWindow } = require('electron')
  window = new BrowserWindow({
    show: false, width: 400, height: 300, skipTaskbar: true,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'poTokenPreload.js'),
      // BotGuard has to run in the page's own world, with the page's window.
      contextIsolation: false, sandbox: false, nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('render-process-gone', reset)
  window.on('closed', () => { window = null; loaded = null; attested = null })
  loaded = withTimeout(window.loadURL(PAGE), 'Opening YouTube').catch(error => { reset(); throw error })
  return loaded
}

function run(code) {
  return page().then(() => withTimeout(window.webContents.executeJavaScript(code, true), 'YouTube attestation'))
}

function attest() {
  if (!attested) {
    attested = run('window.__lokalAttest.attest()')
      .then(ttl => Date.now() + Math.max(60000, Number(ttl) * 1000 - MARGIN_MS))
      .catch(error => { attested = null; throw error }) // a failure is never kept
  }
  return attested
}

/** Attest ahead of the first song, off the moment someone presses play. */
function warm() { attest().catch(() => {}) }

/** A token for `videoId`, or undefined (the song is then tried without one). */
async function mint(videoId) {
  try {
    let expiresAt = await attest()
    if (Date.now() >= expiresAt) { attested = null; expiresAt = await attest() }
    return await run(`window.__lokalAttest.mint(${JSON.stringify(String(videoId))})`)
  } catch {
    return undefined
  }
}

module.exports = { warm, mint, reset }
