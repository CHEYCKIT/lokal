const express = require('express')
const { getRemoteState, sendRemoteCommand, getRemoteConnectionInfo } = require('../../electron/ipc/remote')

const router = express.Router()

function authorized(req) {
  const token = String(process.env.REMOTE_TOKEN || '').trim()
  if (!token) return true
  const provided = req.headers['x-remote-token'] || req.query.token || req.body?.token
  return provided === token
}

router.get('/state', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  return res.json(getRemoteState())
})

router.post('/command', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  const action = req.body?.action
  const value = req.body?.value
  if (!action) return res.status(400).json({ error: 'Missing action' })
  const result = await sendRemoteCommand({ action, value, ts: Date.now() })
  if (result?.error) return res.status(503).json(result)
  return res.json(result || { ok: true })
})

router.get('/connection', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  return res.json(getRemoteConnectionInfo())
})

module.exports = router
