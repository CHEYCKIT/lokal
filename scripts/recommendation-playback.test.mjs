import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

globalThis.localStorage = { getItem: () => null, setItem() {} }
const { playRecommendationPool } = await import('../src/recommendationPlayback.js')
const { usePlayerStore: store } = await import('../src/store/player.js')
const pool = Array.from({ length: 8 }, (_, i) => ({ title: `Song ${i}`, artist: 'Artist' }))
const playable = track => ({ ...track, id: track.title, file_path: '/music/song.flac' })
const tick = () => new Promise(resolve => setImmediate(resolve))
beforeEach(() => store.setState({ currentTrack: null, queue: [], originalQueue: [], shuffleQueue: [], queueIndex: -1, shuffleIndex: -1, shuffle: false, playHistory: [], futureHistory: [], playbackGeneration: 0, progress: 0 }))

test('selected playback starts before slow background resolution and retains full list order, position, and context', async () => {
  let release
  const options = []
  const job = playRecommendationPool(pool, {
    selected: pool[2], context: { type: 'discovery', name: 'Quick Picks' },
    resolve: async (rows, option) => {
      options.push(option.prepareStreams)
      if (!option.prepareStreams && !release) return new Promise(resolve => { release = () => resolve(rows.map(playable)) })
      return rows.map(playable)
    },
  })
  await tick()
  assert.equal(store.getState().currentTrack.title, 'Song 2')
  assert.equal(store.getState().queue.length, 1, 'audio starts while the rest of the shelf is still unresolved')
  store.setState({ progress: 42 })
  release()
  await job
  assert.deepEqual(store.getState().queue.map(track => track.title), pool.map(track => track.title))
  assert.equal(store.getState().queueIndex, 2)
  assert.equal(store.getState().progress, 42)
  assert.deepEqual(store.getState().playbackContext, { type: 'discovery', name: 'Quick Picks' })
  assert.deepEqual(options, [true, false, false])
})

test('catalogue playback skips an unavailable first track and retains the remaining album order', async () => {
  await playRecommendationPool(pool, { firstPlayable: true, resolve: async rows => rows.filter(track => track.title !== 'Song 0').map(playable) })
  assert.equal(store.getState().currentTrack.title, 'Song 1')
  assert.deepEqual(store.getState().queue.map(track => track.title), pool.slice(1).map(track => track.title))
})

test('background results cannot append to a different playback queue', async () => {
  let release
  const job = playRecommendationPool(pool, { selected: pool[0], resolve: async (rows, options) => options.prepareStreams ? rows.map(playable) : new Promise(resolve => { release = () => resolve(rows.map(playable)) }) })
  await tick()
  const other = playable({ title: 'Other', artist: 'Other Artist' })
  store.getState().playQueue([other])
  release()
  await job
  assert.deepEqual(store.getState().queue, [other])
})

test('a failed background batch does not reject active playback or prevent later batches from filling the queue', async () => {
  let backgroundBatches = 0
  const started = await playRecommendationPool(pool, {
    selected: pool[0],
    resolve: async (rows, options) => {
      if (!options.prepareStreams && ++backgroundBatches === 1) throw new Error('Temporary lookup failure')
      return rows.map(playable)
    },
  })
  assert.equal(started, true)
  assert.equal(backgroundBatches, 2)
  assert.equal(store.getState().isPlaying, true)
  assert.equal(store.getState().currentTrack.title, 'Song 0')
  assert.deepEqual(store.getState().queue.map(track => track.title), ['Song 0', 'Song 5', 'Song 6', 'Song 7'])
})

test('a newer click supersedes an older selected-song lookup before audio starts', async () => {
  let release
  const old = playRecommendationPool([pool[0]], { selected: pool[0], resolve: rows => new Promise(resolve => { release = () => resolve(rows.map(playable)) }) })
  await tick()
  await playRecommendationPool([pool[1]], { selected: pool[1], resolve: async rows => rows.map(playable) })
  release()
  assert.equal(await old, null)
  assert.equal(store.getState().currentTrack.title, 'Song 1')
})

test('background queue filling preserves shuffle and avoids duplicate entries', async () => {
  store.setState({ shuffle: true })
  await playRecommendationPool([...pool, pool[1]], { selected: pool[3], resolve: async rows => rows.map(playable) })
  assert.equal(store.getState().shuffle, true)
  assert.equal(store.getState().queueIndex, 3)
  assert.equal(store.getState().shuffleIndex, 0)
  assert.equal(store.getState().shuffleQueue[0].title, 'Song 3')
  assert.equal(new Set(store.getState().shuffleQueue.map(track => track.id)).size, 8)
  assert.deepEqual(store.getState().originalQueue.map(track => track.title), pool.map(track => track.title))
})
