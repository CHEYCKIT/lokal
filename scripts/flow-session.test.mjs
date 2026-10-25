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

const online = n => ({ id: `yt:${n}`, title: `Find ${n}`, artist: `Band ${n}`, file_path: `stream://${n}`, source: 'youtube' })
const adventurous = { adventurous: 1, recent: 0.4, genres: {}, source: 'youtube' }

test('a Flow opens with its first online finds among its first songs', async () => {
  reset(Array.from({ length: 40 }, (_, i) => song(i)))
  const asked = []
  const find = async (context, pool, count, isCurrent, queued) => { asked.push({ count, queued: queued.length }); return [online(1), online(2)] }
  const started = await startFlow({ userId: 'u', tuner: adventurous, find })
  const { queue } = store.getState()
  assert.equal(started, 3, 'one library anchor and two opening radio finds')
  assert.deepEqual(asked, [{ count: 2, queued: 1 }], 'online slots replace local slots rather than inflating the total')
  assert.ok(!queue[0].id.startsWith('yt:'), 'a library song first, playing at once')
  const at = ['yt:1', 'yt:2'].map(id => queue.findIndex(track => track.id === id))
  assert.ok(at.every(i => i >= 1 && i <= 3), `finds among the first songs (${at})`)
})

test('finds too slow for the opening join when they come', async () => {
  reset(Array.from({ length: 40 }, (_, i) => song(i)))
  let deliver
  const find = () => new Promise(resolve => { deliver = resolve })
  const started = await startFlow({ userId: 'u', tuner: adventurous, find, openingWaitMs: 20 })
  assert.equal(started, 1, 'local anchor starts even while radio is slow')
  assert.ok(!store.getState().queue.some(track => track.id.startsWith('yt:')))
  store.getState().next()
  deliver([online(3)])
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(store.getState().queue.some(track => track.id === 'yt:3'), 'woven in once found')
})

test('a library-only tuner starts at once, with no online search', async () => {
  reset(Array.from({ length: 40 }, (_, i) => song(i)))
  let searched = false
  const started = await startFlow({ userId: 'u', tuner: { ...adventurous, source: 'library' }, find: async () => { searched = true; return [] } })
  assert.equal(started, 10)
  assert.equal(searched, false)
})

test('one opening find of two: the background search looks for the rest', async () => {
  reset(Array.from({ length: 40 }, (_, i) => song(i)))
  const asked = []
  const find = async (context, pool, count) => { asked.push(count); return asked.length === 1 ? [online(5)] : [] }
  await startFlow({ userId: 'u', tuner: adventurous, find })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(asked, [2, 8], 'one found at start, eight more targeted online slots')
})

test('the song playing picked again while a Flow waits for its finds: that stays', async () => {
  reset(Array.from({ length: 40 }, (_, i) => song(i)))
  const mine = [song(100), song(101)]
  store.getState().playQueue(mine, 0)
  let deliver
  const find = () => new Promise(resolve => { deliver = resolve })
  const starting = startFlow({ userId: 'u', tuner: adventurous, find })
  await new Promise(resolve => setTimeout(resolve, 10))
  store.getState().playQueue(mine, 0) // same song, same (no) context
  deliver([online(6)])
  assert.equal(await starting, null)
  assert.deepEqual(titles(store.getState().queue), titles(mine), 'the queue picked stays')
})
