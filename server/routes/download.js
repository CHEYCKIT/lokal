// Web-mode download routes. The queue is electron/download/manager.js, the
// same one the desktop app uses (in the desktop app both run in one process
// and share it); standalone, the server configures it with plain PATH tools.

const router = require('express').Router()
const fs = require('fs-extra')
const { execFileSync } = require('child_process')
const { getDB, getStorageDir } = require('../../electron/ipc/db')
const { getDownloadManager } = require('../../electron/download/manager')
const { runJsonSearch, mapSearchResult, mapArtistResult } = require('../../electron/download/search')

const found = new Map()
function findBinary(name, versionFlag = '--version') {
  if (found.has(name)) return found.get(name)
  const candidates = process.platform === 'win32' ? [`${name}.exe`, name] : [name]
  let hit = null
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, [versionFlag], { stdio: 'ignore', windowsHide: true, timeout: 15000 })
      hit = candidate
      break
    } catch {}
  }
  // Only a hit is remembered, so installing yt-dlp later works without a restart.
  if (hit) found.set(name, hit)
  return hit
}

function manager() {
  return getDownloadManager().configure({
    getDB,
    getStorageDir,
    findTools: () => ({ ytdlp: findBinary('yt-dlp'), ffmpeg: null, ffprobe: null }),
    requireFfmpeg: false,
    index: null,
    emit: () => {},
  }, 0)
}

router.get('/search', async (req, res) => {
  const { q, page = 1 } = req.query
  if (!q) return res.json({ results: [], page: 1, hasMore: false })
  const ytdlp = findBinary('yt-dlp')
  if (!ytdlp) return res.status(500).json({ error: 'yt-dlp not found', results: [], page: 1, hasMore: false })
  const result = await runJsonSearch(ytdlp, q, mapSearchResult, page, 10)
  res.status(result.error ? 500 : 200).json(result)
})

router.get('/artist-search', async (req, res) => {
  const { q, page = 1 } = req.query
  if (!q) return res.json({ results: [], page: 1, hasMore: false })
  const ytdlp = findBinary('yt-dlp')
  if (!ytdlp) return res.status(500).json({ error: 'yt-dlp not found', results: [], page: 1, hasMore: false })
  const primary = await runJsonSearch(ytdlp, `${q} official artist channel`, mapArtistResult, page, 10)
  if (primary.results.length > 0 || primary.error) return res.status(primary.error ? 500 : 200).json(primary)
  const fallback = await runJsonSearch(ytdlp, `${q} artist profile`, mapArtistResult, page, 10)
  res.status(fallback.error ? 500 : 200).json(fallback)
})

function enqueue(kind) {
  return (req, res) => {
    const { url, ...opts } = req.body || {}
    if (!url) return res.status(400).json({ error: 'URL is required' })
    const result = manager().enqueue(kind, url, opts)
    res.status(result.error ? 500 : 200).json(result)
  }
}

router.post('/', enqueue('single'))
router.post('/playlist', enqueue('playlist'))

const byId = (action) => async (req, res) => {
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id is required' })
  const result = await manager()[action](id)
  res.status(result?.error ? 404 : 200).json(result)
}

router.post('/cancel', byId('cancel'))
router.post('/remove', byId('remove'))
router.post('/retry', byId('retry'))
router.post('/cancel-all', async (req, res) => res.json(await manager().cancelAll()))
router.post('/clear-finished', (req, res) => res.json(manager().clearFinished()))
router.post('/seen', (req, res) => res.json(manager().markSeen()))
router.get('/queue', (req, res) => res.json(manager().list()))

router.get('/playlists', (req, res) => {
  const db = getDB()
  res.json(db.prepare('SELECT * FROM downloaded_playlists ORDER BY COALESCE(last_downloaded_at, created_at) DESC').all())
})

router.delete('/playlist', (req, res) => {
  const { playlistId } = req.body || {}
  if (!playlistId) return res.status(400).json({ error: 'playlistId is required' })
  const db = getDB()
  const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (playlist?.archive_path) {
    try { fs.unlinkSync(playlist.archive_path) } catch {}
  }
  db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
  res.json({ success: true })
})

router.post('/playlist/redownload', async (req, res) => {
  const { playlistId } = req.body || {}
  if (!playlistId) return res.status(400).json({ error: 'playlistId is required' })
  const db = getDB()
  const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })
  const running = manager().hasPlaylistRunning(playlistId, playlist.url)
  if (running) await manager().remove(running.id)
  if (playlist.archive_path && fs.existsSync(playlist.archive_path)) {
    try { fs.unlinkSync(playlist.archive_path) } catch {}
  }
  db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
  const result = manager().enqueue('playlist', playlist.url, { playlistId, title: playlist.title, from: 'Re-download' })
  res.status(result.error ? 500 : 200).json(result)
})

router.get('/playlist/archive-ids', (req, res) => {
  const { playlistId } = req.query
  if (!playlistId) return res.status(400).json({ error: 'playlistId is required' })
  const db = getDB()
  const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (!playlist?.archive_path || !fs.existsSync(playlist.archive_path)) return res.json([])
  const ids = fs.readFileSync(playlist.archive_path, 'utf-8')
    .split(/\r?\n/)
    .map(line => {
      const match = line.match(/([a-zA-Z0-9_-]{11})/)
      return match ? match[1] : null
    })
    .filter(Boolean)
  res.json(Array.from(new Set(ids)))
})

router.post('/playlist/remove-archive', (req, res) => {
  const { playlistId, videoId } = req.body || {}
  if (!playlistId || !videoId) return res.status(400).json({ error: 'playlistId and videoId are required' })
  const db = getDB()
  const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (!playlist?.archive_path) return res.status(404).json({ error: 'Playlist not found' })

  try {
    if (fs.existsSync(playlist.archive_path)) {
      const content = fs.readFileSync(playlist.archive_path, 'utf-8')
      const next = content
        .split(/\r?\n/)
        .filter(line => line && !line.includes(videoId))
        .join('\n')
      fs.writeFileSync(playlist.archive_path, next)
    }
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
