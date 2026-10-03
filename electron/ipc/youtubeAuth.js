const { BrowserWindow } = require('electron')
const { getDB } = require('./db')
const { syncPastedCookie, looksSignedIn } = require('./ytCookies')

const YOUTUBE_PARTITION = 'persist:lokal-youtube-account'
const YOUTUBE_HOST = /(?:^|\.)youtube\.com$/i
const COOKIE_NAMES = new Set([
  'LOGIN_INFO',
  'SAPISID',
  '__Secure-1PAPISID',
  '__Secure-1PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PAPISID',
  '__Secure-3PSID',
  '__Secure-3PSIDTS',
  'SID',
  'HSID',
  'SSID',
  'APISID',
])

let loginWindow = null
let pendingLogin = null

function youtubeCookieHeader(cookies) {
  return cookies
    .filter(cookie => YOUTUBE_HOST.test(String(cookie.domain || '').replace(/^\./, '')))
    .filter(cookie => COOKIE_NAMES.has(cookie.name))
    .filter(cookie => cookie.value)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

function saveYouTubeCookie(header) {
  const db = getDB()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('yt_cookies', '1')").run()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('yt_cookie_browser', 'paste')").run()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('yt_cookie_header', ?)").run(header)
  syncPastedCookie(Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value])))
}

async function finishLogin(session, resolve) {
  if (!session) {
    resolve({ error: 'YouTube sign-in window was unavailable.' })
    return
  }

  try {
    await session.cookies.flushStore?.()
    const cookies = await session.cookies.get({ domain: 'youtube.com' })
    const header = youtubeCookieHeader(cookies)
    if (!looksSignedIn(header)) {
      resolve({ error: 'No signed-in YouTube session was found. Sign in, then close the window and try again.' })
      return
    }
    saveYouTubeCookie(header)
    resolve({ ok: true, cookieCount: header.split('; ').filter(Boolean).length })
  } catch (error) {
    resolve({ error: error.message || 'Could not read the YouTube session.' })
  }
}

function openYouTubeLogin(parent) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show()
    loginWindow.focus()
    return pendingLogin || Promise.resolve({ ok: true, alreadyOpen: true })
  }

  loginWindow = new BrowserWindow({
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    width: 1060,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'Sign in to YouTube Music — return to Lokal when done',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      partition: YOUTUBE_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  loginWindow.webContents.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '134.0.0.0'} Safari/537.36`
  )
  loginWindow.loadURL('https://music.youtube.com/')
  const loginSession = loginWindow.webContents.session

  pendingLogin = new Promise((resolve) => {
    loginWindow.once('closed', async () => {
      loginWindow = null
      await finishLogin(loginSession, resolve)
      pendingLogin = null
    })
  })

  loginWindow.on('unresponsive', () => loginWindow?.webContents.send('youtube-auth:status', 'The YouTube sign-in page is not responding.'))
  loginWindow.show()
  return pendingLogin
}

function registerYouTubeAuthHandlers(ipcMain, getParentWindow) {
  ipcMain.handle('youtube:login', () => openYouTubeLogin(getParentWindow?.()))
}

module.exports = { registerYouTubeAuthHandlers, YOUTUBE_PARTITION }
