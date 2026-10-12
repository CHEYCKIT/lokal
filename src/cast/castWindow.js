// What the TV should hold, from the player's queue (pure, for the tests).

export const AHEAD = 3 // the next songs the TV holds, so it moves on by itself with no gap
export const UP_NEXT = 12 // the next songs Lokal's receiver shows (its Up Next row)

/**
 * The playing song and the next few, in the order Lokal will play them: the
 * shuffle order when shuffled, wrapping round on repeat-all (not shuffled:
 * a shuffled repeat reshuffles at the end, which can't be known yet). Stops
 * at a song already in the window, which the TV would otherwise mix up.
 */
export function castWindow(state, ahead = AHEAD) {
  const { shuffle, shuffleQueue = [], shuffleIndex = -1, queue = [], queueIndex = -1, currentTrack, repeat } = state || {}
  if (!currentTrack?.id) return null
  const shuffled = !!shuffle && shuffleQueue.length > 0
  const order = shuffled ? shuffleQueue : queue
  const index = shuffled ? shuffleIndex : queueIndex
  const seen = new Set([String(currentTrack.id)])
  const upcoming = []
  const candidates = order.slice(index + 1)
  if (repeat === 'all' && !shuffled && index >= 0) candidates.push(...order.slice(0, index))
  for (const track of candidates) {
    if (upcoming.length >= ahead || !track?.id || seen.has(String(track.id))) break
    seen.add(String(track.id))
    upcoming.push(track)
  }
  return { current: currentTrack, upcoming, repeat: repeat === 'one' || repeat === 'all' ? repeat : 'none' }
}

/** A window's identity: when it changes, the TV is brought in step. */
export const windowKey = window => (window ? [window.current.id, ...window.upcoming.map(track => track.id), window.repeat].join('\u0001') : '')

/** Lyrics as Lokal's receiver takes them: [{ t, text }] (timed only when synced). */
export function receiverLyrics(result) {
  const lines = Array.isArray(result?.lines) ? result.lines : []
  const synced = result?.type === 'synced' && lines.length > 0
  return {
    synced,
    lines: lines
      .map(line => ({ t: synced ? Math.max(0, Number(line?.time) || 0) : null, text: String(line?.text ?? '').trim().slice(0, 200) }))
      .filter((line, index, all) => line.text || (synced && index > 0 && all[index - 1].text)) // keep one blank (a break) after a line
      .slice(0, 400), // a Cast message is at most 64 KB
  }
}

/** Where the TV is in the song now, from its last report (its clock runs on while it plays). */
export function castPosition(anchor, now = Date.now(), duration = 0) {
  if (!anchor) return 0
  const position = anchor.playing ? anchor.position + Math.max(0, now - anchor.at) / 1000 : anchor.position
  return duration > 0 ? Math.min(position, duration) : position
}

/**
 * Where a song the TV moved to sits in the player's order: { shuffleIndex?,
 * queueIndex, track }, or null when it isn't there (it was removed meanwhile).
 */
export function locate(state, trackId) {
  const { shuffle, shuffleQueue = [], queue = [] } = state || {}
  const id = String(trackId)
  if (shuffle && shuffleQueue.length > 0) {
    const shuffleIndex = shuffleQueue.findIndex(track => String(track?.id) === id)
    if (shuffleIndex < 0) return null
    return { shuffleIndex, queueIndex: queue.findIndex(track => String(track?.id) === id), track: shuffleQueue[shuffleIndex] }
  }
  const queueIndex = queue.findIndex(track => String(track?.id) === id)
  return queueIndex < 0 ? null : { queueIndex, track: queue[queueIndex] }
}
