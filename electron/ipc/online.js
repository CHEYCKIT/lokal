// Online results (YouTube Music) for the desktop app: search, keeping songs as
// ghost tracks, and the lokal-stream:// protocol the player streams from.

const { getDB } = require('./db')
const { findYtDlp } = require('./tools')
const { cookieArgs } = require('./ytCookies')
const { runJsonSearch, mapSearchResult } = require('../download/search')
const yt = require('../online/youtube')

const SCHEME = 'lokal-stream'

/** All settings as { key: value }. */
function settings() {
  try { return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])) } catch { return {} }
}

/** yt-dlp and the user's YouTube cookie options, for resolving streams. */
function streamOptions() {
  return { ytdlp: findYtDlp(), cookieArgs: cookieArgs(settings()).args }
}

/** Songs for `query`: YouTube Music, or plain YouTube through yt-dlp if that fails. */
async function search(query) {
  try {
    return { results: await yt.searchSongs(query, { limit: 10 }) }
  } catch (e) {
    const ytdlp = findYtDlp()
    if (!ytdlp) return { error: e.message, results: [] }
    const found = await runJsonSearch(ytdlp, String(query || ''), mapSearchResult, 1, 10)
    return {
      fallback: true,
      results: (found.results || []).map(r => ({
        videoId: r.id, title: r.title, artist: r.channel, artists: [r.channel], album: null,
        duration: r.duration || null, thumbnail: r.thumbnail, kind: r.topic ? 'song' : 'video', official: !!r.official, url: r.url,
      })),
    }
  }
}

/** IPC: online:search, online:save (keep as ghost tracks), online:prepare (resolve a stream ahead of time, or get why it fails). */
function registerOnlineHandlers(ipcMain) {
  yt.pruneOnlineTracks(getDB())
  ipcMain.handle('online:search', (_, query) => search(query))
  ipcMain.handle('online:save', (_, items) => {
    try { return yt.saveOnlineTracks(getDB(), items) } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('online:prepare', async (_, videoId, force = false) => {
    try { await yt.resolveStream(videoId, { ...streamOptions(), force: !!force }); return { ok: true } } catch (e) { return { error: e.message } }
  })
}

/** Must run before the app is ready: lets <audio> stream (and seek) from lokal-stream://. */
function registerStreamScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }])
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

/** lokal-stream://yt/<videoId>: the song's audio from YouTube, with Range support for seeking. */
function registerStreamProtocol(protocol, net) {
  protocol.handle(SCHEME, async (request) => {
    let videoId = ''
    try { videoId = new URL(request.url).pathname.replace(/^\/+/, '') } catch {}
    try {
      const { res, mime } = await yt.fetchStream(videoId, { ...streamOptions(), range: request.headers.get('Range'), fetchImpl: (url, init) => net.fetch(url, init) })
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
