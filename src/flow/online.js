// Flow's fresh finds from online: songs recommended by Last.fm (similar to
// what you scrobble) or YouTube Music (your home feed and mixes), found and
// made ready to play, woven in among your library's songs. The Flow Tuner
// says which (tuner.source: 'library' keeps Flow to your library).
//
// Recommendations come a page at a time (loadRecommendationPage, the same as
// Home → Discovery); a song is offered once per session, and one already in
// the queue, or one you know (liked or played in your library), isn't a find.
//
// A mood's finds come from the mood itself (moodFinds): songs similar to
// library songs that fit it (Last.fm's similar tracks, YouTube Music's radio
// for the song), each heard first (its AutoMix analysis against the song it
// was found from) and left out when it doesn't belong.

import { api } from '../api.js'
import { loadRecommendationPage, resolveRecommendationTracks, songKey, uniqueSongs } from '../recommendations.js'

export const ONLINE_SOURCES = [
  { id: 'library', label: 'Library only' },
  { id: 'lastfm', label: 'Last.fm' },
  { id: 'youtube', label: 'YouTube Music' },
]

const MAX_PAGES = 6 // pages read per session before the source counts as dry
const PAGES_PER_ASK = 2
const PICK_FROM = 24 // a find is picked among the first this many left, so it isn't always the top one

const sources = new Map() // source -> { candidates, page, error, tried, loading }

function stateOf(source) {
  if (!sources.has(source)) sources.set(source, { candidates: [], page: 0, error: '', tried: new Set(), loading: null })
  return sources.get(source)
}

/** What went wrong reading the source last (not set up, offline), or ''. */
export function onlineError(source) {
  return source && source !== 'library' ? stateOf(source).error : ''
}

// Who shows the error (Flow Tuner) hears when it changes (useSyncExternalStore).
const listeners = new Set()
export function subscribeOnline(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function setError(state, error) {
  if (state.error === error) return
  state.error = error
  for (const listener of listeners) listener()
}

// Bumped by each reset: a find started before it is for what was forgotten.
let generation = 0

/** Forget what was read: a settings change may be another account (and for the tests). */
export function resetOnline() {
  generation++
  sources.clear()
  usedSeeds.clear()
  seeded.clear()
  for (const listener of listeners) listener()
}
// Settings saved (another Last.fm or YouTube Music account, say): what was read was another account's.
if (typeof window !== 'undefined') window.addEventListener('lokal:settings-saved', () => resetOnline())

// What a failed read says: its message, or a plain one for a rejection without one.
function errorText(error) {
  const text = typeof error === 'string' ? error : error?.message
  return String(text || '').trim() || 'Could not read recommendations.'
}

async function readMore(source, loadPage) {
  const state = stateOf(source)
  if (state.loading) return state.loading
  state.loading = (async () => {
    for (let n = 0; n < PAGES_PER_ASK && state.page < MAX_PAGES; n++) {
      const data = await Promise.resolve(loadPage(source, state.page)).catch(error => ({ error: errorText(error) }))
      state.page++
      if (data?.error) { setError(state, String(data.error)); break }
      setError(state, '')
      // Unheard ones first (Last.fm's fresh finds), then the rest of the page.
      const songs = uniqueSongs([...(data?.freshFinds || []), ...(data?.candidates || [])]).filter(song => song?.title && song?.artist)
      const known = new Set(state.candidates.map(songKey))
      state.candidates.push(...songs.filter(song => !known.has(songKey(song))))
    }
  })().finally(() => { state.loading = null })
  return state.loading
}

/**
 * Up to `count` online finds, ready to play.
 * @param exclude song keys (songKey) not to offer: queued, or known from the library
 * @param isCurrent false once the Flow they're for has stopped
 * Nothing comes back when the online state is reset meanwhile (resetOnline).
 */
export async function onlineFinds(source, { count, exclude = new Set(), isCurrent = () => true, random = Math.random, loadPage = (from, page) => loadRecommendationPage(from, page, api), resolve = (rows, options) => resolveRecommendationTracks(rows, api, options) } = {}) {
  if (!source || source === 'library' || !(count > 0)) return []
  const started = generation
  const live = () => started === generation && isCurrent()
  const state = stateOf(source)
  const found = []
  let tries = 0
  while (found.length < count && tries < count * 3 && live()) {
    let left = state.candidates.filter(song => !state.tried.has(songKey(song)) && !exclude.has(songKey(song)))
    if (!left.length) {
      if (state.page >= MAX_PAGES) break
      await readMore(source, loadPage)
      if (!live()) break
      if (state.error && !state.candidates.length) break
      left = state.candidates.filter(song => !state.tried.has(songKey(song)) && !exclude.has(songKey(song)))
      if (!left.length) break
    }
    const pick = left[Math.floor(random() * Math.min(left.length, PICK_FROM))]
    state.tried.add(songKey(pick))
    tries++
    const [track] = await Promise.resolve(resolve([pick], { isCurrent: live })).catch(() => [])
    if (track && live() && !exclude.has(songKey(track))) {
      exclude.add(songKey(track))
      found.push({ ...track, flowFind: source })
    }
  }
  // Reset meanwhile: even what was found is the old account's.
  return started === generation ? found : []
}

/**
 * How many of `count` songs come from online: from 10% (a personal tuner) to
 * 80% (all the way adventurous), none for the library alone.
 */
export function onlineShare(tuner, count) {
  if (!tuner?.source || tuner.source === 'library') return 0
  const adventurous = Math.min(1, Math.max(0, Number(tuner.adventurous) || 0))
  return Math.max(1, Math.round(count * (0.1 + 0.7 * adventurous)))
}

// ---------------------------------------------------------------- moods

const SEEDS_PER_ASK = 3
const SEED_POOL = 24 // seeds are drawn from the library's best fits for the mood
const MAX_MOOD_QUEUE = 30 // songs like the seeds kept to try, per source and mood
const usedSeeds = new Map() // mood -> Set of seed song keys, so seeds take turns
const seeded = new Map() // source:mood -> [{ song, seed }] still to try

/**
 * The library songs a mood's online finds are found from: the ones that fit
 * it best, favourites first (a find is "like this song I love in this mood").
 */
export function moodSeeds(pool, { mood, fits, favour, count = SEEDS_PER_ASK, random = Math.random }) {
  const best = (pool || [])
    .map(track => ({ track, score: fits(track) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score * (0.5 + favour(b.track)) - a.score * (0.5 + favour(a.track)))
    .slice(0, SEED_POOL)
  const used = usedSeeds.get(mood) || new Set()
  let left = best.filter(item => !used.has(songKey(item.track)))
  if (!left.length) { used.clear(); left = best }
  const picked = []
  while (picked.length < count && left.length) {
    const [item] = left.splice(Math.floor(random() * Math.min(left.length, 8)), 1)
    picked.push(item.track)
    used.add(songKey(item.track))
  }
  usedSeeds.set(mood, used)
  return picked
}

/** Songs like `seed`, from the source: Last.fm's similar tracks, or YouTube Music's radio for it. */
async function similarTo(source, seed, client) {
  if (source === 'lastfm') {
    const result = await Promise.resolve(client.lastfmSimilar(seed.artist, seed.title, 30)).catch(() => null)
    if (result?.error) throw new Error(result.error)
    return Array.isArray(result?.tracks) ? result.tracks : []
  }
  const { youtubeRadioSeed } = await import('../radioActions.js')
  const videoId = await youtubeRadioSeed(seed, 'track', client).catch(() => null)
  if (!videoId) return []
  const radio = await Promise.resolve(client.youtubeRadio(videoId)).catch(() => [])
  return (Array.isArray(radio) ? radio : []).filter(song => song?.videoId !== videoId)
}

/**
 * Up to `count` online finds for a Flow mood (option 1, then option 4 of the
 * mood design): songs similar to library songs that fit the mood, each
 * checked against its seed's AutoMix analysis (src/flow/moodFit.js) before
 * it's offered. `seeds` from moodSeeds; `analyze(track)` an analysis or null.
 */
export async function moodFinds(source, { mood, seeds, count, exclude = new Set(), isCurrent = () => true, client = api, analyze = track => client.automixAnalyze(track), fits = null, resolve = (rows, options) => resolveRecommendationTracks(rows, client, options), random = Math.random, log = () => {} } = {}) {
  if (!source || source === 'library' || !(count > 0) || !seeds?.length) return []
  const started = generation
  const live = () => started === generation && isCurrent()
  const { fitsMood } = fits ? { fitsMood: fits } : await import('./moodFit.js')
  const state = stateOf(source)
  // Songs like each seed, interleaved (one of each in turn), new ones only.
  const lists = await Promise.all(seeds.map(seed => similarTo(source, seed, client).then(songs => songs.map(song => ({ song, seed }))).catch(error => { setError(state, errorText(error)); return [] })))
  if (!live()) return []
  const key = `${source}:${mood}`
  const queue = (seeded.get(key) || []).filter(({ song }) => !state.tried.has(songKey(song)))
  const queued = new Set(queue.map(({ song }) => songKey(song)))
  for (let i = 0; lists.some(list => i < list.length); i++) {
    for (const list of lists) {
      const id = list[i] && songKey(list[i].song)
      if (id && !state.tried.has(id) && !queued.has(id)) { queue.push(list[i]); queued.add(id) }
    }
  }
  // Kept to a few refills' worth: the rest are found again from other seeds.
  if (queue.length > MAX_MOOD_QUEUE) queue.length = MAX_MOOD_QUEUE
  seeded.set(key, queue)
  const found = []
  let tries = 0
  while (found.length < count && tries < count * 4 && queue.length && live()) {
    const at = Math.floor(random() * Math.min(queue.length, 10))
    const [{ song, seed }] = queue.splice(at, 1)
    const songId = songKey(song)
    if (state.tried.has(songId) || exclude.has(songId)) continue
    state.tried.add(songId)
    tries++
    const [track] = await Promise.resolve(resolve([{ ...song, source }], { isCurrent: live })).catch(() => [])
    if (!track || !live() || exclude.has(songKey(track))) continue
    // Heard before it's offered: its pace and loudness against its seed's.
    const [mine, theirs] = await Promise.all([Promise.resolve(analyze(track)).catch(() => null), Promise.resolve(analyze(seed)).catch(() => null)])
    if (!live()) break
    const verdict = fitsMood({ mood, candidate: mine, seed: theirs })
    if (!verdict.fit) { log(`flow ${mood}: left out "${track.title}" (${verdict.reason})`); continue }
    exclude.add(songKey(track))
    found.push({ ...track, flowFind: source, flowSeed: seed.id })
  }
  // Reset meanwhile: even what was found is the old account's.
  return started === generation ? found : []
}
