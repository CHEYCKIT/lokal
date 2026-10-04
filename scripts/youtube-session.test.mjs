import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import sessions from '../electron/online/youtubeSession.js'
import youtube from '../electron/online/youtube.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
function environment({ connected = false, authenticated = true } = {}) {
  const settings = { yt_account_session: connected ? '1' : '0' }
  let cookieValue = 'session-one'
  let ua = 'Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36 lokal-music/4.1.0 Electron/44.5.1'
  const requests = []
  const exports = []
  const cookies = Object.assign(new EventEmitter(), {
    get: async () => [{ name: 'SAPISID', value: cookieValue }, { name: 'SID', value: 'test-login' }], flushStore: async () => {},
  })
  const session = {
    cookies, getUserAgent: () => ua, setUserAgent: value => { ua = value },
    webRequest: { onBeforeSendHeaders: (filter, callback) => { session.capture = callback } },
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({}) } },
    clearStorageData: async () => { session.cleared = true },
  }
  const windows = []
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false
      this.webContents = Object.assign(new EventEmitter(), { id: 7, getURL: () => this.url, setWindowOpenHandler: callback => { this.popupHandler = callback } })
      windows.push(this)
    }
    setMenu() {} show() {} focus() {}
    loadURL(url) { this.url = url; return Promise.resolve() }
    isDestroyed() { return this.destroyed }
    close() { this.destroyed = true; this.emit('closed') }
  }
  const provider = { ...youtube, fetchAccountData: async auth => {
    await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: JSON.stringify({ context: { client: { clientVersion: 'initial' } } }) })
    return { authenticated, ...(authenticated ? { home: [{ title: 'Personal Song', artist: 'Artist' }] } : { error: 'Not authenticated' }) }
  } }
  const manager = sessions.createYouTubeSession({
    electron: { session: { fromPartition: partition => { assert.equal(partition, sessions.PARTITION); return session } }, BrowserWindow },
    getSettings: () => settings, saveSettings: values => Object.assign(settings, values), provider, syncCookies: header => exports.push(header),
  })
  return { manager, settings, session, provider, requests, exports, windows, rotate: () => { cookieValue = 'session-two' } }
}

test('session requests use fresh signed authorization, matching UA, selected-account context and Chromium cookie rotation', async () => {
  const env = environment({ connected: true })
  env.settings.yt_account_context = JSON.stringify({ 'x-goog-authuser': '2', 'x-goog-pageid': 'saved-brand', 'x-youtube-client-version': '1.saved' })
  const auth = await env.manager.credentials()
  assert.ok(!env.session.getUserAgent().includes('Electron'))
  assert.ok(!env.session.getUserAgent().includes('lokal'))
  await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: '{}' })
  env.rotate()
  await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: '{}' })
  assert.notEqual(env.requests[0].init.headers.Authorization, env.requests[1].init.headers.Authorization, 'a rotated session gets a new signature without a manual reconnect')
  assert.equal(env.requests[0].init.credentials, 'include')
  assert.equal(env.requests[0].init.headers.Cookie, undefined)
  assert.equal(env.requests[0].init.headers['User-Agent'], env.session.getUserAgent())
  assert.equal(env.requests[0].init.headers['X-Goog-AuthUser'], '2', 'the first request after restart must use the saved verified context')
  assert.equal(env.requests[0].init.headers['X-Goog-PageId'], 'saved-brand')
  assert.equal(env.requests[0].init.headers['X-YouTube-Client-Version'], '1.saved')
  await assert.rejects(auth.fetchImpl('https://example.com/'), /Unexpected.*origin/)
})

test('login uses a plain isolated window and succeeds only after authenticated API verification', async () => {
  const env = environment()
  const login = env.manager.signIn()
  const win = env.windows[0]
  assert.equal(win.options.title, 'Sign in to YouTube Music')
  assert.equal(win.options.webPreferences.nodeIntegration, false)
  assert.equal(win.options.webPreferences.preload, undefined)
  assert.equal(win.options.webPreferences.session, env.session)
  assert.ok(win.url.startsWith('https://accounts.google.com/ServiceLogin'))
  env.session.capture({ webContentsId: 7, requestHeaders: { 'X-Goog-AuthUser': '2', 'X-Goog-PageId': 'brand', 'X-YouTube-Client-Version': '1.browser.client', Cookie: 'do-not-store', Authorization: 'do-not-store' } }, () => {})
  assert.equal(env.settings.yt_account_context, undefined, 'captured headers stay staged until verification succeeds')
  win.url = 'https://music.youtube.com/'
  win.webContents.emit('did-finish-load')
  const result = await login
  assert.equal(result.authenticated, true)
  assert.equal(env.settings.yt_account_session, '1')
  assert.equal(env.settings.yt_cookie_browser, 'session')
  assert.deepEqual(JSON.parse(env.settings.yt_account_context), { 'x-goog-authuser': '2', 'x-goog-pageid': 'brand', 'x-youtube-client-version': '1.browser.client' })
  assert.ok(!env.settings.yt_account_context.includes('do-not-store'))
  assert.equal(win.destroyed, true)
  assert.equal(env.requests[0].init.headers['X-Goog-AuthUser'], '2')
  assert.equal(JSON.parse(env.requests[0].init.body).context.client.clientVersion, '1.browser.client')
  assert.equal(JSON.parse(env.requests[0].init.body).context.user.onBehalfOfUser, 'brand')
})

test('having cookies alone never marks a login successful; closing and disconnecting are handled', async () => {
  const env = environment({ authenticated: false })
  const login = env.manager.signIn()
  const win = env.windows[0]
  win.url = 'https://music.youtube.com/'
  win.webContents.emit('did-finish-load')
  await tick()
  assert.equal(win.destroyed, false)
  assert.equal(env.settings.yt_account_session, '0')
  win.close()
  assert.equal((await login).cancelled, true)
  await env.manager.disconnect()
  assert.equal(env.session.cleared, true)
  assert.equal(env.settings.yt_account_session, '0')
  assert.equal((await env.manager.credentials()).cookies, '')
  assert.equal(env.settings.yt_cookies, '0')
  assert.equal(env.exports.at(-1), '', 'disconnect removes the automatically exported playback cookies')
})

test('session API requests preserve bootstrapped context before the website captures it and discard old brand selections', async () => {
  const env = environment({ connected: true })
  const auth = await env.manager.credentials()
  await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', {
    method: 'POST', headers: { 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'bootstrapped-brand', 'X-Goog-Visitor-Id': 'visitor', 'X-YouTube-Client-Version': '1.bootstrapped' },
    body: JSON.stringify({ context: { client: { clientVersion: 'default' } } }),
  })
  const request = env.requests.at(-1).init
  assert.equal(request.headers['X-Goog-AuthUser'], '3')
  assert.equal(request.headers['X-Goog-PageId'], 'bootstrapped-brand')
  assert.equal(JSON.parse(request.body).context.client.clientVersion, '1.bootstrapped')
  assert.equal(JSON.parse(request.body).context.client.visitorData, 'visitor')
  const login = env.manager.signIn()
  env.session.capture({ webContentsId: 7, requestHeaders: { 'X-Goog-AuthUser': '2', 'X-Goog-PageId': 'old-brand' } }, () => {})
  env.session.capture({ webContentsId: 7, requestHeaders: { 'X-Goog-AuthUser': '0', 'X-YouTube-Client-Version': '1.personal' } }, () => {})
  env.windows[0].url = 'https://music.youtube.com/'
  env.windows[0].webContents.emit('did-finish-load')
  await login
  const personal = youtube.accountHeaders((await env.manager.credentials()).cookies)
  assert.equal(personal['X-Goog-AuthUser'], '0')
  assert.equal(personal['X-Goog-PageId'], undefined, 'a personal account must not inherit the previous brand identity')
  await assert.rejects(auth.fetchImpl('https://music.youtube.com/'), /session changed/)
})

test('disconnect during verification cannot restore connected settings or stale playback cookies', async () => {
  const env = environment()
  let releaseFlush
  env.session.cookies.flushStore = () => new Promise(resolve => { releaseFlush = resolve })
  const login = env.manager.signIn()
  const win = env.windows[0]
  win.url = 'https://music.youtube.com/'
  win.webContents.emit('did-finish-load')
  await tick()
  assert.equal(typeof releaseFlush, 'function')
  await env.manager.disconnect()
  releaseFlush()
  await tick()
  assert.equal((await login).cancelled, true)
  assert.equal(env.settings.yt_account_session, '0')
  assert.equal(env.exports.at(-1), '')
})

test('main-frame failures report an error and the default retry restores the real Chromium user-agent', async () => {
  const env = environment()
  const failed = env.manager.signIn({ compatibility: true })
  assert.match(env.session.getUserAgent(), /Firefox/)
  env.windows[0].webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://accounts.google.com/', true)
  assert.match((await failed).error, /ERR_NAME_NOT_RESOLVED/)
  const retry = env.manager.signIn()
  assert.match(env.session.getUserAgent(), /Chrome/)
  assert.doesNotMatch(env.session.getUserAgent(), /Electron|lokal|Firefox/)
  env.windows[1].close()
  assert.equal((await retry).cancelled, true)
})

test('cancelled or failed account switches preserve the verified context and discard the candidate', async () => {
  for (const failure of ['cancel', 'verification', 'load']) {
    const env = environment({ connected: true, authenticated: false })
    const active = { 'x-goog-authuser': '2', 'x-goog-pageid': 'verified-brand', 'x-youtube-client-version': '1.verified' }
    env.settings.yt_account_context = JSON.stringify(active)
    const login = env.manager.signIn()
    const win = env.windows[0]
    env.session.capture({ webContentsId: 7, requestHeaders: { 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'unverified-brand' } }, () => {})
    assert.deepEqual(JSON.parse(env.settings.yt_account_context), active, 'capturing candidate headers must not replace persisted authority')
    const during = youtube.accountHeaders((await env.manager.credentials()).cookies)
    assert.equal(during['X-Goog-AuthUser'], '2')
    assert.equal(during['X-Goog-PageId'], 'verified-brand')
    if (failure === 'verification') {
      win.url = 'https://music.youtube.com/'
      win.webContents.emit('did-finish-load')
      await tick()
      assert.equal(env.requests.at(-1).init.headers['X-Goog-AuthUser'], '3', 'verification uses the staged candidate, not the active account')
      assert.equal(win.destroyed, false)
    }
    if (failure === 'load') win.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', win.url, true)
    else win.close()
    const result = await login
    assert.equal(result.authenticated, false)
    assert.equal(env.settings.yt_account_session, '1')
    assert.deepEqual(JSON.parse(env.settings.yt_account_context), active)
    const after = youtube.accountHeaders((await env.manager.credentials()).cookies)
    assert.equal(after['X-Goog-AuthUser'], '2')
    assert.equal(after['X-Goog-PageId'], 'verified-brand')
  }
})

test('a context change during verification requires verification of the new snapshot before promotion', async () => {
  const env = environment({ connected: true })
  const active = { 'x-goog-authuser': '2', 'x-goog-pageid': 'verified-brand' }
  env.settings.yt_account_context = JSON.stringify(active)
  const releases = []
  env.provider.fetchAccountData = async auth => {
    await auth.fetchImpl('https://music.youtube.com/youtubei/v1/browse', { method: 'POST', body: JSON.stringify({ context: { client: {} } }) })
    await new Promise(resolve => releases.push(resolve))
    return { authenticated: true }
  }
  const login = env.manager.signIn()
  const win = env.windows[0]
  env.session.capture({ webContentsId: 7, requestHeaders: { 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'candidate-brand' } }, () => {})
  win.url = 'https://music.youtube.com/'
  win.webContents.emit('did-finish-load')
  await tick()
  env.session.capture({ webContentsId: 7, requestHeaders: { 'X-Goog-AuthUser': '0', 'X-YouTube-Client-Version': '1.personal' } }, () => {})
  releases[0]()
  await tick()
  assert.equal(win.destroyed, false, 'the first verified response cannot authorize a different captured context')
  assert.deepEqual(JSON.parse(env.settings.yt_account_context), active)
  assert.equal(env.requests.at(-1).init.headers['X-Goog-AuthUser'], '0')
  const oldHandle = await env.manager.credentials()
  releases[1]()
  assert.equal((await login).authenticated, true)
  assert.deepEqual(JSON.parse(env.settings.yt_account_context), { 'x-goog-authuser': '0', 'x-youtube-client-version': '1.personal' })
  const personal = youtube.accountHeaders((await env.manager.credentials()).cookies)
  assert.equal(personal['X-Goog-AuthUser'], '0')
  assert.equal(personal['X-Goog-PageId'], undefined)
  await assert.rejects(oldHandle.fetchImpl('https://music.youtube.com/'), /session changed/, 'handles bound to the previous active context cannot survive promotion')
})
