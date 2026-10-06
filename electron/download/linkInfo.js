// What a link pasted into Search is: its title, who made it and its cover,
// for the link card (Search -> Link). YouTube and SoundCloud answer through
// their oEmbed endpoints (about 0.2 s, no key, songs and playlists alike).
// Anything they can't answer (a private or unlisted playlist, Bandcamp, which
// shows a bot check to plain requests) is read with yt-dlp instead, with the
// cookies set up in Settings, like the playlist importer does.
// Only those fixed hosts are fetched: never the pasted link itself.

const { spawn } = require('child_process')
const { cookieArgs } = require('../ipc/ytCookies')
const { jsRuntime } = require('../online/jsRuntime')
const { isYouTube, isSoundCloud } = require('./args')

const OEMBED_TIMEOUT_MS = 6000
const YTDLP_TIMEOUT_MS = 45000
const CACHE_MAX = 50
const cache = new Map()

const text = (value, max = 300) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && url.href.length <= 1000 ? url.href : null
  } catch {
    return null
  }
}

/** YouTube's hqdefault is 4:3 with black bars; mqdefault is the frame itself (and a topic upload's square cover sits in its middle). */
function youtubeThumb(url) {
  const safe = httpsUrl(url)
  if (!safe) return null
  return safe.replace(/^(https:\/\/i\.ytimg\.com\/vi\/[\w-]{11})\/hqdefault\.jpg$/, '$1/mqdefault.jpg')
}

function linkProblem(link) {
  let url
  try { url = new URL(String(link || '').trim()) } catch { return 'Not a link.' }
  if (!/^https?:$/.test(url.protocol)) return 'Not a web link.'
  return null
}

async function oembed(link, { fetchImpl, timeoutMs }) {
  const youtube = isYouTube(link)
  const endpoint = youtube ? 'https://www.youtube.com/oembed' : isSoundCloud(link) ? 'https://soundcloud.com/oembed' : null
  if (!endpoint) return null
  const res = await fetchImpl(`${endpoint}?${new URLSearchParams({ format: 'json', url: link })}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res?.ok) return null
  const data = await res.json().catch(() => null)
  const author = text(data?.author_name, 200)
  let title = text(data?.title, 300)
  // SoundCloud titles read "Song by Artist".
  if (!youtube && author && title.toLowerCase().endsWith(` by ${author.toLowerCase()}`)) title = title.slice(0, -(author.length + 4)).trim()
  if (!title) return null
  return { title, author: author || null, thumbnail: youtube ? youtubeThumb(data?.thumbnail_url) : httpsUrl(data?.thumbnail_url) }
}

function bestThumbnail(data) {
  const listed = (Array.isArray(data?.thumbnails) ? data.thumbnails : []).filter(t => httpsUrl(t?.url))
  const sized = listed.filter(t => Number(t.width) > 0 && Number(t.height) > 0)
  const best = sized.length
    ? sized.reduce((a, b) => (Number(b.width) * Number(b.height) > Number(a.width) * Number(a.height) ? b : a))
    : listed[listed.length - 1]
  return httpsUrl(best?.url) || httpsUrl(data?.thumbnail) || null
}

/** yt-dlp's answer (one item of a playlist at most) as { title, author, thumbnail, count }. */
function parseYtdlp(stdout) {
  let data
  try { data = JSON.parse(stdout) } catch { return null }
  const title = text(data?.title || data?.playlist_title || data?.album, 300)
  if (!title) return null
  const count = Number(data?.playlist_count)
  const first = Array.isArray(data?.entries) ? data.entries[0] : null
  return {
    title,
    author: text(data?.uploader || data?.channel || data?.artist || data?.album_artist, 200) || null,
    // A playlist without art of its own shows its first song's.
    thumbnail: bestThumbnail(data) || bestThumbnail(first),
    count: Number.isFinite(count) && count > 0 ? count : null,
  }
}

function ytdlpInfo(link, { ytdlp, settings, spawnImpl = spawn, timeoutMs }) {
  if (!ytdlp) return Promise.resolve(null)
  const cookies = cookieArgs(settings || {}, { url: link })
  const runtime = isYouTube(link) ? jsRuntime() : { args: [], options: {} }
  const args = [
    '--flat-playlist', '--dump-single-json', '--playlist-items', '1', '--no-warnings', '--quiet',
    ...cookies.args, ...runtime.args,
    '--', link,
  ]
  return new Promise((resolve) => {
    let proc
    try { proc = spawnImpl(ytdlp, args, { windowsHide: true, ...runtime.options }) } catch { resolve(null); return }
    let stdout = ''
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stdout.on('data', d => { if (stdout.length < 4_000_000) stdout += d.toString() })
    proc.stderr?.on('data', () => {})
    proc.on('error', () => { clearTimeout(timer); resolve(null) })
    proc.on('close', () => { clearTimeout(timer); resolve(parseYtdlp(stdout)) })
  })
}

/**
 * { title, author, thumbnail, count } for a pasted link, or { error }.
 * Answers are kept for the session (a link is often pasted, edited, pasted back).
 */
async function linkInfo(url, { ytdlp = null, settings = {}, fetchImpl = fetch, spawnImpl, oembedTimeoutMs = OEMBED_TIMEOUT_MS, ytdlpTimeoutMs = YTDLP_TIMEOUT_MS } = {}) {
  const problem = linkProblem(url)
  if (problem) return { error: problem }
  const link = String(url).trim()
  if (cache.has(link)) return cache.get(link)
  const pending = (async () => {
    const quick = await oembed(link, { fetchImpl, timeoutMs: oembedTimeoutMs }).catch(() => null)
    const info = quick || await ytdlpInfo(link, { ytdlp, settings, spawnImpl, timeoutMs: ytdlpTimeoutMs })
    return info ? { ok: true, ...info } : { error: "Couldn't read that link." }
  })()
  cache.set(link, pending)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  const result = await pending
  // A failure (offline, a slow moment) is asked again next time.
  if (result.error) cache.delete(link)
  return result
}

module.exports = { linkInfo, parseYtdlp, _clear: () => cache.clear() }
