const youtube = require('./youtube')

const PARTITION = 'persist:lokal-ytmusic'
const MUSIC = 'https://music.youtube.com'
const LOGIN = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F'

function browserUserAgent(value) {
  return String(value || '').replace(/\s+(?:Electron|lokal(?:-music)?)\/[\w.+-]+/gi, '').trim()
}

/** The dedicated Chromium cookie jar owns login and cookie rotation. No app preload runs here. */
function createYouTubeSession({ electron, getSettings, saveSettings, provider = youtube, syncCookies = header => require('../ipc/ytCookies').syncSessionCookies(header) } = {}) {
  let ses
  let window
  let loginJob
  let revision = 0
  let requestContext = {}
  let pendingRequestContext = null
  let verifyLogin
  let defaultUserAgent
  const getSession = () => {
    if (ses) return ses
    const runtime = electron || require('electron')
    ses = runtime.session.fromPartition(PARTITION)
    defaultUserAgent = browserUserAgent(ses.getUserAgent())
    ses.setUserAgent(defaultUserAgent)
    ses.cookies.on('changed', () => {
      const token = revision
      if (getSettings().yt_account_session === '1') cookieHeader().then(header => {
        if (token === revision && getSettings().yt_account_session === '1') syncCookies(header)
      }).catch(() => {})
    })
    try { requestContext = JSON.parse(getSettings().yt_account_context || '{}') } catch {}
    ses.webRequest.onBeforeSendHeaders({ urls: [`${MUSIC}/youtubei/*`] }, (details, callback) => {
      // Learn the selected account/client from the actual website request.
      // Never copy Cookie or Authorization to renderer-visible settings.
      let changed = false
      if (window && details.webContentsId === window.webContents.id) {
        const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([key, value]) => [key.toLowerCase(), value]))
        const next = {}
        for (const key of ['x-goog-authuser', 'x-goog-pageid', 'x-goog-visitor-id', 'x-youtube-client-version']) if (typeof headers[key] === 'string') next[key] = headers[key]
        if (JSON.stringify(next) !== JSON.stringify(pendingRequestContext)) {
          pendingRequestContext = next
          changed = true
        }
      }
      callback({ requestHeaders: details.requestHeaders })
      if (changed) verifyLogin?.()
    })
    return ses
  }
  const cookieHeader = async () => (await getSession().cookies.get({ url: MUSIC })).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  const credentials = async ({ forceSession = false, context } = {}) => {
    if (!forceSession && getSettings().yt_account_session !== '1') return { cookies: '', fetchImpl: fetch }
    const token = revision
    const currentSession = getSession()
    const accountContext = context ?? requestContext
    const headersFor = cookies => JSON.stringify({ ...accountContext, 'user-agent': currentSession.getUserAgent(), Cookie: cookies })
    const cookies = await cookieHeader()
    if (token !== revision) throw new Error('YouTube Music session changed. Try again.')
    syncCookies(cookies)
    return {
      cookies: headersFor(cookies),
      fetchImpl: async (url, init = {}) => {
        if (new URL(url).origin !== MUSIC) throw new Error('Unexpected YouTube Music request origin.')
        const fresh = headersFor(await cookieHeader())
        if (token !== revision) throw new Error('YouTube Music session changed. Try again.')
        let body = init.body
        const headers = { ...init.headers, ...provider.accountHeaders(fresh, {
          SESSION_INDEX: init.headers?.['X-Goog-AuthUser'],
          DELEGATED_SESSION_ID: init.headers?.['X-Goog-PageId'],
          VISITOR_DATA: init.headers?.['X-Goog-Visitor-Id'],
          INNERTUBE_CLIENT_VERSION: init.headers?.['X-YouTube-Client-Version'],
        }), 'User-Agent': currentSession.getUserAgent() }
        // Chromium sends the cookie jar and persists Set-Cookie rotations.
        delete headers.Cookie
        if (typeof body === 'string') {
          const data = JSON.parse(body)
          if (data.context?.client) {
            data.context.client.clientVersion = headers['X-YouTube-Client-Version']
            if (headers['X-Goog-Visitor-Id']) data.context.client.visitorData = headers['X-Goog-Visitor-Id']
            if (headers['X-Goog-PageId']) data.context.user = { ...data.context.user, onBehalfOfUser: headers['X-Goog-PageId'] }
          }
          body = JSON.stringify(data)
        }
        return currentSession.fetch(url, { ...init, body, headers, credentials: 'include' })
      },
    }
  }
  const signIn = ({ compatibility = false } = {}) => {
    if (loginJob) { window?.show(); window?.focus(); return loginJob }
    const runtime = electron || require('electron')
    const currentSession = getSession()
    currentSession.setUserAgent(compatibility ? 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0' : defaultUserAgent)
    const token = ++revision
    pendingRequestContext = {}
    loginJob = new Promise(resolve => {
      const win = window = new runtime.BrowserWindow({
        width: 980, height: 760, minWidth: 640, minHeight: 500, title: 'Sign in to YouTube Music', backgroundColor: '#111111', autoHideMenuBar: true,
        webPreferences: { session: currentSession, nodeIntegration: false, contextIsolation: true, sandbox: true },
      })
      win.setMenu?.(null)
      let finished = false
      let verifying = false
      const finish = result => {
        if (finished) return
        finished = true
        revision++
        pendingRequestContext = null
        verifyLogin = null
        window = null
        loginJob = null
        if (!win.isDestroyed()) win.close()
        resolve(result)
      }
      const check = async () => {
        if (finished || verifying || token !== revision || !win.webContents.getURL().startsWith(`${MUSIC}/`)) return
        verifying = true
        try {
          while (!finished && token === revision) {
            // Promote only the exact context snapshot these requests verified.
            const context = pendingRequestContext
            const auth = await credentials({ forceSession: true, context })
            if (!provider.accountHeaders(auth.cookies)) return
            provider.clearAccountCache()
            const result = await provider.fetchAccountData({ ...auth, force: true })
            if (finished || token !== revision) return
            if (context !== pendingRequestContext) continue
            if (!result.authenticated || result.error) return
            await currentSession.cookies.flushStore()
            const freshCookies = await cookieHeader()
            if (finished || token !== revision) return
            if (context !== pendingRequestContext) continue
            requestContext = context
            saveSettings({ yt_account_context: JSON.stringify(context), yt_account_session: '1', yt_account_revision: String(Date.now()), yt_cookies: '1', yt_cookie_browser: 'session' })
            syncCookies(freshCookies)
            finish(result)
          }
        } finally { verifying = false }
      }
      verifyLogin = () => { check().catch(() => {}) }
      win.webContents.on('did-finish-load', () => { check().catch(() => {}) })
      win.webContents.on('did-navigate-in-page', () => { check().catch(() => {}) })
      win.webContents.on('did-fail-load', (_, code, description, url, isMainFrame) => {
        if (isMainFrame && code !== -3) finish({ authenticated: false, error: `Could not load YouTube Music sign-in: ${description || code}.` })
      })
      const onCookie = () => { check().catch(() => {}) }
      currentSession.cookies.on('changed', onCookie)
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (event, url) => {
        try { if (!['music.youtube.com', 'www.youtube.com', 'accounts.google.com', 'myaccount.google.com', 'consent.google.com', 'consent.youtube.com'].includes(new URL(url).hostname)) event.preventDefault() } catch { event.preventDefault() }
      })
      win.once('closed', () => { currentSession.cookies.removeListener('changed', onCookie); finish({ authenticated: false, cancelled: true }) })
      win.loadURL(LOGIN, { userAgent: currentSession.getUserAgent() }).catch(() => finish({ authenticated: false, error: 'Could not open YouTube Music sign-in.' }))
    })
    return loginJob
  }
  const disconnect = async () => {
    revision++
    window?.close()
    await getSession().clearStorageData()
    saveSettings({ yt_account_session: '0', yt_account_context: '', yt_account_revision: String(Date.now()), yt_cookies: '0', yt_cookie_browser: 'session', yt_cookie_header: '' })
    syncCookies('')
    requestContext = {}
    provider.clearAccountCache()
    return { ok: true }
  }
  return { credentials, signIn, disconnect }
}

module.exports = { createYouTubeSession, browserUserAgent, PARTITION }
