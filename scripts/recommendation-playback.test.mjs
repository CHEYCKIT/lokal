import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

globalThis.localStorage = { getItem: () => null, setItem() {} }
const { playRecommendationPool, skipUnavailableRecommendation } = await import('../src/recommendationPlayback.js')
const { usePlayerStore: store } = await import('../src/store/player.js')
const pool = Array.from({ length: 8 }, (_, i) => ({ title: `Song ${i}`, artist: 'Artist' }))
const playable = track => ({ ...track, id: track.title, file_path: '/music/song.flac' })
const tick = () => new Promise(resolve => setImmediate(resolve))
beforeEach(() => store.setState({ currentTrack: null, queue: [], originalQueue: [], shuffleQueue: [], queueIndex: -1, shuffleIndex: -1, shuffle: false, repeat: 'off', playHistory: [], futureHistory: [], playbackGeneration: store.getState().playbackGeneration + 1, recommendationLoading: 0, progress: 0 }))

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

test('a one-song Discovery result never gains unrelated local recommendations', async () => {
  await playRecommendationPool(pool.slice(0, 1), { context: { type: 'discovery', name: 'Album' }, resolve: async rows => rows.map(playable) })
  store.getState().appendRelated([playable({ title: 'Unrelated Local', artist: 'Other' })])
  assert.deepEqual(store.getState().queue.map(track => track.title), ['Song 0'])
  store.setState({ playbackContext: { type: 'mix', name: 'Mix' } })
  store.getState().appendRelated([playable({ title: 'Unrelated Local', artist: 'Other' })])
  assert.deepEqual(store.getState().queue.map(track => track.title), ['Song 0'])
})

for (const name of ['Fresh Finds', 'Quick Picks', 'Scrobble History', 'YouTube Music Likes', 'YouTube Music History', 'Album', 'Mixed for you']) {
  test(`${name} skips an unavailable clicked song and starts the next playable song in shelf order`, async () => {
    const unavailable = new Set(['Song 2', 'Song 3'])
    await playRecommendationPool(pool, { selected: pool[2], context: { type: 'discovery', name }, resolve: async rows => rows.filter(track => !unavailable.has(track.title)).map(playable) })
    assert.equal(store.getState().currentTrack.title, 'Song 4')
    assert.deepEqual(store.getState().queue.map(track => track.title), ['Song 0', 'Song 1', 'Song 4', 'Song 5', 'Song 6', 'Song 7'])
    assert.equal(store.getState().queueIndex, 2)
  })
}

test('exhausting every Discovery candidate terminates and leaves the existing queue intact', async () => {
  const previous = playable({ title: 'Previous', artist: 'Artist' })
  store.getState().playQueue([previous])
  let attempts = 0
  assert.equal(await playRecommendationPool(pool, { selected: pool[5], context: { type: 'discovery' }, resolve: async () => { attempts++; return [] } }), false)
  assert.equal(attempts, pool.length)
  assert.deepEqual(store.getState().queue, [previous])
  assert.equal(store.getState().recommendationLoading, 0)
})

test('runtime provider exhaustion skips consecutive failures without repeat-one loops or unrelated tracks', async () => {
  const tracks = pool.slice(0, 3).map(playable)
  store.getState().playQueue(tracks, 0, { type: 'discovery', name: 'Fresh Finds' })
  store.setState({ repeat: 'one' })
  assert.equal(await skipUnavailableRecommendation(tracks[0]), true)
  assert.equal(store.getState().currentTrack, tracks[1])
  assert.equal(await skipUnavailableRecommendation(tracks[1]), true)
  assert.equal(store.getState().currentTrack, tracks[2])
  assert.equal(await skipUnavailableRecommendation(tracks[2]), false)
  assert.deepEqual(store.getState().queue, tracks)
})

test('repeat-all and shuffle skip exhausted songs once and terminate if the entire queue fails', async () => {
  const tracks = pool.slice(0, 3).map(playable)
  store.getState().playQueue(tracks, 0, { type: 'mix' })
  store.setState({ repeat: 'all', shuffle: true, shuffleQueue: [tracks[0], tracks[2], tracks[1]], shuffleIndex: 0 })
  assert.equal(await skipUnavailableRecommendation(tracks[0]), true)
  assert.equal(store.getState().currentTrack, tracks[2])
  assert.equal(store.getState().queueIndex, 2)
  assert.equal(await skipUnavailableRecommendation(tracks[2]), true)
  assert.equal(store.getState().currentTrack, tracks[1])
  assert.equal(await skipUnavailableRecommendation(tracks[1]), false)
})

test('runtime exhaustion waits for an in-flight queue batch and advances when it arrives', async () => {
  let release
  const job = playRecommendationPool(pool, { selected: pool[0], context: { type: 'discovery' }, resolve: async (rows, options) => options.prepareStreams ? rows.map(playable) : new Promise(resolve => { release = () => resolve(rows.map(playable)) }) })
  await tick()
  const failed = store.getState().currentTrack
  const skipping = skipUnavailableRecommendation(failed)
  await tick()
  assert.equal(store.getState().isPlaying, false)
  release()
  assert.equal(await skipping, true)
  assert.equal(store.getState().currentTrack.title, 'Song 1')
  store.getState().playQueue([playable({ title: 'Other', artist: 'Artist' })])
  await tick()
  release()
  await job
})

test('new explicit playback cancels a pending unavailable-song advance', async () => {
  const failed = playable(pool[0])
  store.getState().playQueue([failed], 0, { type: 'discovery' })
  store.setState({ recommendationLoading: store.getState().playbackGeneration })
  const skipping = skipUnavailableRecommendation(failed)
  const other = playable({ title: 'Other', artist: 'Artist' })
  store.getState().playQueue([other])
  assert.equal(await skipping, false)
  assert.equal(store.getState().currentTrack, other)
})
