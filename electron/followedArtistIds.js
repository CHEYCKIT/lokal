// Artists → "Followed": the library artists you follow (Home → Releases →
// Followed artists; stored as names in the `followed_artists` setting),
// as artist ids for the artists list's query.

const artistKey = name => String(name || '').normalize('NFKC').trim().toLowerCase()

function followedKeys(db) {
  try {
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'followed_artists'").get()?.value
    const names = JSON.parse(raw || '[]')
    return new Set((Array.isArray(names) ? names : []).map(artistKey).filter(Boolean))
  } catch { return new Set() }
}

/** The ids of the library's followed artists (matched like the app matches names). */
function followedArtistIds(db) {
  const keys = followedKeys(db)
  if (!keys.size) return []
  return db.prepare('SELECT id, name FROM artists').all().filter(row => keys.has(artistKey(row.name))).map(row => row.id)
}

/** A WHERE condition (and its parameter) keeping only followed artists. */
function followedCondition(db) {
  return { sql: 'a.id IN (SELECT value FROM json_each(?))', param: JSON.stringify(followedArtistIds(db)) }
}

module.exports = { followedArtistIds, followedCondition, artistKey }
