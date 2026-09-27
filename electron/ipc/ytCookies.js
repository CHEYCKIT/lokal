// Cookies for yt-dlp, shared by the desktop downloader and the web server.
//
// "Use YouTube Cookies" used to always mean `--cookies-from-browser <browser>`.
// On Windows that no longer works for Chrome, Edge and other Chromium browsers:
// since Chrome 127 their cookies are protected by app-bound encryption, which
// yt-dlp can't decrypt ("Failed to decrypt with DPAPI", yt-dlp issue #10927),
// and they also lock the cookie database while the browser is open. yt-dlp then
// aborts before downloading anything -- so with cookies on, *every* download
// failed.
//
// Now:
//  - a cookies.txt file (the workaround yt-dlp recommends) can be chosen instead
//    of a browser;
//  - if reading a browser's cookies fails, the download is retried once without
//    cookies (most music downloads don't need them), and browser cookies are
//    skipped for the rest of the session so each download doesn't fail first.

const fs = require('fs')

const CHROMIUM = new Set(['chrome', 'chromium', 'edge', 'brave', 'opera', 'vivaldi', 'whale'])

const COOKIE_ERROR = /Failed to decrypt with DPAPI|app[- ]bound|Could not copy \S+ cookie database|could not find \S+ cookies database|failed to (?:load|decrypt) cookies|cookies? database (?:is )?locked|Unsupported browser specified for cookies|failed to read cookies/i

// Browsers whose cookies failed this session; skipped until the app restarts.
const unreadable = new Set()

function cookieSource(settings) {
  if (settings.yt_cookies !== '1') return null
  const browser = String(settings.yt_cookie_browser || 'firefox').toLowerCase()
  if (browser === 'file') {
    const file = String(settings.yt_cookie_file || '').trim()
    return file ? { type: 'file', file } : null
  }
  return { type: 'browser', browser }
}

/**
 * yt-dlp arguments for cookies, plus notes worth showing in the download log.
 * @returns {{ args: string[], notes: string[], usedBrowser: string|null }}
 */
function cookieArgs(settings, { withoutCookies = false } = {}) {
  const source = cookieSource(settings)
  if (!source || withoutCookies) return { args: [], notes: [], usedBrowser: null }
  if (source.type === 'file') {
    if (!fs.existsSync(source.file)) {
      return { args: [], notes: [`Cookies file not found (${source.file}) — downloading without cookies.`], usedBrowser: null }
    }
    return { args: ['--cookies', source.file], notes: [], usedBrowser: null }
  }
  if (unreadable.has(source.browser)) {
    return { args: [], notes: [`${label(source.browser)} cookies couldn't be read earlier this session — downloading without cookies.`], usedBrowser: null }
  }
  return { args: ['--cookies-from-browser', source.browser], notes: [], usedBrowser: source.browser }
}

function isCookieError(outputLines) {
  const text = Array.isArray(outputLines) ? outputLines.join('\n') : String(outputLines || '')
  return COOKIE_ERROR.test(text)
}

function label(browser) {
  const names = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', chromium: 'Chromium', firefox: 'Firefox', safari: 'Safari', whale: 'Whale' }
  return names[browser] || browser
}

/** Remembers that a browser's cookies can't be read, and returns the log note for the retry. */
function markUnreadable(browser) {
  if (browser) unreadable.add(browser)
  const why = CHROMIUM.has(browser) && process.platform === 'win32'
    ? `${label(browser)} encrypts its cookies in a way yt-dlp can't read on Windows (Chrome 127+).`
    : `${label(browser)}'s cookies couldn't be read (the browser may need to be closed).`
  return `${why} Retrying without cookies. To use cookies, pick Firefox or a cookies.txt file in Settings → Downloads.`
}

const COOKIE_FAILURE_MESSAGE = "Couldn't read the browser's cookies. Pick Firefox or a cookies.txt file in Settings → Downloads, or turn YouTube cookies off."

module.exports = { cookieArgs, isCookieError, markUnreadable, COOKIE_FAILURE_MESSAGE }
