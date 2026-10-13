// The lyrics last found for songs (trackId -> result, or null when there
// weren't any), shared by every place that shows them (the side panel,
// full-screen lyrics) and by opening full screen, which goes straight to the
// lyrics layout for a song that has some (src/store/player.js).

const cache = new Map()
const MAX = 30

/** The cached answer: a result, null (none found), or undefined (not looked up yet). */
export const peekLyrics = trackId => cache.get(trackId)
export const hasCachedLyrics = trackId => cache.has(trackId)

export function cacheLyrics(trackId, result) {
  cache.delete(trackId)
  cache.set(trackId, result)
  if (cache.size > MAX) cache.delete(cache.keys().next().value)
}

/** Whether a result has lines to show (instrumental ones don't). */
export const hasLyricLines = result => (result?.lines?.length || 0) > 0
