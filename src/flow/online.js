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

/** Forget what was read: a settings change may be another account (and for the tests). */
// Bumped by each reset: a find started before it is for what was forgotten.
let generation = 0

export function resetOnline() {
  generation++
  sources.clear()
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

/** How many of `count` songs come from online: more for an adventurous tuner, none for the library alone. */
export function onlineShare(tuner, count) {
  if (!tuner?.source || tuner.source === 'library') return 0
  const adventurous = Math.min(1, Math.max(0, Number(tuner.adventurous) || 0))
  return Math.max(1, Math.round(count * (0.1 + 0.4 * adventurous)))
}
