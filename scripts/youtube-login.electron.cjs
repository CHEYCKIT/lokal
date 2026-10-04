// Run with Electron, not Node. Every window is hidden and every HTTP(S) request
// is answered locally; this fixture never opens Google or a desktop browser.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const { openEmbeddedYouTubeLogin } = require('../electron/online/youtubeEmbeddedLogin')
const { createYouTubeSession, PARTITION } = require('../electron/online/youtubeSession')
const youtube = require('../electron/online/youtube')

const directory = process.env.LOKAL_LOGIN_TEST_DATA_DIR || fs.mkdtempSync(path.join(process.env.LOKAL_LOGIN_TEST_TMP || os.tmpdir(), 'lokal-login-fixture-'))
const prepareRestart = process.argv.includes('--prepare-profile')
const restoreRestart = process.argv.includes('--restore-profile')
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
const timeout = setTimeout(() => { console.error('Hidden Electron login fixture timed out.'); app.exit(1) }, 25000)

const MUSIC = 'https://music.youtube.com'
const COOKIE_EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
const partitions = new Map(), windows = [], unexpectedRequests = [], preloadErrors = []
let failLogin = false, visibleWindows = 0
let stage = 'startup'
let retainedSession
const handoff = new URL('https://www.youtube.com/signin?action_handle_signin=true&app=desktop')
handoff.searchParams.set('next', `${MUSIC}/`)
const googleLogin = new URL('https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube')
googleLogin.searchParams.set('continue', handoff.href)
const html = `<html><head><script>
  window.firstScript = {
    webdriver: navigator.webdriver,
    getter: String(Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver').get),
    ownWebdriver: Object.hasOwn(navigator, 'webdriver'),
    node: typeof require, process: typeof process, app: typeof window.electron,
    userAgent: navigator.userAgent,
    storage: localStorage.getItem('fixture-site-state'),
  };
  const config = { SESSION_INDEX: 3, DELEGATED_SESSION_ID: 'fixture-brand', VISITOR_DATA: 'fixture-visitor', INNERTUBE_CLIENT_VERSION: '1.fixture' };
  window.ytcfg = { get: key => config[key] };
</script></head><body>Local login fixture
  <a id="signin" href="${googleLogin.href.replaceAll('&', '&amp;')}">Sign in</a>
  <a id="finish" href="${handoff.href.replaceAll('&', '&amp;')}">Complete sign-in</a>
</body></html>`
const runtime = {
  app,
  session: { fromPartition: id => {
    if (partitions.has(id)) return partitions.get(id)
    const jar = session.fromPartition(id)
    const respond = request => {
      const url = new URL(request.url)
      if (!['accounts.google.com', 'accounts.google.co.uk', 'music.youtube.com', 'www.youtube.com'].includes(url.hostname)) unexpectedRequests.push(request.url)
      if (failLogin && url.hostname === 'music.youtube.com') return Response.error()
      if (url.hostname === 'www.youtube.com' && url.pathname === '/signin') return Response.redirect(`${MUSIC}/`)
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
  await jar.cookies.set({ url: 'https://accounts.google.com', domain: '.google.com', path: '/', name: 'SID', value: 'fixture-google-session', httpOnly: true, secure: true, expirationDate: COOKIE_EXPIRY })
}
const ready = window => waitFor(() => !window.isDestroyed() && window.webContents.getURL().startsWith(MUSIC) && !window.webContents.isLoadingMainFrame(), 'Music document ready')
const signIn = async (window, value) => {
  await ready(window)
  await window.webContents.executeJavaScript(`localStorage.setItem('fixture-site-state', '${value}-music-state'); document.getElementById('signin').click()`)
  await waitFor(() => window.webContents.getURL().startsWith('https://accounts.google.com/') && !window.webContents.isLoadingMainFrame(), 'website-initiated Google login')
  await window.webContents.executeJavaScript(`localStorage.setItem('fixture-site-state', '${value}-google-state')`)
  await seed(window.webContents.session, value)
}
const completeSignIn = window => window.webContents.executeJavaScript("document.getElementById('finish').click()")

async function checkRestoredProfile() {
  stage = 'restored profile'
  const settings = JSON.parse(fs.readFileSync(path.join(directory, 'fixture-settings.json'), 'utf8'))
  const jar = runtime.session.fromPartition(settings.yt_account_partition)
  assert.equal((await jar.cookies.get({ url: MUSIC })).find(cookie => cookie.name === 'SAPISID').value, 'verified-account')
  assert.equal((await jar.cookies.get({ url: 'https://accounts.google.com' })).find(cookie => cookie.name === 'SID').value, 'fixture-google-session')
  const manager = createYouTubeSession({ electron: runtime, getSettings: () => settings, saveSettings: values => Object.assign(settings, values), syncCookies: () => {} })
  const auth = await manager.credentials()
  assert.equal(JSON.parse(auth.cookies)['x-goog-pageid'], 'fixture-brand')
  assert.equal(JSON.parse(auth.cookies)['user-agent'], jar.getUserAgent())
  const login = await openEmbeddedYouTubeLogin({ electron: runtime, session: jar })
  const window = windows.at(-1)
  await ready(window)
  const first = await window.webContents.executeJavaScript('window.firstScript')
  assert.equal(first.storage, 'verified-account-music-state', 'Music localStorage survives a real Electron shutdown/restart')
  assert.match(first.getter, /\[native code\]/)
  assert.equal(first.app, 'undefined')
  await window.loadURL('https://accounts.google.com/')
  assert.equal((await window.webContents.executeJavaScript('window.firstScript')).storage, 'verified-account-google-state', 'Google localStorage survives a real Electron shutdown/restart')
  await window.loadURL('https://accounts.google.co.uk/')
  assert.equal(window.webContents.getURL(), 'https://accounts.google.co.uk/')
  await login.close({ preserveSession: true })
  assert.deepEqual(unexpectedRequests, [])
  assert.equal(visibleWindows, 0)
  console.log('Restored site-first profile passed: Google/YouTube cookies, per-origin website storage, account context, native identity, and no visible windows or external requests.')
}

app.whenReady().then(async () => {
  let manager
  try {
    if (restoreRestart) { await checkRestoredProfile(); return }
    stage = 'standalone login initialization'
    const login = await openEmbeddedYouTubeLogin({ electron: runtime })
    const window = windows.at(-1), jar = window.webContents.session
    await ready(window)
    const first = await window.webContents.executeJavaScript('window.firstScript')
    assert.equal(first.webdriver, false)
    assert.match(first.getter, /\[native code\]/, 'the login window must retain the native webdriver getter')
    assert.equal(first.ownWebdriver, false)
    assert.equal(first.node, 'undefined')
    assert.equal(first.process, 'undefined')
    assert.equal(first.app, 'undefined')
    assert.match(first.userAgent, /Electron/)
    assert.equal(first.userAgent, jar.getUserAgent())
    const preferences = window.webContents.getLastWebPreferences()
    assert.equal(preferences.sandbox, true)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.webSecurity, true)
    assert.ok(!preferences.preload, 'Google pages must have no application or identity-masking preload')

    stage = 'website Google and YouTube sign-in handoff'
    await signIn(window, 'fixture-snapshot')
    await completeSignIn(window)
    await ready(window)
    const snapshot = await login.read()
    assert.equal(snapshot.context['x-goog-authuser'], '3')
    assert.equal(snapshot.context['x-goog-pageid'], 'fixture-brand')
    assert.equal(snapshot.cookies.find(cookie => cookie.name === 'SAPISID').expires, COOKIE_EXPIRY)
    assert.equal(snapshot.cookies.find(cookie => cookie.name === 'SAPISID').sameSite, 'None')
    assert.equal((await window.webContents.executeJavaScript('window.firstScript')).storage, 'fixture-snapshot-music-state')
    const originalURL = window.webContents.getURL()
    await window.webContents.executeJavaScript("document.body.innerHTML += '<a id=blocked href=https://example.com/>Blocked</a>'; document.getElementById('blocked').click()")
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(window.webContents.getURL(), originalURL)
    await window.webContents.executeJavaScript("window.open('https://example.com/')")
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(BrowserWindow.getAllWindows().length, 1)
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
        // Model a normal Set-Cookie TTL renewal during the verification request.
        const candidate = windows.at(-1).webContents.session
        const cookie = (await candidate.cookies.get({ url: MUSIC })).find(cookie => cookie.name === 'SAPISID')
        await candidate.cookies.set({ ...cookie, url: MUSIC, expirationDate: cookie.expirationDate + 60 })
        return { authenticated, ...(authenticated ? {} : { error: 'Fixture account is not authenticated' }) }
      } },
    })

    stage = 'unverified default login'
    let result = manager.signIn({ onProgress: status => statuses.push(status) }) // Exercise the real default adapter, not an injection.
    await waitFor(() => statuses.length > 0, 'initial local login ready')
    let candidateWindow = windows.at(-1), candidate = candidateWindow.webContents.session
    await signIn(candidateWindow, 'unverified-account')
    await completeSignIn(candidateWindow)
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
    await signIn(candidateWindow, 'verified-account')
    await completeSignIn(candidateWindow)
    assert.equal((await result).authenticated, true)
    assert.match(settings.yt_account_partition, /^persist:lokal-ytmusic-/)
    assert.equal(JSON.parse(settings.yt_account_context)['x-goog-authuser'], '3')
    assert.equal(JSON.parse(settings.yt_account_context)['x-goog-pageid'], 'fixture-brand')
    assert.match(exports.at(-1), /SAPISID=verified-account/)
    assert.ok(!exports.at(-1).includes('fixture-google-session'))
    assert.equal(partitions.get(settings.yt_account_partition), candidate, 'activate the complete website profile without cookie-only copying')
    assert.equal(settings.yt_account_user_agent, '', 'native profile identity must not be pinned across Electron upgrades')
    assert.equal((await candidate.cookies.get({ url: MUSIC })).find(cookie => cookie.name === 'SAPISID').value, 'verified-account')
    assert.equal((await candidate.cookies.get({ url: 'https://accounts.google.com' })).find(cookie => cookie.name === 'SID').value, 'fixture-google-session')
    assert.equal(requests.length, 2, 'expiry-only cookie renewals must not repeat authenticated verification indefinitely')
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
    if (prepareRestart) {
      retainedSession = candidate
      fs.writeFileSync(path.join(directory, 'fixture-settings.json'), JSON.stringify(settings))
    }
    console.log('Native site-first login fixture passed: website-initiated Google/YouTube handoff, native identity, isolated sandbox, no app APIs, full-profile activation, cancellation, load errors, and no visible windows or external requests.')
  } finally {
    manager?.cancelSignIn()
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    for (const jar of partitions.values()) if (jar !== retainedSession) await jar.clearStorageData()
    if (!process.env.LOKAL_LOGIN_TEST_DATA_DIR) await fs.promises.rm(directory, { recursive: true, force: true })
  }
}).then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => { clearTimeout(timeout); console.error(`Fixture failed during ${stage}:`, error); app.exit(1) })
