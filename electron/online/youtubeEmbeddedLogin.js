const crypto = require('crypto')
const path = require('path')
const { accountContext, youtubeCookie } = require('./youtubeBrowser')
const { browserUserAgent } = require('./youtubeLoginIdentity')

const MUSIC = 'https://music.youtube.com'
const LOGIN = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F'

function loginURL(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /(?:^|\.)(?:google|youtube)\.com$/i.test(url.hostname)
  } catch { return false }
}

/** A temporary login jar; the session manager copies and verifies its snapshot. */
async function openEmbeddedYouTubeLogin({ electron, signal, onChange = () => {}, onClosed = () => {}, onError = () => {}, onProgress = () => {} } = {}) {
  if (signal?.aborted) throw new Error('Sign-in cancelled.')
  const runtime = electron || require('electron')
  const session = runtime.session.fromPartition(`lokal-ytmusic-login-${crypto.randomUUID()}`)
  session.setUserAgent(browserUserAgent(session.getUserAgent()))
  const window = new runtime.BrowserWindow({
    width: 980, height: 760, title: 'Sign in to YouTube Music', autoHideMenuBar: true,
    webPreferences: {
      session,
      preload: path.join(__dirname, 'youtubeLoginPreload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.setMenu(null)
  const contents = window.webContents
  let closed = false, ready = false, context = {}
  const changed = () => { if (!closed) onChange() }
  const cleanup = async () => {
    signal?.removeEventListener('abort', abort)
    runtime.app.removeListener('before-quit', abort)
    session.cookies.removeListener('changed', changed)
    session.webRequest.onBeforeSendHeaders(null)
    await session.clearStorageData()
  }
  const close = async () => {
    if (closed) return
    closed = true
    if (!window.isDestroyed()) window.destroy()
    await cleanup()
  }
  const abort = () => { close().catch(() => {}) }
  const fail = error => {
    if (closed) return
    onError(error)
    close().catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })
  runtime.app.once('before-quit', abort)
  window.on('closed', () => {
    if (closed) return
    closed = true
    cleanup().catch(() => {})
    onClosed()
  })
  session.cookies.on('changed', changed)
  session.webRequest.onBeforeSendHeaders({ urls: [`${MUSIC}/youtubei/*`] }, (details, callback) => {
    if (details.webContentsId === contents.id) {
      const next = accountContext(details.requestHeaders)
      if (JSON.stringify(next) !== JSON.stringify(context)) { context = next; changed() }
    }
    callback({ requestHeaders: details.requestHeaders })
  })
  const guardNavigation = event => { if (event.isMainFrame && !loginURL(event.url)) event.preventDefault() }
  contents.on('will-navigate', guardNavigation)
  contents.on('will-redirect', guardNavigation)
  contents.setWindowOpenHandler(({ url }) => {
    if (loginURL(url)) window.loadURL(url).catch(error => fail(new Error(error.message || 'Could not load Google sign-in.')))
    return { action: 'deny' }
  })
  contents.on('did-start-navigation', event => {
    if (!event.isMainFrame || event.isSameDocument) return
    context = {}
    changed()
  })
  contents.on('did-navigate', changed)
  contents.on('did-finish-load', changed)
  contents.on('preload-error', () => fail(new Error('Could not initialize the YouTube Music sign-in window. Please try again.')))
  contents.on('render-process-gone', () => fail(new Error('The YouTube Music sign-in window stopped responding. Please try again.')))
  contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (ready && mainFrame && code !== -3) fail(new Error(`Could not load Google sign-in: ${description}`))
  })
  try {
    await window.loadURL(LOGIN)
    if (closed || signal?.aborted) throw new Error('Sign-in cancelled.')
    ready = true
    onProgress({ message: 'Complete Google sign-in in the Lokal window. Music account access is verified automatically.' })
    return {
      close,
      focus: () => { if (!window.isDestroyed()) { window.show(); window.focus() } },
      async read() {
        if (closed) throw new Error('Sign-in window closed.')
        const url = contents.getURL(), captured = context
        let pageContext = {}
        if (new URL(url).origin === MUSIC) {
          pageContext = await contents.executeJavaScript(`(() => {
            const config = window.ytcfg;
            if (typeof config?.get !== 'function') return {};
            const names = { 'x-goog-authuser': 'SESSION_INDEX', 'x-goog-pageid': 'DELEGATED_SESSION_ID', 'x-goog-visitor-id': 'VISITOR_DATA', 'x-youtube-client-version': 'INNERTUBE_CLIENT_VERSION' };
            return Object.fromEntries(Object.entries(names).flatMap(([header, key]) => {
              const value = config.get(key);
              return typeof value === 'string' || typeof value === 'number' ? [[header, String(value)]] : [];
            }));
          })()`)
        }
        const cookies = (await session.cookies.get({ url: MUSIC })).filter(youtubeCookie).map(cookie => ({
          ...cookie,
          expires: cookie.expirationDate,
          sameSite: ({ no_restriction: 'None', lax: 'Lax', strict: 'Strict' })[cookie.sameSite],
        }))
        return { url, context: accountContext({ ...pageContext, ...captured }), userAgent: session.getUserAgent(), cookies }
      },
    }
  } catch (error) { await close(); throw error }
}

module.exports = { openEmbeddedYouTubeLogin, loginURL }
