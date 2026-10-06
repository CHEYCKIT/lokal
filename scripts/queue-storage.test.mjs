import assert from 'node:assert/strict'
import { test } from 'node:test'

const { packQueue, unpackQueue } = await import('../src/queueStorage.js')

const song = n => ({ id: `t-${n}`, title: `Song ${n}`, artist: 'Someone', album: null, genre: '', duration: 200 + n })
const list = (from, to) => Array.from({ length: to - from }, (_, i) => song(from + i))

test('each song is saved once; the orders come back as they were', () => {
  const queue = list(0, 50)
  const shuffleQueue = [...queue].reverse()
  const state = { queue, queueIndex: 7, shuffleQueue, shuffleIndex: 42, originalQueue: queue, currentTrack: queue[7], shuffle: true, repeat: 'all', playbackContext: { type: 'playlist', id: 'p1' } }
  const saved = JSON.parse(JSON.stringify(packQueue(state)))
  assert.equal(saved.tracks.length, 50)
  assert.deepEqual(saved.queue.slice(0, 2), ['t-0', 't-1'])
  const back = unpackQueue(saved)
  assert.deepEqual(back.queue.map(t => t.id), queue.map(t => t.id))
  assert.deepEqual(back.shuffleQueue.map(t => t.id), shuffleQueue.map(t => t.id))
  assert.equal(back.currentTrack.id, 't-7')
  assert.equal(back.queueIndex, 7)
  assert.equal(back.shuffleIndex, 42)
  assert.equal(back.repeat, 'all')
  assert.deepEqual(back.playbackContext, { type: 'playlist', id: 'p1' })
  assert.equal(back.tracks, undefined)
  assert.equal(back.v, undefined)
  // Empty fields are left out.
  assert.equal('album' in back.queue[0], false)
  assert.equal('genre' in back.queue[0], false)
  assert.equal(back.queue[0].duration, 200)
})

test('a 4,600-song queue is a fraction of the three full copies it used to be', () => {
  const queue = list(0, 4600).map(t => ({ ...t, file_path: `ghost://addon/${t.id}`, artwork_path: `https://example.com/art/${t.id}.jpg`, album: 'Album' }))
  const state = { queue, queueIndex: 0, shuffleQueue: [...queue].reverse(), shuffleIndex: 0, originalQueue: queue, currentTrack: queue[0] }
  const old = JSON.stringify({ queue: state.queue, shuffleQueue: state.shuffleQueue, originalQueue: state.originalQueue, currentTrack: state.currentTrack })
  const now = JSON.stringify(packQueue(state))
  assert.ok(now.length < old.length / 2.5, `${now.length} vs ${old.length}`)
})

test('a limited copy keeps the songs around the current one, its position adjusted', () => {
  const queue = list(0, 1000)
  const state = { queue, queueIndex: 600, shuffleQueue: queue, shuffleIndex: 5, originalQueue: [], currentTrack: queue[600] }
  const back = unpackQueue(JSON.parse(JSON.stringify(packQueue(state, { limit: 100 }))))
  assert.equal(back.queue.length, 201)
  assert.equal(back.queue[0].id, 't-500')
  assert.equal(back.queue[back.queueIndex].id, 't-600')
  assert.equal(back.shuffleQueue[0].id, 't-0')
  assert.equal(back.shuffleQueue[back.shuffleIndex].id, 't-5')
  assert.equal(back.currentTrack.id, 't-600')
})

test('the older format (full copies) still loads', () => {
  const old = { queue: list(0, 3), queueIndex: 1, currentTrack: song(1), shuffle: false }
  assert.equal(unpackQueue(old), old)
  assert.equal(unpackQueue(null), null)
})
