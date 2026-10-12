import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { likedSince, likedEntry } = require('../electron/artwork/spotify.js')

// A Liked Songs library of `count` songs, newest first, one a minute apart, the way Pathfinder pages it.
function library(count, newest = Date.parse('2026-10-12T12:00:00Z')) {
  const asked = []
  const items = Array.from({ length: count }, (_, i) => ({
    addedAt: { isoString: new Date(newest - i * 60000).toISOString() },
    track: { _uri: `spotify:track:${String(i).padStart(22, 'a')}`, data: { __typename: 'Track', name: `Song ${i}`, artists: { items: [{ profile: { name: 'Artist' } }] }, albumOfTrack: { name: 'Album', coverArt: { sources: [] } }, duration: { totalMilliseconds: 200000 } } },
  }))
  const fetchPage = async (offset, limit) => { asked.push([offset, limit]); return { me: { library: { tracks: { items: items.slice(offset, offset + limit), pagingInfo: { offset, limit } } } } } }
  return { items, fetchPage, asked, newest }
}

test('turning sync on reads only the newest like (never the old ones)', async () => {
  const lib = library(20000)
  const { items, newest } = await likedSince('', null, { fetchPage: lib.fetchPage })
  assert.deepEqual(items, [])
  assert.equal(newest, lib.newest)
  assert.deepEqual(lib.asked, [[0, 1]], 'one request for one song, out of 20,000')
})

test('afterwards, only songs liked since are read, and reading stops at the first older one', async () => {
  const lib = library(20000)
  const since = lib.newest - 3 * 60000 // three newer likes since
  const { items, newest } = await likedSince('', since, { fetchPage: lib.fetchPage })
  assert.deepEqual(items.map(item => item.title), ['Song 0', 'Song 1', 'Song 2'])
  assert.equal(newest, lib.newest)
  assert.deepEqual(lib.asked, [[0, 50]], 'one page, not the library')
  // Nothing new: still one page, nothing back.
  const again = await likedSince('', newest, { fetchPage: library(20000).fetchPage })
  assert.deepEqual(again.items, [])
})

test('many new likes are read page by page, but never more than 500 at once', async () => {
  const lib = library(20000)
  const { items } = await likedSince('', lib.newest - 120 * 60000, { fetchPage: lib.fetchPage })
  assert.equal(items.length, 120)
  assert.equal(lib.asked.length, 3)
  const flood = library(20000)
  const many = await likedSince('', flood.newest - 5000 * 60000, { fetchPage: flood.fetchPage })
  assert.equal(many.items.length, 500)
  assert.equal(flood.asked.length, 10)
})

test('a liked song as Lokal uses it; podcasts and local files are skipped', () => {
  const entry = likedEntry({ addedAt: { isoString: '2026-10-12T12:00:00Z' }, track: { _uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', data: { __typename: 'Track', name: 'Never Gonna Give You Up', artists: { items: [{ profile: { name: 'Rick Astley' } }] }, albumOfTrack: { name: 'Whenever You Need Somebody', coverArt: { sources: [{ url: 'small', width: 64 }, { url: 'big', width: 640 }] } }, duration: { totalMilliseconds: 213000 } } } })
  assert.deepEqual(entry, { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody', duration: 213, artwork_url: 'big', addedAt: Date.parse('2026-10-12T12:00:00Z') })
  assert.equal(likedEntry({ track: { _uri: 'spotify:episode:x', data: { __typename: 'Episode' } } }), null)
})
