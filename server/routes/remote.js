const express = require('express')
const { getDB } = require('../../electron/ipc/db')
const { getRemoteState, sendRemoteCommand, getRemoteConnectionInfo } = require('../../electron/ipc/remote')
const { smartTracks, playlistRules } = require('../../electron/playlists/smart')

const router = express.Router()

function authorized(req) {
  const token = String(process.env.REMOTE_TOKEN || '').trim()
  if (!token) return true
  const provided = req.headers['x-remote-token'] || req.query.token || req.body?.token
  return provided === token
}

router.use((req, res, next) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
})

function queryText(value) {
  return String(value || '').trim().slice(0, 100)
}

function pagination(req, fallback = 30) {
  return {
    limit: Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || fallback)),
    offset: Math.max(0, Math.min(100000, parseInt(req.query.offset, 10) || 0)),
  }
}

function safeLike(value) {
  return `%${String(value || '')}%`
}

function compactTrack(track) {
  if (!track) return null
  return {
    id: track.id,
    title: track.title || 'Unknown track',
    artist: track.artist || 'Unknown artist',
    album: track.album || '',
    album_artist: track.album_artist || '',
    duration: Number(track.duration) || 0,
    year: Number(track.year) || null,
    track_num: Number(track.track_num) || null,
    play_count: Number(track.play_count) || 0,
    liked: !!(track.user_liked ?? track.liked),
    hasArtwork: !!track.artwork_path,
  }
}

function compactTracks(rows) {
  return (Array.isArray(rows) ? rows : []).map(compactTrack).filter(Boolean)
}

function userTrackQuery(uid = 'guest') {
  const quotedUid = `'${String(uid).replace(/'/g, "''")}'`
  return `EXISTS (SELECT 1 FROM user_likes ul WHERE ul.user_id = ${quotedUid} AND ul.track_id = t.id)`
}

router.get('/state', (req, res) => res.json(getRemoteState()))

router.post('/command', async (req, res) => {
  const action = req.body?.action
  const value = req.body?.value
  if (!action) return res.status(400).json({ error: 'Missing action' })
  const result = await sendRemoteCommand({ action, value, ts: Date.now() })
  if (result?.error) return res.status(503).json(result)
  return res.json(result || { ok: true })
})

router.get('/connection', (req, res) => res.json(getRemoteConnectionInfo()))

// All collection endpoints sit below /api/remote and inherit the same
// REMOTE_TOKEN check as transport commands.
router.get('/library/tracks', (req, res) => {
  const db = getDB()
  const q = queryText(req.query.q)
  const { limit, offset } = pagination(req)
  const uid = String(getRemoteState().userId || 'guest').slice(0, 200)
  const where = ["t.file_path NOT LIKE 'ghost://%'"]
  const params = []
  if (q) {
    const like = safeLike(q)
    where.push("(t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ? OR t.album_artist LIKE ?)")
    params.push(like, like, like, like)
  }
  const clause = where.join(' AND ')
  const rows = db.prepare(`
    SELECT t.*, CASE WHEN ${userTrackQuery(uid)} THEN 1 ELSE 0 END AS user_liked
    FROM tracks t WHERE ${clause}
    ORDER BY t.title COLLATE NOCASE, t.artist COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
  const total = db.prepare(`SELECT COUNT(*) AS total FROM tracks t WHERE ${clause}`).get(...params)?.total || 0
  return res.json({ items: compactTracks(rows), total, limit, offset, hasMore: offset + rows.length < total })
})

router.get('/library/albums', (req, res) => {
  const db = getDB()
  const q = queryText(req.query.q)
  const { limit, offset } = pagination(req)
  const where = ["t.album IS NOT NULL", "TRIM(t.album) <> ''", "t.file_path NOT LIKE 'ghost://%'"]
  const params = []
  if (q) {
    const like = safeLike(q)
    where.push("(t.album LIKE ? OR t.album_artist LIKE ? OR t.artist LIKE ?)")
    params.push(like, like, like)
  }
  const whereSql = where.join(' AND ')
  const groupSql = `
    FROM tracks t WHERE ${whereSql}
    GROUP BY LOWER(t.album), LOWER(COALESCE(NULLIF(t.album_artist, ''), t.artist))
  `
  const rows = db.prepare(`
    SELECT t.album AS title, COALESCE(NULLIF(t.album_artist, ''), t.artist) AS artist,
      MAX(t.year) AS year, COUNT(*) AS track_count,
      (SELECT x.id FROM tracks x
        WHERE LOWER(x.album) = LOWER(t.album)
          AND LOWER(COALESCE(NULLIF(x.album_artist, ''), x.artist)) = LOWER(COALESCE(NULLIF(t.album_artist, ''), t.artist))
          AND x.file_path NOT LIKE 'ghost://%' AND NULLIF(x.artwork_path, '') IS NOT NULL
        ORDER BY COALESCE(x.track_num, 999999), x.title LIMIT 1) AS coverTrackId
    ${groupSql}
    ORDER BY MAX(t.year) DESC, t.album COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
  const total = db.prepare(`SELECT COUNT(*) AS total FROM (SELECT 1 ${groupSql})`).get(...params)?.total || 0
  return res.json({ items: rows.map(row => ({ ...row, track_count: Number(row.track_count) || 0 })), total, limit, offset, hasMore: offset + rows.length < total })
})

router.get('/library/album-tracks', (req, res) => {
  const title = queryText(req.query.title)
  const artist = queryText(req.query.artist)
  if (!title) return res.status(400).json({ error: 'Album title is required' })
  const rows = getDB().prepare(`
    SELECT t.*, CASE WHEN ${userTrackQuery(String(getRemoteState().userId || 'guest').slice(0, 200))} THEN 1 ELSE 0 END AS user_liked
    FROM tracks t
    WHERE LOWER(t.album) = LOWER(?) AND LOWER(COALESCE(NULLIF(t.album_artist, ''), t.artist)) = LOWER(?)
      AND t.file_path NOT LIKE 'ghost://%'
    ORDER BY COALESCE(t.track_num, 999999), t.title COLLATE NOCASE
  `).all(title, artist)
  return res.json({ items: compactTracks(rows), total: rows.length })
})

router.get('/library/artists', (req, res) => {
  const db = getDB()
  const q = queryText(req.query.q)
  const { limit, offset } = pagination(req)
  const where = ["t.file_path NOT LIKE 'ghost://%'"]
  const params = []
  if (q) { where.push("a.name LIKE ?"); params.push(safeLike(q)) }
  const whereSql = where.join(' AND ')
  const fromSql = `
    FROM artists a JOIN artist_track_links atl ON atl.artist_id = a.id
    JOIN tracks t ON t.id = atl.track_id
    WHERE ${whereSql}
    GROUP BY a.id HAVING COUNT(DISTINCT t.id) > 0
  `
  const rows = db.prepare(`
    SELECT a.id, a.name, COUNT(DISTINCT t.id) AS track_count,
      (SELECT x.id FROM artist_track_links xlink JOIN tracks x ON x.id = xlink.track_id
       WHERE xlink.artist_id = a.id AND x.file_path NOT LIKE 'ghost://%' AND NULLIF(x.artwork_path, '') IS NOT NULL
       ORDER BY COALESCE(x.track_num, 999999), x.title LIMIT 1) AS coverTrackId
    ${fromSql} ORDER BY a.name COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
  const total = db.prepare(`SELECT COUNT(*) AS total FROM (SELECT a.id ${fromSql})`).get(...params)?.total || 0
  return res.json({ items: rows.map(row => ({ ...row, track_count: Number(row.track_count) || 0 })), total, limit, offset, hasMore: offset + rows.length < total })
})

router.get('/library/artist-tracks', (req, res) => {
  const artistId = queryText(req.query.id)
  const uid = String(getRemoteState().userId || 'guest').slice(0, 200)
  if (!artistId) return res.status(400).json({ error: 'Artist id is required' })
  const rows = getDB().prepare(`
    SELECT t.*, CASE WHEN ${userTrackQuery(uid)} THEN 1 ELSE 0 END AS user_liked
    FROM tracks t JOIN artist_track_links atl ON atl.track_id = t.id
    WHERE atl.artist_id = ? AND t.file_path NOT LIKE 'ghost://%'
    ORDER BY t.album COLLATE NOCASE, COALESCE(t.track_num, 999999), t.title COLLATE NOCASE
  `).all(artistId)
  return res.json({ items: compactTracks(rows), total: rows.length })
})

router.get('/library/playlists', (req, res) => {
  const db = getDB()
  const uid = String(getRemoteState().userId || 'guest').slice(0, 200)
  const q = queryText(req.query.q)
  const { limit, offset } = pagination(req)
  const where = ['p.user_id = ?']
  const params = [uid]
  if (q) { where.push("p.name LIKE ?"); params.push(safeLike(q)) }
  const whereSql = where.join(' AND ')
  const rows = db.prepare(`
    SELECT p.id, p.name, p.description, p.user_id, p.smart_rules,
      (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count,
      (SELECT t.id FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = p.id AND NULLIF(t.artwork_path, '') IS NOT NULL ORDER BY pt.position LIMIT 1) AS coverTrackId
    FROM playlists p WHERE ${whereSql}
    ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
  const total = db.prepare(`SELECT COUNT(*) AS total FROM playlists p WHERE ${whereSql}`).get(...params)?.total || 0
  const items = rows.map(({ smart_rules, ...row }) => {
    const rules = playlistRules({ smart_rules })
    if (!rules) return { ...row, track_count: Number(row.track_count) || 0, smart: !!smart_rules }
    const smartItems = smartTracks(db, smart_rules, row.user_id)
    const coverTrack = smartItems.find(track => track?.artwork_path)
    return {
      ...row,
      track_count: smartItems.length,
      coverTrackId: coverTrack?.id || null,
      smart: true,
    }
  })
  return res.json({ items, total, limit, offset, hasMore: offset + rows.length < total })
})

router.get('/library/playlist-tracks', (req, res) => {
  const db = getDB()
  const playlistId = queryText(req.query.id)
  const uid = String(getRemoteState().userId || 'guest').slice(0, 200)
  if (!playlistId) return res.status(400).json({ error: 'Playlist id is required' })
  const playlist = db.prepare('SELECT id, user_id, smart_rules FROM playlists WHERE id = ? AND user_id = ?').get(playlistId, uid)
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })
  const tracks = playlistRules(playlist)
    ? smartTracks(db, playlist.smart_rules, playlist.user_id)
    : db.prepare(`
        SELECT t.* FROM tracks t JOIN playlist_tracks pt ON pt.track_id = t.id
        WHERE pt.playlist_id = ? ORDER BY pt.position
      `).all(playlistId)
  const ids = (Array.isArray(tracks) ? tracks : []).map(track => track?.id).filter(Boolean)
  if (!ids.length) return res.json({ items: [], total: 0 })
  const inClause = ids.map(() => '?').join(',')
  const existing = db.prepare(`
    SELECT t.*, CASE WHEN ${userTrackQuery(uid)} THEN 1 ELSE 0 END AS user_liked
    FROM tracks t WHERE t.id IN (${inClause})
  `).all(...ids)
  const byId = new Map(existing.map(track => [track.id, track]))
  const ordered = ids.map(id => byId.get(id)).filter(Boolean)
  return res.json({ items: compactTracks(ordered), total: ordered.length })
})

router.get('/library/liked', (req, res) => {
  const db = getDB()
  const uid = String(getRemoteState().userId || 'guest').slice(0, 200)
  // Move older streamed-song likes onto their local copies before listing;
  // otherwise excluding the ghost hides a song the user has liked.
  require('../../electron/online/sources').foldStreamedLikes(db, uid)
  const { limit, offset } = pagination(req)
  const q = queryText(req.query.q)
  const where = ['ul.user_id = ?', "t.file_path NOT LIKE 'ghost://%'"]
  const params = [uid]
  if (q) {
    const like = safeLike(q)
    where.push("(t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ?)")
    params.push(like, like, like)
  }
  const clause = where.join(' AND ')
  const rows = db.prepare(`
    SELECT t.*, 1 AS user_liked FROM user_likes ul JOIN tracks t ON t.id = ul.track_id
    WHERE ${clause} ORDER BY ul.liked_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
  const total = db.prepare(`
    SELECT COUNT(*) AS total FROM user_likes ul JOIN tracks t ON t.id = ul.track_id WHERE ${clause}
  `).get(...params)?.total || 0
  return res.json({ items: compactTracks(rows), total, limit, offset, hasMore: offset + rows.length < total })
})

router.get('/connection', (req, res) => res.json(getRemoteConnectionInfo()))

module.exports = router
