// SoundCloud as an online source, through the user's own yt-dlp (SoundCloud
// has no open API): search with `scsearch`, stream the progressive MP3.
// Tracks behind SoundCloud Go+ only give a 30-second preview; those are
// flagged so the UI can say so.

const { spawn } = require('child_process')

const TRACK_ID = /^\d{1,20}$/
const SEARCH_TTL_MS = 10 * 60 * 1000
const STREAM_TTL_MS = 20 * 60 * 1000
const RUN_TIMEOUT_MS = 30000

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
    artist: entry.uploader || entry.artist || '',
    artists: [entry.uploader || entry.artist].filter(Boolean),
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

/** The audio URL for a track: the progressive MP3 (seekable), cached for a while. */
async function resolveStream(id, { ytdlp, force = false } = {}) {
  if (!TRACK_ID.test(String(id || ''))) throw new Error('Not a SoundCloud track id')
  if (!ytdlp) throw new Error('yt-dlp is not installed. Install it from the Download page.')
  const cached = streamCache.get(id)
  if (!force && cached && cached.expiresAt > Date.now()) return cached
  if (!force && resolving.has(id)) return resolving.get(id)
  const job = runJson(ytdlp, ['-j', '--no-warnings', '--no-playlist', '-f', 'http_mp3_1_0/http_mp3_0_0_preview/bestaudio[protocol=http]/bestaudio[protocol=https]', trackUrl(id)])
    .then(info => {
      if (!info?.url) throw new Error('SoundCloud has no playable stream for this track.')
      const stream = {
        url: info.url,
        headers: info.http_headers || {},
        mime: info.ext === 'mp3' ? 'audio/mpeg' : 'audio/*',
        expiresAt: Date.now() + STREAM_TTL_MS,
        preview: /preview/i.test(String(info.format_id || '')),
      }
      if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value)
      streamCache.set(id, stream)
      return stream
    })
    .finally(() => resolving.delete(id))
  resolving.set(id, job)
  return job
}

module.exports = { searchTracks, resolveStream, mapEntry, idFromUrl, trackUrl }
