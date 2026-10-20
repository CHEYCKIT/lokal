// Authentication pages get an isolated Chromium session and no application
// preload or Node access. Callback ownership stays in the trusted host.
const { validateURL, domainAllowed } = require('./network')
const windows = new Map()
const closeWaiters = new Map()

function waitForClose(key) {
  let resolve
  const promise = new Promise(done => { resolve = done })
  const waiters = closeWaiters.get(key) || new Set()
  waiters.add(resolve)
  closeWaiters.set(key, waiters)
  return {
    promise,
    cancel: () => {
      waiters.delete(resolve)
      if (!waiters.size) closeWaiters.delete(key)
    },
  }
}

function isExpectedCallback(raw, runtime) {
  let url
  try { url = new URL(raw) } catch { return false }
  // Some provider flows wrap the final callback in a "cb" query parameter.
  const nested = url.searchParams.get('cb')
  if (nested) {
    // A challenge may include a cb parameter describing its eventual redirect.
    // Only consume it when the nested URL is an actual completed grant callback.
    let callback
    try { callback = new URL(nested) } catch { return false }
    if (!callback.searchParams.get('state') || !(callback.searchParams.get('grant') || callback.searchParams.get('code'))) return false
    return isExpectedCallback(callback.href, runtime)
  }
  const configured = runtime.host.session?.config.callbackUrl || runtime.host.auth.pending?.callback
  const candidates = configured
    ? [configured]
    : ['mornye://session-grant', 'spotiflac://session-grant']
  return candidates.some(value => {
    try {
      const expected = new URL(value)
      return url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname
    } catch { return false }
  })
}

async function openAuthWindow(packages, key) {
  const runtime = await packages.runtime(key)
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return { success: true, message: 'Complete verification in the addon window.', opened: true }
  }
  const pending = runtime.host.session?.pending || runtime.host.auth.pending
  if (!pending?.url) throw new Error('There is no pending addon login or verification')
  const permissions = runtime.host.network.permissions
  validateURL(pending.url, permissions)
  const { BrowserWindow, session } = require('electron')
  const partition = session.fromPartition(`lokal-addon-${key}`)
  const window = new BrowserWindow({ width: 720, height: 800, title: 'Lokal — Addon access', autoHideMenuBar: true, webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } })
  windows.set(key, window)
  let completing = false
  const completeCallback = async raw => {
    if (completing) return
    completing = true
    try {
      const cookies = await partition.cookies.get({})
      for (const cookie of cookies) {
        const host = cookie.domain.replace(/^\./, '')
        if (!domainAllowed(host, permissions.network)) continue
        const attributes = `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path || '/'}${cookie.secure ? '; Secure' : ''}${cookie.httpOnly ? '; HttpOnly' : ''}`
        try { runtime.host.network.cookies.setCookieSync(attributes, `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`) } catch {}
      }
      runtime.host.network.persist?.()
      await packages.authCallback(key, raw)
      if (!window.isDestroyed()) window.close()
    } catch (error) {
      completing = false
      if (!window.isDestroyed()) window.setTitle(`Lokal — ${error.message}`)
    }
  }
  const inspect = (event, raw) => {
    try { new URL(raw) } catch { event.preventDefault(); return }
    if (isExpectedCallback(raw, runtime)) {
      event.preventDefault()
      void completeCallback(raw)
      return
    }
    try { validateURL(raw, permissions) } catch { event.preventDefault() }
  }
  window.webContents.on('will-navigate', inspect)
  window.webContents.on('will-redirect', inspect)
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Updated Mornye challenges may hand off through window.open rather than
    // a top-level navigation. Consume the callback in either case; attempting
    // to load a custom callback URI as a normal page leaves verification open.
    if (isExpectedCallback(url, runtime)) {
      void completeCallback(url)
      return { action: 'deny' }
    }
    try { validateURL(url, permissions); window.loadURL(url).catch(() => {}) } catch {}
    return { action: 'deny' }
  })
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  const timer = setTimeout(() => { if (!window.isDestroyed()) window.close() }, 180000)
  // However the window closes (verified, the person closed it, timed out),
  // access is checked again and the Addons page is told.
  window.on('closed', () => {
    clearTimeout(timer)
    if (windows.get(key) === window) windows.delete(key)
    packages.authStatus(key).then(status => {
      announce(key, status)
      for (const resolve of closeWaiters.get(key) || []) resolve(status)
      closeWaiters.delete(key)
    }, error => {
      const status = { authenticated: false, error: error.message }
      announce(key, status)
      for (const resolve of closeWaiters.get(key) || []) resolve(status)
      closeWaiters.delete(key)
    })
  })
  await window.loadURL(pending.url)
  return { success: true, message: 'Complete verification in the addon window.' }
}

async function openAuthWindowAndWait(packages, key) {
  const waiter = waitForClose(key)
  try {
    await openAuthWindow(packages, key)
    return await waiter.promise
  } catch (error) {
    waiter.cancel()
    throw error
  }
}

function announce(key, status) {
  const { BrowserWindow } = require('electron')
  const auth = new Set(windows.values())
  for (const window of BrowserWindow.getAllWindows()) if (!auth.has(window) && !window.isDestroyed()) window.webContents.send('addons:auth-changed', { key, ...status })
}
function closeAuthWindow(key) { windows.get(key)?.close() }
/** Forget what the addon's login pages stored (Disconnect). */
async function clearAuthSession(key) {
  windows.get(key)?.close()
  try { await require('electron').session.fromPartition(`lokal-addon-${key}`).clearStorageData() } catch {}
}
module.exports = { openAuthWindow, openAuthWindowAndWait, closeAuthWindow, clearAuthSession, isExpectedCallback }
