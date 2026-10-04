import assert from 'node:assert/strict'
import { test } from 'node:test'
import artwork from '../electron/discoveryArtwork.js'
import catalogue from '../electron/discoveryCatalogue.js'

test('artwork fills artist, album, and track metadata while rejecting wrong-artist matches', async () => {
  const requests = []
  const resolver = artwork.createArtworkResolver({
    fetchImpl: async url => {
      requests.push(url)
      const data = url.includes('/artist?') ? { data: [{ name: 'Artist', picture_xl: 'https://images.example/artist.jpg' }] }
        : url.includes('/album?') ? { data: [{ title: 'Album', artist: { name: 'Artist' }, cover_xl: 'https://images.example/album.jpg' }] }
          : url.includes('deezer') ? { data: [{ title: 'Song', artist: { name: 'Wrong Artist' }, album: { cover_xl: 'https://images.example/wrong.jpg' } }] }
            : { results: [{ trackName: 'Song', artistName: 'Artist', artworkUrl100: 'https://images.example/100x100bb.jpg' }] }
      return { ok: true, json: async () => data }
    },
  })
  const items = [{ type: 'artist', artist: 'Artist' }, { type: 'album', artist: 'Artist', title: 'Album' }, { type: 'track', artist: 'Artist', title: 'Song', image: 'https://images.example/2a96cbd8.jpg' }]
  const result = await resolver(items)
  assert.deepEqual(result.map(item => item.image), ['https://images.example/artist.jpg', 'https://images.example/album.jpg', 'https://images.example/600x600bb.jpg'])
  const count = requests.length
  await resolver(items)
  assert.equal(requests.length, count, 'successful fallback art is cached')
})

test('local art avoids external requests and unavailable art stays empty', async () => {
  const resolver = artwork.createArtworkResolver({ getDB: () => ({ prepare: () => ({ get: () => ({ id: 'artist-id', image_path: '/art/artist.jpg' }) }) }), fetchImpl: async () => { throw new Error('No request expected') } })
  assert.equal((await resolver([{ type: 'artist', artist: 'Artist' }]))[0].image, '/api/artist-image/artist-id')
  const missing = artwork.createArtworkResolver({ fetchImpl: async () => ({ ok: false }) })
  assert.equal((await missing([{ type: 'track', artist: 'Unknown', title: 'Unknown' }]))[0].image, '')
})

test('excluded artwork compares normalized http and https URLs', async () => {
  const resolver = artwork.createArtworkResolver({
    fetchImpl: async url => url.includes('deezer')
      ? { ok: true, json: async () => ({ data: [{ title: 'Song', artist: { name: 'Artist' }, album: { cover_xl: 'http://images.example/blocked.jpg' } }] }) }
      : { ok: true, json: async () => ({ results: [] }) },
  })
  const result = await resolver([{ type: 'track', artist: 'Artist', title: 'Song', image: 'https://images.example/blocked.jpg', exclude: 'http://images.example/blocked.jpg' }])
  assert.equal(result[0].image, '')
})

test('artwork skips matching identities with missing or excluded covers and uses later valid candidates', async () => {
  const valid = 'https://images.example/valid.jpg'
  const excluded = 'https://images.example/blocked.jpg'
  for (const type of ['artist', 'album', 'track']) {
    const row = image => type === 'artist' ? { artist: { name: 'Artist' }, album: { cover_xl: image } }
      : type === 'album' ? { title: 'Title', artist: { name: 'Artist' }, cover_xl: image }
        : { title: 'Title', artist: { name: 'Artist' }, album: { cover_xl: image } }
    const resolver = artwork.createArtworkResolver({ fetchImpl: async url => ({ ok: true, json: async () => url.includes('/search/artist?') ? { data: [] } : { data: [row(''), row(excluded), row(valid)] } }) })
    assert.equal((await resolver([{ type, artist: 'Artist', title: 'Title', exclude: excluded }]))[0].image, valid)
  }
  for (const provider of ['itunes', 'youtube']) {
    const resolver = artwork.createArtworkResolver({
      fetchImpl: async url => ({ ok: true, json: async () => url.includes('itunes') && provider === 'itunes'
        ? { results: [{ trackName: 'Song', artistName: 'Artist' }, { trackName: 'Song', artistName: 'Artist', artworkUrl100: valid }] }
        : { data: [], results: [] } }),
      searchSongs: async () => [{ title: 'Song', artists: ['Artist'], thumbnail: excluded }, { title: 'Song', artists: ['Artist'], thumbnail: valid }],
    })
    assert.equal((await resolver([{ type: 'track', artist: 'Artist', title: 'Song', exclude: excluded }]))[0].image, valid)
  }
})

test('album catalogue preserves provider track order and artist catalogue contains actual artist songs', async () => {
  const calls = []
  const call = async (method, params) => {
    calls.push({ method, params })
    const tracks = [{ name: 'First', artist: { name: 'Artist' } }, { name: 'Second', artist: { name: 'Artist' } }]
    return method === 'album.getInfo' ? { album: { tracks: { track: tracks } } } : { toptracks: { track: tracks } }
  }
  const settings = { lastfm_api_key: 'test-key' }
  const album = await catalogue.lastfmCatalogue(settings, call, { type: 'album', artist: 'Artist', album: 'Album' })
  assert.deepEqual(album.tracks.map(track => track.title), ['First', 'Second'])
  assert.ok(album.tracks.every(track => track.album === 'Album'))
  const artist = await catalogue.lastfmCatalogue(settings, call, { type: 'artist', artist: 'Artist' })
  assert.ok(artist.tracks.every(track => track.artist === 'Artist'))
  assert.deepEqual(calls.map(call => call.method), ['album.getInfo', 'artist.getTopTracks'])
})
