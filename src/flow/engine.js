// Flow: an endless mix of your music, like Deezer's. Your favourites (liked
// songs and the ones you play most), with fresh finds mixed in (songs in your
// library you haven't played, and recommendations online), a few at a time
// for as long as it plays.
//
// A mood narrows it (Love, Workout, Chill, …): songs are scored on their
// audio features (energy, valence, danceability, tempo, … imported from
// Spotify's data or found by AutoMix's analysis), or on their genres when
// they have none. The Flow Tuner sets the mix:
//
//   adventurous  0 favourites only … 1 mostly fresh finds
//   recent       0 your all-time favourites … 1 what you've played lately
//   genres       { genre: false } leaves a genre out, { genre: true } adds
//                more of it
//   source       where fresh finds also come from online: 'lastfm',
//                'youtube', or 'library' (none); unset follows Discovery's
//
// Pure (no app state), so it's tested on its own (scripts/flow.test.mjs).

export const FLOW_MOODS = [
  { id: 'flow', label: 'Flow' },
  { id: 'love', label: 'Love' },
  { id: 'workout', label: 'Workout' },
  { id: 'chill', label: 'Chill' },
  { id: 'party', label: 'Party' },
  { id: 'focus', label: 'Focus' },
  { id: 'melancholy', label: 'Melancholy' },
]

export const DEFAULT_TUNER = Object.freeze({ adventurous: 0.3, recent: 0.4, genres: {} })

const DAY_S = 86400
const RECENT_LIKE_S = 60 * DAY_S
const ARTIST_GAP = 3 // songs between two by the same artist
const MOOD_FIT = 0.55 // a song's mood score from which it fits the mood

const MOOD_GENRES = {
  love: ['r&b', 'rnb', 'soul', 'neo soul', 'love', 'romance', 'ballad', 'bossa nova', 'quiet storm', 'slow jam'],
  workout: ['edm', 'electronic', 'hip hop', 'hip-hop', 'rap', 'trap', 'drum and bass', 'dnb', 'dubstep', 'rock', 'metal', 'punk', 'hardstyle', 'phonk', 'workout'],
  chill: ['chill', 'lo-fi', 'lofi', 'ambient', 'downtempo', 'chillhop', 'acoustic', 'jazz', 'bossa nova', 'indie folk', 'dream pop', 'trip hop', 'neo soul'],
  party: ['dance', 'house', 'disco', 'edm', 'reggaeton', 'dancehall', 'funk', 'afrobeats', 'pop', 'electropop', 'k-pop', 'latin', 'party'],
  focus: ['classical', 'ambient', 'lo-fi', 'lofi', 'post-rock', 'soundtrack', 'score', 'piano', 'instrumental', 'jazz', 'minimal', 'study', 'modern classical'],
  melancholy: ['sad', 'emo', 'slowcore', 'singer-songwriter', 'blues', 'darkwave', 'shoegaze', 'sadcore', 'indie folk', 'ballad'],
}

/** The listener's own plays of a song (flow:pool's user_plays; play_count when there's none). */
export const playsOf = track => Math.max(0, Number(track?.user_plays ?? track?.play_count) || 0)

const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))
const clamp01 = value => Math.min(1, Math.max(0, value))
const near = (value, target, span) => clamp01(1 - Math.abs(value - target) / span)

/** A song's genres, lower case ("Hip-Hop, Trap" → ['hip-hop', 'trap']). */
export function trackGenres(track) {
  const seen = new Set()
  for (const source of [track?.genre, track?.genres]) {
    for (const part of String(source || '').split(/[,;/]/)) {
      const genre = part.trim().toLowerCase()
      if (genre) seen.add(genre)
    }
  }
  return [...seen]
}

const genreMatches = (genres, words) => genres.some(genre => words.some(word => genre === word || genre.includes(word)))

/** How well a song fits a mood, 0…1 (Flow: every song fits). */
export function moodScore(track, mood) {
  if (!mood || mood === 'flow') return 1
  const energy = num(track?.energy)
  const valence = num(track?.valence)
  const dance = num(track?.danceability)
  const tempo = num(track?.tempo)
  const acoustic = num(track?.acousticness) ?? 0.3
  const instrumental = num(track?.instrumentalness) ?? 0.1
  const speech = num(track?.speechiness) ?? 0.08
  const minor = num(track?.mode) === 0
  const genres = trackGenres(track)
  const byGenre = genres.length ? (genreMatches(genres, MOOD_GENRES[mood] || []) ? 0.75 : 0.25) : 0.4
  if (energy === null && valence === null) return byGenre
  const e = energy ?? 0.5
  const v = valence ?? 0.5
  const d = dance ?? 0.5
  let score
  switch (mood) {
    case 'love': score = 0.35 * near(v, 0.6, 0.45) + 0.25 * near(e, 0.45, 0.45) + 0.2 * acoustic + 0.2 * (tempo === null ? 0.5 : near(tempo, 95, 45)); break
    case 'workout': score = 0.45 * e + 0.25 * d + 0.3 * (tempo === null ? e : near(tempo, 135, 35)); break
    case 'chill': score = 0.45 * (1 - e) + 0.2 * acoustic + 0.15 * near(v, 0.5, 0.5) + 0.2 * (tempo === null ? 1 - e : near(tempo, 90, 40)); break
    case 'party': score = 0.4 * d + 0.3 * e + 0.3 * v; break
    case 'focus': score = 0.45 * instrumental + 0.25 * (1 - clamp01(speech * 3)) + 0.3 * near(e, 0.4, 0.4); break
    case 'melancholy': score = 0.5 * (1 - v) + 0.25 * (1 - e) + 0.25 * (minor ? 1 : 0.3); break
    default: return 1
  }
  // A genre that names the mood nudges it (features alone miss "love songs").
  return clamp01(score + (byGenre === 0.75 ? 0.1 : 0))
}

/**
 * What the listener thinks of a song, from the pool's play data: 0 never
 * played nor liked … 1 a favourite. `recent` weighs recent plays (and likes)
 * against all-time ones.
 */
export function familiarity(track, { recent = DEFAULT_TUNER.recent, maxPlays = 1, maxRecent = 1, now = Date.now() / 1000 } = {}) {
  const liked = track?.is_liked ? 1 : 0
  const plays = playsOf(track)
  const recentPlays = Math.max(0, Number(track?.recent_plays) || 0)
  const likedAt = Number(track?.liked_at) || 0
  const allTime = 0.5 * liked + 0.5 * (plays ? Math.log1p(plays) / Math.log1p(Math.max(plays, maxPlays)) : 0)
  const lately = 0.3 * (liked && now - likedAt < RECENT_LIKE_S ? 1 : 0) + 0.7 * (recentPlays ? Math.log1p(recentPlays) / Math.log1p(Math.max(recentPlays, maxRecent)) : 0)
  return clamp01((1 - recent) * allTime + recent * lately)
}

/** A song never played nor liked: a fresh find in your own library. */
export const isFresh = track => !track?.is_liked && !(playsOf(track) > 0) && !(Number(track?.recent_plays) > 0)

/** The tuner's genre weight for a song: 0 left out, more than 1 for added genres. */
export function genreWeight(track, genres = {}) {
  const own = trackGenres(track)
  if (!own.length) return 1
  const settings = Object.entries(genres || {}).map(([name, on]) => [name.toLowerCase(), on])
  if (!settings.length) return 1
  const off = settings.filter(([, on]) => on === false).map(([name]) => name)
  const added = settings.filter(([, on]) => on === true).map(([name]) => name)
  if (added.length && genreMatches(own, added)) return 1.8
  if (off.length && own.every(genre => genreMatches([genre], off))) return 0
  return 1
}

/** The most common genres among `tracks` (favourites first), for the tuner's chips. */
export function topGenres(tracks, limit = 8) {
  const counts = new Map()
  for (const track of tracks || []) {
    const weight = track?.is_liked || playsOf(track) > 0 ? 2 : 1
    for (const genre of trackGenres(track)) counts.set(genre, (counts.get(genre) || 0) + weight)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([genre]) => genre)
}

const artistKey = track => String(track?.artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim().toLowerCase()
export const flowSongKey = track => `${String(track?.artist || '').trim().toLowerCase()}\0${String(track?.title || '').trim().toLowerCase()}`

function weightedPick(items, weightOf, random) {
  let total = 0
  const weights = items.map(item => { const w = Math.max(0, weightOf(item)); total += w; return w })
  if (!(total > 0)) return -1
  let at = random() * total
  for (let i = 0; i < items.length; i++) {
    at -= weights[i]
    if (at < 0 && weights[i] > 0) return i
  }
  return weights.findLastIndex(w => w > 0)
}

/**
 * The next `count` songs of a Flow, from the library `pool` (rows of
 * flow:pool). `exclude`: song keys already played or queued; `lastTracks`:
 * the last few songs, so their artists don't come back at once.
 * Returns the tracks in play order; fewer when the pool runs dry.
 */
export function pickFlow(pool, { count = 8, mood = 'flow', tuner = DEFAULT_TUNER, exclude = new Set(), lastTracks = [], random = Math.random, now = Date.now() / 1000 } = {}) {
  const { adventurous = DEFAULT_TUNER.adventurous, recent = DEFAULT_TUNER.recent, genres = {} } = tuner || {}
  let maxPlays = 1
  let maxRecent = 1
  for (const track of pool || []) {
    maxPlays = Math.max(maxPlays, playsOf(track))
    maxRecent = Math.max(maxRecent, Number(track?.recent_plays) || 0)
  }
  const seen = new Set(exclude)
  const candidates = []
  for (const track of pool || []) {
    const key = flowSongKey(track)
    if (!track?.id || seen.has(key)) continue
    seen.add(key)
    const fit = moodScore(track, mood)
    const weight = genreWeight(track, genres)
    if (!weight || (mood !== 'flow' && fit < MOOD_FIT)) continue
    const fresh = isFresh(track)
    // Favourites by how much they're loved; fresh finds evenly (the mood picks among them).
    const base = fresh ? 1 : 0.15 + familiarity(track, { recent, maxPlays, maxRecent, now })
    candidates.push({ track, fresh, weight: base * weight * (mood === 'flow' ? 1 : fit * fit) })
  }
  const freshPool = candidates.filter(item => item.fresh)
  const favourites = candidates.filter(item => !item.fresh)
  // Fresh finds: from 10% (favourites only) to 70% (adventurous), spread out.
  const freshShare = 0.1 + 0.6 * clamp01(adventurous)
  const picked = []
  const artists = lastTracks.map(artistKey).slice(-ARTIST_GAP)
  let freshCredit = 0.5
  while (picked.length < count && (freshPool.length || favourites.length)) {
    freshCredit += freshShare
    const wantFresh = freshCredit >= 1 && freshPool.length > 0
    let from = wantFresh || !favourites.length ? freshPool : favourites
    if (from === freshPool) freshCredit -= 1
    const spaced = item => !artists.includes(artistKey(item.track))
    let index = weightedPick(from, item => (spaced(item) ? item.weight : 0), random)
    if (index < 0) {
      // Every song left here is by an artist just heard: the other kind, else anyone.
      const other = from === freshPool ? favourites : freshPool
      const elsewhere = weightedPick(other, item => (spaced(item) ? item.weight : 0), random)
      if (elsewhere >= 0) { from = other; index = elsewhere } else index = weightedPick(from, item => item.weight, random)
    }
    if (index < 0) break
    const [item] = from.splice(index, 1)
    picked.push(item.track)
    artists.push(artistKey(item.track))
    if (artists.length > ARTIST_GAP) artists.shift()
  }
  return picked
}

/** How many different songs of `pool` a Flow in this mood, with this tuner, can play. */
export function flowEligible(pool, { mood = 'flow', tuner = DEFAULT_TUNER } = {}) {
  const seen = new Set()
  for (const track of pool || []) {
    if (!track?.id || !genreWeight(track, tuner?.genres)) continue
    if (mood !== 'flow' && moodScore(track, mood) < MOOD_FIT) continue
    seen.add(flowSongKey(track))
  }
  return seen.size
}

/** The tuner, as saved and as the page edits it: numbers in range, genres a plain map. */
export function normalizeTuner(value) {
  const tuner = value && typeof value === 'object' ? value : {}
  const unit = (n, fallback) => (Number.isFinite(Number(n)) ? clamp01(Number(n)) : fallback)
  const genres = {}
  for (const [name, on] of Object.entries(tuner.genres && typeof tuner.genres === 'object' ? tuner.genres : {})) {
    const key = String(name || '').trim().toLowerCase()
    if (key && typeof on === 'boolean') genres[key] = on
  }
  const normal = { adventurous: unit(tuner.adventurous, DEFAULT_TUNER.adventurous), recent: unit(tuner.recent, DEFAULT_TUNER.recent), genres }
  // Where fresh finds come from online (src/flow/online.js): none set follows Home → Discovery's source.
  if (FLOW_SOURCES.includes(tuner.source)) normal.source = tuner.source
  return normal
}

export const FLOW_SOURCES = ['library', 'lastfm', 'youtube']

/** The tuner's source of online finds, or Discovery's (`discoverySource`) when it has none of its own. */
export const flowSource = (tuner, discoverySource) => (FLOW_SOURCES.includes(tuner?.source) ? tuner.source : discoverySource === 'youtube' ? 'youtube' : 'lastfm')

export const sameTuner = (a, b) => JSON.stringify(normalizeTuner(a)) === JSON.stringify(normalizeTuner(b))
