// Flow's fresh finds from online: songs recommended by Last.fm (similar to
// what you scrobble) or YouTube Music (your home feed and mixes), found and
// made ready to play, woven in among your library's songs. The Flow Tuner
// says which (tuner.source: 'library' keeps Flow to your library).
//
// Recommendations come a page at a time (loadRecommendationPage, the same as
// Home → Discovery); a song is offered once per session, and one already in
// the queue, or one you know (liked or played in your library), isn't a find.

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

/** Forget what was read (another account, or for the tests). */
export function resetOnline() { sources.clear() }

async function readMore(source, loadPage) {
  const state = stateOf(source)
  if (state.loading) return state.loading
  state.loading = (async () => {
    for (let n = 0; n < PAGES_PER_ASK && state.page < MAX_PAGES; n++) {
      const data = await Promise.resolve(loadPage(source, state.page)).catch(error => ({ error: error.message }))
      state.page++
      if (data?.error) { state.error = String(data.error); break }
      state.error = ''
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
 */
export async function onlineFinds(source, { count, exclude = new Set(), isCurrent = () => true, random = Math.random, loadPage = (from, page) => loadRecommendationPage(from, page, api), resolve = (rows, options) => resolveRecommendationTracks(rows, api, options) } = {}) {
  if (!source || source === 'library' || !(count > 0)) return []
  const state = stateOf(source)
  const found = []
  let tries = 0
  while (found.length < count && tries < count * 3 && isCurrent()) {
    let left = state.candidates.filter(song => !state.tried.has(songKey(song)) && !exclude.has(songKey(song)))
    if (!left.length) {
      if (state.page >= MAX_PAGES) break
      await readMore(source, loadPage)
      if (state.error && !state.candidates.length) break
      left = state.candidates.filter(song => !state.tried.has(songKey(song)) && !exclude.has(songKey(song)))
      if (!left.length) break
    }
    const pick = left[Math.floor(random() * Math.min(left.length, PICK_FROM))]
    state.tried.add(songKey(pick))
    tries++
    const [track] = await Promise.resolve(resolve([pick], { isCurrent })).catch(() => [])
    if (track && isCurrent() && !exclude.has(songKey(track))) {
      exclude.add(songKey(track))
      found.push({ ...track, flowFind: source })
    }
  }
  return found
}

/** How many of `count` songs come from online: more for an adventurous tuner, none for the library alone. */
export function onlineShare(tuner, count) {
  if (!tuner?.source || tuner.source === 'library') return 0
  const adventurous = Math.min(1, Math.max(0, Number(tuner.adventurous) || 0))
  return Math.max(1, Math.round(count * (0.1 + 0.4 * adventurous)))
}
