import test from 'node:test'
import assert from 'node:assert/strict'
import { castWindow, windowKey, castPosition, locate } from '../src/cast/castWindow.js'

const songs = n => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }))
const ids = window => [window.current.id, ...window.upcoming.map(track => track.id)]

test('the TV holds the playing song and the next three, in the order Lokal plays them', () => {
  const queue = songs(6)
  assert.deepEqual(ids(castWindow({ queue, queueIndex: 1, currentTrack: queue[1] })), ['t1', 't2', 't3', 't4'])
  // Near the end: what's left, or round to the start on repeat-all.
  assert.deepEqual(ids(castWindow({ queue, queueIndex: 4, currentTrack: queue[4] })), ['t4', 't5'])
  assert.deepEqual(ids(castWindow({ queue, queueIndex: 4, currentTrack: queue[4], repeat: 'all' })), ['t4', 't5', 't0', 't1'])
  // Shuffled: the shuffle order (and no wrapping: a repeat reshuffles).
  const shuffleQueue = [queue[3], queue[0], queue[5]]
  const shuffled = castWindow({ shuffle: true, shuffleQueue, shuffleIndex: 1, queue, queueIndex: 0, currentTrack: queue[0], repeat: 'all' })
  assert.deepEqual(ids(shuffled), ['t0', 't5'])
  // A song already in the window ends it (the TV would mix the two up).
  const repeated = [queue[0], queue[1], queue[0], queue[2]]
  assert.deepEqual(ids(castWindow({ queue: repeated, queueIndex: 0, currentTrack: queue[0] })), ['t0', 't1'])
  assert.equal(castWindow({ queue, queueIndex: -1, currentTrack: null }), null)
  // The key changes with what the TV should hold, and with repeat.
  const a = castWindow({ queue, queueIndex: 0, currentTrack: queue[0] })
  const b = castWindow({ queue, queueIndex: 0, currentTrack: queue[0], repeat: 'one' })
  assert.notEqual(windowKey(a), windowKey(b))
  assert.equal(windowKey(a), windowKey(castWindow({ queue: [...queue], queueIndex: 0, currentTrack: queue[0] })))
})

test('the TV\'s clock runs on between its reports, and songs it moved to are found', () => {
  assert.equal(castPosition({ position: 10, at: 1000, playing: true }, 3500), 12.5)
  assert.equal(castPosition({ position: 10, at: 1000, playing: false }, 3500), 10)
  assert.equal(castPosition({ position: 179, at: 0, playing: true }, 5000, 180), 180)
  const queue = songs(4)
  assert.deepEqual(locate({ queue }, 't2'), { queueIndex: 2, track: queue[2] })
  assert.deepEqual(locate({ queue, shuffle: true, shuffleQueue: [queue[3], queue[1]] }, 't1'), { shuffleIndex: 1, queueIndex: 1, track: queue[1] })
  assert.equal(locate({ queue }, 'gone'), null)
})

test('lyrics for Lokal\'s receiver: timed when synced, one break kept after a line', async () => {
  const { receiverLyrics } = await import('../src/cast/castWindow.js')
  const synced = receiverLyrics({ type: 'synced', lines: [{ time: 1.5, text: ' One ' }, { time: 4, text: '' }, { time: 5, text: '' }, { time: 6, text: 'Two' }] })
  assert.deepEqual(synced, { synced: true, lines: [{ t: 1.5, text: 'One' }, { t: 4, text: '' }, { t: 6, text: 'Two' }] })
  const plain = receiverLyrics({ type: 'plain', lines: [{ text: 'One' }, { text: '' }, { text: 'Two' }] })
  assert.deepEqual(plain, { synced: false, lines: [{ t: null, text: 'One' }, { t: null, text: 'Two' }] })
  assert.deepEqual(receiverLyrics(null), { synced: false, lines: [] })
})
