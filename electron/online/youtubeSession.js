const crypto = require('crypto')
const youtube = require('./youtube')
const { openYouTubeBrowser, accountContext, youtubeCookie } = require('./youtubeBrowser')
const { openEmbeddedYouTubeLogin } = require('./youtubeEmbeddedLogin')

const PARTITION = 'persist:lokal-ytmusic'
const MUSIC = 'https://music.youtube.com'

/** Preserve cookie scope/lifetime while transferring only this app's Music session. */
function electronCookie(cookie) {
  const host = cookie.domain.replace(/^\./, '')
  return {
    url: `https://${host}${cookie.path || '/'}`, name: cookie.name, value: cookie.value,
    ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : {}),
    path: cookie.path || '/', secure: !!cookie.secure, httpOnly: !!cookie.httpOnly,
    sameSite: ({ None: 'no_restriction', Lax: 'lax', Strict: 'strict' })[cookie.sameSite] || 'unspecified',
    ...(!cookie.session && cookie.expires > 0 ? { expirationDate: cookie.expires } : {}),
  }
}

/** Activate an isolated login snapshot only after authenticated Music verification. */
function createYouTubeSession({ electron, getSettings, saveSettings, provider = youtube, syncCookies = header => require('../ipc/ytCookies').syncSessionCookies(header), openBrowser } = {}) {
  const runtime = () => electron || require('electron')
  let ses, loginJob
  let revision = 0
  let requestContext = {}
  const watchCookies = session => session.cookies.on('changed', () => {
    const token = revision
    if (session === ses && getSettings().yt_account_session === '1') cookieHeader(session).then(header => {
      if (token === revision && session === ses && getSettings().yt_account_session === '1') syncCookies(header)
    }).catch(() => {})
  })
  const getSession = () => {
    if (ses) return ses
    const saved = getSettings()
    const partition = /^persist:lokal-ytmusic(?:-[\da-f-]+)?$/.test(saved.yt_account_partition || '') ? saved.yt_account_partition : PARTITION
    ses = runtime().session.fromPartition(partition)
    // External-browser and legacy profiles keep their saved identity; native
    // embedded profiles use Electron's current default, including after updates.
    if (saved.yt_account_user_agent) ses.setUserAgent(saved.yt_account_user_agent)
    try { requestContext = accountContext(JSON.parse(saved.yt_account_context || '{}')) } catch {}
    watchCookies(ses)
    return ses
  }
  const cookieHeader = async session => (await session.cookies.get({ url: MUSIC })).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  const sessionCredentials = async (session, context, token) => {
    const headersFor = cookies => JSON.stringify({ ...context, 'user-agent': session.getUserAgent(), Cookie: cookies })
    const cookies = await cookieHeader(session)
    if (token !== revision) throw new Error('YouTube Music session changed. Try again.')
    if (session === ses && getSettings().yt_account_session === '1') syncCookies(cookies)
    return {
      cookies: headersFor(cookies),
      fetchImpl: async (url, init = {}) => {
        if (new URL(url).origin !== MUSIC) throw new Error('Unexpected YouTube Music request origin.')
        const fresh = headersFor(await cookieHeader(session))
        if (token !== revision) throw new Error('YouTube Music session changed. Try again.')
        const headers = { ...init.headers, ...provider.accountHeaders(fresh, {
          SESSION_INDEX: init.headers?.['X-Goog-AuthUser'], DELEGATED_SESSION_ID: init.headers?.['X-Goog-PageId'],
          VISITOR_DATA: init.headers?.['X-Goog-Visitor-Id'], INNERTUBE_CLIENT_VERSION: init.headers?.['X-YouTube-Client-Version'],
        }), 'User-Agent': session.getUserAgent() }
        delete headers.Cookie
        let body = init.body
        if (typeof body === 'string') {
          const data = JSON.parse(body)
          if (data.context?.client) {
            data.context.client.clientVersion = headers['X-YouTube-Client-Version']
            if (headers['X-Goog-Visitor-Id']) data.context.client.visitorData = headers['X-Goog-Visitor-Id']
            if (headers['X-Goog-PageId']) data.context.user = { ...data.context.user, onBehalfOfUser: headers['X-Goog-PageId'] }
          }
          body = JSON.stringify(data)
        }
        return session.fetch(url, { ...init, body, headers, credentials: 'include' })
      },
    }
  }
  const credentials = async () => {
    if (getSettings().yt_account_session !== '1') return { cookies: '', fetchImpl: fetch }
    const session = getSession()
    return sessionCredentials(session, requestContext, revision)
  }
  const finish = (job, result) => {
    if (job.finished) return
    job.finished = true
    revision++
    if (loginJob === job) loginJob = null
    // Close before aborting so a successful native login keeps its full profile.
    Promise.resolve(job.browser?.close({ preserveSession: !!result.authenticated })).catch(() => {})
    job.controller.abort()
    if (!result.authenticated) job.session.clearStorageData().catch(() => {})
    job.resolve(result)
  }
  const signIn = ({ mode = 'embedded', onProgress = () => {} } = {}) => {
    if (!['embedded', 'browser'].includes(mode)) return Promise.resolve({ authenticated: false, error: 'Unknown YouTube Music sign-in mode.' })
    if (loginJob) { loginJob.browser?.focus(); return loginJob.promise }
    getSession()
    const partition = `${PARTITION}-${crypto.randomUUID()}`
    const job = { token: ++revision, partition, session: runtime().session.fromPartition(partition), controller: new AbortController(), finished: false, checking: false, dirty: true, browser: null }
    job.promise = new Promise(resolve => { job.resolve = resolve })
    loginJob = job
    const current = () => !job.finished && job.token === revision && loginJob === job
    const check = async () => {
      job.dirty = true
      if (!job.browser || job.checking || !current()) return
      job.checking = true
      try {
        while (job.dirty && current()) {
          job.dirty = false
          const snapshot = await job.browser.read()
          if (!current()) return
          if (job.dirty) continue
          if (new URL(snapshot.url).origin !== MUSIC) return
          const context = accountContext(snapshot.context)
          const native = job.browser.session === job.session
          if (!native) {
            job.session.setUserAgent(snapshot.userAgent)
            await job.session.clearStorageData({ storages: ['cookies'] })
            for (const cookie of snapshot.cookies.filter(youtubeCookie)) {
              if (!current()) return
              await job.session.cookies.set(electronCookie(cookie))
            }
          }
          if (!current()) return
          const auth = await sessionCredentials(job.session, context, job.token)
          if (!provider.accountHeaders(auth.cookies)) return
          provider.clearAccountCache()
          const result = await provider.fetchAccountData({ ...auth, force: true })
          if (!current()) return
          if (job.dirty) continue
          if (!result.authenticated || result.error) { onProgress({ message: result.error || 'YouTube Music has not confirmed account access yet.' }); return }
          await job.session.cookies.flushStore()
          job.session.flushStorageData?.()
          const freshCookies = await cookieHeader(job.session)
          if (!current()) return
          if (job.dirty) continue
          // The old jar and selected account remain intact until this atomic switch.
          saveSettings({ yt_account_partition: partition, yt_account_user_agent: native ? '' : job.session.getUserAgent(), yt_account_context: JSON.stringify(context), yt_account_session: '1', yt_account_revision: String(Date.now()), yt_cookies: '1', yt_cookie_browser: 'session' })
          const previous = ses
          ses = job.session
          requestContext = context
          watchCookies(ses)
          syncCookies(freshCookies)
          finish(job, result)
          previous.clearStorageData().catch(() => {})
        }
      } finally { job.checking = false }
    }
    const changed = () => { check().catch(error => { if (current()) onProgress({ message: error.message || 'Could not verify YouTube Music account access.' }) }) }
    ;(async () => {
      try {
        const opener = openBrowser || (mode === 'browser' ? openYouTubeBrowser : openEmbeddedYouTubeLogin)
        job.browser = await opener({ electron: runtime(), session: job.session, signal: job.controller.signal, onChange: changed, onClosed: () => finish(job, { authenticated: false, cancelled: true }), onError: error => finish(job, { authenticated: false, error: error.message || 'The sign-in window failed.' }), onProgress })
        if (!current()) { await job.browser.close(); return }
        await check()
      } catch (error) { finish(job, { authenticated: false, ...(job.controller.signal.aborted ? { cancelled: true } : { error: error.message || 'Could not open the sign-in browser.' }) }) }
    })()
    return job.promise
  }
  const cancelSignIn = () => { if (loginJob) finish(loginJob, { authenticated: false, cancelled: true }); return { ok: true } }
  const disconnect = async () => {
    revision++
    cancelSignIn()
    await getSession().clearStorageData()
    saveSettings({ yt_account_session: '0', yt_account_context: '', yt_account_partition: '', yt_account_user_agent: '', yt_account_revision: String(Date.now()), yt_cookies: '0', yt_cookie_browser: 'session', yt_cookie_header: '' })
    syncCookies('')
    requestContext = {}
    provider.clearAccountCache()
    return { ok: true }
  }
  return { credentials, signIn, cancelSignIn, disconnect }
}

module.exports = { createYouTubeSession, electronCookie, PARTITION }
