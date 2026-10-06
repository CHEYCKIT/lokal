// Web mode: the same now-playing visuals as the desktop app (colour mesh,
// moving covers), by track id. Clips are served from the shared cache.
const router = require('express').Router()
const path = require('path')
const fs = require('fs')
const { meshForTrack, motionForTrack, motionCacheDir, spotifyCheck } = require('../../electron/ipc/artworkFx')

router.get('/mesh/:trackId', async (req, res) => {
  res.json((await meshForTrack(req.params.trackId).catch(() => null)) || null)
})

router.get('/motion/:trackId', async (req, res) => {
  // The app-managed ffmpeg (Apple's clips are HLS and need remuxing), not
  // whatever happens to be on PATH.
  let ffmpeg = null
  try { ffmpeg = require('../../electron/ipc/tools').findFfmpeg() } catch {}
  const found = await motionForTrack(req.params.trackId, ffmpeg).catch(() => null)
  if (!found?.file) return res.json(null)
  res.json({ source: found.source, tall: found.tall, fade: found.fade || 0, src: `/api/artwork-fx/clip/${path.basename(found.file)}` })
})

router.post('/spotify-check', async (req, res) => {
  // Getting a Spotify token needs the desktop app's hidden browser window; a
  // standalone web server can't, so say so instead of trying.
  if (!process.versions.electron) {
    return res.json({ error: 'Spotify Canvas needs the Lokal desktop app (it isn\'t available on a standalone web server).', unsupported: true })
  }
  res.json(await spotifyCheck().catch(e => ({ error: e.message })))
})

router.get('/clip/:name', (req, res) => {
  if (!/^[a-f0-9]{20}\.mp4$/.test(req.params.name)) return res.status(400).end()
  const file = path.join(motionCacheDir(), req.params.name)
  if (!fs.existsSync(file)) return res.status(404).end()
  res.sendFile(file, { headers: { 'Cache-Control': 'public, max-age=604800' } })
})

module.exports = router
