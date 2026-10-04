import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import embedded from '../electron/online/youtubeEmbeddedLogin.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const nativeUA = 'Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36 lokal-music/4.1.0 Electron/44.5.1'
function environment({ loadError, holdLoad = false } = {}) {
  const partitions = [], windows = [], progress = [], errors = []
  let changes = 0, closures = 0
  const app = new EventEmitter()
  const electron = { app, session: { fromPartition: id => {
    let ua = nativeUA
    const cookies = Object.assign(new EventEmitter(), { values: [], get: async () => cookies.values })
    const session = {
      cookies, getUserAgent: () => ua, setUserAgent: value => { ua = value; session.uaChanges = (session.uaChanges || 0) + 1 },
      webRequest: { onBeforeSendHeaders: (filter, listener) => { session.capture = listener || filter } },
      clearStorageData: async () => { cookies.values = []; session.cleared = true },
    }
    partitions.push({ id, session })
    return session
  } }, BrowserWindow: class extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.loads = []
      this.webContents = Object.assign(new EventEmitter(), {
        id: windows.length + 1,
        getURL: () => this.loads.at(-1),
        setWindowOpenHandler: handler => { this.popup = handler },
        executeJavaScript: async () => ({ 'x-goog-authuser': '2', 'x-goog-pageid': 'page-account', 'x-youtube-client-version': '1.page' }),
      })
      windows.push(this)
    }
    setMenu(menu) { this.menu = menu }
    show() {}
    focus() {}
    isDestroyed() { return !!this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
    async loadURL(url) {
      this.loads.push(url)
      this.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      if (holdLoad) return new Promise(() => {})
      if (loadError) {
        this.webContents.emit('did-fail-load', {}, -105, loadError, url, true)
        throw new Error(loadError)
      }
      this.webContents.emit('did-finish-load')
    }
  } }
  const controller = new AbortController()
  const open = (options = {}) => embedded.openEmbeddedYouTubeLogin({ electron, signal: controller.signal, onChange: () => changes++, onClosed: () => closures++, onError: error => errors.push(error.message), onProgress: status => progress.push(status.message), ...options })
  return { electron, partitions, windows, controller, open, progress, errors, changes: () => changes, closures: () => closures }
}

test('site-first login uses a separate persistent jar, native identity, and a sandboxed window without app preload', async () => {
  const env = environment()
  const first = await env.open(), second = await env.open()
  assert.equal(env.partitions.length, 2)
  assert.notEqual(env.partitions[0].id, env.partitions[1].id)
  assert.match(env.partitions[0].id, /^persist:lokal-ytmusic-/)
  for (const window of env.windows) {
    const preferences = window.options.webPreferences
    assert.equal(preferences.session, env.partitions[env.windows.indexOf(window)].session)
    assert.equal(preferences.sandbox, true)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.webSecurity, true)
    assert.equal(preferences.preload, undefined)
    assert.equal(window.menu, null)
    assert.equal(preferences.session.getUserAgent(), nativeUA)
    assert.equal(preferences.session.uaChanges, undefined)
    assert.equal(window.loads[0], 'https://music.youtube.com/')
  }
  assert.ok(env.progress[0].includes('Use Sign in on the YouTube Music page'))
  await first.close()
  await second.close()
  assert.equal(env.closures(), 0, 'programmatic completion is not user cancellation')
  assert.equal(env.electron.app.listenerCount('before-quit'), 0)
})

test('the verified persistent profile retains Google cookies and website storage when the window closes', async () => {
  const env = environment(), login = await env.open()
  const session = env.partitions[0].session
  session.cookies.values = [{ domain: '.google.com', name: 'SID', value: 'google-session' }]
  session.storage = { login: 'website-state' }
  await login.close({ preserveSession: true })
  env.controller.abort()
  assert.equal(session.cleared, undefined, 'closing after activation must not erase the verified profile')
  assert.equal(session.cookies.values[0].value, 'google-session')
  const reopened = await env.open({ session, signal: new AbortController().signal })
  assert.equal(reopened.session, session)
  assert.equal(env.partitions.length, 1)
  assert.equal(reopened.session.storage.login, 'website-state')
  await reopened.close()
})

test('Music snapshots retain only account context and scoped cookies with transfer semantics', async () => {
  const env = environment(), login = await env.open()
  const { session } = env.partitions[0], window = env.windows[0]
  await window.loadURL('https://music.youtube.com/')
  session.cookies.values = [
    { domain: '.youtube.com', name: 'SAPISID', value: 'test', path: '/', httpOnly: true, secure: true, sameSite: 'no_restriction', expirationDate: 2000000000 },
    { domain: '.google.com', name: 'unrelated', value: 'do-not-import' },
  ]
  session.capture({ webContentsId: window.webContents.id, requestHeaders: { 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'selected-brand', Cookie: 'secret', Authorization: 'secret' } }, result => assert.equal(result.requestHeaders.Cookie, 'secret'))
  const snapshot = await login.read()
  assert.deepEqual(snapshot.context, { 'x-goog-authuser': '3', 'x-goog-pageid': 'selected-brand', 'x-youtube-client-version': '1.page' })
  assert.equal(snapshot.cookies.length, 1)
  assert.equal(snapshot.cookies[0].sameSite, 'None')
  assert.equal(snapshot.cookies[0].expires, 2000000000)
  const count = env.changes()
  window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.ok(env.changes() > count)
  assert.equal((await login.read()).url, 'about:blank', 'an unfinished document cannot authorize account access')
  window.webContents.emit('did-finish-load')
  assert.equal((await login.read()).context['x-goog-authuser'], '2', 'previous document context is discarded')
  await login.close()
  assert.equal(session.cookies.values.length, 0)
  assert.equal(session.capture, null)
})

test('login navigation blocks other origins and protocols and never creates unmanaged popups', async () => {
  const env = environment(), login = await env.open(), window = env.windows[0]
  for (const url of ['https://example.com/', 'https://google.com.example.com/', 'file:///tmp/a', 'lokal://lastfm-auth', 'http://accounts.google.com/']) {
    assert.equal(embedded.loginURL(url), false)
    let blocked = false
    window.webContents.emit('will-navigate', { url, isMainFrame: true, preventDefault: () => { blocked = true } })
    assert.ok(blocked)
    assert.deepEqual(window.popup({ url }), { action: 'deny' })
  }
  for (const url of ['https://accounts.google.co.uk/', 'https://accounts.google.co.in/', 'https://accounts.google.de/', 'https://consent.youtube.com/', 'https://www.youtube.com/signin?action_handle_signin=true']) assert.equal(embedded.loginURL(url), true)
  for (const url of ['https://accounts.google.evil/', 'https://accounts.google.co.uk.example.com/', 'https://accounts.google.uk/', 'https://user:pass@accounts.google.com/', 'https://accounts.google.com:444/']) assert.equal(embedded.loginURL(url), false)
  assert.equal(window.loads.length, 1)
  assert.deepEqual(window.popup({ url: 'https://accounts.google.com/next' }), { action: 'deny' })
  assert.equal(window.loads.at(-1), 'https://accounts.google.com/next')
  let frameBlocked = false
  window.webContents.emit('will-redirect', { url: 'https://www.gstatic.com/', isMainFrame: false, preventDefault: () => { frameBlocked = true } })
  assert.equal(frameBlocked, false, 'Google subresources can redirect without replacing the top-level login page')
  await login.close()
})

test('expiry-only cookie renewals do not loop verification, but cookie value changes and expiration do', async () => {
  const env = environment(), login = await env.open(), session = login.session
  const cookie = { domain: '.youtube.com', path: '/', name: 'SAPISID', value: 'account', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: 2000000000 }
  session.cookies.values = [cookie]
  await login.read()
  const before = env.changes()
  session.cookies.emit('changed', {}, cookie, 'overwrite', true)
  session.cookies.emit('changed', {}, { ...cookie, expirationDate: 2000000060 }, 'explicit', false)
  session.cookies.emit('changed', {}, { ...cookie, domain: '.google.com' }, 'explicit', false)
  assert.equal(env.changes(), before)
  session.cookies.emit('changed', {}, { ...cookie, value: 'new-account' }, 'explicit', false)
  assert.equal(env.changes(), before + 1)
  session.cookies.emit('changed', {}, cookie, 'expired', true)
  assert.equal(env.changes(), before + 2)
  await login.close()
})

test('regional premium redirects retain the Google to YouTube signin to Music handoff', async () => {
  const env = environment(), login = await env.open(), window = env.windows[0]
  for (const url of ['https://www.youtube.com/premium', 'https://youtube.com/musicpremium']) {
    let blocked = false
    window.webContents.emit('will-redirect', { url, isMainFrame: true, preventDefault: () => { blocked = true } })
    assert.ok(blocked)
    const google = new URL(window.loads.at(-1))
    assert.equal(google.origin, 'https://accounts.google.com')
    assert.equal(google.searchParams.get('service'), 'youtube')
    const youtube = new URL(google.searchParams.get('continue'))
    assert.equal(youtube.origin, 'https://www.youtube.com')
    assert.equal(youtube.pathname, '/signin')
    assert.equal(youtube.searchParams.get('action_handle_signin'), 'true')
    assert.equal(youtube.searchParams.get('app'), 'desktop')
    assert.equal(youtube.searchParams.get('next'), 'https://music.youtube.com/')
  }
  assert.deepEqual(env.errors, [])
  await login.close()
})

test('initial site loading stays cancellable without permitting premature account verification', async () => {
  const env = environment({ holdLoad: true }), login = await env.open()
  assert.equal((await login.read()).url, 'about:blank')
  env.controller.abort()
  await tick()
  assert.ok(env.windows[0].destroyed)
  assert.ok(env.partitions[0].session.cleared)
  assert.deepEqual(env.errors, [])
})

test('cancellation and user closure clear the login jar and remove observers', async () => {
  for (const action of ['abort', 'close']) {
    const env = environment(), login = await env.open()
    if (action === 'abort') env.controller.abort()
    else env.windows[0].destroy()
    await tick()
    assert.ok(env.partitions[0].session.cleared)
    assert.equal(env.partitions[0].session.cookies.listenerCount('changed'), 0)
    assert.equal(env.electron.app.listenerCount('before-quit'), 0)
    assert.equal(env.closures(), action === 'close' ? 1 : 0)
    await assert.rejects(login.read(), /window closed/)
  }
  const env = environment()
  env.controller.abort()
  await assert.rejects(env.open(), /cancelled/)
  assert.equal(env.windows.length, 0)
})

test('initial load failure reports an error and cleans up without pretending it was cancellation', async () => {
  const env = environment({ loadError: 'ERR_CONNECTION_FAILED' })
  const login = await env.open()
  await tick()
  assert.equal(env.errors.length, 1)
  assert.match(env.errors[0], /ERR_CONNECTION_FAILED/)
  await assert.rejects(login.read(), /window closed/)
  assert.ok(env.windows[0].destroyed)
  assert.ok(env.partitions[0].session.cleared)
  assert.equal(env.closures(), 0)
  assert.equal(env.electron.app.listenerCount('before-quit'), 0)
})

test('later load and renderer failures terminate the isolated login with useful errors', async () => {
  for (const event of ['did-fail-load', 'render-process-gone']) {
    const env = environment(), login = await env.open()
    if (event === 'did-fail-load') env.windows[0].webContents.emit(event, {}, -105, 'ERR_NAME_NOT_RESOLVED', '', true)
    else env.windows[0].webContents.emit(event)
    await tick()
    assert.equal(env.errors.length, 1)
    assert.match(env.errors[0], /sign-in/)
    assert.ok(env.partitions[0].session.cleared)
    assert.equal(env.closures(), 0)
    await assert.rejects(login.read(), /window closed/)
  }
})
