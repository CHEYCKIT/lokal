// SoundCloud as an online source, through the user's own yt-dlp (SoundCloud
// has no open API): search with `scsearch`, stream the progressive MP3.
// Tracks behind SoundCloud Go+ only give a 30-second preview; those are
// flagged so the UI can say so.

const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const TRACK_ID = /^\d{1,20}$/
const SEARCH_TTL_MS = 10 * 60 * 1000
const STREAM_TTL_MS = 20 * 60 * 1000
const RUN_TIMEOUT_MS = 30000
const HLS_PIECE_TIMEOUT_MS = 20000
const HLS_PARALLEL = 6
// Prefer the progressive stream, then full HLS formats, and only then the Go+ preview.
const FORMAT = [
  'http_mp3_1_0',
  'bestaudio[protocol=http][format_id!*=preview]',
  'bestaudio[protocol=https][format_id!*=preview]',
  'hls_aac_160k',
  'hls_aac_96k',
  'hls_mp3_1_0',
  'bestaudio[protocol=m3u8_native][format_id!*=preview][ext=m4a]',
  'bestaudio[protocol=m3u8_native][format_id!*=preview][ext=mp3]',
  'http_mp3_0_0_preview',
  'bestaudio',
].join('/')

const searchCache = new Map() // query -> { at, results }
const streamCache = new Map() // id -> { url, headers, mime, expiresAt, preview }
const resolving = new Map()   // id -> Promise

/** The canonical yt-dlp URL for a SoundCloud track id. */
function trackUrl(id) {
  return `https://api.soundcloud.com/tracks/${id}`
}

/** A SoundCloud track id from an api.soundcloud.com URL (plain or "soundcloud:tracks:" form). */
function idFromUrl(url) {
  const m = String(url || '').match(/api\.soundcloud\.com\/tracks\/(?:soundcloud(?:%3A|:)tracks(?:%3A|:))?(\d+)/i)
  return m ? m[1] : null
}

/** Run yt-dlp and parse its JSON output (last line). */
function runJson(ytdlp, args) {
  return new Promise((resolve, reject) => {
    let proc
    try { proc = spawn(ytdlp, args, { windowsHide: true }) } catch (e) { reject(new Error(`Could not run yt-dlp (${e.message})`)); return }
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { proc.kill() } catch {} }, RUN_TIMEOUT_MS)
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('error', e => { clearTimeout(timer); reject(new Error(`Could not run yt-dlp (${e.message})`)) })
    proc.on('close', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(out.trim().split('\n').pop())) } catch {
        const line = String(err).split('\n').reverse().find(l => /ERROR:/.test(l))
        reject(new Error(line ? line.replace(/^.*?ERROR:\s*/, '').slice(0, 200) : 'SoundCloud did not answer.'))
      }
    })
  })
}

/** The biggest square cover (t500x500) from yt-dlp's thumbnail list. */
function coverOf(entry) {
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : []
  const pick = thumbs.find(t => t.id === 't500x500') || thumbs.find(t => t.id === 't300x300') || thumbs[thumbs.length - 1]
  return pick?.url || entry.thumbnail || null
}

/** One search entry as an online result. */
function mapEntry(entry) {
  const id = idFromUrl(entry.url) || (TRACK_ID.test(String(entry.id || '')) ? String(entry.id) : null)
  if (!id) return null
  const duration = Number(entry.duration) || null
  return {
    provider: 'sc',
    id,
    title: entry.title || 'Unknown Track',
    artist: entry.artist || entry.uploader || '',
    artists: [entry.artist || entry.uploader].filter(Boolean),
    album: null,
    duration,
    thumbnail: coverOf(entry),
    kind: 'song',
    // Go+ tracks only offer a 30-second preview to everyone else.
    preview: duration != null && Math.round(duration) === 30,
    url: trackUrl(id),
  }
}

/** Tracks on SoundCloud for `query` (cached ten minutes). */
async function searchTracks(query, { ytdlp, limit = 10 } = {}) {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  if (!ytdlp) throw new Error('yt-dlp is not installed. Install it from the Download page.')
  const key = q.toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results.slice(0, limit)
  const json = await runJson(ytdlp, ['--flat-playlist', '-J', '--no-warnings', `scsearch${Math.max(1, Math.min(limit, 30))}:${q}`])
  const results = (json?.entries || []).map(mapEntry).filter(Boolean)
  if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value)
  searchCache.set(key, { at: Date.now(), results })
  return results.slice(0, limit)
}

/**
 * HLS-only SoundCloud tracks are joined into the same bounded playback cache as
 * other playable copies. Lokal's online source layer already serves { type:
 * 'file' } streams with HTTP Range support, so seeking works like a local copy.
 */
function hlsDir() {
  try {
    const dir = require('../cache').cacheDir('playback')
    if (dir) return dir
  } catch {}
  return path.join(os.tmpdir(), 'lokal-playback-cache')
}

const MIME_OF_EXT = {
  m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg',
  aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg',
}
const safeName = value => String(value || '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'hls'

/** A previously joined HLS stream, or null. Prefer full streams over previews. */
function joinedFile(id) {
  let names
  try {
    names = fs.readdirSync(hlsDir()).filter(name =>
      name.startsWith(`sc-${id}-`) && !/\.part(?:\.|$)|\.tmp$/.test(name)
    )
  } catch { return null }
  if (!names.length) return null
  names.sort((a, b) => Number(/preview/i.test(a)) - Number(/preview/i.test(b)))
  const name = names[0]
  const file = path.join(hlsDir(), name)
  try {
    const now = new Date()
    fs.utimesSync(file, now, now)
  } catch {}
  const ext = path.extname(file).slice(1).toLowerCase()
  return { file, mime: MIME_OF_EXT[ext] || 'audio/*', preview: /preview/i.test(name) }
}

async function fetchChecked(url, headers, fetchImpl, as = 'bytes', signal = null) {
  let requestSignal = AbortSignal.timeout(HLS_PIECE_TIMEOUT_MS)
  if (signal) requestSignal = AbortSignal.any([signal, requestSignal])
  const response = await fetchImpl(url, { headers, signal: requestSignal })
  if (!response.ok) {
    try { await response.body?.cancel?.() } catch {}
    throw new Error(`SoundCloud refused a piece of the track (HTTP ${response.status}).`)
  }
  return as === 'text' ? response.text() : Buffer.from(await response.arrayBuffer())
}

/** Resolve the init fragment and media segments of an HLS media playlist. */
function hlsPieces(playlist, base) {
  const lines = String(playlist || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('SoundCloud sent no playlist for this track.')
  if (lines.some(line => line.startsWith('#EXT-X-STREAM-INF'))) throw new Error('Unexpected SoundCloud master playlist.')
  const key = lines.find(line => line.startsWith('#EXT-X-KEY'))
  if (key && !/METHOD=NONE/i.test(key)) throw new Error('This SoundCloud track is encrypted and cannot be played.')
  const init = lines.find(line => line.startsWith('#EXT-X-MAP'))?.match(/URI="([^"]+)"/)?.[1] || null
  const media = lines.filter(line => !line.startsWith('#'))
  if (!media.length) throw new Error('SoundCloud sent an empty playlist for this track.')
  const full = value => {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('SoundCloud sent an invalid media URL.')
    return url.href
  }
  return { init: init ? full(init) : null, media: media.map(full) }
}

/** Fetches every HLS piece with bounded concurrency, then atomically publishes the file. */
async function joinHls(playlistUrl, file, { headers = {}, fetchImpl = globalThis.fetch, signal = null } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener?.('abort', abort, { once: true })
  try {
    const playlist = await fetchChecked(playlistUrl, headers, fetchImpl, 'text', controller.signal)
    const { init, media } = hlsPieces(playlist, playlistUrl)
    const urls = init ? [init, ...media] : media
    const parts = new Array(urls.length)
    let next = 0
    const worker = async () => {
      while (next < urls.length) {
        if (controller.signal.aborted) throw new Error('SoundCloud stream cancelled.')
        const index = next++
        let lastError = null
        for (let attempt = 0; attempt < 3 && parts[index] == null; attempt++) {
          try {
            parts[index] = await fetchChecked(urls[index], headers, fetchImpl, 'bytes', controller.signal)
          } catch (error) {
            lastError = error
            if (controller.signal.aborted) throw error
          }
        }
        if (parts[index] == null) throw lastError || new Error('Could not fetch SoundCloud audio.')
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(HLS_PARALLEL, urls.length) }, worker))
    } catch (error) {
      controller.abort()
      throw error
    }
    if (controller.signal.aborted) throw new Error('SoundCloud stream cancelled.')
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.part`
    await fsp.writeFile(temp, Buffer.concat(parts))
    try {
      if (fs.existsSync(file)) await fsp.unlink(file)
      await fsp.rename(temp, file)
    } catch (error) {
      await fsp.unlink(temp).catch(() => {})
      throw error
    }
    return file
  } finally {
    signal?.removeEventListener?.('abort', abort)
  }
}

/** Resolve the progressive URL, or join HLS pieces into a seekable cache file. */
async function resolveStream(id, { ytdlp, force = false, fetchImpl = globalThis.fetch, signal = null } = {}) {
  if (!TRACK_ID.test(String(id || ''))) throw new Error('Not a SoundCloud track id')
  const cached = streamCache.get(id)
  if (!force && cached && cached.expiresAt > Date.now() && (!cached.file || fs.existsSync(cached.file))) return cached
  if (!force && resolving.has(id)) return resolving.get(id)
  const joined = joinedFile(id)
  if (joined) {
    const stream = { type: 'file', headers: {}, expiresAt: Date.now() + STREAM_TTL_MS, ...joined }
    streamCache.set(id, stream)
    return stream
  }
  if (!ytdlp) throw new Error('yt-dlp is not installed. Install it from the Download page.')
  const job = runJson(ytdlp, ['-j', '--no-warnings', '--no-playlist', '-f', FORMAT, trackUrl(id)])
    .then(async info => {
      if (!info?.url) throw new Error('SoundCloud has no playable stream for this track.')
      const preview = /preview/i.test(String(info.format_id || ''))
      const ext = String(info.ext || '').toLowerCase()
      const mime = MIME_OF_EXT[ext] || (ext === 'mp3' ? 'audio/mpeg' : 'audio/*')
      let stream
      if (/m3u8/i.test(String(info.protocol || ''))) {
        const extension = Object.prototype.hasOwnProperty.call(MIME_OF_EXT, ext) ? ext : 'm4a'
        const suffix = safeName(info.format_id || 'hls')
        const file = path.join(hlsDir(), `sc-${id}-${suffix}.${extension}`)
        await joinHls(info.url, file, { headers: info.http_headers || {}, fetchImpl, signal })
        stream = { type: 'file', file, headers: {}, mime: MIME_OF_EXT[extension], expiresAt: Date.now() + STREAM_TTL_MS, preview }
        try { require('../cache').trim({ keep: [file] }) } catch {}
      } else {
        stream = { url: info.url, headers: info.http_headers || {}, mime, expiresAt: Date.now() + STREAM_TTL_MS, preview }
      }
      if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value)
      streamCache.set(id, stream)
      return stream
    })
    .finally(() => resolving.delete(id))
  resolving.set(id, job)
  return job
}

module.exports = { searchTracks, resolveStream, mapEntry, idFromUrl, trackUrl, hlsPieces, joinHls }
