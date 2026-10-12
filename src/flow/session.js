// Flow playing: starts with a few songs, and adds more as they're heard
// (App.jsx asks continueFlow when three or fewer are left), so it never ends.
// The mood and tuner it plays with are in its playback context; applying
// the tuner while it plays swaps the songs coming up for newly picked ones.
//
// With an adventurous tuner, a song recommended online (Last.fm or YouTube
// Music, as set for Discovery) joins now and then among the library's.

import { api } from '../api'
import { usePlayerStore } from '../store/player'
import { DEFAULT_TUNER, FLOW_MOODS, flowSongKey, normalizeTuner, pickFlow } from './engine'
import { recommendationSession } from '../recommendationSession'
import { resolveRecommendationTracks } from '../recommendations'

const POOL_TTL_MS = 5 * 60 * 1000
const START_COUNT = 10
const MORE_COUNT = 6
const ONLINE_FROM = 0.5 // the tuner's adventurousness from which online finds join

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

const flowContext = (userId, mood, tuner) => ({ type: 'flow', id: `flow:${Date.now().toString(36)}`, name: flowName(mood), mood, tuner: normalizeTuner(tuner), userId: userId || 'guest' })

/** The songs coming up, in play order (shuffled when shuffle is on). */
function upcoming(state) {
  if (state.shuffle && state.shuffleQueue.length) return state.shuffleQueue.slice(state.shuffleIndex + 1)
  return state.queue.slice(state.queueIndex + 1)
}

/** Start a Flow. Resolves to the number of songs it started with (0: none to play). */
export async function startFlow({ userId, mood = 'flow', tuner = DEFAULT_TUNER }) {
  const pool = await flowPool(userId, { force: true })
  const tracks = pickFlow(pool, { count: START_COUNT, mood, tuner })
  if (!tracks.length) return 0
  usePlayerStore.getState().playQueue(tracks, 0, flowContext(userId, mood, tuner))
  return tracks.length
}

/** A Flow that's playing, its songs coming up picked again for a new mood or tuner. */
export async function retuneFlow({ userId, mood, tuner }) {
  const state = usePlayerStore.getState()
  if (state.playbackContext?.type !== 'flow' || !state.currentTrack) return false
  const pool = await flowPool(userId)
  const exclude = new Set([...(state.playHistory || []).map(id => state.queue.find(track => track.id === id)).filter(Boolean), state.currentTrack].map(flowSongKey))
  const tracks = pickFlow(pool, { count: START_COUNT - 1, mood, tuner, exclude, lastTracks: [state.currentTrack] })
  return usePlayerStore.getState().continueAsQueue([state.currentTrack, ...tracks], flowContext(userId, mood, tuner))
}

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
    const exclude = new Set(now.queue.map(flowSongKey))
    const order = now.shuffle && now.shuffleQueue.length ? now.shuffleQueue : now.queue
    let tracks = pickFlow(pool, { count: MORE_COUNT, mood: context.mood, tuner, exclude, lastTracks: order.slice(-3) })
    // Played it all: the songs heard longest ago come round again.
    if (!tracks.length) tracks = pickFlow(pool, { count: MORE_COUNT, mood: context.mood, tuner, exclude: new Set(now.queue.slice(-30).map(flowSongKey)), lastTracks: order.slice(-3) })
    usePlayerStore.getState().extendQueue(tracks, context)
    if (tuner.adventurous >= ONLINE_FROM && (!context.mood || context.mood === 'flow')) await addOnlineFind(context, exclude).catch(() => {})
  })().finally(() => { adding = null })
  return adding
}

const onlineTried = new Set()

/** One song recommended online, found and ready to play, at the end of the Flow. */
async function addOnlineFind(context, exclude) {
  const session = recommendationSession(context.userId)
  const data = session.getSnapshot().data
  if (!data) { session.ensure().catch(() => {}); return }
  const candidates = [...(data.freshFinds || []), ...(data.candidates || [])]
    .filter(track => track?.title && track?.artist && !exclude.has(flowSongKey(track)) && !onlineTried.has(flowSongKey(track)))
  const pick = candidates[Math.floor(Math.random() * Math.min(candidates.length, 20))]
  if (!pick) return
  onlineTried.add(flowSongKey(pick))
  const isCurrent = () => usePlayerStore.getState().playbackContext?.id === context.id
  const [found] = await resolveRecommendationTracks([pick], api, { isCurrent })
  if (found && isCurrent()) usePlayerStore.getState().extendQueue([found], context)
}
