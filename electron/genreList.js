// Genre taxonomy used by the Genres page and Library genre filters.
// Audio-file tags are left untouched; normalization only consolidates the
// categories Lokal presents and matches when browsing/filtering the library.

const SEPARATORS = /[\\/;,|]/
const OTHER = 'Other'
const OTHER_KEY = 'other'
const MIN_GENRE_TRACKS = 2

const GROUPS = [
  ['Video Game Music', [
    'vgm', 'video game', 'video games', 'video game music', 'videogame music',
    'video games music', 'video game soundtrack', 'video game soundtracks',
    'videogame soundtrack', 'video game ost', 'videogame ost', 'game music',
    'video game score', 'game soundtrack', 'game ost', 'game score',
    'video game original soundtrack', 'game background music', 'game bgm',
    'game music soundtrack', 'gaming music', 'chiptune game music',
    'videogame'
  ]],
  ['Soundtrack', [
    'soundtrack', 'soundtracks', 'ost', 'original soundtrack',
    'original motion picture soundtrack', 'motion picture soundtrack',
    'film soundtrack', 'movie soundtrack', 'film score', 'movie score',
    'score', 'tv soundtrack', 'television soundtrack', 'soundtrack music',
    'film music', 'stage and screen', 'musical theatre', 'саундтрек'
  ]],
  ['Anime', [
    'anime', 'anime music', 'anime soundtrack', 'anime ost', 'anime opening',
    'anime ending', 'anime song', 'anime theme', 'anisong', 'anison',
    'japanese animation music', 'japanese anime music'
  ]],
  ['Pop', [
    'pop', 'pop music', 'indie pop', 'dance pop', 'dream pop', 'art pop',
    'synthpop', 'synth pop', 'electropop', 'electro pop', 'teen pop',
    'power pop', 'baroque pop', 'chamber pop', 'k-pop', 'kpop', 'j-pop',
    'jpop', 'c-pop', 'cpop', 'mandopop', 'cantopop', 'korean pop',
    'japanese pop', 'chinese pop', 'pop ballad', 'поп'
  ]],
  ['Rock', [
    'rock', 'rock music', 'classic rock', 'hard rock', 'soft rock',
    'alternative rock', 'alt rock', 'indie rock', 'garage rock', 'arena rock',
    'southern rock', 'psychedelic rock', 'progressive rock', 'prog rock',
    'post rock', 'post-rock', 'math rock', 'grunge', 'pop punk', 'punk rock',
    'punk', 'post punk', 'post-punk', 'emo', 'skate punk', 'new wave',
    'gothic rock', 'industrial rock', 'rock and roll', 'rock n roll',
    'rockabilly', 'britpop', 'country rock', 'blues rock', 'рэп рок', 'рок'
  ]],
  ['Metal', [
    'metal', 'heavy metal', 'death metal', 'black metal', 'thrash metal',
    'doom metal', 'power metal', 'symphonic metal', 'folk metal',
    'metalcore', 'deathcore', 'nu metal', 'numetal', 'alternative metal',
    'progressive metal', 'prog metal', 'sludge metal', 'speed metal',
    'gothic metal', 'melodic death metal'
  ]],
  ['Electronic', [
    'electronic', 'electronic music', 'electronica', 'edm',
    'electronic dance music', 'dance', 'dance music', 'house', 'deep house',
    'progressive house', 'tech house', 'techno', 'trance', 'trance music',
    'dubstep', 'drum and bass', 'drum bass', 'dnb', 'd&b', 'jungle',
    'breakbeat', 'hardstyle', 'future bass', 'electro', 'electro house',
    'synthwave', 'retrowave', 'vaporwave', 'chillwave', 'downtempo',
    'trip hop', 'triphop', 'big beat', 'indietronica', 'idm',
    'intelligent dance music', 'electronic rock', 'chiptune', 'chip tune',
    'chip music', '8 bit', '8-bit', 'ambient techno', 'garage', 'rave',
    'electronic body music', 'ebm', 'электронная музыка'
  ]],
  ['Hip-Hop', [
    'hip hop', 'hip-hop', 'hiphop', 'rap', 'rap music', 'trap', 'drill',
    'boom bap', 'lofi hip hop', 'lo-fi hip-hop', 'alternative hip hop',
    'conscious hip hop', 'instrumental hip hop', 'cloud rap', 'рэп'
  ]],
  ['R&B / Soul', [
    'r&b', 'r and b', 'rnb', 'rhythm and blues', 'rhythm & blues',
    'contemporary r&b', 'contemporary rnb', 'soul', 'neo soul', 'neosoul',
    'funk', 'funky', 'disco', 'motown', 'quiet storm', 'new jack swing',
    'g funk', 'g-funk', 'p funk', 'p-funk', 'blue-eyed soul'
  ]],
  ['Jazz', [
    'jazz', 'smooth jazz', 'acid jazz', 'bebop', 'be-bop', 'swing',
    'jazz fusion', 'fusion jazz', 'free jazz', 'nu jazz', 'big band',
    'vocal jazz', 'ragtime', 'dixieland'
  ]],
  ['Classical', [
    'classical', 'classical music', 'orchestral', 'orchestral music',
    'baroque', 'baroque music', 'chamber music', 'opera', 'symphony',
    'symphonic', 'contemporary classical', 'minimalism', 'neoclassical',
    'romantic classical', 'medieval', 'renaissance music', 'камерная музыка'
  ]],
  ['Country', [
    'country', 'country music', 'bluegrass', 'americana', 'outlaw country',
    'country pop', 'modern country', 'traditional country', 'honky tonk'
  ]],
  ['Folk', [
    'folk', 'folk music', 'indie folk', 'traditional folk', 'singer-songwriter',
    'singer songwriter', 'acoustic', 'acoustic music', 'neofolk', 'traditional',
    'traditional music', 'celtic folk'
  ]],
  ['Blues', [
    'blues', 'blues music', 'delta blues', 'chicago blues', 'country blues',
    'electric blues', 'modern blues'
  ]],
  ['Reggae & Ska', [
    'reggae', 'reggae music', 'ska', 'dub', 'dancehall', 'roots reggae',
    'rocksteady', 'lovers rock'
  ]],
  ['Latin', [
    'latin', 'latin music', 'latin pop', 'latin urban', 'reggaeton',
    'salsa', 'bachata', 'cumbia', 'merengue', 'regional mexican',
    'norteño', 'norteno', 'tango', 'bossa nova', 'samba', 'mariachi'
  ]],
  ['World', [
    'world', 'world music', 'afrobeat', 'afrobeats', 'afropop', 'bollywood',
    'indian classical', 'hindustani classical', 'carnatic music', 'qawwali',
    'fado', 'flamenco', 'klezmer', 'ethnic music', 'middle eastern',
    'arabic music', 'african music'
  ]],
  ['Ambient / New Age', [
    'ambient', 'ambient music', 'new age', 'new-age', 'chillout', 'chill out',
    'meditation', 'drone', 'soundscape', 'relaxation', 'spa music',
    'sleep music', 'healing music', 'cosmic', 'dark ambient', 'space ambient'
  ]],
  ['Gospel & Christian', [
    'gospel', 'gospel music', 'christian', 'christian music',
    'contemporary christian', 'worship', 'praise and worship', 'ccm',
    'religious music', 'christian contemporary'
  ]],
  ['Indie / Alternative', [
    'indie', 'independent music', 'alternative', 'alternative music',
    'indie alternative'
  ]],
  ['Other', ['other', 'misc', 'miscellaneous', 'uncategorized', 'various']]
]

const NOISE = new Set([
  'none', 'null', 'undefined', 'unknown', 'unk', 'na', 'notapplicable',
  'notset', 'unspecified', 'nogenre', 'genre', 'genreid', 'unknown genre',
  'karaoke', 'karaokeplain', 'instrumental', 'instrumentals', 'speech',
  'spokenword', 'audiobook', 'audiobooks', 'podcast', 'podcasts', 'soundeffect',
  'soundeffects', 'music', 'audio', 'nonmusic', 'notmusic', 'unclassified',
  'рэпкараоке', 'караоке', 'karaoke_plain'
])

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
