// Flow's songs (src/flow/engine.js picks from them): the library's playable
// songs with what the listener thinks of them, from likes and plays.
//
//   is_liked, liked_at   the listener's like
//   user_plays           the listener's own plays, all-time (play_count is
//                        everyone's, on a computer shared by profiles)
//   recent_plays         their plays in the last 30 days
//
// A play is a listen of 30 seconds or more (history from before listens were
// timed counts too).
//
// A big library is cut down: every favourite (liked or played, up to 4,000,
// the most loved first) and up to 2,000 never-played songs at random, so a
// Flow stays quick to start with 50,000 songs.

const RECENT_DAYS = 30
const MAX_FAVOURITES = 4000
const MAX_FRESH = 2000

function flowPool(db, userId) {
  const uid = userId || 'guest'
  try { db.exec('CREATE TABLE IF NOT EXISTS track_errors (track_id TEXT PRIMARY KEY, message TEXT NOT NULL, at INTEGER NOT NULL)') } catch {}
  const since = Math.floor(Date.now() / 1000) - RECENT_DAYS * 86400
  const select = `
    SELECT t.*, ul.liked_at, CASE WHEN ul.track_id IS NULL THEN 0 ELSE 1 END AS is_liked,
      COALESCE(h.user_plays, 0) AS user_plays, COALESCE(h.recent_plays, 0) AS recent_plays
    FROM tracks t
    LEFT JOIN user_likes ul ON ul.track_id = t.id AND ul.user_id = @uid
    LEFT JOIN (
      SELECT track_id, COUNT(*) AS user_plays, SUM(played_at >= @since) AS recent_plays FROM play_history
      WHERE user_id = @uid AND (COALESCE(seconds_played, 0) = 0 OR seconds_played >= 30) GROUP BY track_id
    ) h ON h.track_id = t.id
    WHERE t.file_path NOT LIKE 'ghost://%' AND t.id NOT IN (SELECT track_id FROM track_errors)`
  const favourites = db.prepare(`${select} AND (ul.track_id IS NOT NULL OR h.user_plays > 0)
    ORDER BY is_liked DESC, recent_plays DESC, user_plays DESC LIMIT ${MAX_FAVOURITES}`).all({ uid, since })
  const fresh = db.prepare(`${select} AND ul.track_id IS NULL AND h.track_id IS NULL
    ORDER BY RANDOM() LIMIT ${MAX_FRESH}`).all({ uid, since })
  return [...favourites, ...fresh]
}

function registerFlowHandlers(ipcMain) {
  const { getDB } = require('./db')
  ipcMain.handle('flow:pool', (_, userId) => {
    try { return flowPool(getDB(), userId) } catch (error) { return { error: error.message } }
  })
}

module.exports = { registerFlowHandlers, flowPool }
