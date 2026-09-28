// Online results from YouTube Music, streamed with the user's own yt-dlp:
// the same source the downloader already uses, played instead of saved.
// Shared by the desktop app (IPC + the lokal-stream:// protocol) and the web
// server (/api/online).
//
//   - search: YouTube Music's own search (the "Songs" tab), so results carry
//     the artist, album, duration and square cover art;
//   - stream: yt-dlp works out the audio URL (Opus when there is one), cached
//     until shortly before it expires, and fetched again once if YouTube
//     refuses it (an expired or IP-bound URL);
//   - keeping online songs as ghost tracks (for playlists, likes, history)
//     is shared with the other sources: see sources.js.

const { spawn } = require('child_process')
const { isCookieError, markUnreadable } = require('../ipc/ytCookies')

const SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false'
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20250901.03.00', hl: 'en' }
// YouTube Music's "Songs" filter, as its own web client sends it.
const SONGS_PARAMS = 'EgWKAQIIAWoOEAkQAxAEEAUQChAVEA4%3D'
const VIDEO_ID = /^[\w-]{11}$/
const DURATION = /^(?:\d+:)?\d{1,2}:\d{2}$/
const SEARCH_TTL_MS = 10 * 60 * 1000
const STREAM_MARGIN_MS = 10 * 60 * 1000
const RESOLVE_TIMEOUT_MS = 30000

const searchCache = new Map() // query -> { at, results }
const streamCache = new Map() // videoId -> { url, headers, mime, expiresAt }
const resolving = new Map()   // videoId -> Promise

/** "3:07" or "1:02:03" -> seconds; null when it isn't a duration. */
function parseDuration(text) {
  if (!DURATION.test(String(text || '').trim())) return null
  return String(text).trim().split(':').map(Number).reduce((total, part) => total * 60 + part, 0)
}

/** The runs (text pieces) of one flex column of a list item. */
function columnRuns(renderer, index) {
  return renderer?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
}

/** A bigger square cover than the 60px one in search results. */
function largerThumbnail(url) {
  if (!url) return null
  return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^&?]*$/, '=w544-h544-l90-rj') : url
}

/** One song or video row of a YouTube Music search, or null for anything else. */
function parseItem(renderer) {
  const titleRuns = columnRuns(renderer, 0)
  const watch = titleRuns[0]?.navigationEndpoint?.watchEndpoint
  const videoId = renderer?.playlistItemData?.videoId || watch?.videoId
  if (!videoId || !VIDEO_ID.test(videoId)) return null
  const videoType = watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || ''

  const artists = []
  let album = null
  let albumId = null
  let duration = null
  const loose = []
  for (const run of columnRuns(renderer, 1)) {
    const text = String(run.text || '').trim()
    if (!text || text === '•') continue
    const browse = run.navigationEndpoint?.browseEndpoint
    const pageType = browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || ''
    if (pageType.endsWith('_ARTIST') || pageType.endsWith('_USER_CHANNEL')) artists.push(text)
    else if (pageType.endsWith('_ALBUM')) { album = text; albumId = browse.browseId || null }
    else if (parseDuration(text) != null) duration = parseDuration(text)
    else loose.push(text)
  }
  // Unfiltered results start with the kind ("Song", "Video"); an artist
  // without a channel link is plain text.
  const kind = /^(song|video|episode)$/i.test(loose[0] || '') ? loose.shift().toLowerCase() : null
  if (kind === 'episode') return null
  if (!artists.length) {
    const name = loose.find(t => !/\b(views|plays)$/i.test(t))
    if (name) artists.push(name)
  }

  const thumbs = renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
  return {
    videoId,
    title: titleRuns.map(r => r.text).join('').trim(),
    artists,
    artist: artists.join(', '),
    album,
    albumId,
    duration,
    thumbnail: largerThumbnail(thumbs[thumbs.length - 1]?.url),
    // ATV = the audio track from the catalogue; OMV = official music video.
    kind: kind || (videoType === 'MUSIC_VIDEO_TYPE_ATV' ? 'song' : 'video'),
    official: videoType === 'MUSIC_VIDEO_TYPE_ATV' || videoType === 'MUSIC_VIDEO_TYPE_OMV',
    url: `https://music.youtube.com/watch?v=${videoId}`,
  }
}

/** Every song/video row in a search response, in order, without repeats. */
function parseSearch(json) {
  const found = []
  const seen = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.musicResponsiveListItemRenderer) {
      const item = parseItem(node.musicResponsiveListItemRenderer)
      if (item && !seen.has(item.videoId)) { seen.add(item.videoId); found.push(item) }
      return
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(json)
  return found
}

async function innertubeSearch(query, params, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ context: { client: CLIENT }, query, ...(params ? { params } : {}) }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`)
    return parseSearch(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Songs on YouTube Music for `query`: the Songs tab, or, where YouTube Music
 * has no catalogue for the region, the songs and official videos of the
 * general search. Cached for ten minutes.
 */
async function searchSongs(query, { limit = 10, fetchImpl = fetch } = {}) {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const key = q.toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results.slice(0, limit)
  let results = await innertubeSearch(q, SONGS_PARAMS, fetchImpl)
  if (!results.length) {
    const all = await innertubeSearch(q, null, fetchImpl)
    results = all.filter(r => r.kind === 'song' || r.official)
  }
  if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value)
  searchCache.set(key, { at: Date.now(), results })
  return results.slice(0, limit)
}

// ---------------------------------------------------------------- streams

function expiryOf(url) {
  try {
    const expire = Number(new URL(url).searchParams.get('expire'))
    if (expire > 0) return expire * 1000 - STREAM_MARGIN_MS
  } catch {}
  return Date.now() + 60 * 60 * 1000
}

/** A readable reason from yt-dlp's error output. */
function streamError(text) {
  if (/confirm you.re not a bot/i.test(text)) return 'YouTube asked to confirm you are not a bot. Turn on YouTube cookies in Settings → Library.'
  if (/Sign in to confirm your age/i.test(text)) return 'This song is age-restricted. Turn on YouTube cookies in Settings → Library to play it.'
  if (/not available|unavailable|Private video|removed/i.test(text)) return 'This song is not available on YouTube.'
  if (/HTTP Error 429|Too Many Requests/i.test(text)) return 'YouTube is rate-limiting. Try again in a while.'
  const line = String(text).split('\n').reverse().find(l => /ERROR:/.test(l))
  return line ? line.replace(/^.*?ERROR:\s*/, '').slice(0, 200) : 'Could not get the audio from YouTube.'
}

function runResolve(videoId, { ytdlp, cookieArgs = [] }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestaudio[acodec=opus]/bestaudio[ext=m4a]/bestaudio',
      '-j', '--no-playlist', '--no-warnings', '--skip-download',
      ...cookieArgs,
      `https://music.youtube.com/watch?v=${videoId}`,
    ]
    let proc
    try { proc = spawn(ytdlp, args, { windowsHide: true }) } catch (e) { reject(new Error(`Could not run yt-dlp (${e.message})`)); return }
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { proc.kill() } catch {} }, RESOLVE_TIMEOUT_MS)
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('error', e => { clearTimeout(timer); reject(new Error(`Could not run yt-dlp (${e.message})`)) })
    proc.on('close', () => {
      clearTimeout(timer)
      let info = null
      try { info = JSON.parse(out.trim().split('\n').pop()) } catch {}
      const output = err || out
      if (!info?.url) {
        if (isCookieError(output)) {
          const error = new Error('YouTube cookies could not be read')
          error.cookieError = true
          reject(error)
          return
        }
        reject(new Error(streamError(output)))
        return
      }
      const ext = info.ext || ''
      resolve({
        url: info.url,
        headers: info.http_headers || {},
        mime: ext === 'webm' ? 'audio/webm' : ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : 'audio/*',
        expiresAt: expiryOf(info.url),
      })
    })
  })
}

/** The audio URL for a video, from cache or yt-dlp (one lookup at a time per video). */
async function resolveStream(videoId, { ytdlp, cookieArgs, cookieBrowser = null, force = false } = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('Not a YouTube video id')
  if (!ytdlp) throw new Error('yt-dlp is not installed. Install it from the Download page.')
  const cached = streamCache.get(videoId)
  if (!force && cached && cached.expiresAt > Date.now()) return cached
  if (!force && resolving.has(videoId)) return resolving.get(videoId)
  const job = (async () => {
    try {
      return await runResolve(videoId, { ytdlp, cookieArgs })
    } catch (e) {
      if (!cookieBrowser || !e.cookieError) throw e
      markUnreadable(cookieBrowser)
      return runResolve(videoId, { ytdlp, cookieArgs: [] })
    }
  })().then(stream => {
    if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value)
    streamCache.set(videoId, stream)
    return stream
  })
    .finally(() => resolving.delete(videoId))
  resolving.set(videoId, job)
  return job
}

/**
 * Fetch (a range of) the audio for a video. A refused URL (expired, or tied
 * to another address) is looked up again once.
 */
async function fetchStream(videoId, { range, ytdlp, cookieArgs, cookieBrowser, fetchImpl = fetch } = {}) {
  const attempt = async (force) => {
    const stream = await resolveStream(videoId, { ytdlp, cookieArgs, cookieBrowser, force })
    const headers = { ...stream.headers }
    if (range) headers.Range = range
    return { stream, res: await fetchImpl(stream.url, { headers }) }
  }
  let { stream, res } = await attempt(false)
  if (res.status === 403 || res.status === 410) {
    try { await res.body?.cancel?.() } catch {}
    ;({ stream, res } = await attempt(true))
  }
  return { res, mime: stream.mime }
}

/** A YouTube video id from a youtube.com / music.youtube.com / youtu.be link, or null. */
function videoIdFromUrl(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

module.exports = {
  searchSongs, parseSearch, parseItem, parseDuration,
  resolveStream, fetchStream, streamError, videoIdFromUrl,
}
