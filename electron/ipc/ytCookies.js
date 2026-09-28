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
//  - or the user's YouTube cookie can be pasted (like the Spotify one for
//    canvases): Lokal writes it to a private cookies.txt in its data folder
//    and hands that to yt-dlp. A YouTube Premium account's cookie gives
//    Premium's 256 kbps AAC when streaming at "Best";
//  - if reading a browser's cookies fails, the download is retried once without
//    cookies (most music downloads don't need them), and browser cookies are
//    skipped for the rest of the session so each download doesn't fail first.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CHROMIUM = new Set(['chrome', 'chromium', 'edge', 'brave', 'opera', 'vivaldi', 'whale'])

const COOKIE_ERROR = /Failed to decrypt with DPAPI|app[- ]bound|Could not copy \S+ cookie database|could not find \S+ cookies database|failed to (?:load|decrypt) cookies|cookies? database (?:is )?locked|Unsupported browser specified for cookies|failed to read cookies/i

// Browsers whose cookies failed this session; skipped until the app restarts.
const unreadable = new Set()

const HEADER = ['# Netscape HTTP Cookie File', '# Written by Lokal from the cookie pasted in Settings.']

/** Is `domain` youtube.com or one of its subdomains? */
function isYouTubeDomain(domain) {
  const d = String(domain || '').replace(/^#HttpOnly_/i, '').replace(/^\./, '').toLowerCase()
  return d === 'youtube.com' || d.endsWith('.youtube.com')
}

/** Is `url` a YouTube (or YouTube Music) link? */
function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'youtu.be' || isYouTubeDomain(host)
  } catch { return false }
}

/**
 * A Netscape cookies.txt for youtube.com from what the user pasted: a Cookie
 * header ("name=value; name2=value2", with or without "cookie:"), or a
 * cookies.txt, of which only the youtube.com cookies are kept (an export of
 * a whole browser profile must not hand every site's cookies to yt-dlp).
 * Returns '' when nothing usable was pasted.
 */
function cookiesTxtFrom(pasted) {
  const text = String(pasted || '').trim()
  if (!text) return ''
  if (/^(?:#|\.?[\w.-]+\t(?:TRUE|FALSE)\t)/m.test(text)) {
    const records = text.split(/\r?\n/).filter(line => {
      const fields = line.split('\t')
      return fields.length >= 7 && isYouTubeDomain(fields[0])
    })
    return records.length ? `${[...HEADER, ...records].join('\n')}\n` : ''
  }
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  const lines = [...HEADER]
  for (const part of text.replace(/^cookie:\s*/i, '').split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const name = part.slice(0, i).trim()
    const value = part.slice(i + 1).trim()
    if (!/^[\w.$%&+-]+$/.test(name) || /[\t\r\n]/.test(value)) continue
    lines.push(['.youtube.com', 'TRUE', '/', 'TRUE', String(expires), name, value].join('\t'))
  }
  return lines.length > 2 ? `${lines.join('\n')}\n` : ''
}

/** Does a pasted cookie look like a signed-in YouTube session? */
function looksSignedIn(pasted) {
  return /(?:^|[;\s\t])(?:__Secure-3PAPISID|SAPISID|__Secure-1PSID|LOGIN_INFO)[=\t]/.test(String(pasted || ''))
}

/** Where the pasted cookie is written: { file, stamp }, or null without a data folder. */
function pastedCookiePaths() {
  let dir
  try { dir = require('./db').getStorageDir() } catch { return null }
  if (!dir) return null
  return { file: path.join(dir, 'youtube-cookies.txt'), stamp: path.join(dir, 'youtube-cookies.hash') }
}

/** Delete the file written from a pasted cookie (cleared, or another source picked). */
function removePastedCookieFile() {
  const paths = pastedCookiePaths()
  if (!paths) return
  for (const f of [paths.file, paths.stamp]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {}
  }
}

/** Write the pasted cookie as cookies.txt in the data folder (only when it changed). */
function pastedCookieFile(pasted) {
  const content = cookiesTxtFrom(pasted)
  if (!content) {
    // Cleared (or nothing usable): don't leave the old cookie on disk.
    removePastedCookieFile()
    return null
  }
  const paths = pastedCookiePaths()
  if (!paths) return null
  const { file, stamp } = paths
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  try {
    if (!fs.existsSync(file) || (fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '') !== hash) {
      fs.writeFileSync(file, content, { mode: 0o600 })
      fs.writeFileSync(stamp, hash, { mode: 0o600 })
    }
    return file
  } catch { return null }
}

function cookieSource(settings) {
  const browser = String(settings.yt_cookie_browser || 'firefox').toLowerCase()
  if (settings.yt_cookies !== '1' || browser !== 'paste') {
    // Cookies off, or another source picked: the pasted one isn't used, so
    // its file doesn't stay behind in the data folder.
    removePastedCookieFile()
    if (settings.yt_cookies !== '1') return null
  }
  if (browser === 'paste') {
    const file = pastedCookieFile(settings.yt_cookie_header)
    return file ? { type: 'file', file, pasted: true } : null
  }
  if (browser === 'file') {
    const file = String(settings.yt_cookie_file || '').trim()
    return file ? { type: 'file', file } : null
  }
  return { type: 'browser', browser }
}

/**
 * After settings are saved: write the pasted cookie's file, or delete it when
 * the cookie was cleared or another source (or no cookies) was picked.
 */
function syncPastedCookie(settings) {
  try { cookieSource(settings || {}) } catch {}
}

/**
 * yt-dlp arguments for cookies, plus notes worth showing in the download log.
 * The pasted YouTube cookie is only given to yt-dlp for YouTube links (`url`).
 * @returns {{ args: string[], notes: string[], usedBrowser: string|null }}
 */
function cookieArgs(settings, { withoutCookies = false, url } = {}) {
  const source = cookieSource(settings)
  if (!source || withoutCookies) return { args: [], notes: [], usedBrowser: null }
  if (source.pasted && !isYouTubeUrl(url)) return { args: [], notes: [], usedBrowser: null }
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
  return `${why} Retrying without cookies. To use cookies, pick Firefox or a cookies.txt file in Settings → Library.`
}

const COOKIE_FAILURE_MESSAGE = "Couldn't read the browser's cookies. Pick Firefox or a cookies.txt file in Settings → Library, or turn YouTube cookies off."

module.exports = { syncPastedCookie, cookieArgs, isCookieError, markUnreadable, COOKIE_FAILURE_MESSAGE, cookiesTxtFrom, looksSignedIn, isYouTubeUrl, removePastedCookieFile }
