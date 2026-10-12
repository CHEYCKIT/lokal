import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { api } = await import('../src/api.js')
const { usePlayerStore: store } = await import('../src/store/player.js')
const { startFlow, retuneFlow, continueFlow, flowPool, upcoming } = await import('../src/flow/session.js')

const song = (n, over = {}) => ({ id: `t${n}`, title: `Song ${n}`, artist: `Artist ${n}`, file_path: `/m/${n}.flac`, user_plays: n % 3, is_liked: n % 2, ...over })
let library = []
api.flowPool = async () => library

function reset(tracks) {
  library = tracks
  store.setState({ queue: [], queueIndex: -1, currentTrack: null, shuffle: false, shuffleQueue: [], shuffleIndex: -1, originalQueue: [], playHistory: [], futureHistory: [], playbackContext: null })
}
const titles = list => list.map(track => track.title)

test('retuning keeps what has played (and its history); only the songs to come change', async () => {
  reset(Array.from({ length: 40 }, (_, i) => song(i)))
  await startFlow({ userId: 'u', mood: 'flow' })
  store.getState().next(); store.getState().next()
  const before = store.getState()
  const played = before.queue.slice(0, before.queueIndex)
  const history = before.playHistory
  assert.ok(await retuneFlow({ userId: 'u', mood: 'flow', tuner: { adventurous: 1, recent: 0, genres: {} } }))
  const after = store.getState()
  assert.deepEqual(titles(after.queue.slice(0, after.queueIndex)), titles(played))
  assert.equal(after.currentTrack, before.currentTrack)
  assert.deepEqual(after.playHistory, history)
  const coming = upcoming(after)
  assert.ok(coming.length > 0)
  assert.ok(coming.every(track => !played.some(old => old.id === track.id)), 'nothing played comes back')
})

test('retuning while shuffled keeps the shuffle order played so far', async () => {
  reset(Array.from({ length: 40 }, (_, i) => song(i)))
  await startFlow({ userId: 'u', mood: 'flow' })
  store.getState().enableShuffle()
  store.getState().next()
  const before = store.getState()
  const played = before.shuffleQueue.slice(0, before.shuffleIndex + 1)
  await retuneFlow({ userId: 'u', mood: 'flow', tuner: { adventurous: 0.5, recent: 0.5, genres: {} } })
  const after = store.getState()
  assert.deepEqual(titles(after.shuffleQueue.slice(0, after.shuffleIndex + 1)), titles(played))
  assert.equal(after.queue[after.queueIndex].id, after.currentTrack.id)
  assert.ok(upcoming(after).every(track => !played.some(old => old.id === track.id)))
})

test('a Flow that has played its whole library goes round again', async () => {
  reset(Array.from({ length: 8 }, (_, i) => song(i)))
  await flowPool('u', { force: true })
  await startFlow({ userId: 'u', mood: 'flow' })
  for (let round = 0; round < 20; round++) {
    const state = store.getState()
    if (upcoming(state).length < 3) await continueFlow()
    store.getState().next()
  }
  const state = store.getState()
  assert.ok(upcoming(state).length > 0, 'it never ends')
  assert.equal(new Set(state.queue.map(track => track.id)).size, state.queue.length, 'each song once in the queue')
  assert.equal(state.queue[state.queueIndex].id, state.currentTrack.id)
})
