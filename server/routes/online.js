// Online results (YouTube Music, SoundCloud) for web mode. Same as the desktop app's
// online IPC, plus /stream/:provider/:id, which relays the audio through this
// server: YouTube's audio URLs only work from the address that asked for
// them, which is this server, not the browser.

const router = require('express').Router()
const { Readable } = require('stream')
const { getDB } = require('../../electron/ipc/db')
const { cookieArgs } = require('../../electron/ipc/ytCookies')
const { runJsonSearch, mapSearchResult } = require('../../electron/download/search')
const sources = require('../../electron/online/sources')

/** yt-dlp, found the same way the web downloader finds it. */
function ytdlp() {
  return require('./download').findBinary('yt-dlp')
}

/** All settings as { key: value }. */
function settings() {
  try { return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])) } catch { return {} }
}

/** yt-dlp and the user's YouTube cookie options, for resolving streams. */
function streamOptions() {
  const all = settings()
  const cookies = cookieArgs(all)
  return { quality: all.online_quality === 'saver' ? 'saver' : 'best', ytdlp: ytdlp(), cookieArgs: cookies.args, cookieBrowser: cookies.usedBrowser }
}

/** Plain YouTube search through yt-dlp, for when YouTube Music can't be reached. */
async function youtubeFallback(query) {
  const bin = ytdlp()
  if (!bin) throw new Error('YouTube Music could not be reached, and yt-dlp is not installed.')
  const found = await runJsonSearch(bin, String(query || ''), mapSearchResult, 1, 10)
  return (found.results || []).map(r => ({
    videoId: r.id, title: r.title, artist: r.channel, artists: [r.channel], album: null,
    duration: r.duration || null, thumbnail: r.thumbnail, kind: r.topic ? 'song' : 'video', official: !!r.official, url: r.url,
  }))
}

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200)
  const provider = sources.providerOf(String(req.query.provider || '')) ? String(req.query.provider) : 'yt'
  try {
    res.json(await sources.search(provider, q, { ytdlp: ytdlp(), fallbackSearch: youtubeFallback }))
  } catch (e) {
    res.json({ error: e.message, results: [] })
  }
})

router.post('/save', (req, res) => {
  try { res.json(sources.saveOnlineTracks(getDB(), req.body?.items)) } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/prepare/:provider/:id', async (req, res) => {
  try {
    const stream = await sources.resolveStream(req.params.provider, req.params.id, { ...streamOptions(), force: req.query.force === '1' })
    res.json({ ok: true, preview: !!stream.preview })
  } catch (e) { res.json({ error: e.message }) }
})

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

router.get('/stream/:provider/:id', async (req, res) => {
  let upstream
  try {
    const { res: r, mime } = await sources.fetchStream(req.params.provider, req.params.id, { ...streamOptions(), range: req.headers.range })
    upstream = r
    res.status(r.status)
    for (const name of PASS_HEADERS) { const v = r.headers.get(name); if (v) res.setHeader(name, v) }
    if (!r.headers.get('content-type')) res.setHeader('content-type', mime)
    res.setHeader('cache-control', 'no-store')
  } catch (e) {
    return res.status(502).type('text/plain').send(String(e.message || e))
  }
  if (!upstream.body) return res.end()
  const body = Readable.fromWeb(upstream.body)
  // Skipping to another song aborts this request: stop fetching from YouTube too.
  res.on('close', () => {
    if (!res.writableFinished) body.destroy()
  })
  body.on('error', () => res.end())
  body.pipe(res)
})

module.exports = router
