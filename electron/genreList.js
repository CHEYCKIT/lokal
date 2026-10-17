// A song's genres, as the Genres tab and the genre filter read them. One tag
// often holds several, written with a separator: "Рэп/Караоке", "Rock; Pop",
// "Hip-Hop\Rap", or the comma list in the `genres` column -- each part is a
// genre of its own ("Рэп/Караоке" and "Рэп/Друзья ATL" are three genres).

const SEPARATORS = /[\\/;,|]/

/** "Rock / Pop; Indie" -> ['Rock', 'Pop', 'Indie'], without repeats. */
function splitGenres(value) {
  const out = []
  const seen = new Set()
  for (const part of String(value || '').split(SEPARATORS)) {
    const name = part.replace(/\s+/g, ' ').trim()
    const key = genreKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** Compares genres regardless of case (Cyrillic too) and spacing. */
function genreKey(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

/** Every genre of a track row, from its main genre and its genre list. */
function trackGenres(row) {
  return splitGenres([row?.genre, row?.genres].filter(Boolean).join(','))
}

/**
 * SQL: lokal_has_genre(genre, genres, wanted) is 1 when the track has that
 * genre; with wanted '' it's 1 when the track has no genre at all. (SQLite's
 * own LOWER() only folds ASCII, so this is done in JS.)
 */
const registered = new WeakSet()
function registerGenreFunctions(db) {
  if (!db || registered.has(db)) return
  registered.add(db)
  try {
    db.function('lokal_has_genre', { deterministic: true }, (genre, genres, wanted) => {
      const list = trackGenres({ genre, genres })
      const key = genreKey(wanted)
      if (!key) return list.length ? 0 : 1
      return list.some(name => genreKey(name) === key) ? 1 : 0
    })
  } catch {}
}

/**
 * The Genres tab: [{ name, count, artwork, track_id }] by most songs, and
 * how many songs have no genre.
 */
function genreSummary(db) {
  const rows = db.prepare(`SELECT id, genre, genres, artwork_path FROM tracks WHERE file_path NOT LIKE 'ghost://%' ORDER BY added_at DESC`).all()
  const byKey = new Map()
  let none = 0
  for (const row of rows) {
    const list = trackGenres(row)
    if (!list.length) { none++; continue }
    for (const name of list) {
      const key = genreKey(name)
      let item = byKey.get(key)
      if (!item) { item = { name, count: 0, artworks: [] }; byKey.set(key, item) }
      item.count++
      if (row.artwork_path && item.artworks.length < 4 && !item.artworks.some(a => a.artwork_path === row.artwork_path)) item.artworks.push({ track_id: row.id, artwork_path: row.artwork_path })
    }
  }
  const genres = [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return { genres, none }
}

/**
 * A file's genre tag can hold several values (ID3v2.4 TCON "Романтика" and
 * "Караоке_Plain"); the main `genre` column keeps the first, so the rest go
 * into the `genres` list, next to what it had. null when there's nothing
 * to add.
 */
function withFileGenres(existing, fileGenres) {
  const fromFile = splitGenres((Array.isArray(fileGenres) ? fileGenres : [fileGenres]).filter(Boolean).join(','))
  if (fromFile.length < 2) return null
  const merged = splitGenres([existing, fromFile.join(',')].filter(Boolean).join(','))
  const next = merged.join(', ')
  return next === String(existing || '') ? null : next
}

module.exports = { splitGenres, genreKey, trackGenres, registerGenreFunctions, genreSummary, withFileGenres }
