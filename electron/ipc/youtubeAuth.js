// Google rejects embedded sign-in. Use an installed browser with a dedicated
// Lokal profile and a private debugging pipe (no listening TCP port).
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { app, session } = require('electron')
const { getDB } = require('./db')
const { syncPastedCookie, removePastedCookieFile } = require('./ytCookies')
const youtube = require('../online/youtube')

const YOUTUBE_URL = 'https://music.youtube.com/'
const COOKIE_NAMES = new Set(['LOGIN_INFO', 'SAPISID', '__Secure-1PAPISID', '__Secure-1PSID', '__Secure-1PSIDTS', '__Secure-3PAPISID', '__Secure-3PSID', '__Secure-3PSIDTS', 'SID', 'HSID', 'SSID', 'APISID'])
let pendingLogin = null
let cancelLogin = null

function youtubeCookieHeader(cookies) {
  return (cookies || [])
    .filter(cookie => /(?:^|\.)youtube\.com$/i.test(String(cookie.domain || '').replace(/^\./, '')) && COOKIE_NAMES.has(cookie.name))
    .filter(cookie => cookie.value && (!cookie.expires || cookie.expires < 0 || cookie.expires * 1000 > Date.now()))
    .map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

function findBrowser() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const candidates = process.platform === 'win32'
    ? roots.flatMap(root => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe'].map(file => path.join(root, file)))
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
      : (process.env.PATH || '').split(path.delimiter).filter(Boolean).flatMap(root => ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'chromium', 'chromium-browser', 'brave-browser'].map(name => path.join(root, name)))
  return candidates.find(file => {
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile() } catch { return false }
  })
}

function saveYouTubeCookie(header) {
  const db = getDB()
  db.transaction(() => {
    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries({ yt_cookies: '1', yt_cookie_browser: 'paste', yt_cookie_header: header })) set.run(key, value)
  })()
  syncPastedCookie({ yt_cookies: '1', yt_cookie_browser: 'paste', yt_cookie_header: header })
  youtube.clearAccountCache()
}

async function launchLogin() {
  const browser = findBrowser()
  if (!browser) return { error: 'Install Chrome, Edge, Chromium, or Brave to sign in, or import your YouTube cookies under Advanced connection.' }
  const profile = path.join(app.getPath('userData'), 'youtube-browser-profile')
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 })
  return new Promise(resolve => {
    const child = spawn(browser, [
      `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run',
      '--no-default-browser-check', '--new-window', YOUTUBE_URL,
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: false })
    let done = false
    let sequence = 0
    let buffer = ''
    let pollTimer
    let lastHeader = ''
    const requests = new Map()
    const finish = result => {
      if (done) return
      done = true
      clearTimeout(deadline)
      clearTimeout(pollTimer)
      for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error('Sign-in closed.')) }
      requests.clear()
      cancelLogin = null
      // Close only the browser instance launched with our dedicated profile.
      try { child.stdio[3].write(JSON.stringify({ id: ++sequence, method: 'Browser.close' }) + '\0') } catch {}
      resolve(result)
    }
    const send = (method, params = {}) => new Promise((resolveCall, reject) => {
      if (done) return reject(new Error('Sign-in closed.'))
      const id = ++sequence
      const timer = setTimeout(() => { requests.delete(id); reject(new Error('Browser connection timed out.')) }, 8000)
      requests.set(id, { resolve: resolveCall, reject, timer })
      child.stdio[3].write(JSON.stringify({ id, method, params }) + '\0', error => {
        if (!error) return
        clearTimeout(timer); requests.delete(id); reject(error)
      })
    })
    const deadline = setTimeout(() => finish({ error: 'Sign-in timed out. You can try again.' }), 5 * 60 * 1000)
    cancelLogin = () => finish({ cancelled: true })
    child.on('error', () => finish({ error: 'Could not start the YouTube sign-in browser.' }))
    child.on('close', () => finish({ cancelled: true }))
    child.stdio[3].on('error', () => finish({ error: 'The sign-in browser disconnected.' }))
    child.stdio[4].on('error', () => finish({ error: 'The sign-in browser disconnected.' }))
    child.stdio[4].on('data', chunk => {
      buffer += chunk.toString()
      let end
      while ((end = buffer.indexOf('\0')) >= 0) {
        const message = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const response = JSON.parse(message)
          const request = requests.get(response.id)
          if (!request) continue
          clearTimeout(request.timer); requests.delete(response.id)
          if (response.error) request.reject(new Error('Could not read the YouTube browser session.'))
          else request.resolve(response.result)
        } catch {}
      }
    })
    const poll = async () => {
      try {
        const result = await send('Storage.getCookies')
        const header = youtubeCookieHeader(result?.cookies)
        if (header && header !== lastHeader && /(?:^|; )(?:SAPISID|__Secure-3PAPISID|__Secure-1PAPISID)=/.test(header)) {
          lastHeader = header
          if (!done) { saveYouTubeCookie(header); finish({ ok: true }); return }
        }
      } catch {}
      if (!done) pollTimer = setTimeout(poll, 1500)
    }
    pollTimer = setTimeout(poll, 1000)
  })
}

function openYouTubeLogin() {
  if (!pendingLogin) pendingLogin = launchLogin().catch(() => ({ error: 'Could not start YouTube sign-in.' })).finally(() => { pendingLogin = null })
  return pendingLogin
}

async function disconnectYouTube() {
  cancelLogin?.()
  await pendingLogin
  const db = getDB()
  db.transaction(() => {
    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries({ yt_cookies: '0', yt_cookie_header: '', yt_cookie_file: '', yt_cookie_browser: 'paste' })) set.run(key, value)
  })()
  removePastedCookieFile()
  youtube.clearAccountCache()
  // Remove the legacy embedded browser session as well.
  await session.fromPartition('persist:lokal-youtube-account').clearStorageData()
  try { fs.rmSync(path.join(app.getPath('userData'), 'youtube-browser-profile'), { recursive: true, force: true }) } catch {}
  return { ok: true }
}

function registerYouTubeAuthHandlers(ipcMain) {
  ipcMain.handle('youtube:login', () => openYouTubeLogin())
  ipcMain.handle('youtube:cancelLogin', () => { cancelLogin?.(); return { ok: true } })
  ipcMain.handle('youtube:disconnect', () => disconnectYouTube().catch(() => ({ error: 'Could not disconnect YouTube.' })))
}

module.exports = { registerYouTubeAuthHandlers, youtubeCookieHeader, findBrowser }
