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
