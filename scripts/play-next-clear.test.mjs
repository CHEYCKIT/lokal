import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { usePlayerStore: store } = await import('../src/store/player.js')

const song = n => ({ id: `t${n}`, title: `Song ${n}`, artist: `Artist ${n}`, file_path: `/m/${n}.flac` })
const ids = list => list.map(track => track.id)

function reset({ shuffle = false } = {}) {
  const queue = [1, 2, 3, 4, 5].map(song)
  store.setState({
    queue, queueIndex: 1, currentTrack: queue[1], playNextIds: [],
    shuffle, shuffleQueue: shuffle ? [queue[3], queue[1], queue[4], queue[0], queue[2]] : [], shuffleIndex: shuffle ? 1 : -1,
    originalQueue: shuffle ? queue : [],
  })
}

test('Clear Play Next removes only the songs added with Play Next', () => {
  reset()
  store.getState().playNext(song(8))
  store.getState().playNext(song(9))
  store.getState().clearUpcoming()
  const state = store.getState()
  assert.deepEqual(ids(state.queue), ['t1', 't2', 't3', 't4', 't5'])
  assert.equal(state.queueIndex, 1)
  assert.equal(state.currentTrack.id, 't2')
  assert.deepEqual(state.playNextIds, [])
})

test('with nothing added via Play Next, Clear leaves the queue alone', () => {
  reset()
  store.getState().clearUpcoming()
  assert.deepEqual(ids(store.getState().queue), ['t1', 't2', 't3', 't4', 't5'])
})

test('a Play Next song that has started playing is not removed', () => {
  reset()
  store.getState().playNext(song(8))
  store.getState().playNext(song(9))
  const { queue } = store.getState()
  store.setState({ queueIndex: 2, currentTrack: queue[2] })
  assert.deepEqual(store.getState().playNextIds, ['t8'])
  store.getState().clearUpcoming()
  assert.deepEqual(ids(store.getState().queue), ['t1', 't2', 't9', 't3', 't4', 't5'])
  assert.equal(store.getState().queueIndex, 2)
})

test('in shuffle, only the Play Next songs leave the shuffled order', () => {
  reset({ shuffle: true })
  store.getState().playNext(song(8))
  assert.deepEqual(ids(store.getState().shuffleQueue), ['t4', 't2', 't8', 't5', 't1', 't3'])
  store.getState().clearUpcoming()
  const state = store.getState()
  assert.deepEqual(ids(state.shuffleQueue), ['t4', 't2', 't5', 't1', 't3'])
  assert.equal(state.shuffleIndex, 1)
  assert.deepEqual(ids(state.queue), ['t1', 't2', 't3', 't4', 't5'])
  assert.equal(state.queueIndex, 1)
})
