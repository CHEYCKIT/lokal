// Web mode: the same ListenBrainz integration as the desktop app.
const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const lb = require('../../electron/listenbrainz')

// Listens queued while offline: try once shortly after start-up, then keep
// retrying while the web server is running even when playback is idle.
setTimeout(() => {
  try {
    const db = getDB()
    lb.startQueueRetry(db)
    const s = lb.settingsOf(db)
    if (s.enabled && s.token) lb.flushQueue(db, s.token).catch(() => {})
  } catch {}
}, 15000)

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
