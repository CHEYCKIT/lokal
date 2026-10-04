const crypto = require('crypto')
const { accountContext, youtubeCookie } = require('./youtubeBrowser')

const MUSIC = 'https://music.youtube.com'
// Regional Google account hosts, restricted to Google's supported domain list.
const GOOGLE_ACCOUNT_SUFFIXES = new Set(`com ad ae com.af com.ag al am co.ao com.ar as at com.au az
  ba com.bd be bf bg com.bh bi bj com.bn com.bo com.br bs bt co.bw by com.bz ca cd cf cg ch ci co.ck cl cm cn
  com.co co.cr com.cu cv com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg
  com.gh com.gi gl gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je com.jm jo co.jp co.ke
  com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv com.ly co.ma md me mg mk ml com.mm mn com.mt mu
  mv mw com.mx com.my co.mz com.na com.ng com.ni ne nl no com.np nr nu co.nz com.om com.pa com.pe com.pg
  com.ph com.pk pl pn com.pr ps pt com.py com.qa ro ru rw com.sa com.sb sc se com.sg sh si sk com.sl sn so sm
  sr st com.sv td tg co.th com.tj tl tm tn to com.tr tt com.tw co.tz com.ua co.ug co.uk com.uy co.uz com.vc
  co.ve co.vi com.vn vu ws rs co.za co.zm co.zw cat`.split(/\s+/))
const handoff = new URL('https://www.youtube.com/signin?action_handle_signin=true&app=desktop')
handoff.searchParams.set('next', `${MUSIC}/`)
const regionalLogin = new URL('https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube')
regionalLogin.searchParams.set('continue', handoff.href)

function loginURL(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (
      /(?:^|\.)(?:google|youtube)\.com$/i.test(url.hostname)
      || (url.hostname.startsWith('accounts.google.') && GOOGLE_ACCOUNT_SUFFIXES.has(url.hostname.slice('accounts.google.'.length)))
    )
  } catch { return false }
}

/** Navigate Music with native Electron identity; preserve the whole verified profile. */
async function openEmbeddedYouTubeLogin({ electron, session: candidateSession, signal, onChange = () => {}, onClosed = () => {}, onError = () => {}, onProgress = () => {}, cookiePollMs = 1000 } = {}) {
  if (signal?.aborted) throw new Error('Sign-in cancelled.')
  const runtime = electron || require('electron')
  const session = candidateSession || runtime.session.fromPartition(`persist:lokal-ytmusic-${crypto.randomUUID()}`)
  const window = new runtime.BrowserWindow({
    width: 980, height: 760, title: 'Sign in to YouTube Music', autoHideMenuBar: true,
    webPreferences: {
      session,
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.setMenu(null)
  const contents = window.webContents
  let closed = false, loaded = false, context = {}
  let cookiePollTimer
  const changed = () => { if (!closed) onChange() }
  const cookieValues = new Map()
  const cookieKey = cookie => JSON.stringify([cookie.domain, cookie.path, cookie.name])
  const cookieValue = cookie => JSON.stringify([cookie.value, cookie.secure, cookie.httpOnly, cookie.sameSite])
  const cookieChanged = (_event, cookie, cause, removed) => {
    if (!cookie || !youtubeCookie(cookie)) return
    const domain = cookie.domain.replace(/^\./, '')
    if (!('music.youtube.com' === domain || 'music.youtube.com'.endsWith(`.${domain}`))) return
    // Overwrites arrive as removal + insertion. An expiry-only renewal during
    // API verification does not change account authority or require a new check.
    if (removed && cause === 'overwrite') return
    const key = cookieKey(cookie), next = removed ? undefined : cookieValue(cookie)
    if (cookieValues.get(key) === next) return
    if (removed) cookieValues.delete(key)
    else cookieValues.set(key, next)
    changed()
  }
  const cleanup = async (preserveSession = false) => {
    signal?.removeEventListener('abort', abort)
    runtime.app.removeListener('before-quit', abort)
    clearInterval(cookiePollTimer)
    session.cookies.removeListener('changed', cookieChanged)
    session.webRequest.onBeforeSendHeaders(null)
    if (!preserveSession) await session.clearStorageData()
  }
  const close = async ({ preserveSession = false } = {}) => {
    if (closed) return
    closed = true
    if (!window.isDestroyed()) window.destroy()
    await cleanup(preserveSession)
  }
  const abort = () => { close().catch(() => {}) }
  const fail = error => {
    if (closed) return
    onError(error)
    close().catch(() => {})
  }
  const navigate = url => window.loadURL(url).catch(error => {
    // Website navigation and the regional redirect can supersede the initial load.
    if (error.code !== 'ERR_ABORTED' && error.errno !== -3) fail(error)
  })
  signal?.addEventListener('abort', abort, { once: true })
  runtime.app.once('before-quit', abort)
  window.on('closed', () => {
    if (closed) return
    closed = true
    cleanup().catch(() => {})
    onClosed()
  })
  session.cookies.on('changed', cookieChanged)
  let polledCookies = '', pollInitialized = false
  const pollCookies = async () => {
    if (closed) return
    const cookies = (await session.cookies.get({ url: MUSIC })).filter(youtubeCookie)
    const next = cookies.map(cookie => `${cookie.domain}|${cookie.path}|${cookie.name}|${cookie.value}|${cookie.sameSite}`).sort().join('\n')
    if (pollInitialized && next !== polledCookies) changed()
    polledCookies = next
    pollInitialized = true
  }
  cookiePollTimer = setInterval(() => { pollCookies().catch(() => {}) }, cookiePollMs)
  session.webRequest.onBeforeSendHeaders({ urls: [`${MUSIC}/youtubei/*`] }, (details, callback) => {
    if (details.webContentsId === contents.id) {
      const next = accountContext(details.requestHeaders)
      if (JSON.stringify(next) !== JSON.stringify(context)) { context = next; changed() }
    }
    callback({ requestHeaders: details.requestHeaders })
  })
  const guardNavigation = event => { if (event.isMainFrame && !loginURL(event.url)) event.preventDefault() }
  contents.on('will-navigate', guardNavigation)
  contents.on('will-redirect', event => {
    guardNavigation(event)
    if (!event.isMainFrame || !loginURL(event.url)) return
    const url = new URL(event.url)
    if (['www.youtube.com', 'youtube.com'].includes(url.hostname) && ['/premium', '/musicpremium'].includes(url.pathname)) {
      event.preventDefault()
      navigate(regionalLogin.href)
    }
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (loginURL(url)) navigate(url)
    return { action: 'deny' }
  })
  contents.on('did-start-navigation', event => {
    if (!event.isMainFrame || event.isSameDocument) return
    loaded = false
    context = {}
    changed()
  })
  contents.on('did-navigate', changed)
  contents.on('did-navigate-in-page', changed)
  contents.on('did-finish-load', () => {
    loaded = true
    onProgress({ message: 'Use Sign in on the YouTube Music page, then complete Google sign-in. Lokal verifies account access automatically.' })
    changed()
  })
  contents.on('render-process-gone', () => fail(new Error('The YouTube Music sign-in window stopped responding. Please try again.')))
  contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) fail(new Error(`Could not load YouTube Music sign-in: ${description}`))
  })
  try {
    navigate(`${MUSIC}/`)
    return {
      session,
      close,
      focus: () => { if (!window.isDestroyed()) { window.show(); window.focus() } },
      async read() {
        if (closed) throw new Error('Sign-in window closed.')
        const url = loaded ? contents.getURL() : 'about:blank', captured = context
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
        const scoped = (await session.cookies.get({ url: MUSIC })).filter(youtubeCookie)
        for (const cookie of scoped) cookieValues.set(cookieKey(cookie), cookieValue(cookie))
        polledCookies = scoped.map(cookie => `${cookie.domain}|${cookie.path}|${cookie.name}|${cookie.value}|${cookie.sameSite}`).sort().join('\n')
        pollInitialized = true
        const cookies = scoped.map(cookie => ({
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
