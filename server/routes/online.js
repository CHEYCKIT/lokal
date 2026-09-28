// Online results (YouTube Music) for web mode. Same as the desktop app's
// online IPC, plus /stream/:videoId, which relays the audio through this
// server: YouTube's audio URLs only work from the address that asked for
// them, which is this server, not the browser.

const router = require('express').Router()
const { Readable } = require('stream')
const { getDB } = require('../../electron/ipc/db')
const { cookieArgs } = require('../../electron/ipc/ytCookies')
const { runJsonSearch, mapSearchResult } = require('../../electron/download/search')
const yt = require('../../electron/online/youtube')

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
  const cookies = cookieArgs(settings())
  return { ytdlp: ytdlp(), cookieArgs: cookies.args, cookieBrowser: cookies.usedBrowser }
}

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200)
  try {
    res.json({ results: await yt.searchSongs(q, { limit: 10 }) })
  } catch (e) {
    const bin = ytdlp()
    if (!bin) return res.json({ error: e.message, results: [] })
    const found = await runJsonSearch(bin, q, mapSearchResult, 1, 10)
    res.json({
      fallback: true,
      results: (found.results || []).map(r => ({
        videoId: r.id, title: r.title, artist: r.channel, artists: [r.channel], album: null,
        duration: r.duration || null, thumbnail: r.thumbnail, kind: r.topic ? 'song' : 'video', official: !!r.official, url: r.url,
      })),
    })
  }
})

router.post('/save', (req, res) => {
  try { res.json(yt.saveOnlineTracks(getDB(), req.body?.items)) } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/prepare/:videoId', async (req, res) => {
  try { await yt.resolveStream(req.params.videoId, { ...streamOptions(), force: req.query.force === '1' }); res.json({ ok: true }) } catch (e) { res.json({ error: e.message }) }
})

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

router.get('/stream/:videoId', async (req, res) => {
  let upstream
  try {
    const { res: r, mime } = await yt.fetchStream(req.params.videoId, { ...streamOptions(), range: req.headers.range })
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
  req.on('close', () => body.destroy())
  body.on('error', () => res.end())
  body.pipe(res)
})

module.exports = router
