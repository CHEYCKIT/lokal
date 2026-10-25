import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { globalSearch, normalise } = require('../electron/online/globalCatalogue.js')

const apple = [
  { wrapperType: 'track', kind: 'song', trackId: 100, trackName: 'A Song',
    artistName: 'An Artist', collectionName: 'Album', trackTimeMillis: 234500,
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/foo/100x100bb.jpg' },
  { wrapperType: 'track', kind: 'song', trackId: 100, trackName: 'A Song', artistName: 'An Artist' },
  { wrapperType: 'track', kind: 'song', trackId: 200, trackName: '', artistName: 'Artist' },
]

test('Global tracks contain Apple metadata but no playback source identity', () => {
  const result = normalise('tracks', apple)
  assert.equal(result.length, 1)
  assert.deepEqual(result[0], {
    id: '100', title: 'A Song', artist: 'An Artist', album: 'Album',
    duration: 234.5,
    artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/foo/100x100bb.jpg',
    catalogue: 'apple', catalogue_id: '100',
  })
  assert.equal(result[0].provider, undefined)
  assert.equal(result[0].file_path, undefined)
})

test('Global search bounds query, country and pagination; caches repeated requests', async () => {
  const asked = []
  const fetchImpl = async url => {
    const u = new URL(url)
    asked.push(u)
    const kind = u.searchParams.get('entity')
    return { ok: true, json: async () => ({ results: kind === 'song' ? apple : [] }) }
  }
  const options = { country: 'fR', limit: 5, fetchImpl }
  const result = await globalSearch('A Song', options)
  assert.equal(result.tracks.length, 1)
  assert.equal(result.albums.length, 0)
  assert.equal(result.artists.length, 0)
  assert.deepEqual(asked.map(a => a.searchParams.get('entity')), ['song','album','musicArtist'])
  assert.ok(asked.every(a => a.searchParams.get('country') === 'FR'))
  await globalSearch('A Song', options)
  assert.equal(asked.length, 3)
})

test('Invalid regions default to US and all results remain metadata-only', async () => {
  const seen = []
  const fetchImpl = async url => {
    seen.push(new URL(url))
    return { ok: true, json: async () => ({ results: [] }) }
  }
  await globalSearch('Other Query', { country: 'a/b', fetchImpl })
  assert.ok(seen.every(u => u.searchParams.get('country') === 'US'))
})
