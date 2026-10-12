// A batch of songs liked on Spotify, liked here (src/spotifyLikes.js): which
// were, and up to when every one is handled, so the next look starts after
// those and a song that couldn't be found or liked this time comes back.

export const MAX_TRIES = 3 // a song not found (or not liked) after this many looks is let go

const tries = new Map() // spotify uri -> looks it wasn't liked in
const done = new Set() // spotify uris liked here this session (a retried batch doesn't like or count them twice)

/**
 * Likes a batch of Spotify's likes (oldest first) here. `resolve(item)` finds
 * the song (or null), `like(row)` likes it (true when it did). Answers how
 * many were liked and `through`: the time up to which every song is handled
 * (liked, or given up on), for the next look to start after; null when the
 * first one isn't.
 */
export async function likeBatch(items, { newest, resolve, like, tries: counts = tries, done: seen = done } = {}) {
  let liked = 0
  let through = null
  let blocked = false
  for (const item of items) {
    let handled = seen.has(item.uri)
    if (!handled) {
      const row = await Promise.resolve(resolve(item)).catch(() => null)
      if (row && await Promise.resolve(like(row)).catch(() => false)) {
        handled = true
        liked++
        seen.add(item.uri)
        counts.delete(item.uri)
      } else {
        const count = (counts.get(item.uri) || 0) + 1
        counts.set(item.uri, count)
        if (count >= MAX_TRIES) { handled = true; counts.delete(item.uri) }
      }
    }
    if (!handled) {
      // Liked at the same moment as one handled: the next look must still find it.
      if (!blocked && through != null && through >= item.addedAt) through = item.addedAt - 1
      blocked = true
    } else if (!blocked) through = item.addedAt
  }
  if (!blocked && items.length) through = Math.max(Number(newest) || 0, through || 0)
  return { liked, through }
}
