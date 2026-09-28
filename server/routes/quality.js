// Web API for the Audio Quality page and "Get it in lossless" (see electron/quality).

const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const quality = require('../../electron/quality')
const { buyLinks } = require('../../electron/quality/stores')

const send = (fn) => async (req, res) => {
  try {
    const result = await fn(req)
    res.status(result?.error ? 400 : 200).json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

router.get('/summary', send(() => quality.summary(getDB())))
router.get('/list', send(req => quality.list(getDB(), { tier: String(req.query.tier || ''), limit: req.query.limit, offset: req.query.offset })))
router.get('/status', send(() => quality.status()))
router.post('/read', send(req => quality.startReading(getDB(), { all: req.body?.all === true })))
router.post('/check', send(req => quality.startChecking(getDB(), {
  ids: Array.isArray(req.body?.ids) ? req.body.ids.filter(id => typeof id === 'string') : null,
  recheck: req.body?.recheck === true,
})))
router.post('/check/:id', send(req => quality.checkOne(getDB(), req.params.id)))
router.post('/cancel', send(() => quality.cancel()))
router.get('/buy/:id', send(req => {
  const track = getDB().prepare('SELECT id, title, artist, album, duration, isrc FROM tracks WHERE id = ?').get(req.params.id)
  return track ? buyLinks(track) : { error: 'Track not found' }
}))

module.exports = router
