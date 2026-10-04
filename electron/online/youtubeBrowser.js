const fs = require('fs')
const path = require('path')
const { connectBrowser } = require('./browserCdp')

const MUSIC = 'https://music.youtube.com'
const LOGIN = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F'
let browserInstallJob

/** Only the four non-secret account/client headers are retained. */
function accountContext(headers = {}) {
  const lowered = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return Object.fromEntries(['x-goog-authuser', 'x-goog-pageid', 'x-goog-visitor-id', 'x-youtube-client-version'].filter(key => typeof lowered[key] === 'string').map(key => [key, lowered[key]]))
}

function youtubeCookie(cookie) {
  return /(?:^|\.)youtube\.com$/i.test(String(cookie.domain || '').replace(/^\./, '')) && !cookie.partitionKey
}

/** Use installed Chrome/Edge, or cache an official Chrome for Testing download. */
async function browserExecutable(userData, onProgress = () => {}, tools, app) {
  try {
    const browser = await app?.getApplicationInfoForProtocol('https://music.youtube.com')
    if (browser?.path && (process.platform === 'win32' || !/\.exe$/i.test(browser.path)) && /chrome|chromium|edge|brave|vivaldi|thorium|helium|quetta|opera|arc/i.test(`${browser.name} ${browser.path}`) && fs.existsSync(browser.path) && fs.statSync(browser.path).isFile()) return browser.path
  } catch {}
  tools ||= await import('@puppeteer/browsers')
  try {
    const file = tools.computeSystemExecutablePath({ browser: tools.Browser.CHROME, channel: tools.ChromeReleaseChannel.STABLE })
    if (process.platform === 'win32' || !/\.exe$/i.test(file)) return file
  } catch {}
  const edge = process.platform === 'win32'
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(base => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    : process.platform === 'darwin' ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const installed = edge.find(file => fs.existsSync(file))
  if (installed) return installed
  const cacheDir = path.join(userData, 'sign-in-browser')
  const cached = (await tools.getInstalledBrowsers({ cacheDir })).find(browser => browser.browser === tools.Browser.CHROME)
  if (cached && fs.existsSync(cached.executablePath)) return cached.executablePath
  onProgress({ message: 'Downloading the dedicated sign-in browser from Google…' })
  if (!browserInstallJob) browserInstallJob = (async () => {
    const platform = tools.detectBrowserPlatform()
    if (!platform) throw new Error('A Chrome or Edge browser is required on this platform.')
    const buildId = await tools.resolveBuildId(tools.Browser.CHROME, platform, tools.BrowserTag.STABLE)
    let lastPercent = -1
    const browser = await tools.install({ browser: tools.Browser.CHROME, buildId, cacheDir, downloadProgressCallback: (done, total) => {
      const percent = total ? Math.floor(done / total * 100) : 0
      if (percent !== lastPercent) { lastPercent = percent; onProgress({ message: `Downloading sign-in browser… ${percent}%` }) }
    } })
    return browser.executablePath
  })().finally(() => { browserInstallJob = null })
  return browserInstallJob
}

/** Launch an isolated browser window; passwords stay in that browser. */
async function openYouTubeBrowser({ electron, signal, onChange = () => {}, onClosed = () => {}, onProgress = () => {}, tools, executablePath, extraArgs = [] } = {}) {
  const runtime = electron || require('electron')
  const userData = runtime.app.getPath('userData')
  tools ||= await import('@puppeteer/browsers')
  executablePath ||= await browserExecutable(userData, onProgress, tools, runtime.app)
  if (signal?.aborted) throw new Error('Sign-in cancelled.')
  fs.mkdirSync(userData, { recursive: true })
  const profile = fs.mkdtempSync(path.join(userData, 'ytmusic-login-'))
  fs.chmodSync(profile, 0o700)
  let browser, cdp, closed = false, ready = false, pageSession, targetId
  let url = LOGIN, context = {}
  const close = async () => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', abort)
    runtime.app.removeListener('before-quit', abort)
    try { await cdp?.send('Browser.close') } catch {}
    cdp?.close()
    try {
      if (browser?.nodeProcess?.pid) await browser.close()
      else browser?.kill()
    } catch {}
    await fs.promises.rm(profile, { recursive: true, force: true }).catch(() => {})
  }
  const abort = () => { close().catch(() => {}) }
  try {
    if (signal?.aborted) throw new Error('Sign-in cancelled.')
    // CDP stays on inherited child-process pipes, never a shared local listener.
    // The app owns this temporary profile, never the user's.
    browser = tools.launch({ executablePath, pipe: true, args: [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--disable-save-password-bubble', '--window-size=980,760', ...extraArgs, '--app=about:blank'], env: { ...process.env }, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false })
    signal?.addEventListener('abort', abort, { once: true })
    runtime.app.once('before-quit', abort)
    browser.hasClosed().then(() => { if (!closed && ready) { onClosed(); close().catch(() => {}) } }).catch(() => {})
    cdp = await connectBrowser(browser.nodeProcess, { timeoutMs: 15000 })
    const version = await cdp.send('Browser.getVersion')
    const targets = await cdp.send('Target.getTargets')
    targetId = targets.targetInfos.find(target => target.type === 'page')?.targetId
    if (!targetId) throw new Error('The sign-in browser could not open a window.')
    pageSession = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId
    cdp.on('Network.requestWillBeSent', (event, sessionId) => {
      if (sessionId !== pageSession) return
      let request
      try { request = new URL(event.request.url) } catch { return }
      if (request.origin !== MUSIC || !request.pathname.startsWith('/youtubei/')) return
      const next = accountContext(event.request.headers)
      if (JSON.stringify(next) !== JSON.stringify(context)) { context = next; onChange() }
    })
    cdp.on('Page.frameNavigated', (event, sessionId) => {
      if (sessionId !== pageSession || event.frame.parentId) return
      url = event.frame.url
      onChange()
    })
    cdp.on('Page.loadEventFired', (_, sessionId) => { if (sessionId === pageSession) onChange() })
    cdp.on('closed', () => { if (!closed && ready) { onClosed(); close().catch(() => {}) } })
    await cdp.send('Network.enable', {}, pageSession)
    await cdp.send('Page.enable', {}, pageSession)
    const identity = await cdp.send('Runtime.evaluate', { expression: 'navigator.webdriver', returnByValue: true }, pageSession)
    await cdp.send('Page.navigate', { url: LOGIN }, pageSession)
    ready = true
    onProgress({ message: 'Complete Google sign-in in the browser window. Lokal verifies Music account access automatically.' })
    return {
      close,
      focus: () => cdp.send('Page.bringToFront', {}, pageSession).catch(() => {}),
      async read() {
        const snapshot = context
        const cookies = await cdp.send('Network.getCookies', { urls: [MUSIC] }, pageSession)
        return { url, context: snapshot, userAgent: version.userAgent, webdriver: identity.result?.value, cookies: (cookies.cookies || []).filter(youtubeCookie) }
      },
    }
  } catch (error) { await close(); throw error }
}

module.exports = { openYouTubeBrowser, browserExecutable, accountContext, youtubeCookie }
