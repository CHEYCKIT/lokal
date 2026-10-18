// The song a radio station is playing, as a playable online song: what Like,
// Save to library and download need (a station's stream isn't a song). Found
// like Flow's online finds: the app's playback sources, first match. Asked once
// per song.

import { api } from '../api.js'
import { resolveRecommendationTracks } from '../recommendations.js'

const cache = new Map() // song_key -> Promise<track | null>
const MAX = 50

/** The playing station's song, as a track (null: it can't be found online). */
export function resolveStationSong(station, client = api, resolve = resolveRecommendationTracks) {
  if (!station?.song_key || !station.title) return Promise.resolve(null)
  const key = station.song_key
  if (cache.has(key)) return cache.get(key)
  const pending = Promise.resolve(resolve([{ title: station.title, artist: station.artist || '' }], client))
    .then(found => (Array.isArray(found) ? found[0] || null : null))
    .catch(() => null)
  cache.set(key, pending)
  if (cache.size > MAX) cache.delete(cache.keys().next().value)
  pending.then(track => { if (!track) cache.delete(key) })
  return pending
}
