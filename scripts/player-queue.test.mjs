import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
}
const { usePlayerStore: store } = await import('../src/store/player.js')

const track = (id, title = id) => ({
  id, title, artist: 'Test Artist', file_path: `/music/${id}.flac`,
})
const reset = state => store.setState({
  queue: [], queueIndex: -1, currentTrack: null,
  shuffle: false, shuffleQueue: [], shuffleIndex: -1, originalQueue: [],
  playNextIds: [],
  ...state,
})
beforeEach(() => reset({}))

test('reordering while shuffled changes playback order and tracks the current row', () => {
  const queue = ['a', 'b', 'c', 'd'].map(id => track(id))
  reset({
    queue, originalQueue: queue, queueIndex: 1, currentTrack: queue[1],
    shuffle: true, shuffleQueue: [...queue], shuffleIndex: 1,
  })

  store.getState().reorderQueue(3, 1)

  assert.deepEqual(store.getState().shuffleQueue.map(item => item.id), ['a', 'd', 'b', 'c'])
  assert.equal(store.getState().shuffleIndex, 2)
  assert.deepEqual(store.getState().queue.map(item => item.id), ['a', 'b', 'c', 'd'])
  assert.equal(store.getState().queueIndex, 1)
})

test('adding a song while shuffled keeps all queue orders in sync', () => {
  const existing = track('existing')
  reset({
    queue: [existing], originalQueue: [existing], queueIndex: 0, currentTrack: existing,
    shuffle: true, shuffleQueue: [existing], shuffleIndex: 0,
  })

  store.getState().addToQueue(track('added'))

  const state = store.getState()
  assert.deepEqual(state.queue.map(item => item.id), ['existing', 'added'])
  assert.deepEqual(state.shuffleQueue.map(item => item.id), ['existing', 'added'])
  assert.deepEqual(state.originalQueue.map(item => item.id), ['existing', 'added'])
})

test('removing one duplicate queue entry leaves the other occurrence intact', () => {
  const samePlaying = track('same')
  const other = track('other')
  const sameQueued = track('same')
  reset({ queue: [samePlaying, other, sameQueued], queueIndex: 0, currentTrack: samePlaying })

  store.getState().removeFromQueue('same', 2)

  assert.deepEqual(store.getState().queue.map(item => item.id), ['same', 'other'])
  assert.equal(store.getState().queueIndex, 0)
  assert.equal(store.getState().currentTrack, samePlaying)
})

test('removing a duplicate from a reordered shuffle removes the matching canonical occurrence', () => {
  const playing = track('same', 'Playing copy')
  const firstDuplicate = track('same', 'First queued copy')
  const other = track('other', 'Other')
  const targetDuplicate = track('same', 'Target queued copy')
  const queue = [playing, firstDuplicate, other, targetDuplicate]
  const shuffleQueue = [playing, targetDuplicate, other, firstDuplicate]
  reset({
    queue, originalQueue: [...queue], queueIndex: 0, currentTrack: playing,
    shuffle: true, shuffleQueue, shuffleIndex: 0,
  })

  store.getState().removeFromQueue('same', 1)

  let state = store.getState()
  assert.deepEqual(state.shuffleQueue.map(item => item.title), ['Playing copy', 'Other', 'First queued copy'])
  assert.deepEqual(state.queue.map(item => item.title), ['Playing copy', 'First queued copy', 'Other'])
  assert.deepEqual(state.originalQueue.map(item => item.title), ['Playing copy', 'First queued copy', 'Other'])

  store.getState().disableShuffle()
  state = store.getState()
  assert.deepEqual(state.queue.map(item => item.title), ['Playing copy', 'First queued copy', 'Other'])
})

test('removing a legacy shuffled-only entry still removes its row', () => {
  const existing = track('existing')
  const orphan = track('orphan')
  reset({
    queue: [existing], originalQueue: [existing], queueIndex: 0, currentTrack: existing,
    shuffle: true, shuffleQueue: [existing, orphan], shuffleIndex: 0,
  })

  store.getState().removeFromQueue('orphan', 1)

  assert.deepEqual(store.getState().shuffleQueue.map(item => item.id), ['existing'])
  assert.deepEqual(store.getState().queue.map(item => item.id), ['existing'])
})

test('removing a duplicate in shuffle mode removes only that occurrence from all queue orders', () => {
  const samePlaying = track('same')
  const other = track('other')
  const sameQueued = track('same')
  const queue = [samePlaying, other, sameQueued]
  reset({
    queue, originalQueue: [...queue], queueIndex: 0, currentTrack: samePlaying,
    shuffle: true, shuffleQueue: [...queue], shuffleIndex: 0,
  })

  store.getState().removeFromQueue('same', 2)

  const state = store.getState()
  assert.deepEqual(state.shuffleQueue.map(item => item.id), ['same', 'other'])
  assert.deepEqual(state.queue.map(item => item.id), ['same', 'other'])
  assert.deepEqual(state.originalQueue.map(item => item.id), ['same', 'other'])
  assert.equal(state.shuffleIndex, 0)
  assert.equal(state.queueIndex, 0)
  assert.equal(state.currentTrack, samePlaying)
})
