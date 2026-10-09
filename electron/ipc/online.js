// Online results (YouTube Music, SoundCloud) for the desktop app: search,
// keeping songs as ghost tracks, and the lokal-stream://<provider>/<id>
// protocol the player streams from. See electron/online/sources.js.

const { getDB } = require('./db')
const { findYtDlp } = require('./tools')
const { cookieArgs } = require('./ytCookies')
const { runJsonSearch, mapSearchResult } = require('../download/search')
const sources = require('../online/sources')
const genres = require('../online/genres')
const youtube = require('../online/youtube')
const { createArtworkResolver } = require('../discoveryArtwork')
const { spelling } = require('../online/spelling')
const discoveryArtwork = createArtworkResolver({ getDB, isElectron: true, searchArtists: require('./artistMetadata').searchArtistMetadataCandidates, searchSongs: youtube.searchSongs })
let accountSession

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
  return { db: getDB(), quality: all.online_quality === 'saver' ? 'saver' : 'best', ytdlp: findYtDlp(), cookieArgs: cookies.args, cookieBrowser: cookies.usedBrowser }
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
    const auth = provider === 'yt' && accountSession ? await accountSession.credentials() : {}
    return await sources.search(sources.providerOf(provider) ? provider : 'yt', query, { db: getDB(), ytdlp: findYtDlp(), fetchImpl: auth.fetchImpl, fallbackSearch: youtubeFallback })
  } catch (e) {
    return { error: e.message, results: [] }
  }
}

/** Built-in sources, then the user's enabled addons that can search and stream. */
function providers() {
  return [
    { id: 'yt', label: 'YouTube Music' },
    { id: 'sc', label: 'SoundCloud' },
    ...sources.addons.searchable(getDB()).map(a => ({ id: a.provider, label: a.name, icon: a.icon, addon: true, album: a.resources.includes('album'), artist: a.resources.includes('artist') })),
  ]
}

/** IPC: online:search, online:save (keep as ghost tracks), online:prepare (resolve a stream ahead of time, or get why it fails). */
function registerOnlineHandlers(ipcMain) {
  accountSession ||= require('../online/youtubeSession').createYouTubeSession({ getSettings: settings, saveSettings: values => {
    const stmt = getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    getDB().transaction(() => { for (const [key, value] of Object.entries(values)) stmt.run(key, String(value)) })()
  } })
  const accountRequest = async work => { const auth = await accountSession.credentials(); return work(auth) }
  sources.pruneOnlineTracks(getDB())
  // Streamed songs' genres (see genres.js): those already played, once the app has settled.
  setTimeout(() => genres.backfillOnlineGenres(getDB()), 20000).unref?.()
  ipcMain.handle('online:search', (_, query, provider) => search(query, provider))
  ipcMain.handle('online:save', (_, items) => {
    try {
      const rows = sources.saveOnlineTracks(getDB(), items)
      genres.fillOnlineGenres(getDB(), rows)
      return rows
    } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('online:genre', (_, trackId) => genres.trackGenre(getDB(), trackId).catch(() => null))
  // The sources the search page can switch between: built-in ones, then addons.
  ipcMain.handle('online:providers', () => providers())
  // A misspelt search ("micheal jackson"): the library's spelling, else YouTube Music's.
  ipcMain.handle('online:spelling', (_, query) => spelling(getDB(), query))
  ipcMain.handle('online:artwork', (_, items) => discoveryArtwork(items))
  ipcMain.handle('online:signIn', (event, options) => accountSession.signIn({ mode: options?.mode || 'embedded', onProgress: status => { if (!event.sender.isDestroyed()) event.sender.send('online:signInStatus', status) } }))
  ipcMain.handle('online:cancelSignIn', () => accountSession.cancelSignIn())
  ipcMain.handle('online:disconnect', () => accountSession.disconnect())
  ipcMain.handle('online:catalogue', (_, options) => accountRequest(({ cookies, fetchImpl }) => youtube.fetchCatalogue(options, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  ipcMain.handle('online:account', (_, force = false) => accountRequest(auth => youtube.fetchAccountData({ ...auth, force: !!force })).catch(e => ({ error: e.message, authenticated: false })))
  ipcMain.handle('online:accountPlaylist', (_, playlistId) => accountRequest(({ cookies, fetchImpl }) => youtube.fetchAccountPlaylist(playlistId, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  ipcMain.handle('online:radio', (_, videoId) => accountRequest(auth => youtube.fetchRadio(videoId, auth)).catch(() => []))
  ipcMain.handle('online:setAccountLiked', (_, videoId, liked) => accountRequest(({ cookies, fetchImpl }) => youtube.setAccountLiked(videoId, liked, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  // Direct audio link of an addon track, for "Save to library" (the downloader fetches it).
  ipcMain.handle('online:downloadUrl', async (_, provider, id) => {
    try { return { url: (await sources.resolveStream(provider, id, { ...streamOptions(), force: true })).url } } catch (e) { return { error: e.message } }
  })
  // Addons' manifests are read again now and then (new resources, settings).
  sources.addons.refreshManifests(getDB()).catch(() => {})
  ipcMain.handle('addons:list', () => { sources.addons.refreshManifests(getDB()).catch(() => {}); return sources.addons.list(getDB()) })
  // An addon's album and artist pages (when its manifest offers them).
  ipcMain.handle('online:addonAlbum', async (_, provider, id) => {
    const key = sources.addons.keyOfProvider(provider)
    if (!key) return { error: 'Not an addon.' }
    try { return await sources.addons.album(getDB(), key, id) } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('online:addonArtist', async (_, provider, id) => {
    const key = sources.addons.keyOfProvider(provider)
    if (!key) return { error: 'Not an addon.' }
    try { return await sources.addons.artist(getDB(), key, id) } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('addons:install', async (_, url) => {
    try { return await sources.addons.install(getDB(), url) } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('addons:remove', (_, key) => sources.addons.remove(getDB(), key))
  ipcMain.handle('addons:setEnabled', (_, key, enabled) => sources.addons.setEnabled(getDB(), key, enabled))
  ipcMain.handle('addons:setSettings', (_, key, values) => sources.addons.setSettings(getDB(), key, values))
  ipcMain.handle('musicVideo:find', (_, trackId) => musicVideoFor(trackId).catch(() => null))
  ipcMain.handle('online:prepare', async (_, provider, id, force = false) => {
    try {
      if (provider === 'yt') await accountSession.credentials()
      const stream = await sources.resolveStream(provider, id, { ...streamOptions(), force: !!force })
      return { ok: true, preview: !!stream.preview }
    } catch (e) { return { error: e.message } }
  })
}

/** Where ffmpeg reads a YouTube video's audio from; a retry gets a fresh URL in another format. */
async function youtubeAudio(videoId, attempt = 0) {
  const stream = await youtube.resolveStream(videoId, { ...streamOptions(), quality: attempt ? 'saver' : 'analysis', force: attempt > 0 })
  return { input: stream.url, headers: stream.headers }
}

/** Where ffmpeg reads a track's own audio from, for the music video check. */
function resolvedSourceAudio(provider, id, { resolve = sources.resolveStream, options = streamOptions() } = {}) {
  return async attempt => {
    const stream = await resolve(provider, id, { ...options, force: attempt > 0 })
    return { input: stream.url, headers: stream.headers }
  }
}

function songAudioFor(track, canStream, options = {}) {
  const file = String(track?.file_path || '')
  const ref = sources.streamRef(track)
  if (ref && (ref.provider !== 'yt' || canStream)) {
    if (ref.provider === 'yt') return attempt => youtubeAudio(ref.id, attempt)
    // SoundCloud and addon streams are resolved by the shared source layer so
    // the music-video matcher receives the same fresh URL as playback.
    return resolvedSourceAudio(ref.provider, ref.id, options)
  }
  if (file && !file.startsWith('ghost://') && require('fs').existsSync(file)) return async () => ({ input: file, headers: {} })
  return null
}

/** The official music video for a track (see online/musicVideo.js), or null. */
async function musicVideoFor(trackId) {
  const track = getDB().prepare('SELECT id, title, artist, duration, file_path FROM tracks WHERE id = ?').get(trackId)
  if (!track) return null
  if (accountSession) await accountSession.credentials().catch(() => {})
  const { findFfmpeg } = require('./tools')
  const options = streamOptions()
  const canStream = !!options.ytdlp
  return require('../online/musicVideo').findMusicVideo(track, {
    ffmpeg: findFfmpeg(),
    songAudio: songAudioFor(track, canStream),
    videoAudio: canStream ? youtubeAudio : null,
    youtubeSearch: canStream ? query => runJsonSearch(options.ytdlp, query, entry => ({
      ...entry,
      id: entry.id,
      videoId: entry.id,
      artist: entry.channel || entry.uploader || '',
      artists: [entry.channel || entry.uploader || ''].filter(Boolean),
      kind: 'video',
      official: /(?:official\s+(?:music\s+)?video|VEVO$)/i.test(`${entry.title || ''} ${entry.channel || entry.uploader || ''}`),
      url: `https://www.youtube.com/watch?v=${entry.id}`,
    }), 1, 10) : null,
    cacheFile: require('path').join(require('electron').app.getPath('userData'), 'music-videos.json'),
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
      id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {}
    try {
      if (provider === 'yt' && accountSession) await accountSession.credentials()
      // Electron doesn't fire request.signal when the player drops a stream
      // (next song, seek); it cancels the response body. The request to the
      // media server must be aborted then, or its connection stays open: after
      // six (Chromium's limit per server) every new stream from that server
      // waits forever, and songs stop playing until Lokal restarts.
      const upstream = new AbortController()
      request.signal?.addEventListener?.('abort', () => upstream.abort(), { once: true })
      const fetchImpl = (u, init) => net.fetch(u, init)
      const range = request.headers.get('Range')
      // ytv: a music video's picture (musicVideo.js).
      const { res, mime } = provider === 'ytv'
        ? await youtube.fetchStream(id, { ...streamOptions(), quality: 'video', range, signal: upstream.signal, fetchImpl })
        : await sources.fetchStream(provider, id, { ...streamOptions(), range, signal: upstream.signal, fetchImpl })
      const headers = new Headers()
      for (const name of PASS_HEADERS) { const v = res.headers.get(name); if (v) headers.set(name, v) }
      if (!headers.has('content-type')) headers.set('content-type', mime)
      return new Response(sources.cancellableBody(res.body, () => upstream.abort()), { status: res.status, headers })
    } catch (e) {
      return new Response(String(e.message || e), { status: 502, headers: { 'content-type': 'text/plain' } })
    }
  })
}

module.exports = { registerOnlineHandlers, registerStreamScheme, registerStreamProtocol, search, streamOptions, providers, songAudioFor, resolvedSourceAudio }
