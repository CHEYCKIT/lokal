// Online results (YouTube Music, SoundCloud) for the desktop app: search,
// keeping songs as ghost tracks, and the lokal-stream://<provider>/<id>
// protocol the player streams from. See electron/online/sources.js.

const { getDB } = require('./db')
const { findYtDlp } = require('./tools')
const { cookieArgs } = require('./ytCookies')
const { runJsonSearch, mapSearchResult } = require('../download/search')
const sources = require('../online/sources')

const SCHEME = 'lokal-stream'

/** All settings as { key: value }. */
function settings() {
  try { return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])) } catch { return {} }
}

/** yt-dlp and the user's YouTube cookie options, for resolving streams. */
function streamOptions() {
  const all = settings()
  // Only YouTube streams go through yt-dlp with cookies.
  const cookies = cookieArgs(all, { url: 'https://music.youtube.com/' })
  return { quality: all.online_quality === 'saver' ? 'saver' : 'best', ytdlp: findYtDlp(), cookieArgs: cookies.args, cookieBrowser: cookies.usedBrowser }
}

/** Plain YouTube search through yt-dlp, for when YouTube Music can't be reached. */
async function youtubeFallback(query) {
  const ytdlp = findYtDlp()
  if (!ytdlp) throw new Error('YouTube Music could not be reached, and yt-dlp is not installed.')
  const found = await runJsonSearch(ytdlp, String(query || ''), mapSearchResult, 1, 10)
  return (found.results || []).map(r => ({
    videoId: r.id, title: r.title, artist: r.channel, artists: [r.channel], album: null,
    duration: r.duration || null, thumbnail: r.thumbnail, kind: r.topic ? 'song' : 'video', official: !!r.official, url: r.url,
  }))
}

/** Songs for `query` on a provider ('yt' YouTube Music, 'sc' SoundCloud). */
async function search(query, provider = 'yt') {
  try {
    return await sources.search(sources.providerOf(provider) ? provider : 'yt', query, { ytdlp: findYtDlp(), fallbackSearch: youtubeFallback })
  } catch (e) {
    return { error: e.message, results: [] }
  }
}

/** IPC: online:search, online:save (keep as ghost tracks), online:prepare (resolve a stream ahead of time, or get why it fails). */
function registerOnlineHandlers(ipcMain) {
  sources.pruneOnlineTracks(getDB())
  ipcMain.handle('online:search', (_, query, provider) => search(query, provider))
  ipcMain.handle('online:save', (_, items) => {
    try { return sources.saveOnlineTracks(getDB(), items) } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('online:prepare', async (_, provider, id, force = false) => {
    try {
      const stream = await sources.resolveStream(provider, id, { ...streamOptions(), force: !!force })
      return { ok: true, preview: !!stream.preview }
    } catch (e) { return { error: e.message } }
  })
}

/** Must run before the app is ready: lets <audio> stream (and seek) from lokal-stream://. */
function registerStreamScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }])
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

/** lokal-stream://<provider>/<id>: a song's audio (YouTube, SoundCloud), with Range support for seeking. */
function registerStreamProtocol(protocol, net) {
  protocol.handle(SCHEME, async (request) => {
    let provider = ''
    let id = ''
    try {
      const url = new URL(request.url)
      provider = url.hostname
      id = url.pathname.replace(/^\/+/, '')
    } catch {}
    try {
      const { res, mime } = await sources.fetchStream(provider, id, { ...streamOptions(), range: request.headers.get('Range'), fetchImpl: (u, init) => net.fetch(u, init) })
      const headers = new Headers()
      for (const name of PASS_HEADERS) { const v = res.headers.get(name); if (v) headers.set(name, v) }
      if (!headers.has('content-type')) headers.set('content-type', mime)
      return new Response(res.body, { status: res.status, headers })
    } catch (e) {
      return new Response(String(e.message || e), { status: 502, headers: { 'content-type': 'text/plain' } })
    }
  })
}

module.exports = { registerOnlineHandlers, registerStreamScheme, registerStreamProtocol, search, streamOptions }
