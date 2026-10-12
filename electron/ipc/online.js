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
  return {
    db: getDB(), quality: all.online_quality === 'saver' ? 'saver' : 'best',
    // Settings -> Playback -> Music Video Quality.
    videoHeight: [1080, 720, 480].includes(Number(all.video_quality)) ? Number(all.video_quality) : 1080,
    ytdlp: findYtDlp(), cookieArgs: cookies.args, cookieBrowser: cookies.usedBrowser,
    // Settings -> Playback -> Fast YouTube Playback (on unless turned off).
    fast: all.yt_fast_engine === '0' ? null : require('../online/youtubeFast'),
  }
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
    ...sources.addons.searchable(getDB()).map(a => ({ id: a.provider, label: a.name, icon: a.icon, addon: true, package: a.kind === 'spotiflac', needsSetup: a.kind === 'spotiflac' && !!a.access && !a.access.ready, filters: a.searchFilters, album: a.resources.includes('album'), artist: a.resources.includes('artist') })),
  ]
}

/** IPC: online:search, online:save (keep as ghost tracks), online:prepare (resolve a stream ahead of time, or get why it fails). */
function registerOnlineHandlers(ipcMain) {
  // The fast YouTube engine sets itself up a few seconds after launch, so the
  // first song doesn't wait for it.
  setTimeout(() => { try { if (streamOptions().fast) require('../online/youtubeFast').warm() } catch {} }, 5000).unref?.()
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
  ipcMain.handle('online:catalogue', (_, options) => {
    const viaYouTube = () => accountRequest(({ cookies, fetchImpl }) => youtube.fetchCatalogue(options, cookies, fetchImpl))
    // Releases carry their exact date when Deezer has the artist.
    return (options?.type === 'releases' ? require('../online/releaseDates').releaseCatalogue(options, viaYouTube) : viaYouTube()).catch(e => ({ error: e.message }))
  })
  ipcMain.handle('online:account', (_, force = false) => accountRequest(auth => youtube.fetchAccountData({ ...auth, force: !!force })).catch(e => ({ error: e.message, authenticated: false })))
  ipcMain.handle('online:accountPlaylist', (_, playlistId) => accountRequest(({ cookies, fetchImpl }) => youtube.fetchAccountPlaylist(playlistId, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  ipcMain.handle('online:radio', (_, videoId) => accountRequest(auth => youtube.fetchRadio(videoId, auth)).catch(() => []))
  ipcMain.handle('online:setAccountLiked', (_, videoId, liked) => accountRequest(({ cookies, fetchImpl }) => youtube.setAccountLiked(videoId, liked, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  // Direct audio link of an addon track, for "Save to library" (the downloader fetches it).
  ipcMain.handle('online:downloadUrl', async (_, provider, id) => {
    const key = sources.addons.keyOfProvider(provider)
    if (key && sources.addons.packageService(getDB()).find(key)) return { package: true, url: `spotiflac://${key}/${encodeURIComponent(id)}` }
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
  const addonRequest = async work => { try { return await work() } catch (e) { return { error: e.message } } }
  ipcMain.handle('addons:remove', (_, key) => addonRequest(() => sources.addons.remove(getDB(), key)))
  ipcMain.handle('addons:setEnabled', (_, key, enabled) => addonRequest(() => sources.addons.setEnabled(getDB(), key, enabled)))
  ipcMain.handle('addons:setSettings', (_, key, values) => addonRequest(() => sources.addons.setSettings(getDB(), key, values)))
  ipcMain.handle('addons:packages', (event, request) => {
    if (event.senderFrame !== event.sender.mainFrame) return { error: 'Addon management requires the main application frame' }
    return addonRequest(() => require('../spotiflac/api').dispatch(getDB(), request))
  })
  const musicVideoProgress = (event, trackId) => update => {
    try { if (!event.sender.isDestroyed()) event.sender.send('musicVideo:progress', { trackId, ...update }) } catch {}
  }
  ipcMain.handle('musicVideo:find', (event, trackId) => musicVideoFor(trackId, {
    onProgress: musicVideoProgress(event, trackId),
  }).catch(() => null))
  ipcMain.handle('musicVideo:download', (_, trackId) => prepareMusicVideoFor(trackId, { download: true }).catch(e => ({ error: e.message })))
  ipcMain.handle('musicVideo:prepare', (_, trackId) => prepareMusicVideoFor(trackId).catch(e => ({ error: e.message })))
  ipcMain.handle('musicVideo:deleteDownload', async (_, trackId) => {
    try {
      const video = await musicVideoFor(trackId)
      if (!video) throw new Error('No music video found for this song')
      const manager = require('./downloader').manager()
      for (const job of [...manager.jobs.values()]) {
        if (job.kind !== 'music-video' || job.opts.videoId !== video.videoId) continue
        if (['downloading', 'queued'].includes(job.status)) { await manager.cancel(job.id); await manager.waitFor(job.id) }
      }
      const storage = require('../online/musicVideoDownloads')
      const files = [...manager.jobs.values()].filter(job => job.kind === 'music-video' && job.opts.videoId === video.videoId).flatMap(job => [job.song, ...(job.filepaths || [])]).filter(Boolean)
      const local = musicVideoFile(video, { artist: trackArtist(trackId) })
      if (local) files.push(local)
      for (const height of [1080, 720, 480]) {
        const file = storage.peekCachedVideoFile(video.videoId, { cacheDir: require('../cache').cacheDir('musicVideo'), videoHeight: height, touch: false })
        if (file) files.push(file)
      }
      storage.deleteVideoFiles(getDB(), video.videoId, { files })
      for (const job of manager.jobs.values()) {
        if (job.kind === 'music-video' && job.opts.videoId === video.videoId) manager.update(job, { song: null, filepaths: [], removed: true, message: 'Downloaded video deleted' }, { persist: true, force: true })
      }
      return { success: true }
    } catch (error) { return { error: error.message } }
  })
  ipcMain.handle('musicVideo:list', () => listMusicVideos())
  ipcMain.handle('musicVideo:save', async (_, trackId, saved = true) => {
    try {
      const video = await musicVideoFor(trackId)
      if (!video) throw new Error('No music video found for this song')
      ensureVideoLibrary()
      if (saved) getDB().prepare('INSERT OR REPLACE INTO saved_music_videos (track_id, added_at, video_json) VALUES (?, ?, ?)').run(trackId, Date.now(), JSON.stringify(video))
      else getDB().prepare('DELETE FROM saved_music_videos WHERE track_id = ?').run(trackId)
      return { saved: !!saved }
    } catch (e) { return { error: e.message } }
  })
  // Settings -> Library -> Maintenance: find every library song's music video
  // now, so they open at once later. One song at a time; cancellable.
  let videoIndexJob = null
  // The latest progress, for a window that wasn't listening when it was sent
  // (the Downloads panel after a reload).
  let videoIndexStatus = null
  ipcMain.handle('musicVideo:indexAll', async () => {
    if (videoIndexJob) return { running: true }
    const job = { cancelled: false }
    videoIndexJob = job
    // Every window, so one opened after the job started (the original closed
    // and the app reopened its window) keeps following it.
    const send = (payload) => {
      videoIndexStatus = payload
      for (const win of require('electron').BrowserWindow.getAllWindows()) {
        try { if (!win.webContents.isDestroyed()) win.webContents.send('musicVideo:indexProgress', payload) } catch {}
      }
    }
    try {
      const rows = getDB().prepare("SELECT id, title, artist, duration FROM tracks WHERE title IS NOT NULL AND artist IS NOT NULL AND duration > 30 AND file_path NOT LIKE 'ghost://%' ORDER BY artist, title").all()
      let done = 0
      let found = 0
      for (const row of rows) {
        if (job.cancelled) break
        send({ running: true, done, total: rows.length, found, title: `${row.artist} — ${row.title}` })
        const video = await prepareMusicVideoFor(row.id, { wait: true }).catch(() => null)
        if (video) found++
        done++
      }
      send({ running: false, done, total: rows.length, found, cancelled: job.cancelled })
      return { done, total: rows.length, found, cancelled: job.cancelled }
    } finally { videoIndexJob = null }
  })
  // Videos page: a card's animated preview when the video isn't downloaded.
  ipcMain.handle('musicVideo:animatedPreview', (_, videoId, query, force) =>
    require('../online/videoPreview').animatedPreview(String(videoId || ''), String(query || ''), { force: force === true }).catch(() => null))
  ipcMain.handle('musicVideo:cancelIndex', () => { if (videoIndexJob) videoIndexJob.cancelled = true })
  ipcMain.handle('musicVideo:indexStatus', () => videoIndexStatus)
  ipcMain.handle('online:prepare', async (_, provider, id, force = false) => {
    try {
      const key = sources.addons.keyOfProvider(provider)
      if (key && sources.addons.packageService(getDB()).find(key)) return require('../spotiflac/media').prepare(getDB(), key, id, { force: !!force })
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
    return { input: stream.file || stream.url, headers: stream.headers }
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
async function musicVideoFor(trackId, { onProgress } = {}) {
  const track = getDB().prepare('SELECT id, title, artist, duration, file_path FROM tracks WHERE id = ?').get(trackId)
  if (!track) return null
  const cacheFile = musicVideoMetadataFile()
  const matcher = require('../online/musicVideo')
  ensureVideoLibrary()
  const known = matcher.knownMusicVideos([track], { cacheFile, findFile: musicVideoFile })[0]?.video
  if (known) return known
  for (const row of getDB().prepare('SELECT video_json FROM downloaded_music_videos').all()) {
    try { const video = JSON.parse(row.video_json); if (video.trackId === trackId && (video.motion === 'verified' || musicVideoFile(video, track))) return video } catch {}
  }
  try {
    const saved = JSON.parse(getDB().prepare('SELECT video_json FROM saved_music_videos WHERE track_id = ?').get(trackId)?.video_json || 'null')
    if (/^[\w-]{11}$/.test(String(saved?.videoId || '')) && (saved.motion === 'verified' || musicVideoFile(saved, track))) return saved
  } catch {}
  if (accountSession) await accountSession.credentials().catch(() => {})
  const { findFfmpeg } = require('./tools')
  const options = streamOptions()
  // The fast engine plays YouTube without yt-dlp (and falls back to it when there).
  const canStream = !!options.ytdlp || !!options.fast
  const ytdlpSearch = query => runJsonSearch(options.ytdlp, query, entry => ({
    ...entry,
    id: entry.id,
    videoId: entry.id,
    artist: entry.channel || entry.uploader || '',
    artists: [entry.channel || entry.uploader || ''].filter(Boolean),
    kind: 'video',
    official: /(?:official\s+(?:music\s+)?video|VEVO$)/i.test(`${entry.title || ''} ${entry.channel || entry.uploader || ''}`),
    url: `https://www.youtube.com/watch?v=${entry.id}`,
  }), 1, 10, undefined, { timeoutMs: 15000 })
  // youtube.com's own search first (a request, under a second); yt-dlp's when
  // that fails or finds nothing (a page YouTube laid out differently).
  const fastSearch = async query => {
    let found
    try {
      found = (await require('../online/videoPreview').searchVideos(query)).slice(0, 10).map(entry => ({
        ...entry,
        videoId: entry.id,
        artist: entry.channel,
        artists: [entry.channel].filter(Boolean),
        kind: 'video',
        official: /(?:official\s+(?:music\s+)?video|VEVO$)/i.test(`${entry.title} ${entry.channel}`),
      }))
    } catch (error) {
      require('electron-log').info(`YouTube fast engine (video): search through yt-dlp (${String(error?.message || error).slice(0, 200)})`)
      if (!options.ytdlp) throw error
      return ytdlpSearch(query)
    }
    if (found.length || !options.ytdlp) return found
    require('electron-log').info('YouTube fast engine (video): search through yt-dlp (youtube.com found nothing)')
    return ytdlpSearch(query)
  }
  const video = await matcher.findMusicVideo(track, {
    ffmpeg: findFfmpeg(),
    onProgress,
    songAudio: songAudioFor(track, canStream),
    videoAudio: canStream ? youtubeAudio : null,
    visualMotion: item => matcher.validateVisualMotion(findFfmpeg(), async () => {
      const storage = require('../online/musicVideoDownloads')
      const file = storage.recordedVideoFile(getDB(), item.videoId, options.videoHeight) || storage.peekCachedVideoFile(item.videoId, { cacheDir: require('../cache').cacheDir('musicVideo'), videoHeight: options.videoHeight, touch: false })
      if (file) return { input: file, headers: {} }
      if (!canStream) return null
      const media = await youtube.resolveStream(item.videoId, { ...options, quality: 'video' })
      return { input: media.url, headers: media.headers }
    }, item.duration || track.duration),
    youtubeSearch: options.fast ? fastSearch : options.ytdlp ? ytdlpSearch : null,
    cacheFile,
    log: message => require('electron-log').info(message),
  })
  return video
}

function musicVideoMetadataFile() {
  return require('path').join(require('electron').app.getPath('userData'), 'music-videos.json')
}

function ensureVideoLibrary() {
  getDB().exec('CREATE TABLE IF NOT EXISTS saved_music_videos (track_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL, video_json TEXT NOT NULL)')
  require('../online/musicVideoDownloads').ensureDownloadsTable(getDB())
}

function musicVideoFile(video, track = {}) {
  const storage = require('../online/musicVideoDownloads')
  const height = storage.heightOf(settings().video_quality)
  const recorded = storage.recordedVideoFile(getDB(), video.videoId, height)
  if (recorded) return recorded
  for (const videoHeight of new Set([height, 1080, 720, 480])) {
    for (const artist of new Set([track.artist, video.artist].filter(Boolean))) {
      const file = storage.peekDurableVideoFile(video.videoId, { artist, videoHeight })
      if (file) return file
    }
    const legacy = storage.peekCachedVideoFile(video.videoId, { cacheDir: require('../cache').cacheDir('musicVideo'), videoHeight, touch: false })
    if (legacy) return legacy
  }
  return null
}

function listMusicVideos() {
  ensureVideoLibrary()
  const tracks = getDB().prepare('SELECT * FROM tracks ORDER BY artist, title').all()
  const saved = new Map(getDB().prepare('SELECT track_id, video_json FROM saved_music_videos').all().map(row => [row.track_id, row.video_json]))
  const known = new Map(require('../online/musicVideo').knownMusicVideos(tracks, { cacheFile: musicVideoMetadataFile(), findFile: musicVideoFile }).map(item => [item.track.id, item]))
  for (const row of getDB().prepare('SELECT video_json FROM downloaded_music_videos').all()) {
    try {
      const video = JSON.parse(row.video_json)
      const track = tracks.find(track => track.id === video.trackId)
      if (track && !known.has(track.id)) known.set(track.id, { track, video })
    } catch {}
  }
  // Saved videos keep their metadata even when discovery expires or the file
  // is evicted. Disk-cache membership isn't library membership.
  for (const track of tracks) {
    if (known.has(track.id) || !saved.has(track.id)) continue
    try {
      const video = JSON.parse(saved.get(track.id))
      if (/^[\w-]{11}$/.test(String(video?.videoId || ''))) known.set(track.id, { track, video })
    } catch {}
  }
  return [...known.values()].sort((a, b) => String(a.track.artist || '').localeCompare(String(b.track.artist || '')) || String(a.track.title || '').localeCompare(String(b.track.title || ''))).map(({ track, video }) => {
    const file = musicVideoFile(video, track)
    return {
      track, video: { ...video, file, thumbnail: `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg` },
      saved: saved.has(track.id), downloaded: !!file,
    }
  })
}

async function prepareMusicVideoFor(trackId, { wait = false, download = false } = {}) {
  const video = await musicVideoFor(trackId)
  if (!video) return null
  const { peekDurableVideoFile, recordedVideoFile, heightOf } = require('../online/musicVideoDownloads')
  const options = { videoHeight: heightOf(settings().video_quality), artist: trackArtist(trackId) || video.artist, title: video.title, trackId }
  const file = musicVideoFile(video, { artist: options.artist })
  const durable = recordedVideoFile(getDB(), video.videoId, options.videoHeight) || peekDurableVideoFile(video.videoId, options)
  if (durable || (file && !download)) return { ...video, file: durable || file }
  if (!download) {
    const manager = require('./downloader').manager()
    const active = [...manager.jobs.values()].find(job => job.kind === 'music-video' && job.opts.videoId === video.videoId && ['queued', 'downloading'].includes(job.status))
    return { ...video, file: null, ...(active ? { downloadId: active.id } : { needsDownload: true }) }
  }
  const { queueMusicVideo, waitForDownload } = require('./downloader')
  const queued = queueMusicVideo(video, options)
  if (queued.error) throw new Error(queued.error)
  if (!wait) return { ...video, downloadId: queued.downloadId }
  const job = await waitForDownload(queued.downloadId)
  const downloaded = peekDurableVideoFile(video.videoId, options)
  if (!downloaded || job?.status !== 'done') throw new Error(job?.error || 'Could not download the music video')
  return { ...video, file: downloaded }
}

function trackArtist(trackId) {
  try { return getDB().prepare('SELECT artist FROM tracks WHERE id = ?').get(trackId)?.artist } catch { return null }
}

/** Must run before the app is ready: lets <audio> stream (and seek) from lokal-stream://. */
function registerStreamScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }])
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']
const VIDEO_CHUNK = 2 * 1024 * 1024
const VIDEO_CHUNK_TIMEOUT_MS = 30000

// Why a video's stream last failed (shown to the player, which only sees a read error).
const videoErrors = new Map() // videoId -> message
function videoFailed(id, message) {
  if (videoErrors.size > 50) videoErrors.delete(videoErrors.keys().next().value)
  videoErrors.set(id, message)
  try { require('electron-log').info(`Music video stream: ${id}: ${message}`) } catch {}
}

/** At most `want` bytes of a response, then the connection let go. */
async function readUpTo(res, want) {
  const reader = res.body.getReader()
  const parts = []
  let size = 0
  while (size < want) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    size += value.length
  }
  if (size >= want) reader.cancel().catch(() => {})
  return Buffer.concat(parts.map(part => Buffer.from(part))).subarray(0, want)
}

/**
 * One piece of a music video, read whole: { body, from, to, total, mime, engine }.
 * YouTube is asked for the range as such, then (refused) open-ended, reading
 * only what's needed; still refused, with a fresh link the same two ways.
 * The error says what each try got.
 */
// The size of the file each video is being played from: every piece must
// come from that same file (a fresh link to another format, yt-dlp's after
// the fast engine's, would hand the player two files: "data source error").
const videoFiles = new Map() // videoId -> total bytes
function videoFile(id, total) {
  if (videoFiles.size > 50 && !videoFiles.has(id)) videoFiles.delete(videoFiles.keys().next().value)
  videoFiles.set(id, total)
}

async function videoChunk(id, from, to, fetchImpl, force = false, stop = null) {
  const upstream = new AbortController()
  const timer = setTimeout(() => upstream.abort(), VIDEO_CHUNK_TIMEOUT_MS)
  const abort = () => upstream.abort()
  stop?.addEventListener('abort', abort, { once: true })
  const at = `${(from / 1048576).toFixed(1)} MB in`
  const tried = []
  try {
    // The link in hand, then a fresh one from the same engine (the same
    // format, so the same file); another engine's only before the video has
    // started (from 0), when changing file is still possible.
    const links = [...(force ? [] : [{}]), { force: true, keepFast: true }, ...(from === 0 ? [{ force: true }] : [])]
    let previous = null
    for (const link of links) {
      const stream = await youtube.resolveStream(id, { ...streamOptions(), quality: 'video', ...link })
      if (previous === stream.url) continue
      previous = stream.url
      const engine = stream.engine || 'yt-dlp'
      for (const open of [false, true]) {
        let res
        try {
          res = await fetchImpl(stream.url, { headers: { ...stream.headers, Range: `bytes=${from}-${open ? '' : to}` }, signal: upstream.signal })
        } catch (error) {
          throw new Error(upstream.signal.aborted ? `YouTube took too long, ${at}` : `Couldn't reach YouTube ${at} (${error.message})`)
        }
        const span = String(res.headers.get('content-range') || '').match(/bytes (\d+)-(\d+)\/(\d+)/)
        const whole = res.status === 200 && from === 0 // a server that ignored the range
        if ((res.status === 206 && span) || whole) {
          let body
          try { body = await readUpTo(res, to - from + 1) } catch {
            throw new Error(upstream.signal.aborted ? `YouTube took too long, ${at} (${engine} link)` : `YouTube cut the video off ${at} (${engine} link)`)
          }
          if (!body.length) throw new Error(`YouTube sent nothing ${at} (${engine} link)`)
          const total = span ? Number(span[3]) : Number(res.headers.get('content-length')) || body.length
          const begin = span ? Number(span[1]) : 0
          const playing = videoFiles.get(id)
          if (from > 0 && playing && playing !== total) {
            tried.push(`another file (${total} bytes, not ${playing}), ${engine} link`)
            break
          }
          if (from === 0) videoFile(id, total)
          return { body, from: begin, to: begin + body.length - 1, total, mime: res.headers.get('content-type') || stream.mime, engine }
        }
        try { await res.body?.cancel?.() } catch {}
        tried.push(`HTTP ${res.status} ${open ? 'open range' : 'range'}, ${engine} link`)
        if (![400, 403, 416].includes(res.status)) break
      }
    }
    throw new Error(`YouTube refused the video ${at} (${tried.join('; ')})`)
  } finally { clearTimeout(timer); stop?.removeEventListener('abort', abort) }
}

/**
 * A music video's picture (lokal-stream://ytv/<id>). The player sees one
 * ordinary stream of what it asked for; behind it, YouTube is asked for
 * pieces of at most 2 MB (what its own player asks for: an open-ended range
 * is refused or slowed), the next one only as the player reads. Each piece
 * is read whole, so a stream the player drops or stops reading (the video
 * closed, paused, a seek) never holds a connection: those used to pile up
 * on the video's server (Chromium allows six per server) until it stopped
 * loading. A dropped stream's piece in progress is stopped. A piece that fails is asked for once more with a fresh link; a
 * fresh link to another file (another format) ends the stream rather than
 * mixing two files.
 */
async function videoStream(id, range, fetchImpl) {
  const asked = String(range || '').match(/^bytes=(\d+)-(\d*)$/)
  const start = asked ? Number(asked[1]) : 0
  // Not shared with other streams of the video: the player can read two at
  // once (the file's index from its end, say), and ending one breaks it.
  const stop = new AbortController()
  let first
  try { first = await videoChunk(id, start, start + VIDEO_CHUNK - 1, fetchImpl, false, stop.signal) } catch (error) {
    if (!stop.signal.aborted) videoFailed(id, error.message)
    throw error
  }
  videoErrors.delete(id)
  const last = Math.min(asked && asked[2] ? Number(asked[2]) : Infinity, first.total - 1)
  let next = first.to + 1
  let cancelled = false
  const piece = async (from, to) => {
    try { return await videoChunk(id, from, to, fetchImpl, false, stop.signal) } catch (error) {
      if (cancelled || stop.signal.aborted) throw error
      try { require('electron-log').info(`Music video stream: ${id}: ${error.message}; trying a fresh link`) } catch {}
      const again = await videoChunk(id, from, to, fetchImpl, true, stop.signal)
      if (again.total !== first.total) throw new Error(`YouTube gave another file for this video mid-way (${again.engine} link)`)
      return again
    }
  }
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(first.body.subarray(0, last - start + 1))
      if (first.to >= last) controller.close()
    },
    async pull(controller) {
      if (cancelled || next > last) return
      try {
        const got = await piece(next, Math.min(last, next + VIDEO_CHUNK - 1))
        if (cancelled) return
        controller.enqueue(got.body.subarray(0, last - got.from + 1))
        next = got.to + 1
        if (next > last) controller.close()
      } catch (error) {
        if (cancelled) return
        videoFailed(id, error.message)
        controller.error(error)
      }
    },
    cancel() {
      cancelled = true
      stop.abort()
    },
  }, { highWaterMark: 0 })
  return new Response(body, {
    status: 206,
    headers: { 'content-type': first.mime, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${last}/${first.total}`, 'content-length': String(last - start + 1) },
  })
}

/** lokal-stream://<provider>/<id>: a song's audio (YouTube, SoundCloud), with Range support for seeking; ytv: a music video's picture. */
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
      if (provider === 'ytv') {
        // The player asking why the video's stream failed.
        if (request.headers.get('x-lokal-why')) return new Response(videoErrors.get(id) || '', { status: 200, headers: { 'content-type': 'text/plain' } })
        return await videoStream(id, request.headers.get('Range'), (u, init) => net.fetch(u, init))
      }
      // Electron doesn't fire request.signal when the player drops a stream
      // (next song, seek); it cancels the response body. The request to the
      // media server must be aborted then, or its connection stays open: after
      // six (Chromium's limit per server) every new stream from that server
      // waits forever, and songs stop playing until Lokal restarts.
      const upstream = new AbortController()
      request.signal?.addEventListener?.('abort', () => upstream.abort(), { once: true })
      const fetchImpl = (u, init) => net.fetch(u, init)
      const range = request.headers.get('Range')
      const { res, mime } = await sources.fetchStream(provider, id, { ...streamOptions(), range, signal: upstream.signal, fetchImpl })
      const headers = new Headers()
      for (const name of PASS_HEADERS) { const v = res.headers.get(name); if (v) headers.set(name, v) }
      if (!headers.has('content-type')) headers.set('content-type', mime)
      return new Response(sources.cancellableBody(res.body, () => upstream.abort()), { status: res.status, headers })
    } catch (e) {
      return new Response(String(e.message || e), { status: 502, headers: { 'content-type': 'text/plain' } })
    }
  })
}

module.exports = { registerOnlineHandlers, registerStreamScheme, registerStreamProtocol, search, streamOptions, providers, songAudioFor, resolvedSourceAudio, listMusicVideos, prepareMusicVideoFor }
