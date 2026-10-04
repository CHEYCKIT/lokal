import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import identity from '../electron/online/youtubeLoginIdentity.js'
import embedded from '../electron/online/youtubeEmbeddedLogin.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
function environment({ loadError } = {}) {
  const partitions = [], windows = [], progress = [], errors = []
  let changes = 0, closures = 0
  const app = new EventEmitter()
  const electron = { app, session: { fromPartition: id => {
    let ua = 'Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36 lokal-music/4.1.0 Electron/44.5.1'
    const cookies = Object.assign(new EventEmitter(), { values: [], get: async () => cookies.values })
    const session = {
      cookies, getUserAgent: () => ua, setUserAgent: value => { ua = value },
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
    async loadURL(url) { this.loads.push(url); if (loadError) throw new Error(loadError) }
  } }
  const controller = new AbortController()
  const open = () => embedded.openEmbeddedYouTubeLogin({ electron, signal: controller.signal, onChange: () => changes++, onClosed: () => closures++, onError: error => errors.push(error.message), onProgress: status => progress.push(status.message) })
  return { electron, partitions, windows, controller, open, progress, errors, changes: () => changes, closures: () => closures }
}

test('the automation switch is merged before startup dependencies or app readiness', () => {
  let value = 'OtherFeature, AutomationControlled'
  const app = { commandLine: { getSwitchValue: () => value, appendSwitch: (name, next) => { assert.equal(name, 'disable-blink-features'); value = next } } }
  identity.configureLoginIdentity(app)
  identity.configureLoginIdentity(app)
  assert.equal(value, 'OtherFeature,AutomationControlled')
  value = 'ExistingFeature'
  const stop = new Error('Stop before startup dependencies')
  assert.throws(() => vm.runInNewContext(readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8'), {
    require: name => {
      if (name === 'electron') return { app }
      if (name === './online/youtubeLoginIdentity') return identity
      assert.equal(value, 'ExistingFeature,AutomationControlled')
      throw stop
    },
  }), error => error === stop)
})

test('each embedded login gets an independent temporary jar and a dedicated sandboxed preload', async () => {
  const env = environment()
  const first = await env.open(), second = await env.open()
  assert.equal(env.partitions.length, 2)
  assert.notEqual(env.partitions[0].id, env.partitions[1].id)
  assert.match(env.partitions[0].id, /^lokal-ytmusic-login-/)
  for (const window of env.windows) {
    const preferences = window.options.webPreferences
    assert.equal(preferences.session, env.partitions[env.windows.indexOf(window)].session)
    assert.equal(preferences.sandbox, true)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.webSecurity, true)
    assert.match(preferences.preload, /youtubeLoginPreload\.js$/)
    assert.equal(window.menu, null)
    assert.doesNotMatch(preferences.session.getUserAgent(), /Electron|lokal/)
  }
  await first.close()
  await second.close()
  assert.equal(env.closures(), 0, 'programmatic completion is not user cancellation')
  assert.equal(env.electron.app.listenerCount('before-quit'), 0)
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
  assert.equal(window.loads.length, 1)
  assert.deepEqual(window.popup({ url: 'https://accounts.google.com/next' }), { action: 'deny' })
  assert.equal(window.loads.at(-1), 'https://accounts.google.com/next')
  let frameBlocked = false
  window.webContents.emit('will-redirect', { url: 'https://www.gstatic.com/', isMainFrame: false, preventDefault: () => { frameBlocked = true } })
  assert.equal(frameBlocked, false, 'Google subresources can redirect without replacing the top-level login page')
  await login.close()
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
  await assert.rejects(env.open(), /ERR_CONNECTION_FAILED/)
  assert.ok(env.windows[0].destroyed)
  assert.ok(env.partitions[0].session.cleared)
  assert.equal(env.closures(), 0)
  assert.equal(env.electron.app.listenerCount('before-quit'), 0)
})

test('later load, preload, and renderer failures terminate the isolated login with useful errors', async () => {
  for (const event of ['did-fail-load', 'preload-error', 'render-process-gone']) {
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
