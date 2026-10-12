import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { onlineFinds, onlineShare, onlineError, resetOnline } = await import('../src/flow/online.js')
const { usePlayerStore: store } = await import('../src/store/player.js')
const { songKey } = await import('../src/recommendations.js')

const rec = n => ({ title: `Find ${n}`, artist: `Band ${n}` })
const page = (from, to) => ({ freshFinds: Array.from({ length: to - from }, (_, i) => rec(from + i)), candidates: [] })
const resolveAll = async rows => rows.map(row => ({ ...row, id: `yt:${row.title}`, file_path: `stream://${row.title}`, source: 'youtube' }))

test('online finds: read a page at a time, offered once, known songs left out', async () => {
  resetOnline()
  const pages = []
  const loadPage = async (source, n) => { pages.push(n); return page(n * 10, n * 10 + 10) }
  const exclude = new Set([songKey(rec(0)), songKey(rec(1))])
  const first = await onlineFinds('lastfm', { count: 3, exclude, loadPage, resolve: resolveAll, random: () => 0 })
  assert.equal(first.length, 3)
  assert.ok(first.every(track => track.flowFind === 'lastfm' && !['Find 0', 'Find 1'].includes(track.title)))
  const again = await onlineFinds('lastfm', { count: 3, exclude: new Set(), loadPage, resolve: resolveAll, random: () => 0 })
  assert.ok(again.every(track => !first.some(old => old.title === track.title)), 'never offered twice')
  assert.deepEqual(pages, [0, 1], 'two pages read, once')
})

test('a song not found online is skipped for the next one', async () => {
  resetOnline()
  const resolve = async rows => (rows[0].title === 'Find 0' ? [] : resolveAll(rows))
  const found = await onlineFinds('youtube', { count: 2, loadPage: async () => page(0, 5), resolve, random: () => 0 })
  assert.deepEqual(found.map(track => track.title), ['Find 1', 'Find 2'])
})

test('a source that is not set up: nothing found, and why', async () => {
  resetOnline()
  const found = await onlineFinds('lastfm', { count: 2, loadPage: async () => ({ error: 'Connect Last.fm in Integrations.' }), resolve: resolveAll })
  assert.deepEqual(found, [])
  assert.equal(onlineError('lastfm'), 'Connect Last.fm in Integrations.')
  assert.equal(onlineError('library'), '')
})

test('a read that rejects without a message still says what went wrong', async () => {
  resetOnline()
  const found = await onlineFinds('lastfm', { count: 2, loadPage: () => Promise.reject(undefined), resolve: resolveAll })
  assert.deepEqual(found, [])
  assert.equal(onlineError('lastfm'), 'Could not read recommendations.')
  resetOnline()
  await onlineFinds('lastfm', { count: 1, loadPage: () => Promise.reject('offline'), resolve: resolveAll })
  assert.equal(onlineError('lastfm'), 'offline')
})

test('a reset while finding: nothing comes back, not even what was found', async () => {
  resetOnline()
  let resolved = 0
  const resolve = async rows => { if (++resolved === 2) resetOnline(); return resolveAll(rows) }
  const found = await onlineFinds('youtube', { count: 3, loadPage: async () => page(0, 10), resolve, random: () => 0 })
  assert.deepEqual(found, [])
  assert.equal(resolved, 2, 'stops once reset')
})

test('shuffled: finds go after the song playing in the unshuffled order too', () => {
  const songs = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}`, artist: 'A', file_path: `/m/${i}.flac` }))
  const context = { type: 'flow', id: 'flow:shuffled' }
  store.setState({ shuffle: false, shuffleQueue: [], shuffleIndex: -1, originalQueue: [], playHistory: [], futureHistory: [] })
  store.getState().playQueue(songs, 0, context)
  store.setState({ shuffle: true, shuffleQueue: [songs[0], songs[5], songs[2], songs[7], songs[1], songs[3], songs[6], songs[4]], shuffleIndex: 0, originalQueue: songs, queueIndex: 0 })
  store.getState().insertUpcoming([{ id: 'yt:s', title: 'Find S', artist: 'B', file_path: 'stream://s' }], context)
  for (const list of ['originalQueue', 'queue']) {
    const at = store.getState()[list].findIndex(track => track.id === 'yt:s')
    assert.ok(at > 1 && at < songs.length, `${list}: woven in, not at the end (${at})`)
  }
})

test('how many come from online', () => {
  assert.equal(onlineShare({ source: 'library', adventurous: 1 }, 10), 0)
  assert.equal(onlineShare({ adventurous: 1 }, 10), 0)
  assert.equal(onlineShare({ source: 'lastfm', adventurous: 0 }, 10), 1)
  assert.equal(onlineShare({ source: 'youtube', adventurous: 1 }, 10), 8)
})

test('finds are woven among the songs to come, never before the next one', () => {
  const songs = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: 'A', file_path: `/m/${i}.flac` }))
  const context = { type: 'flow', id: 'flow:test' }
  store.setState({ shuffle: false, shuffleQueue: [], shuffleIndex: -1, originalQueue: [], playHistory: [], futureHistory: [] })
  store.getState().playQueue(songs, 0, context)
  store.getState().next()
  const finds = [1, 2].map(n => ({ id: `yt:${n}`, title: `Find ${n}`, artist: 'B', file_path: `stream://${n}` }))
  store.getState().insertUpcoming(finds, context)
  const { queue, queueIndex } = store.getState()
  assert.equal(queue[queueIndex].id, 't1', 'the song playing stays')
  assert.equal(queue[queueIndex + 1].id, 't2', 'the next song stays next')
  const at = finds.map(find => queue.findIndex(track => track.id === find.id))
  assert.ok(at.every(i => i > queueIndex + 1))
  assert.ok(at[1] - at[0] > 1, 'spread out')
  store.getState().insertUpcoming([{ id: 'yt:9', title: 'X', artist: 'C', file_path: 'stream://9' }], { type: 'flow', id: 'other' })
  assert.ok(!store.getState().queue.some(track => track.id === 'yt:9'), 'only for the Flow playing')
})
