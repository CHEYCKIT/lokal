// Genre taxonomy used by the Genres page and Library genre filters.
// Audio-file tags are left untouched; normalization only consolidates the
// categories Lokal presents and matches when browsing/filtering the library.

const SEPARATORS = /[\\/;,|]/
const OTHER = 'Other'
const OTHER_KEY = 'other'
const MIN_GENRE_TRACKS = 2

const { groups: GROUPS, noise: NOISE_VALUES } = require('./genreTaxonomy.json')
const NOISE = new Set(NOISE_VALUES)

function taxonomyKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const ALIASES = new Map()
for (const [canonical, aliases] of GROUPS) {
  ALIASES.set(taxonomyKey(canonical), canonical)
  for (const alias of aliases) ALIASES.set(taxonomyKey(alias), canonical)
}

/** Convert a raw tag to a broad display/filter category, or null for junk. */
function normalizeGenreName(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim()
  const key = taxonomyKey(raw)
  if (!key || /^\d+$/.test(key) || NOISE.has(key)) return null
  return ALIASES.get(key) || OTHER
}

/** "Rock / Pop; Indie" -> separate canonical categories, without repeats. */
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

/** Compares labels regardless of case and spacing. */
function genreKey(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

/** Every raw tag of a track row mapped into broad, deduplicated categories. */
function trackGenres(row) {
  const names = splitGenres([row?.genre, row?.genres].filter(Boolean).join(','))
  const out = []
  const seen = new Set()
  for (const raw of names) {
    const name = normalizeGenreName(raw)
    const key = genreKey(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

// Rare, otherwise-valid categories are folded into Other for the current DB.
// The original genre strings are kept on the track and in the audio-file tags.
const rareGenreKeysByDb = new WeakMap()

function visibleGenres(genres, rareKeys = new Set()) {
  const common = genres.filter(name => name !== OTHER && !rareKeys.has(genreKey(name)))
  if (common.length) return common
  if (genres.length && !rareKeys.has(OTHER_KEY)) return [OTHER]
  return []
}

/**
 * SQL: lokal_has_genre(genre, genres, wanted) checks the normalized visible
 * category. The empty wanted string means no usable genre tag remains.
 */
const registered = new WeakSet()
function registerGenreFunctions(db) {
  if (!db || registered.has(db)) return
  registered.add(db)
  try {
    db.function('lokal_has_genre', { deterministic: true }, (genre, genres, wanted) => {
      const list = trackGenres({ genre, genres })
      const rareKeys = rareGenreKeysByDb.get(db) || new Set()
      const visible = visibleGenres(list, rareKeys)
      const rawWanted = String(wanted || '').trim()
      if (!rawWanted) return visible.length ? 0 : 1
      const canonicalWanted = normalizeGenreName(rawWanted)
      if (!canonicalWanted) return 0
      return visible.some(name => genreKey(name) === genreKey(canonicalWanted)) ? 1 : 0
    })
  } catch {}
}

/**
 * Genres page categories, counted by distinct track and artwork. Categories
 * used by only one track are merged into Other; if Other itself has fewer than
 * two tracks, those tags are treated as unclassified instead of getting a
 * one-track card.
 */
function genreSummary(db) {
  registerGenreFunctions(db)
  const rows = db.prepare(`SELECT id, genre, genres, artwork_path FROM tracks WHERE file_path NOT LIKE 'ghost://%' ORDER BY added_at DESC`).all()
  const tracks = rows.map(row => ({ row, genres: trackGenres(row) }))
  const counts = new Map()
  for (const { genres } of tracks) {
    for (const name of genres) {
      const key = genreKey(name)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }

  const rareKeys = new Set([...counts].filter(([key, count]) => key !== OTHER_KEY && count < MIN_GENRE_TRACKS).map(([key]) => key))
  const rareOnly = tracks.map(({ genres }) => visibleGenres(genres, rareKeys))
  const otherTracks = rareOnly.reduce((count, names) => count + (names.includes(OTHER) ? 1 : 0), 0)
  if (otherTracks < MIN_GENRE_TRACKS) rareKeys.add(OTHER_KEY)
  rareGenreKeysByDb.set(db, rareKeys)

  const byKey = new Map()
  let none = 0
  for (const { row, genres } of tracks) {
    const visible = visibleGenres(genres, rareKeys)
    if (!visible.length) { none++; continue }
    for (const name of visible) {
      const key = genreKey(name)
      let item = byKey.get(key)
      if (!item) { item = { name, count: 0, artworks: [] }; byKey.set(key, item) }
      item.count++
      if (row.artwork_path && item.artworks.length < 4 && !item.artworks.some(a => a.artwork_path === row.artwork_path)) {
        item.artworks.push({ track_id: row.id, artwork_path: row.artwork_path })
      }
    }
  }
  const genres = [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return { genres, none }
}

/**
 * File-provided tags are kept raw so edits do not silently rewrite user metadata.
 * null when the file supplies nothing extra to add.
 */
function withFileGenres(existing, fileGenres) {
  const fromFile = splitGenres((Array.isArray(fileGenres) ? fileGenres : [fileGenres]).filter(Boolean).join(','))
  if (fromFile.length < 2) return null
  const merged = splitGenres([existing, fromFile.join(',')].filter(Boolean).join(','))
  const next = merged.join(', ')
  return next === String(existing || '') ? null : next
}

module.exports = {
  splitGenres,
  genreKey,
  normalizeGenreName,
  trackGenres,
  visibleGenres,
  registerGenreFunctions,
  genreSummary,
  withFileGenres,
}
