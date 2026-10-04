import { usePlayerStore } from './store/player.js'
import { resolveRecommendationTracks, songKey, uniqueSongs } from './recommendations.js'

/** Start one song promptly, then fill the same ordered queue in bounded batches. */
export async function playRecommendationPool(candidates, { selected, context, firstPlayable = false, isCurrent = () => true, onProviderFailure, resolve = (rows, options) => resolveRecommendationTracks(rows, undefined, options), store = usePlayerStore } = {}) {
  const pool = uniqueSongs(candidates)
  let index = selected ? pool.findIndex(track => songKey(track) === songKey(selected)) : 0
  if (!isCurrent()) return null
  if (index < 0 || !pool.length) return false
  // Supersede an older lookup immediately, including before either lookup has
  // started audio. Explicit playTrack/playQueue calls also advance this token.
  let version = (store.getState().playbackGeneration || 0) + 1
  store.setState({ playbackGeneration: version })
  const current = () => isCurrent() && store.getState().playbackGeneration === version
  let first
  for (; index < pool.length && current(); index++) {
    const rows = await resolve([pool[index]], { isCurrent: current, prepareStreams: true, onProviderFailure })
    first = rows[0]
    if (first || !firstPlayable) break
  }
  if (!current()) return null
  if (!first) return false
  store.getState().playQueue([first], 0, context)
  version = store.getState().playbackGeneration
  const rest = [...pool.slice(index + 1), ...(firstPlayable ? [] : pool.slice(0, index))]
  const order = pool.map(songKey)
  for (let at = 0; at < rest.length && current(); at += 4) {
    // Future songs are prepared when they actually play. Known preview results
    // are still rejected here, and runtime preparation handles hidden previews.
    const rows = await resolve(rest.slice(at, at + 4), { isCurrent: current, prepareStreams: false })
    if (current() && rows.length) store.getState().extendRecommendationQueue(rows, order, version)
  }
  return true
}
