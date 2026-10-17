// Web mode: the same online radio catalogue and now-playing lookups as the
// desktop app (electron/ipc/radio.js).
const router = require('express').Router()
const { getCatalog, loadAndSave } = require('../../electron/ipc/radio')
const { nowPlaying } = require('../../electron/radio/nowPlaying')

router.get('/catalog', (req, res) => res.json(getCatalog()))

router.post('/catalog', async (req, res) => {
  res.json(await loadAndSave(req.body?.url).catch(error => ({ ok: false, errors: [{ path: '', code: 'network', detail: String(error?.message || error) }] })))
})

router.post('/now-playing', async (req, res) => {
  res.json((await nowPlaying(req.body?.api).catch(() => null)) || null)
})

module.exports = router
