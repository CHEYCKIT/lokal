import assert from 'node:assert/strict'
import test from 'node:test'
import { artistResultKey, normalizeArtistResults } from '../src/downloadLinks.js'

test('artist search results with the same provider ID but different URLs remain distinct', () => {
  const results = normalizeArtistResults([
    { id: 'artist-channel', title: 'Artist A', type: 'channel', url: 'https://www.youtube.com/channel/PLone' },
    { id: 'artist-channel', title: 'Artist A', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLtwo' },
    { id: 'artist-channel', title: 'Artist A', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLthree' },
    { id: 'artist-channel', title: 'Artist A', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLtwo' },
  ])

  assert.equal(results.length, 3, 'only an exact duplicate should be removed')
  assert.equal(new Set(results.map(artistResultKey)).size, 3, 'every displayed result needs a unique React key')
})

test('artist result keys are stable for duplicate records', () => {
  const result = { id: 'channel', title: 'Artist', type: 'channel', url: 'https://youtube.com/@artist' }
  assert.equal(artistResultKey(result), artistResultKey({ ...result }))
  assert.deepEqual(normalizeArtistResults([result, { ...result }]), [result])
})
