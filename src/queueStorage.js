// The queue as saved between sessions (localStorage 'lokal-queue'). Each song
// is kept once, without empty fields; the play order, the shuffled order and
// the order before shuffling are lists of its id. (They used to be three full
// copies of every song, written after every change of the player's state,
// playback position included: a 4,600-song playlist made ~15 MB of JSON several
// times a second, more than the storage holds, and everything stalled.)

export const QUEUE_KEYS = ['queue', 'queueIndex', 'currentTrack', 'shuffle', 'repeat', 'shuffleQueue', 'shuffleIndex', 'playHistory', 'futureHistory', 'wasShuffled', 'originalQueue', 'playbackContext']

const compact = track => {
  const out = {}
  for (const [key, value] of Object.entries(track)) {
    if (value === null || value === undefined || value === '') continue
    out[key] = value
  }
  return out
}

/**
 * The saved form of the player's queue state. `limit`: at most this many
 * songs on each side of the current one (a smaller copy when the full one
 * doesn't fit).
 */
export function packQueue(state, { limit = Infinity } = {}) {
  const tracks = new Map()
  const keep = track => {
    if (!track?.id) return null
    if (!tracks.has(track.id)) tracks.set(track.id, compact(track))
    return track.id
  }
  const around = (list, index) => {
    const all = Array.isArray(list) ? list : []
    if (!Number.isFinite(limit) || all.length <= limit * 2 + 1) return { list: all, offset: 0 }
    const at = Math.max(0, index)
    const start = Math.max(0, at - limit)
    return { list: all.slice(start, at + limit + 1), offset: start }
  }
  const queue = around(state.queue, state.queueIndex)
  const shuffled = around(state.shuffleQueue, state.shuffleIndex)
  const original = around(state.originalQueue, state.queueIndex)
  return {
    v: 2,
    queue: queue.list.map(keep).filter(Boolean),
    queueIndex: Math.max(-1, (state.queueIndex ?? -1) - queue.offset),
    shuffleQueue: shuffled.list.map(keep).filter(Boolean),
    shuffleIndex: Math.max(-1, (state.shuffleIndex ?? -1) - shuffled.offset),
    originalQueue: original.list.map(keep).filter(Boolean),
    currentTrack: keep(state.currentTrack),
    tracks: [...tracks.values()],
    shuffle: !!state.shuffle,
    repeat: state.repeat,
    playHistory: Array.isArray(state.playHistory) ? state.playHistory.slice(-200) : [],
    futureHistory: Array.isArray(state.futureHistory) ? state.futureHistory.slice(0, 200) : [],
    wasShuffled: !!state.wasShuffled,
    playbackContext: state.playbackContext || null,
  }
}

/** The queue state from what packQueue saved (or the older format with full copies). */
export function unpackQueue(saved) {
  if (!saved || typeof saved !== 'object') return null
  if (saved.v !== 2) return saved
  const { v, tracks, ...rest } = saved
  const byId = new Map((Array.isArray(tracks) ? tracks : []).filter(track => track?.id).map(track => [track.id, track]))
  const list = ids => (Array.isArray(ids) ? ids : []).map(id => byId.get(id)).filter(Boolean)
  return {
    ...rest,
    queue: list(saved.queue),
    shuffleQueue: list(saved.shuffleQueue),
    originalQueue: list(saved.originalQueue),
    currentTrack: byId.get(saved.currentTrack) || null,
  }
}
