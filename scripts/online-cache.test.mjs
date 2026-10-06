import assert from 'node:assert/strict'
import { test } from 'node:test'

// A fresh copy of the module (its cache) for each test, sharing `storage`.
const fresh = tag => import(`../src/onlineBrowse.js?${tag}`)
function memoryStorage() {
  const data = new Map()
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, String(value)) }, data }
}

test('online data is looked up once, then served from the cache until refreshed', async () => {
  globalThis.localStorage = memoryStorage()
  const { cachedOnline } = await fresh('a')
  let loads = 0
  const load = async () => ({ tracks: [{ title: `Song ${++loads}` }] })
  const keep = value => value.tracks.length > 0
  assert.equal((await cachedOnline('album:x', load, { keep })).tracks[0].title, 'Song 1')
  assert.equal((await cachedOnline('album:x', load, { keep })).tracks[0].title, 'Song 1')
  assert.equal(loads, 1)
  assert.equal((await cachedOnline('album:x', load, { keep, refresh: true })).tracks[0].title, 'Song 2')
  assert.equal((await cachedOnline('album:x', load, { keep })).tracks[0].title, 'Song 2')
})

test('nothing found is not kept: the next visit looks again', async () => {
  globalThis.localStorage = memoryStorage()
  const { cachedOnline } = await fresh('b')
  let loads = 0
  const load = async () => { loads++; return { tracks: [] } }
  await cachedOnline('album:y', load, { keep: value => value.tracks.length > 0 })
  await cachedOnline('album:y', load, { keep: value => value.tracks.length > 0 })
  assert.equal(loads, 2)
})

test('kept across restarts, for a week, the newest 80', async () => {
  const storage = memoryStorage()
  globalThis.localStorage = storage
  const first = await fresh('c')
  for (let i = 0; i < 85; i++) first.keepOnline(`artist:${i}`, { songs: { tracks: [i] } })
  const restarted = await fresh('d')
  assert.deepEqual(restarted.peekOnline('artist:84').value, { songs: { tracks: [84] } })
  assert.equal(restarted.peekOnline('artist:0'), null)
  // A week later it's looked up again.
  const saved = JSON.parse(storage.getItem('lokal-online-cache-v1'))
  saved.find(([key]) => key === 'artist:84')[1].at = Date.now() - 8 * 24 * 60 * 60 * 1000
  storage.setItem('lokal-online-cache-v1', JSON.stringify(saved))
  assert.equal((await fresh('e')).peekOnline('artist:84'), null)
})

test('cache keys ignore spelling details; storage that fails is no error', async () => {
  globalThis.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  const { albumCacheKey, artistCacheKey, keepOnline, peekOnline } = await fresh('f')
  assert.equal(albumCacheKey({ artist: 'Earth, Wind & Fire', album: 'I Am' }), albumCacheKey({ artist: 'earth wind & fire', album: 'I am' }))
  assert.notEqual(albumCacheKey({ artist: 'A', album: 'B' }), albumCacheKey({ artist: 'A', album: 'B', provider: 'a-0123456789', sourceAlbumId: '1' }))
  assert.equal(artistCacheKey('Earth, Wind & Fire'), artistCacheKey('Earth Wind & Fire'))
  keepOnline('artist:z', { ok: true })
  assert.deepEqual(peekOnline('artist:z').value, { ok: true })
})
