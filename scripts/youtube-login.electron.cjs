// Run with Electron, not Node. Every window is hidden and every HTTP(S) request
// is answered locally; this fixture never opens Google or a desktop browser.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const { configureLoginIdentity } = require('../electron/online/youtubeLoginIdentity')
const { openEmbeddedYouTubeLogin } = require('../electron/online/youtubeEmbeddedLogin')
const { createYouTubeSession, PARTITION } = require('../electron/online/youtubeSession')
const youtube = require('../electron/online/youtube')

app.commandLine.appendSwitch('enable-automation')
configureLoginIdentity(app)
const directory = fs.mkdtempSync(path.join(process.env.LOKAL_LOGIN_TEST_TMP || os.tmpdir(), 'lokal-login-fixture-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
const timeout = setTimeout(() => { console.error('Hidden Electron login fixture timed out.'); app.exit(1) }, 25000)

const MUSIC = 'https://music.youtube.com'
const COOKIE_EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
const partitions = new Map(), windows = [], unexpectedRequests = [], preloadErrors = []
let failLogin = false, visibleWindows = 0
let stage = 'startup'
const html = `<html><head><script>
  window.firstScript = {
    webdriver: navigator.webdriver,
    getter: String(Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver').get),
    ownWebdriver: Object.hasOwn(navigator, 'webdriver'),
    node: typeof require, process: typeof process, app: typeof window.electron,
    userAgent: navigator.userAgent,
  };
  const config = { SESSION_INDEX: 3, DELEGATED_SESSION_ID: 'fixture-brand', VISITOR_DATA: 'fixture-visitor', INNERTUBE_CLIENT_VERSION: '1.fixture' };
  window.ytcfg = { get: key => config[key] };
</script></head><body>Local login fixture</body></html>`
const runtime = {
  app,
  session: { fromPartition: id => {
    if (partitions.has(id)) return partitions.get(id)
    const jar = session.fromPartition(id)
    const respond = request => {
      const url = new URL(request.url)
      if (!['accounts.google.com', 'music.youtube.com'].includes(url.hostname)) unexpectedRequests.push(request.url)
      if (failLogin && url.hostname === 'accounts.google.com') return Response.error()
      return new Response(url.pathname.startsWith('/youtubei/') ? '{}' : html, { headers: { 'content-type': url.pathname.startsWith('/youtubei/') ? 'application/json' : 'text/html' } })
    }
    jar.protocol.handle('https', respond)
    jar.protocol.handle('http', respond)
    partitions.set(id, jar)
    return jar
  } },
  BrowserWindow: class {
    constructor(options) {
      const window = new BrowserWindow({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } })
      window.on('show', () => { visibleWindows++ })
      window.webContents.on('preload-error', (_event, _path, error) => preloadErrors.push(error.message))
      windows.push(window)
      return window
    }
  },
}
const waitFor = async (predicate, label) => {
  const end = Date.now() + 8000
  while (!(await predicate())) {
    if (Date.now() >= end) throw new Error(`Timed out: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
const seed = async (jar, value) => {
  await jar.cookies.set({ url: MUSIC, domain: '.youtube.com', path: '/', name: 'SAPISID', value, httpOnly: true, secure: true, sameSite: 'no_restriction', expirationDate: COOKIE_EXPIRY })
  await jar.cookies.set({ url: MUSIC, domain: '.youtube.com', path: '/', name: 'SID', value: 'fixture-login', secure: true })
}

app.whenReady().then(async () => {
  let manager
  try {
    stage = 'standalone login initialization'
    const login = await openEmbeddedYouTubeLogin({ electron: runtime })
    const window = windows.at(-1), jar = window.webContents.session
    const first = await window.webContents.executeJavaScript('window.firstScript')
    assert.equal(first.webdriver, false)
    assert.match(first.getter, /=> false/, 'the document-start main-world preload must run before the first inline script')
    assert.equal(first.ownWebdriver, false)
    assert.equal(first.node, 'undefined')
    assert.equal(first.process, 'undefined')
    assert.equal(first.app, 'undefined')
    assert.doesNotMatch(first.userAgent, /Electron|lokal/i)
    const preferences = window.webContents.getLastWebPreferences()
    assert.equal(preferences.sandbox, true)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.webSecurity, true)

    await seed(jar, 'fixture-snapshot')
    stage = 'standalone Music navigation'
    await window.loadURL(MUSIC)
    const snapshot = await login.read()
    assert.equal(snapshot.context['x-goog-authuser'], '3')
    assert.equal(snapshot.context['x-goog-pageid'], 'fixture-brand')
    assert.equal(snapshot.cookies.find(cookie => cookie.name === 'SAPISID').expires, COOKIE_EXPIRY)
    assert.equal(snapshot.cookies.find(cookie => cookie.name === 'SAPISID').sameSite, 'None')
    assert.equal((await window.webContents.executeJavaScript('window.firstScript')).webdriver, false)
    const originalURL = window.webContents.getURL()
    await window.webContents.executeJavaScript("document.body.innerHTML += '<a id=blocked href=https://example.com/>Blocked</a>'; document.getElementById('blocked').click()")
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(window.webContents.getURL(), originalURL)
    await window.webContents.executeJavaScript("window.open('https://example.com/')")
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(windows.length, 1)
    await login.close()
    assert.equal((await jar.cookies.get({ url: MUSIC })).length, 0)

    const plain = new runtime.BrowserWindow({ webPreferences: { session: runtime.session.fromPartition('fixture-plain'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
    stage = 'unrelated window navigation'
    await plain.loadURL(MUSIC)
    const unmasked = await plain.webContents.executeJavaScript('window.firstScript')
    assert.match(unmasked.getter, /\[native code\]/, 'the preload mask must not leak into unrelated windows')
    plain.destroy()

    const settings = { yt_account_session: '1', yt_account_context: JSON.stringify({ 'x-goog-authuser': '2', 'x-goog-pageid': 'old-account' }) }
    const active = runtime.session.fromPartition(PARTITION)
    await seed(active, 'active-account')
    const exports = [], requests = [], statuses = []
    let authenticated = false
    manager = createYouTubeSession({
      electron: runtime, getSettings: () => settings, saveSettings: values => Object.assign(settings, values), syncCookies: header => exports.push(header),
      provider: { ...youtube, fetchAccountData: async auth => {
        requests.push(JSON.parse(auth.cookies))
        const response = await auth.fetchImpl(`${MUSIC}/youtubei/v1/browse`, { method: 'POST', body: JSON.stringify({ context: { client: {} } }) })
        assert.ok(response.ok)
        return { authenticated, ...(authenticated ? {} : { error: 'Fixture account is not authenticated' }) }
      } },
    })

    stage = 'unverified default login'
    let result = manager.signIn({ onProgress: status => statuses.push(status) }) // Exercise the real default adapter, not an injection.
    await waitFor(() => statuses.length > 0, 'initial local login ready')
    let candidateWindow = windows.at(-1), candidate = candidateWindow.webContents.session
    await seed(candidate, 'unverified-account')
    await candidateWindow.loadURL(MUSIC)
    await waitFor(() => requests.length > 0, 'unverified Music API check')
    assert.equal(settings.yt_account_partition, undefined)
    assert.equal(JSON.parse(settings.yt_account_context)['x-goog-pageid'], 'old-account')
    assert.equal((await active.cookies.get({ url: MUSIC })).find(cookie => cookie.name === 'SAPISID').value, 'active-account')
    assert.deepEqual(exports, [])
    manager.cancelSignIn()
    assert.equal((await result).cancelled, true)
    await waitFor(async () => !(await candidate.cookies.get({ url: MUSIC })).length, 'cancelled jar cleanup')

    stage = 'verified default login'
    authenticated = true
    statuses.length = 0
    result = manager.signIn({ mode: 'embedded', onProgress: status => statuses.push(status) })
    await waitFor(() => statuses.length > 0, 'second local login ready')
    candidateWindow = windows.at(-1)
    candidate = candidateWindow.webContents.session
    await seed(candidate, 'verified-account')
    // Verification can complete at did-navigate and close the window before
    // loadURL's did-finish-load promise resolves.
    const navigation = candidateWindow.loadURL(MUSIC).catch(error => error)
    assert.equal((await result).authenticated, true)
    const navigationResult = await navigation
    if (navigationResult instanceof Error) assert.ok(['ERR_FAILED', 'ERR_ABORTED'].includes(navigationResult.code))
    assert.match(settings.yt_account_partition, /^persist:lokal-ytmusic-/)
    assert.equal(JSON.parse(settings.yt_account_context)['x-goog-authuser'], '3')
    assert.equal(JSON.parse(settings.yt_account_context)['x-goog-pageid'], 'fixture-brand')
    assert.match(exports.at(-1), /SAPISID=verified-account/)
    assert.notEqual(partitions.get(settings.yt_account_partition), candidate, 'login and verified jars must be independent')
    await waitFor(async () => !(await candidate.cookies.get({ url: MUSIC })).length, 'successful login cleanup')
    await waitFor(async () => !(await active.cookies.get({ url: MUSIC })).length, 'old verified jar cleanup')

    const savedPartition = settings.yt_account_partition
    stage = 'failed default login'
    failLogin = true
    const failed = await manager.signIn()
    assert.equal(failed.authenticated, false)
    assert.ok(failed.error)
    assert.equal(failed.cancelled, undefined)
    assert.equal(settings.yt_account_partition, savedPartition)
    assert.equal((await partitions.get(savedPartition).cookies.get({ url: MUSIC })).find(cookie => cookie.name === 'SAPISID').value, 'verified-account')
    assert.deepEqual(unexpectedRequests, [])
    assert.deepEqual(preloadErrors, [])
    assert.equal(visibleWindows, 0)
    console.log('Hidden Electron login fixture passed: document-start masking, isolated sandbox, no app APIs, scoped cookies/context, blocked external navigation/popups, verified-only activation, cancellation, load errors, and no visible windows or external requests.')
  } finally {
    manager?.cancelSignIn()
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    for (const jar of partitions.values()) await jar.clearStorageData()
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
}).then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => { clearTimeout(timeout); console.error(`Fixture failed during ${stage}:`, error); app.exit(1) })
