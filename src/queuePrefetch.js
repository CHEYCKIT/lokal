// Predictive pre-resolving: the streams of the songs coming up are looked up
// ahead of time (api.onlinePrepare: the yt-dlp lookup, an addon's preparation),
// so each starts at once when its turn comes, a skip included. The next
// LOOKAHEAD songs in play order (the shuffle order when shuffled, round again
// on repeat-all), the first at once and the rest STAGGER_MS apart so they
// don't all hit the network together. Songs already looked up lately aren't
// asked again; work for songs no longer coming up (the queue changed) stops.
//
// Run when the song changes and when the queue does (App.jsx).

import { api } from './api.js'
import { streamRef } from './onlineTracks.js'

export const LOOKAHEAD = 4
export const STAGGER_MS = 2000
const PREPARED_TTL_MS = 20 * 60 * 1000 // a stream looked up this recently still plays
const MAX_PREPARED_KEYS = 100

const prepared = new Map() // provider:id -> when it was ready
const running = new Map() // provider:id -> AbortController
let timers = []

/** The next `count` songs in play order after the one playing. */
export function upcomingTracks(state, count = LOOKAHEAD) {
  const shuffled = state.shuffle && state.shuffleQueue?.length > 0
  const list = shuffled ? state.shuffleQueue : state.queue || []
  const at = shuffled ? state.shuffleIndex : state.queueIndex
  if (!list.length || at == null || at < 0) return []
  const out = []
  for (let step = 1; out.length < count && step < list.length + 1; step++) {
    const index = at + step
    if (index < list.length) out.push(list[index])
    else if (state.repeat === 'all') out.push(list[index % list.length])
    else break
  }
  return out.filter(track => track && track.id !== state.currentTrack?.id)
}

const keyOf = ref => `${ref.provider}:${ref.id}`

function prunePrepared(now = Date.now()) {
  for (const [key, at] of prepared) {
    if (now - at >= PREPARED_TTL_MS) prepared.delete(key)
  }
  while (prepared.size > MAX_PREPARED_KEYS) prepared.delete(prepared.keys().next().value)
}

/** Forget what was looked up (tests; another account). */
export function resetPrefetch() {
  for (const timer of timers) clearTimeout(timer)
  timers = []
  for (const controller of running.values()) controller.abort()
  running.clear()
  prepared.clear()
}

/**
 * Look up the streams of the songs coming up.
 * @param getState the player's state when a staggered lookup starts (the queue may have changed)
 * @returns the keys asked for, in order (for the tests)
 */
export function prefetchUpcoming(state, { prepare = (provider, id, options) => api.onlinePrepare(provider, id, false, options), now = Date.now, schedule = setTimeout, cancel = clearTimeout, count = LOOKAHEAD, stagger = STAGGER_MS, getState = () => state } = {}) {
  prunePrepared(now())
  for (const timer of timers) cancel(timer)
  timers = []
  const refs = []
  for (const track of upcomingTracks(state, count)) {
    const ref = streamRef(track)
    if (ref && !refs.some(other => keyOf(other) === keyOf(ref))) refs.push(ref)
  }
  const wanted = new Set(refs.map(keyOf))
  // No longer coming up: its lookup (an addon's download, say) stops.
  for (const [key, controller] of running) {
    if (!wanted.has(key)) { controller.abort(); running.delete(key) }
  }
  const asked = []
  let delay = 0
  for (const ref of refs) {
    const key = keyOf(ref)
    const at = prepared.get(key)
    if ((at != null && now() - at < PREPARED_TTL_MS) || running.has(key)) continue
    asked.push(key)
    const start = () => {
      if (running.has(key)) return
      // Started later (staggered): still coming up in the queue as it is now?
      if (!upcomingTracks(getState(), count).some(track => { const now = streamRef(track); return now && keyOf(now) === key })) return
      const controller = new AbortController()
      running.set(key, controller)
      Promise.resolve(prepare(ref.provider, ref.id, { signal: controller.signal }))
        .then(result => {
          if (result && !result.error && !controller.signal.aborted) {
            prepared.delete(key)
            prepared.set(key, now())
            prunePrepared(now())
          }
        })
        .catch(() => {})
        .finally(() => { if (running.get(key) === controller) running.delete(key) })
    }
    if (delay === 0) start()
    else timers.push(schedule(start, delay))
    delay += stagger
  }
  return asked
}
