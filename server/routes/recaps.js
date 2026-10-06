const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const { buildRecap, recapTracks, listeningDays, artistPlays, trackPlays } = require('../../electron/ipc/recaps')

router.get('/:userId', (req, res) => {
  try {
    res.json(buildRecap(getDB(), req.params.userId || 'guest', req.query || {}))
  } catch (e) {
    res.json({ error: e.message })
  }
})

// One artist's or genre's songs in a recap (Top Artists / Genres: play, save).
router.get('/:userId/tracks', (req, res) => {
  try {
    res.json(recapTracks(getDB(), req.params.userId || 'guest', req.query || {}))
  } catch (e) {
    res.json({ error: e.message, tracks: [] })
  }
})

// Days with plays (in the listener's time zone), for the Recap page's navigation.
router.get('/:userId/days', (req, res) => {
  try {
    res.json(listeningDays(getDB(), req.params.userId || 'guest', { tz: typeof req.query.tz === 'string' ? req.query.tz : undefined, sources: typeof req.query.sources === 'string' ? req.query.sources : undefined }))
  } catch (e) {
    res.json({ error: e.message, days: [] })
  }
})

// One artist's plays, files and streams (the artist page's share card).
router.get('/:userId/artist/:artistId', (req, res) => {
  try { res.json(artistPlays(getDB(), req.params.userId || 'guest', req.params.artistId)) } catch (e) { res.json({ error: e.message }) }
})

// One song's plays by the user (the side panel's Plays).
router.get('/:userId/track/:trackId', (req, res) => {
  try { res.json(trackPlays(getDB(), req.params.userId || 'guest', req.params.trackId)) } catch (e) { res.json({ error: e.message }) }
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
