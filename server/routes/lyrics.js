// Web-mode lyrics routes -- the same service the Electron IPC handlers use.

const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const service = require('../../electron/lyrics/service')

const argsFrom = (req) => ({
  trackId: req.params.trackId,
  title: req.query.title,
  artist: req.query.artist,
  album: req.query.album,
  duration: req.query.duration,
  // No filePath: the service resolves it from the library by track id, so a
  // client can't point the local-file source at arbitrary paths.
  refresh: req.query.refresh === '1',
})

router.get('/sources', (req, res) => {
  res.json(service.sources(getDB()))
})

router.post('/clear-all', (req, res) => {
  const db = getDB()
  db.prepare('DELETE FROM lyrics_cache').run()
  try { db.prepare('DELETE FROM lyrics_translations').run() } catch {}
  res.json({ ok: true })
})

router.get('/:trackId', async (req, res) => {
  try {
    res.json(await service.getLyrics(getDB(), argsFrom(req)))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:trackId/from/:providerId', async (req, res) => {
  try {
    res.json(await service.getLyricsFrom(getDB(), argsFrom(req), req.params.providerId))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:trackId/import', (req, res) => {
  res.json(service.importLyrics(getDB(), req.params.trackId, req.body?.content, req.body?.type))
})

router.delete('/:trackId', (req, res) => {
  res.json(service.clearCache(getDB(), req.params.trackId))
})

router.post('/:trackId/translate', async (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
  res.json(await service.translate(getDB(), req.params.trackId, lines, req.body?.targetLang || 'en'))
})

router.post('/:trackId/romanize', async (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
  res.json(await service.romanize(getDB(), req.params.trackId, lines))
})

router.post('/:trackId/detect-language', async (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
  const r = await service.translate(getDB(), req.params.trackId, lines, 'en')
  const lang = r?.detectedLang || 'unknown'
  res.json({ lang, confidence: lang === 'unknown' ? 0 : 0.9, source: 'remote' })
})

module.exports = router
