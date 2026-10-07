import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterPlaylistTracks } from '../src/playlistSearch.js'

const tracks = [
  { id: '1', title: 'Hyper', artist: 'Kroi', album: 'Fire Brain' },
  { id: '2', title: 'Boogie Oogie', artist: 'Babert', album: 'Disco' },
  { id: '3', title: 'Brighter Days', artist: 'Gypsy Woman', album: 'House Essentials' },
]

test('playlist search matches title, artist, or album and keeps the playlist order', () => {
  assert.deepEqual(filterPlaylistTracks(tracks, 'boogie'), [tracks[1]])
  assert.deepEqual(filterPlaylistTracks(tracks, 'house gypsy'), [tracks[2]])
  assert.deepEqual(filterPlaylistTracks(tracks, 'KROI'), [tracks[0]])
  assert.deepEqual(filterPlaylistTracks(tracks, ''), tracks)
  assert.deepEqual(filterPlaylistTracks(tracks, 'missing'), [])
})
