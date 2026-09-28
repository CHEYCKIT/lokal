const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const { buildRecap, listeningDays } = require('../../electron/ipc/recaps')

router.get('/:userId', (req, res) => {
  try {
    res.json(buildRecap(getDB(), req.params.userId || 'guest', req.query || {}))
  } catch (e) {
    res.json({ error: e.message })
  }
})

// Days with plays (in the listener's time zone), for the Recap page's navigation.
router.get('/:userId/days', (req, res) => {
  try {
    res.json(listeningDays(getDB(), req.params.userId || 'guest', { tz: typeof req.query.tz === 'string' ? req.query.tz : undefined }))
  } catch (e) {
    res.json({ error: e.message, days: [] })
  }
})

router.get('/:userId/preferences', (req, res) => {
  const row = getDB().prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'listening_preferences'").get(req.params.userId || 'guest')
  try {
    res.json(row?.value ? JSON.parse(row.value) : null)
  } catch {
    res.json(null)
  }
})

module.exports = router
