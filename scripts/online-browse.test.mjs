import assert from 'node:assert/strict'
import { test } from 'node:test'
import { libraryAlbum, loadOnlineAlbum, loadOnlineArtistAlbums, onlineAlbumPath } from '../src/onlineBrowse.js'
import { isContextNavigable } from '../src/playbackContext.js'

test('album pages are addressed by artist and album (and YouTube album id)', () => {
  const path = onlineAlbumPath({ artist: 'Earth, Wind & Fire', album: 'I Am', albumId: 'MPREiam' })
  const params = new URLSearchParams(path.split('?')[1])
  assert.equal(path.split('?')[0], '/online/album')
  assert.deepEqual([params.get('artist'), params.get('album'), params.get('albumId')], ['Earth, Wind & Fire', 'I Am', 'MPREiam'])
  assert.equal(new URLSearchParams(onlineAlbumPath({ artist: 'A', album: 'B', albumId: 'javascript:x' }).split('?')[1]).get('albumId'), null)
})

test('the library album opens instead when the library has its songs as files', async () => {
  const client = tracks => ({ getAlbumTracks: async () => tracks })
  assert.deepEqual(await libraryAlbum({ artist: 'A', album: 'B' }, client([{ file_path: '/music/b.flac' }])), { title: 'B', album_artist: 'A' })
  assert.equal(await libraryAlbum({ artist: 'A', album: 'B' }, client([{ file_path: 'ghost://addon/a-0123456789/1' }])), null)
  assert.equal(await libraryAlbum({ artist: 'A', album: 'B' }, client([])), null)
})

test("album songs fall back to the album's cover, and to the playback sources", async () => {
  const searched = []
  const client = {
    discoveryCatalogue: async () => ({ tracks: [] }),
    getSettings: async () => ({}),
    onlineProviders: async () => [{ id: 'a-0123456789', addon: true, label: 'Addon' }],
    onlineSearch: async (query, source) => { searched.push([query, source]); return { results: [
      { title: 'In the Stone', artist: 'Earth, Wind & Fire', album: 'I Am', track_num: 1 },
      { title: 'Boogie Wonderland', artist: 'Earth, Wind & Fire', album: 'The Essential Earth, Wind & Fire' },
      { title: "Can't Let Go", artist: 'Earth, Wind & Fire', album: 'I Am', track_num: 2, thumbnail: 'https://addon.example/iam.jpg' },
    ] } },
  }
  const result = await loadOnlineAlbum({ artist: 'Earth, Wind & Fire', album: 'I Am', artwork: 'https://shown.example/iam.jpg' }, client)
  assert.deepEqual(result.tracks.map(track => track.title), ['In the Stone', "Can't Let Go"])
  assert.deepEqual(result.tracks.map(track => track.artwork_url), ['https://shown.example/iam.jpg', 'https://addon.example/iam.jpg'])
  assert.ok(searched.some(([query]) => query === 'Earth, Wind & Fire I Am'))
})

test("an artist's albums: the catalogue's, then their songs' albums, once each", async () => {
  const client = { discoveryCatalogue: async ({ source }) => source === 'youtube' ? { albums: [{ title: 'I Am', artist: 'Earth, Wind & Fire', albumId: 'MPREiam' }] } : { error: 'no' } }
  const albums = await loadOnlineArtistAlbums('Earth, Wind & Fire', [
    { title: 'September', album: 'The Best of Earth, Wind & Fire, Vol. 1', artwork_url: 'https://x.example/best.jpg' },
    { title: 'Boogie Wonderland', album: 'I am', artwork_url: 'https://x.example/iam.jpg' },
  ], client)
  assert.deepEqual(albums.map(album => album.title), ['I Am', 'The Best of Earth, Wind & Fire, Vol. 1'])
  assert.equal(albums[0].artwork_url, 'https://x.example/iam.jpg')
})

test('"Playing from" leads back to an online album or artist page', () => {
  assert.equal(isContextNavigable({ type: 'discovery', name: 'I Am', path: '/online/album?artist=A&album=B' }), true)
  assert.equal(isContextNavigable({ type: 'discovery', name: 'Fresh Finds' }), false)
  assert.equal(isContextNavigable({ type: 'discovery', name: 'x', path: 'https://evil.example' }), false)
})

import { mergeWithLibrary, isConnected, releaseTitleKey } from '../src/onlineBrowse.js'

test('the full album keeps its order, with the library copies in place of the songs it has', () => {
  const lib = [
    { id: 'l1', title: 'Boogie Wonderland', artist: 'Earth, Wind & Fire', file_path: '/m/bw.flac' },
    { id: 'l2', title: 'Bonus Jam', artist: 'Earth, Wind & Fire', file_path: '/m/bonus.flac' },
    { id: 'g1', title: 'In the Stone', artist: 'Earth, Wind & Fire', file_path: 'ghost://youtube/online/abcdefghijk' },
  ]
  const online = [
    { title: 'In the Stone (Album Version)', artist: 'Earth, Wind & Fire' },
    { title: 'Boogie Wonderland (with The Emotions)(Album Version)', artist: 'Earth, Wind & Fire' },
    { title: "Can't Let Go", artist: 'Earth, Wind & Fire' },
  ]
  const merged = mergeWithLibrary(online, lib)
  assert.deepEqual(merged.tracks.map(track => track.id || track.title), ['In the Stone (Album Version)', 'l1', "Can't Let Go", 'l2'])
  assert.deepEqual(merged.missing.map(track => track.title), ['In the Stone (Album Version)', "Can't Let Go"])
  assert.equal(merged.owned, 2)
})

test('release titles compare without edition labels; nothing remembered without storage', () => {
  assert.equal(releaseTitleKey('I Am (Expanded Edition)'), releaseTitleKey('I am'))
  assert.equal(isConnected('album:x|y'), false)
})

import { libraryAlbumCounts, releaseOwnership } from '../src/onlineBrowse.js'

test('releases the library has all or part of', () => {
  const counts = libraryAlbumCounts([
    { album: 'I Am', file_path: '/m/1.flac' }, { album: 'I Am (Expanded Edition)', file_path: '/m/2.flac' },
    { album: 'Raise!', file_path: 'ghost://youtube/online/abcdefghijk' }, { album: 'Spirit', file_path: '/m/3.flac' },
  ])
  assert.deepEqual(releaseOwnership({ title: 'I Am', track_count: 9 }, counts), { owned: 2, total: 9, full: false })
  assert.deepEqual(releaseOwnership({ title: 'Spirit', track_count: 1 }, counts), { owned: 1, total: 1, full: true })
  assert.deepEqual(releaseOwnership({ title: 'Spirit' }, counts), { owned: 1, total: 0, full: false })
  // Streamed songs aren't in the library.
  assert.equal(releaseOwnership({ title: 'Raise!', track_count: 9 }, counts), null)
  assert.equal(releaseOwnership({ title: 'Gratitude' }, counts), null)
})
