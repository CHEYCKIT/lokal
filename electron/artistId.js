// Artist ids are `a-<slug>`: the name lowercased, letters and digits of any
// script kept (so "宇多田ヒカル" gets its own id instead of every non-Latin
// name sharing "a-unknown"), everything else turned into "-". A name with no
// letters or digits at all ("!!!", "†") gets `a-<12 hex of its sha256>`.
// Mirrored in src/artistId.js for links in the app; keep the two identical
// (scripts/artist-id.test.mjs checks they agree).
const crypto = require('crypto')

const normalizeArtistName = (name) => String(name || '').normalize('NFKC').toLowerCase().trim()

function artistSlug(name) {
  return normalizeArtistName(name).replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '')
}

const HASH_ID = /^a-[0-9a-f]{12}$/

function artistIdFromName(name) {
  const normalized = normalizeArtistName(name)
  if (!normalized) return 'a-unknown'
  const slug = artistSlug(normalized)
  if (slug) return `a-${slug}`
  return `a-${crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12)}`
}

/**
 * The artist row an id points at: by id, else the artist whose name gives
 * that id (rows made before ids were Unicode-safe keep their old id), else,
 * for an id that isn't a hash, the name read back from the slug.
 */
function findArtistById(db, id) {
  if (!id) return null
  let artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id)
  if (artist) return artist
  for (const row of db.prepare('SELECT id, name FROM artists').iterate()) {
    if (artistIdFromName(row.name) === id) return db.prepare('SELECT * FROM artists WHERE id = ?').get(row.id) || null
  }
  if (HASH_ID.test(id)) return null
  const name = String(id).replace(/^a-/, '').replace(/-/g, ' ')
  artist = db.prepare('SELECT * FROM artists WHERE LOWER(name) = LOWER(?)').get(name)
  return artist || null
}

/**
 * Before ids were Unicode-safe every non-Latin name shared "a-unknown", one
 * row named after whichever was scanned last. That row moves to its name's
 * real id; the re-link pass then gives the other artists their own rows.
 */
function migrateUnknownArtist(db) {
  const row = db.prepare("SELECT name FROM artists WHERE id = 'a-unknown'").get()
  if (!row) return null
  const newId = artistIdFromName(row.name)
  if (newId === 'a-unknown' || db.prepare('SELECT 1 FROM artists WHERE id = ?').get(newId)) return null
  db.prepare("UPDATE artists SET id = ? WHERE id = 'a-unknown'").run(newId)
  db.prepare("UPDATE OR IGNORE artist_track_links SET artist_id = ? WHERE artist_id = 'a-unknown'").run(newId)
  db.prepare("DELETE FROM artist_track_links WHERE artist_id = 'a-unknown'").run()
  return newId
}

/**
 * The id to link a name to: the row already carrying that name (names are
 * unique, and rows made before keep their old id), else a row with the
 * name's id, made if needed and taking this spelling.
 */
function resolveArtistId(db, name) {
  const slugId = artistIdFromName(name)
  let id = db.prepare('SELECT id FROM artists WHERE name = ? LIMIT 1').get(name)?.id
    || db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE LIMIT 1').get(name)?.id
  if (id === 'a-unknown' && slugId !== 'a-unknown') id = migrateUnknownArtist(db) || id
  if (id) {
    db.prepare('UPDATE OR IGNORE artists SET name = ? WHERE id = ? AND name <> ?').run(name, id, name)
    return id
  }
  db.prepare('INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)').run(slugId, name)
  db.prepare('UPDATE OR IGNORE artists SET name = ? WHERE id = ?').run(name, slugId)
  return slugId
}

/** A track's artists as linked (collaborations split), in the order they're credited. */
function trackArtistLinks(db, trackId) {
  const track = db.prepare('SELECT artist FROM tracks WHERE id = ?').get(trackId)
  if (!track) return []
  const rows = db.prepare('SELECT a.id, a.name FROM artist_track_links l JOIN artists a ON a.id = l.artist_id WHERE l.track_id = ?').all(trackId)
  const credited = String(track.artist || '').toLowerCase()
  const at = (name) => { const i = credited.indexOf(String(name).toLowerCase()); return i < 0 ? Infinity : i }
  return rows.sort((a, b) => at(a.name) - at(b.name))
}

module.exports = { trackArtistLinks, artistIdFromName, artistSlug, normalizeArtistName, findArtistById, migrateUnknownArtist, resolveArtistId, HASH_ID }
