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
  const found = await motionForTrack(req.params.trackId, null).catch(() => null)
  if (!found?.file) return res.json(null)
  res.json({ source: found.source, tall: found.tall, src: `/api/artwork-fx/clip/${path.basename(found.file)}` })
})

router.post('/spotify-check', async (req, res) => {
  res.json(await spotifyCheck().catch(e => ({ error: e.message })))
})

router.get('/clip/:name', (req, res) => {
  if (!/^[a-f0-9]{20}\.mp4$/.test(req.params.name)) return res.status(400).end()
  const file = path.join(motionCacheDir(), req.params.name)
  if (!fs.existsSync(file)) return res.status(404).end()
  res.sendFile(file, { headers: { 'Cache-Control': 'public, max-age=604800' } })
})

module.exports = router
