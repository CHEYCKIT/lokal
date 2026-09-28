// Web mode: the same ListenBrainz integration as the desktop app.
const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const lb = require('../../electron/listenbrainz')

router.get('/status', (req, res) => res.json(lb.status(getDB())))
router.post('/connect', async (req, res) => res.json(await lb.connect(getDB(), req.body?.token)))
router.post('/disconnect', (req, res) => res.json(lb.disconnect(getDB())))
router.post('/enabled', (req, res) => {
  getDB().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('listenbrainz_enabled', ?)").run(req.body?.enabled ? '1' : '0')
  res.json(lb.status(getDB()))
})
router.post('/now-playing', async (req, res) => res.json(await lb.nowPlaying(getDB(), req.body?.track).catch(e => ({ error: e.message }))))
router.post('/submit', async (req, res) => res.json(await lb.submitListen(getDB(), req.body?.track, req.body?.listenedAt).catch(e => ({ error: e.message }))))

module.exports = router
