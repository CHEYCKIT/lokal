import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { prefetchUpcoming, upcomingTracks, resetPrefetch, LOOKAHEAD, STAGGER_MS } = await import('../src/queuePrefetch.js')

const online = n => ({ id: `yt:v${n}`, title: `Song ${n}`, artist: 'A', file_path: `ghost://youtube/online/v${n}` })
const local = n => ({ id: `t${n}`, title: `Local ${n}`, artist: 'A', file_path: `/m/${n}.flac` })

function fakeClock() {
  const timers = []
  return { schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, cancel: id => { if (timers[id - 1]) timers[id - 1].fn = null }, timers }
}

test('the next four songs, in play order (shuffle, repeat)', () => {
  const queue = [0, 1, 2, 3, 4, 5].map(local)
  assert.deepEqual(upcomingTracks({ queue, queueIndex: 0, currentTrack: queue[0] }).map(t => t.id), ['t1', 't2', 't3', 't4'])
  assert.deepEqual(upcomingTracks({ queue, queueIndex: 4, currentTrack: queue[4] }).map(t => t.id), ['t5'])
  assert.deepEqual(upcomingTracks({ queue, queueIndex: 4, currentTrack: queue[4], repeat: 'all' }).map(t => t.id), ['t5', 't0', 't1', 't2'])
  const shuffleQueue = [queue[3], queue[0], queue[5], queue[1]]
  assert.deepEqual(upcomingTracks({ queue, queueIndex: 3, shuffle: true, shuffleQueue, shuffleIndex: 0, currentTrack: queue[3] }).map(t => t.id), ['t0', 't5', 't1'])
  assert.equal(LOOKAHEAD, 4)
  assert.equal(STAGGER_MS, 2000)
})

test('online songs looked up ahead: the first at once, the rest 2 s apart; local ones need nothing', async () => {
  resetPrefetch()
  const asked = []
  const prepare = async (provider, id) => { asked.push(`${provider}:${id}`); return { ok: true } }
  const clock = fakeClock()
  const queue = [online(0), online(1), local(2), online(3), online(4), online(5)]
  const keys = prefetchUpcoming({ queue, queueIndex: 0, currentTrack: queue[0] }, { prepare, ...clock })
  assert.equal(keys.length, 3, 'three of the next four are online')
  assert.equal(asked.length, 1, 'the next one at once')
  assert.deepEqual(clock.timers.map(t => t.ms), [STAGGER_MS, 2 * STAGGER_MS])
  for (const t of clock.timers) t.fn?.()
  await new Promise(r => setTimeout(r, 0))
  assert.equal(asked.length, 3)
  // Asked again right after: all ready already, nothing new.
  assert.deepEqual(prefetchUpcoming({ queue, queueIndex: 0, currentTrack: queue[0] }, { prepare, ...fakeClock() }), [])
})

test('a lookup for a song no longer coming up stops', () => {
  resetPrefetch()
  const signals = []
  const prepare = (provider, id, { signal }) => { signals.push({ id, signal }); return new Promise(() => {}) }
  const queue = [online(0), online(1), online(2)]
  prefetchUpcoming({ queue, queueIndex: 0, currentTrack: queue[0] }, { prepare, ...fakeClock() })
  assert.equal(signals[0].id, 'v1')
  const other = [online(0), online(7)]
  prefetchUpcoming({ queue: other, queueIndex: 0, currentTrack: other[0] }, { prepare, ...fakeClock() })
  assert.equal(signals[0].signal.aborted, true, 'v1 is no longer next')
})

test('a staggered lookup for a song no longer coming up does not start', async () => {
  resetPrefetch()
  const asked = []
  const prepare = async (provider, id) => { asked.push(id); return { ok: true } }
  const clock = fakeClock()
  const queue = [online(0), online(1), online(2), online(3)]
  let state = { queue, queueIndex: 0, currentTrack: queue[0] }
  prefetchUpcoming(state, { prepare, getState: () => state, ...clock })
  assert.equal(asked.length, 1)
  // The songs coming up were replaced (same song playing) before the timers ran.
  const replaced = [queue[0], online(7), online(8)]
  state = { queue: replaced, queueIndex: 0, currentTrack: queue[0] }
  for (const t of clock.timers) t.fn?.()
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(asked, ['v1'], 'v2 and v3 are no longer coming up')
})
