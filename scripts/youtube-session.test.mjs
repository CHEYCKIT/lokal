import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import sessions from '../electron/online/youtubeSession.js'
import youtube from '../electron/online/youtube.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const browserCookies = value => [{ name: 'SAPISID', value, domain: '.youtube.com', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: 2000000000 }, { name: 'SID', value: 'test-login', domain: '.youtube.com', path: '/', secure: true }]
function environment({ connected = false, authenticated = true, launchError = false, native = false } = {}) {
  const settings = { yt_account_session: connected ? '1' : '0' }
  const requests = [], exports = [], partitions = new Map()
  function partition(id) {
    if (partitions.has(id)) return partitions.get(id)
    let values = id === sessions.PARTITION && connected ? browserCookies('session-one') : []
    let ua = 'Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36 lokal-music/4.1.0 Electron/44.5.1'
    const cookies = Object.assign(new EventEmitter(), {
      get: async ({ url } = {}) => url ? values.filter(cookie => { const host = new URL(url).hostname, domain = cookie.domain.replace(/^\./, ''); return host === domain || host.endsWith(`.${domain}`) }) : values,
      set: async cookie => { values.push(cookie); cookies.emit('changed') }, flushStore: async () => {},
    })
    const session = {
      cookies, getUserAgent: () => ua, setUserAgent: value => { ua = value },
      fetch: async (url, init) => { requests.push({ url, init, partition: id }); return { ok: true, json: async () => ({}) } },
      clearStorageData: async () => { values = []; session.storage = {}; session.cleared = true; cookies.emit('changed') },
      flushStorageData: () => { session.storageFlushed = true },
      storage: {},
      rotate: () => { values = browserCookies('session-two'); cookies.emit('changed') },
    }
    partitions.set(id, session)
    return session
  }
  let callbacks
  const snapshot = { url: 'https://accounts.google.com/', context: {}, cookies: browserCookies('browser-login'), userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0 Safari/537.36' }
  const browser = { closed: false, close: async ({ preserveSession = false } = {}) => {
    if (browser.closed) return
    browser.closed = true
    browser.preserved = preserveSession
    if (native) {
      browser.session.cookies.removeListener('changed', callbacks.onChange)
      if (!preserveSession) await browser.session.clearStorageData()
    }
  }, focus() {}, read: async () => ({ ...structuredClone(snapshot), ...(native ? { userAgent: browser.session.getUserAgent() } : {}) }) }
  const provider = { ...youtube, fetchAccountData: async auth => {
    await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: JSON.stringify({ context: { client: { clientVersion: 'initial' } } }) })
    return { authenticated, ...(authenticated ? { home: [{ title: 'Personal Song', artist: 'Artist' }] } : { error: 'Not authenticated' }) }
  } }
  const electron = { session: { fromPartition: partition }, BrowserWindow: class { constructor() { throw new Error('The injected login adapter owns window creation') } } }
  const makeManager = () => sessions.createYouTubeSession({ electron, getSettings: () => settings, saveSettings: values => Object.assign(settings, values), provider, syncCookies: header => exports.push(header), openBrowser: async options => {
    callbacks = options
    if (launchError) throw new Error('Could not start an isolated sign-in browser (test)')
    if (native) {
      browser.session = options.session
      browser.session.cookies.on('changed', options.onChange)
      options.signal.addEventListener('abort', () => browser.close(), { once: true })
    }
    return browser
  } })
  const manager = makeManager()
  return {
    manager, makeManager, settings, partitions, provider, requests, exports, browser, snapshot,
    session: () => partition(settings.yt_account_partition || sessions.PARTITION),
    candidate: () => [...partitions.values()].at(-1),
    navigate: url => { snapshot.url = url; callbacks.onChange() },
    capture: context => { snapshot.context = context; callbacks.onChange() },
    close: () => callbacks.onClosed(),
    fail: error => callbacks.onError(error),
  }
}

test('restored session uses saved account context, fresh signatures, Chromium cookie rotation, and a matching user-agent', async () => {
  const env = environment({ connected: true })
  env.settings.yt_account_context = JSON.stringify({ 'x-goog-authuser': '2', 'x-goog-pageid': 'saved-brand', 'x-youtube-client-version': '1.saved' })
  const auth = await env.manager.credentials()
  assert.match(env.session().getUserAgent(), /Electron/, 'native sessions retain Electron’s real identity')
  await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: '{}' })
  env.session().rotate()
  await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: '{}' })
  assert.notEqual(env.requests[0].init.headers.Authorization, env.requests[1].init.headers.Authorization)
  assert.equal(env.requests[0].init.credentials, 'include')
  assert.equal(env.requests[0].init.headers.Cookie, undefined)
  assert.equal(env.requests[0].init.headers['X-Goog-AuthUser'], '2')
  assert.equal(env.requests[0].init.headers['X-Goog-PageId'], 'saved-brand')
  assert.equal(env.requests[0].init.headers['User-Agent'], env.session().getUserAgent())
  await assert.rejects(auth.fetchImpl('https://example.com/'), /Unexpected.*origin/)
})

test('restored external-browser profiles retain their saved user-agent', async () => {
  const env = environment({ connected: true })
  env.settings.yt_account_user_agent = 'Fixture external browser'
  const auth = await env.manager.credentials()
  await auth.fetchImpl('https://music.youtube.com/')
  assert.equal(env.requests[0].init.headers['User-Agent'], 'Fixture external browser')
})

test('native sign-in verifies and promotes the whole website profile without clearing or copying its cookies', async () => {
  const env = environment({ connected: true, native: true })
  const active = env.session()
  const login = env.manager.signIn()
  await tick()
  const candidate = env.candidate(), ua = candidate.getUserAgent()
  candidate.storage.login = 'persistent-website-state'
  for (const cookie of [...browserCookies('native-account'), { name: 'SID', value: 'google-session', domain: '.google.com' }]) await candidate.cookies.set(cookie)
  env.capture({ 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'native-brand' })
  assert.equal((await active.cookies.get())[0].value, 'session-one')
  env.navigate('https://music.youtube.com/')
  assert.equal((await login).authenticated, true)
  assert.equal(env.session(), candidate)
  assert.equal(candidate.cleared, undefined)
  assert.equal(candidate.storage.login, 'persistent-website-state')
  assert.ok(candidate.storageFlushed)
  assert.equal((await candidate.cookies.get()).find(cookie => cookie.domain === '.google.com').value, 'google-session')
  assert.equal(env.settings.yt_account_user_agent, '', 'native profiles must follow Electron updates rather than pinning an old identity')
  assert.equal(env.requests[0].init.headers['User-Agent'], ua)
  assert.ok(env.browser.preserved, 'completion must preserve the profile before the abort signal runs')
  assert.ok(!env.exports.at(-1).includes('google-session'), 'playback-cookie export remains scoped to YouTube')
  assert.ok(active.cleared)
  candidate.setUserAgent('Updated native Electron identity')
  const restored = env.makeManager()
  const auth = await restored.credentials()
  await auth.fetchImpl('https://music.youtube.com/')
  assert.equal(env.requests.at(-1).init.headers['User-Agent'], 'Updated native Electron identity')
  assert.equal(candidate.storage.login, 'persistent-website-state')
  await restored.disconnect()
  assert.deepEqual(await candidate.cookies.get(), [])
  assert.deepEqual(candidate.storage, {})
  assert.equal(env.exports.at(-1), '')
})

test('native account verification rechecks a changed website cookie snapshot before activation', async () => {
  const env = environment({ native: true })
  const releases = []
  env.provider.fetchAccountData = async auth => {
    await auth.fetchImpl('https://music.youtube.com/')
    await new Promise(resolve => releases.push(resolve))
    return { authenticated: true }
  }
  const login = env.manager.signIn()
  await tick()
  await env.candidate().cookies.set(browserCookies('native-account')[0])
  env.navigate('https://music.youtube.com/')
  await tick()
  env.candidate().rotate()
  releases[0]()
  await tick()
  assert.equal(env.settings.yt_account_session, '0')
  assert.equal(releases.length, 2)
  releases[1]()
  assert.equal((await login).authenticated, true)
  assert.match(env.exports.at(-1), /SAPISID=session-two/)
})

test('cancelled native login clears only the candidate full profile', async () => {
  const env = environment({ connected: true, authenticated: false, native: true })
  const active = env.session()
  active.storage.login = 'verified-website-state'
  const login = env.manager.signIn()
  await tick()
  const candidate = env.candidate()
  candidate.storage.login = 'unverified-website-state'
  await candidate.cookies.set(browserCookies('unverified-account')[0])
  env.navigate('https://music.youtube.com/')
  await tick()
  env.manager.cancelSignIn()
  assert.equal((await login).cancelled, true)
  assert.equal((await active.cookies.get())[0].value, 'session-one')
  assert.equal(active.storage.login, 'verified-website-state')
  assert.deepEqual(await candidate.cookies.get(), [])
  assert.deepEqual(candidate.storage, {})
  assert.deepEqual(env.exports, [])
})

test('real-browser cookies are staged separately and activated only after authenticated Music API verification', async () => {
  const env = environment()
  const progress = []
  const login = env.manager.signIn({ onProgress: status => progress.push(status.message) })
  await tick()
  env.capture({ 'X-Goog-AuthUser': '2', 'X-Goog-PageId': 'brand', 'X-YouTube-Client-Version': '1.browser', Cookie: 'do-not-store', Authorization: 'do-not-store' })
  assert.equal(env.settings.yt_account_context, undefined)
  assert.deepEqual(env.exports, [])
  env.snapshot.cookies.push({ name: 'unrelated', value: 'do-not-import', domain: '.google.com' })
  env.navigate('https://music.youtube.com/')
  await tick()
  assert.deepEqual(progress, [], 'candidate verification must not report an internal error')
  assert.equal((await login).authenticated, true)
  assert.match(env.settings.yt_account_partition, /^persist:lokal-ytmusic-/)
  assert.deepEqual(JSON.parse(env.settings.yt_account_context), { 'x-goog-authuser': '2', 'x-goog-pageid': 'brand', 'x-youtube-client-version': '1.browser' })
  assert.equal(env.requests[0].init.headers['X-Goog-AuthUser'], '2')
  assert.equal(JSON.parse(env.requests[0].init.body).context.user.onBehalfOfUser, 'brand')
  assert.ok(!env.exports.at(-1).includes('do-not-import'))
  assert.equal(env.session().getUserAgent(), env.snapshot.userAgent)
  const reopened = env.makeManager()
  const auth = await reopened.credentials()
  assert.equal(youtube.accountHeaders(auth.cookies)['X-Goog-PageId'], 'brand')
  assert.ok(env.browser.closed)
})

test('failed or cancelled account switching never alters the active jar or context and never exports candidate cookies', async () => {
  for (const verify of [false, true]) {
    const env = environment({ connected: true, authenticated: false })
    const active = { 'x-goog-authuser': '2', 'x-goog-pageid': 'verified-brand' }
    env.settings.yt_account_context = JSON.stringify(active)
    const oldJar = env.session()
    const login = env.manager.signIn()
    await tick()
    env.capture({ 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'candidate-brand' })
    if (verify) { env.navigate('https://music.youtube.com/'); await tick(); assert.equal(env.requests.at(-1).init.headers['X-Goog-AuthUser'], '3') }
    env.close()
    assert.equal((await login).cancelled, true)
    assert.deepEqual(JSON.parse(env.settings.yt_account_context), active)
    assert.equal(env.session(), oldJar)
    assert.equal((await oldJar.cookies.get())[0].value, 'session-one')
    assert.deepEqual(env.exports, [])
  }
})

test('cookie presence alone does not complete sign-in, and explicit cancel clears the candidate', async () => {
  const env = environment({ authenticated: false })
  const login = env.manager.signIn()
  await tick()
  env.navigate('https://music.youtube.com/')
  await tick()
  assert.equal(env.settings.yt_account_session, '0')
  assert.equal(env.browser.closed, false)
  env.manager.cancelSignIn()
  assert.equal((await login).cancelled, true)
  assert.equal((await env.candidate().cookies.get()).length, 0)
})

test('a changing candidate context is reverified before promotion and invalidates old credential handles', async () => {
  const env = environment({ connected: true })
  const active = { 'x-goog-authuser': '2', 'x-goog-pageid': 'verified-brand' }
  env.settings.yt_account_context = JSON.stringify(active)
  const releases = []
  env.provider.fetchAccountData = async auth => {
    await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: '{}' })
    await new Promise(resolve => releases.push(resolve))
    return { authenticated: true }
  }
  const login = env.manager.signIn()
  await tick()
  env.capture({ 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'candidate-brand' })
  env.navigate('https://music.youtube.com/')
  await tick()
  env.capture({ 'X-Goog-AuthUser': '0', 'X-YouTube-Client-Version': '1.personal' })
  releases[0]()
  await tick()
  assert.deepEqual(JSON.parse(env.settings.yt_account_context), active)
  assert.equal(env.requests.at(-1).init.headers['X-Goog-AuthUser'], '0')
  const oldHandle = await env.manager.credentials()
  releases[1]()
  assert.equal((await login).authenticated, true)
  assert.deepEqual(JSON.parse(env.settings.yt_account_context), { 'x-goog-authuser': '0', 'x-youtube-client-version': '1.personal' })
  await assert.rejects(oldHandle.fetchImpl('https://music.youtube.com/'), /session changed/)
})

test('disconnect during candidate flushing prevents activation and removes playback cookies', async () => {
  const env = environment({ connected: true })
  const login = env.manager.signIn()
  await tick()
  let release
  env.candidate().cookies.flushStore = () => new Promise(resolve => { release = resolve })
  env.navigate('https://music.youtube.com/')
  await tick()
  assert.equal(typeof release, 'function')
  await env.manager.disconnect()
  release()
  await tick()
  assert.equal((await login).cancelled, true)
  assert.equal(env.settings.yt_account_session, '0')
  assert.equal(env.settings.yt_account_partition, '')
  assert.equal(env.exports.at(-1), '')
  assert.equal((await env.manager.credentials()).cookies, '')
})

test('cookie transfer retains domain, path, expiry, HttpOnly and SameSite semantics', () => {
  const cookie = sessions.electronCookie(browserCookies('test')[0])
  assert.equal(cookie.domain, '.youtube.com')
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.sameSite, 'no_restriction')
  assert.equal(cookie.expirationDate, 2000000000)
  const hostOnly = sessions.electronCookie({ name: 'session', value: 'test', domain: 'music.youtube.com', path: '/', session: true })
  assert.equal(hostOnly.domain, undefined)
  assert.equal(hostOnly.expirationDate, undefined)
})

test('a browser launch failure reports an error and leaves the verified account untouched', async () => {
  const env = environment({ connected: true, launchError: true })
  env.settings.yt_account_context = JSON.stringify({ 'x-goog-authuser': '2' })
  const result = await env.manager.signIn()
  assert.match(result.error, /Could not start an isolated sign-in browser/)
  assert.equal(result.cancelled, undefined)
  assert.equal(env.settings.yt_account_session, '1')
  assert.deepEqual(JSON.parse(env.settings.yt_account_context), { 'x-goog-authuser': '2' })
  assert.deepEqual(env.exports, [])
})

test('a login window failure preserves the active account and releases the candidate', async () => {
  const env = environment({ connected: true })
  const active = env.session()
  const login = env.manager.signIn({ mode: 'embedded' })
  await tick()
  env.fail(new Error('The sign-in window stopped responding'))
  const result = await login
  assert.match(result.error, /stopped responding/)
  assert.equal(result.cancelled, undefined)
  assert.equal(env.settings.yt_account_session, '1')
  assert.equal((await active.cookies.get())[0].value, 'session-one')
  assert.equal((await env.candidate().cookies.get()).length, 0)
  assert.deepEqual(env.exports, [])
})

test('unknown sign-in modes cannot launch a window or change credentials', async () => {
  const env = environment({ connected: true })
  const auth = await env.manager.credentials()
  assert.match((await env.manager.signIn({ mode: 'unknown' })).error, /Unknown/)
  assert.equal(env.partitions.size, 1)
  await auth.fetchImpl('https://music.youtube.com/')
})
