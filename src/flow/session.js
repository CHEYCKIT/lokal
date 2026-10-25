// Flow playing: starts with a few songs, and adds more as they're heard
// (App.jsx asks continueFlow when three or fewer are left), so it never ends.
// The mood and tuner it plays with are in its playback context; applying
// the tuner while it plays swaps the songs coming up for newly picked ones.
//
// Fresh finds also come from online (src/flow/online.js): songs Last.fm or
// YouTube Music recommend (the tuner's choice, else Discovery's source), found
// and woven in among the library's; more of them the more adventurous the
// tuner. A Flow waits a moment for its first two, so it doesn't open with
// the library alone; the rest are found in the background. A mood's come from the mood itself: songs similar to
// library songs that fit it, each heard first and left out when its pace or
// loudness doesn't belong (src/flow/online.js moodFinds, src/flow/moodFit.js).

import { api } from '../api.js'
import { usePlayerStore } from '../store/player.js'
import { DEFAULT_TUNER, FLOW_MOODS, familiarity, flowEligible, flowSongKey, flowSource, genreWeight, isFresh, moodScore, normalizeTuner, pickFlow } from './engine.js'
import { songKey } from '../recommendations.js'
import { moodFinds, moodSeeds, onlineFinds, onlineShare, radioFinds } from './online.js'
import { fitsMood } from './moodFit.js'

const POOL_TTL_MS = 5 * 60 * 1000
const START_COUNT = 10
const MORE_COUNT = 6
const OPENING_FINDS = 2 // online finds a Flow waits for, to start with them among its first songs
const OPENING_WAIT_MS = 3500 // … but no longer than this: then it starts, and they join when found
const RECENT_HELD = 30 // played it all: these last ones aren't played again yet

const pools = new Map() // user -> { at, rows: Promise<rows> }

/** The library's songs for a Flow (electron/ipc/flow.js), kept a few minutes. */
export function flowPool(userId, { force = false } = {}) {
  const key = userId || 'guest'
  const cached = pools.get(key)
  if (!force && cached && Date.now() - cached.at < POOL_TTL_MS) return cached.rows
  const rows = Promise.resolve(api.flowPool(key)).then(result => (Array.isArray(result) ? result : [])).catch(() => [])
  pools.set(key, { at: Date.now(), rows })
  return rows
}

const settingsKey = userId => `lokal-flow:${userId || 'guest'}`

/** The mood and tuner last applied (per user). */
export function readFlowSettings(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey(userId)) || 'null')
    const mood = FLOW_MOODS.some(item => item.id === saved?.mood) ? saved.mood : 'flow'
    return { mood, tuner: normalizeTuner(saved?.tuner || DEFAULT_TUNER) }
  } catch { return { mood: 'flow', tuner: normalizeTuner(DEFAULT_TUNER) } }
}

export function saveFlowSettings(userId, { mood, tuner }) {
  try { localStorage.setItem(settingsKey(userId), JSON.stringify({ mood, tuner: normalizeTuner(tuner) })) } catch {}
}

export const flowName = mood => (mood && mood !== 'flow' ? `Flow · ${FLOW_MOODS.find(item => item.id === mood)?.label || mood}` : 'Flow')

const flowContext = (userId, mood, tuner, source) => ({ type: 'flow', id: `flow:${Date.now().toString(36)}`, name: flowName(mood), mood, tuner: normalizeTuner(tuner), userId: userId || 'guest', source })

/** Where this tuner's online finds come from ('library': none), Discovery's source when it names none. */
export async function sourceFor(tuner) {
  if (normalizeTuner(tuner).source) return flowSource(tuner)
  const settings = await Promise.resolve(api.getSettings?.()).catch(() => null)
  return flowSource(tuner, settings?.recommendation_source)
}

/** The songs coming up, in play order (shuffled when shuffle is on). */
export function upcoming(state) {
  if (state.shuffle && state.shuffleQueue.length) return state.shuffleQueue.slice(state.shuffleIndex + 1)
  return state.queue.slice(state.queueIndex + 1)
}

/**
 * Start a Flow. Resolves to the number of songs it started with (0: none to
 * play; null: something else played meanwhile).
 * @param find  online finds (tests): (context, pool, count, isCurrent, queued) => tracks
 */
let starts = 0
export async function startFlow({ userId, mood = 'flow', tuner = DEFAULT_TUNER, find = findOnline, openingWaitMs = OPENING_WAIT_MS }) {
  const start = ++starts
  const before = usePlayerStore.getState()
  // Something else played (or another Flow was started) while this one was
  // being picked: that stays, this one doesn't start.
  const stale = () => {
    const now = usePlayerStore.getState()
    // (Each play started counts, the song playing picked again included.)
    return start !== starts || now.playbackGeneration !== before.playbackGeneration || now.playbackContext !== before.playbackContext || now.currentTrack?.id !== before.currentTrack?.id
  }
  const pool = await flowPool(userId, { force: true })
  const source = await sourceFor(tuner)
  if (stale()) return null
  // Online tracks replace library slots instead of being appended to a full
  // local queue (the old "80% online" setting actually meant 8 of 18).
  const share = onlineShare({ ...normalizeTuner(tuner), source }, START_COUNT)
  const tracks = pickFlow(pool, { count: START_COUNT - share, mood, tuner })
  if (!tracks.length) return 0
  const context = flowContext(userId, mood, tuner, source)
  // Its first online finds, waited for a moment so the Flow opens with them.
  // Too slow: it starts without them, and they join when they're found.
  let playing = false
  const isCurrent = () => (playing ? usePlayerStore.getState().playbackContext?.id === context.id : !stale())
  const openingCount = Math.min(OPENING_FINDS, share)
  let opening = []
  let rest = share // the finds left for the background search
  if (openingCount) {
    const search = Promise.resolve(find(context, pool, openingCount, isCurrent, tracks)).catch(() => [])
    const found = await Promise.race([search, new Promise(resolve => setTimeout(() => resolve(null), openingWaitMs))])
    if (stale()) return null
    if (found) {
      // Fewer than asked for: the background search looks for the rest.
      opening = found
      rest = share - opening.length
    } else {
      rest = share - openingCount
      search.then(late => { if (late?.length && isCurrent()) usePlayerStore.getState().insertUpcoming(late, context) })
    }
  }
  usePlayerStore.getState().playQueue(openingQueue(tracks, opening), 0, context)
  playing = true
  if (rest > 0) weaveOnline(context, pool, rest, find).catch(() => {})
  return tracks.length + opening.length
}

/** The library's first songs with the online finds spread among them: a library song first, then a find soon after. */
export function openingQueue(tracks, finds) {
  const out = [...tracks]
  const known = new Set(out.map(track => track.id))
  const extra = (finds || []).filter(track => track && !known.has(track.id))
  const room = Math.max(1, out.length - 1)
  extra.forEach((track, i) => {
    const at = 1 + Math.floor((i * room) / extra.length) + i
    out.splice(Math.min(at, out.length), 0, track)
  })
  return out
}

/**
 * A Flow that's playing, its songs coming up picked again for a new mood or
 * tuner. What has played stays in the queue (and its history), so a retuned
 * Flow still doesn't play those again.
 */
export async function retuneFlow({ userId, mood, tuner }) {
  const state = usePlayerStore.getState()
  if (state.playbackContext?.type !== 'flow' || !state.currentTrack) return false
  const pool = await flowPool(userId)
  const source = await sourceFor(tuner)
  // Both waits done: the Flow it was asked for must still be the one playing.
  const now = usePlayerStore.getState()
  if (now.playbackContext?.id !== state.playbackContext.id || !now.currentTrack) return false
  const order = playOrder(now)
  const played = order.slice(0, order.length - upcoming(now).length)
  const onlineCount = onlineShare({ ...normalizeTuner(tuner), source }, START_COUNT - 1)
  const tracks = pickFlow(pool, { count: START_COUNT - 1 - onlineCount, mood, tuner, exclude: new Set(played.map(flowSongKey)), lastTracks: played.slice(-3) })
  const context = flowContext(userId, mood, tuner, source)
  const replaced = usePlayerStore.getState().replaceUpcoming(tracks, context, { expect: state.playbackContext.id })
  if (replaced) weaveOnline(context, pool, onlineCount).catch(() => {})
  return replaced
}

/** The queue in play order (the shuffle order when shuffled). */
const playOrder = state => (state.shuffle && state.shuffleQueue.length ? state.shuffleQueue : state.queue)

/** A Flow playing with few songs left (App.jsx asks on each time update). */
export function flowNeedsMore(state) {
  return state.playbackContext?.type === 'flow' && upcoming(state).length < 3
}

let adding = null

/** More songs for the Flow that's playing. */
export function continueFlow() {
  if (adding) return adding
  adding = (async () => {
    const state = usePlayerStore.getState()
    const context = state.playbackContext
    if (context?.type !== 'flow') return
    const tuner = normalizeTuner(context.tuner)
    const pool = await flowPool(context.userId)
    const now = usePlayerStore.getState()
    if (now.playbackContext?.id !== context.id) return
    // Everything this Flow has played or queued is in its queue: none of it again.
    const exclude = new Set(now.queue.map(flowSongKey))
    const lastTracks = playOrder(now).slice(-3)
    const share = onlineShare({ ...tuner, source: context.source }, MORE_COUNT)
    let tracks = pickFlow(pool, { count: MORE_COUNT - share, mood: context.mood, tuner, exclude, lastTracks })
    if (!tracks.length && pool.length) {
      // Played it all: the songs heard longest ago come round again. Only the
      // last few stay held back (fewer for a small library, so some are left).
      const eligible = flowEligible(pool, { mood: context.mood, tuner })
      usePlayerStore.getState().dropPlayed(Math.min(RECENT_HELD, Math.floor(eligible / 2)))
      const trimmed = usePlayerStore.getState()
      if (trimmed.playbackContext?.id !== context.id) return
      tracks = pickFlow(pool, { count: MORE_COUNT - share, mood: context.mood, tuner, exclude: new Set(trimmed.queue.map(flowSongKey)), lastTracks })
    }
    usePlayerStore.getState().extendQueue(tracks, context)
    // Online finds join in the background: the library's songs are queued
    // already, and the next refill doesn't wait for slow lookups.
    weaveOnline(context, pool, share).catch(() => {})
  })().finally(() => { adding = null })
  return adding
}

/**
 * Online finds for the Flow `context`, woven in among its songs to come, in
 * the background (finding a song online takes a moment). None for moods, or
 * for a tuner set to the library.
 */
const weaving = new Set() // Flow ids with online finds being looked for

async function weaveOnline(context, pool, count, find = findOnline) {
  if (!count) return
  // One search at a time per Flow: a refill while one runs leaves it to that.
  if (weaving.has(context.id)) return
  weaving.add(context.id)
  try {
    const isCurrent = () => usePlayerStore.getState().playbackContext?.id === context.id
    // A slow catalogue/add-on must not leave reserved queue slots empty
    // indefinitely. Late answers are ignored; the fallback owns those slots.
    let deadline
    const fallback = new Promise(resolve => {
      deadline = setTimeout(() => resolve([]), 7000)
    })
    const found = await Promise.race([
      Promise.resolve().then(() => find(context, pool, count, isCurrent)).catch(() => []),
      fallback,
    ]).finally(() => clearTimeout(deadline))
    if (!isCurrent()) return
    if (found.length) usePlayerStore.getState().insertUpcoming(found, context)
    // Online may be unavailable (offline, missing account, provider throttled).
    // Backfill only its missing slots, preserving uninterrupted playback.
    const missing = count - found.length
    if (missing > 0) {
      const state = usePlayerStore.getState()
      const fallback = pickFlow(pool, {
        count: missing, mood: context.mood, tuner: context.tuner,
        exclude: new Set(state.queue.map(flowSongKey)), lastTracks: playOrder(state).slice(-3),
      })
      if (fallback.length && isCurrent()) state.extendQueue(fallback, context)
    }
  } finally { weaving.delete(context.id) }
}

/**
 * Up to `count` online finds for the Flow `context` (its mood's, for a mood).
 * @param queued  its songs not in the queue yet (a Flow starting), not offered again
 */
async function findOnline(context, pool, count, isCurrent, queued = []) {
  // A Flow from before this was kept (its context names no source): the tuner's, or Discovery's.
  const source = context.source || await sourceFor(context.tuner)
  if (!count || !source || source === 'library') return []
  const state = usePlayerStore.getState()
  // Not a find: songs in this Flow already, or ones the listener knows (liked or played here).
  const exclude = new Set([...state.queue, ...queued].map(songKey))
  for (const track of pool) if (!isFresh(track)) exclude.add(songKey(track))
  const mood = context.mood || 'flow'
  let found
  if (mood === 'flow') {
    // Provider home recommendations are useful, but can be unavailable for
    // signed-out listeners. Augment them with public, track-seeded radio.
    const homeCount = Math.ceil(count / 2)
    found = await onlineFinds(source, { count: homeCount, exclude, isCurrent })
    if (found.length < count && isCurrent()) {
      const seeds = moodSeeds(pool, {
        mood: 'flow', fits: () => 1,
        favour: track => familiarity(track, { recent: normalizeTuner(context.tuner).recent }),
      })
      const radio = await radioFinds({ seeds, count: count - found.length, exclude, isCurrent })
      found = [...found, ...radio]
    }
  } else {
    // A mood: songs like the library's songs that fit it, each heard before it's offered.
    const tuner = normalizeTuner(context.tuner)
    const seeds = moodSeeds(pool, {
      mood,
      fits: track => (genreWeight(track, tuner.genres) ? Math.max(0, moodScore(track, mood) - 0.5) : 0),
      favour: track => familiarity(track, { recent: tuner.recent }),
    })
    const log = message => { try { console.info(message) } catch {} }
    found = await moodFinds(source, { mood, seeds, count, exclude, isCurrent, log })
    if (found.length < count && isCurrent()) {
      // Last.fm can return no similarly tagged songs. Online radio still
      // follows the selected mood's local seed instead of random downloads.
      found = [...found, ...await radioFinds({
        seeds, count: count - found.length, exclude, isCurrent,
        accept: async (candidate, seed) => {
          const [mine, theirs] = await Promise.all([
            Promise.resolve(api.automixAnalyze(candidate)).catch(() => null),
            Promise.resolve(api.automixAnalyze(seed)).catch(() => null),
          ])
          return fitsMood({ mood, candidate: mine, seed: theirs }).fit
        },
      })]
    }
  }
  return found
}
