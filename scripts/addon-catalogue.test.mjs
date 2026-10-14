import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { loadAddonAlbum, loadAddonArtist, loadOnlineAlbum, trackAlbumPath } from '../src/onlineBrowse.js'
import { resolveRecommendationTracks } from '../src/recommendations.js'

const require = createRequire(import.meta.url)
const addons = require('../electron/online/addons.js')
const sources = require('../electron/online/sources.js')

function memoryDb() {
  const rows = new Map()
  return { prepare: () => ({ get: key => (rows.has(key) ? { value: rows.get(key) } : undefined), run: (key, value) => { rows.set(key, value) }, all: () => [] }) }
}
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const BASE = 'https://addon.example/token123'
const manifest = (version, resources) => ({ id: 'qobuz-test', name: 'Qobuz (test)', version, resources, settings: [{ key: 'quality', type: 'select', default: '6' }] })

test('an addon gaining album and artist pages is picked up without reinstalling, settings and order kept', async () => {
  const db = memoryDb()
  await addons.install(db, 'https://other.example/manifest.json', { fetchImpl: async () => json({ id: 'other', name: 'Other', version: '1', resources: ['search', 'stream'] }) })
  const installed = await addons.install(db, `${BASE}/manifest.json`, { fetchImpl: async () => json(manifest('1.0.0', ['search', 'stream'])) })
  addons.setSettings(db, installed.key, { quality: '27' })
  // Fresh manifests aren't fetched again.
  let fetched = 0
  await addons.refreshManifests(db, { fetchImpl: async () => { fetched++; return json(manifest('1.1.0', ['search', 'stream', 'album', 'artist'])) } })
  assert.equal(fetched, 0)
  const after = await addons.refreshManifests(db, { maxAgeMs: 0, fetchImpl: async url => { fetched++; return String(url).startsWith(BASE) ? json(manifest('1.1.0', ['search', 'stream', 'album', 'artist'])) : json({ id: 'other', name: 'Other', version: '2', resources: ['search', 'stream'] }) } })
  const mine = after.find(a => a.key === installed.key)
  assert.deepEqual(mine.resources, ['search', 'stream', 'album', 'artist'])
  assert.equal(mine.version, '1.1.0')
  assert.equal(mine.settings.quality, '27')
  assert.deepEqual(after.map(a => a.id), ['other', 'qobuz-test'])
  // A manifest answering with another id isn't taken for this addon.
  await addons.refreshManifests(db, { maxAgeMs: 0, fetchImpl: async () => json(manifest('9', ['search', 'stream']) && { ...manifest('9', ['search', 'stream']), id: 'someone-else' }) })
  assert.equal(addons.list(db).find(a => a.key === installed.key).version, '1.1.0')
})

test("addon albums come in disc and track order, artists with their ids", async () => {
  const db = memoryDb()
  const { key } = await addons.install(db, `${BASE}/manifest.json`, { fetchImpl: async () => json(manifest('1.1.0', ['search', 'stream', 'album', 'artist'])) })
  const urls = []
  const fetchImpl = async url => {
    urls.push(String(url))
    if (String(url).includes('/album/')) return json({ id: '0886443461536', title: 'I Am', artist: 'Earth, Wind & Fire', artistId: '61717', artworkURL: 'https://img.example/iam.jpg', year: 1979, releaseType: 'album', tracks: [
      { id: '2', title: 'Can\'t Let Go', artist: 'Earth, Wind & Fire', artists: [{ id: '61717', name: 'Earth, Wind & Fire' }], trackNumber: 2, discNumber: 1, duration: 182 },
      { id: '1', title: 'In the Stone', artist: 'Earth, Wind & Fire', artists: [{ id: 61717, name: 'Earth, Wind & Fire' }], trackNumber: 1, discNumber: 1, duration: 288, format: 'FLAC 16/44.1' },
    ] })
    return json({ id: '61717', name: 'Earth, Wind & Fire', artworkURL: 'http://insecure.example/a.jpg', albums: [{ id: '0886443461536', title: 'I Am', year: 1979, releaseType: 'album', trackCount: 9 }, { id: 'x', title: 'Weird', releaseType: 'bootleg' }], topTracks: [{ id: '1', title: 'In the Stone', artist: 'Earth, Wind & Fire' }] })
  }
  const album = await addons.album(db, key, '0886443461536', { fetchImpl })
  assert.deepEqual(album.tracks.map(t => [t.track_num, t.title, t.album, t.albumId, t.artistIds[0], t.thumbnail]), [
    [1, 'In the Stone', 'I Am', '0886443461536', '61717', 'https://img.example/iam.jpg'],
    [2, "Can't Let Go", 'I Am', '0886443461536', '61717', 'https://img.example/iam.jpg'],
  ])
  assert.ok(urls[0].startsWith(`${BASE}/album/0886443461536?`) && urls[0].includes('quality=6'))
  const artist = await addons.artist(db, key, '61717', { fetchImpl })
  assert.equal(artist.image, null)
  assert.deepEqual(artist.albums.map(a => [a.albumId, a.release_type]), [['0886443461536', 'album'], ['x', 'album']])
  // Cached: asked once.
  await addons.album(db, key, '0886443461536', { fetchImpl })
  assert.equal(urls.filter(url => url.includes('/album/')).length, 1)
  await assert.rejects(() => addons.album(memoryDb(), key, '1', { fetchImpl }), /not installed/)
})

const ADDON = 'a-0123456789'
test('Amazon-style addon album objects keep a clickable album name and source id while streaming', () => {
  const result = addons.trackOf({
    id: 'amz-track-1',
    title: 'Song',
    artist: 'Artist',
    album: { id: 'B012345678', name: 'Amazon Album' },
  }, ADDON)

  assert.equal(result.album, 'Amazon Album')
  assert.equal(result.albumId, 'B012345678')
  const path = trackAlbumPath({ ...result, file_path: 'ghost://addon/0123456789/amz-track-1' })
  const params = new URLSearchParams(path.split('?')[1])
  assert.equal(params.get('source'), ADDON)
  assert.equal(params.get('sourceAlbum'), 'B012345678')
  assert.equal(params.get('album'), 'Amazon Album')
})

const iAm = { id: 'alb1', title: 'I Am', artist: 'Earth, Wind & Fire', artwork_url: 'https://img.example/iam.jpg', tracks: [
  { provider: ADDON, id: '1', title: 'In the Stone', artist: 'Earth, Wind & Fire', thumbnail: 'https://img.example/iam.jpg' },
  { provider: ADDON, id: '2', title: "Can't Let Go", artist: 'Earth, Wind & Fire' },
] }
function client({ catalogue = { tracks: [] }, search = [], artistIds = {} } = {}) {
  const calls = []
  return {
    calls,
    getSettings: async () => ({ playback_search_order: JSON.stringify([ADDON, 'yt']) }),
    onlineProviders: async () => [{ id: 'yt' }, { id: ADDON, addon: true, album: true, artist: true }],
    discoveryCatalogue: async options => { calls.push(`catalogue:${options.source}:${options.type}`); return catalogue },
    onlineSearch: async (query, source) => { calls.push(`search:${source}:${query}`); return { results: source === ADDON ? search : [] } },
    addonAlbum: async (provider, id) => { calls.push(`album:${id}`); return id === 'alb1' ? iAm : { error: 'Album not found' } },
    addonArtist: async (provider, id) => { calls.push(`artist:${id}`); return artistIds[id] || { error: 'Artist not found' } },
  }
}

test('album pages: Last.fm and YouTube Music first, the addon only when they have nothing', async () => {
  const fromCatalogue = client({ catalogue: { tracks: [{ title: 'In the Stone', artist: 'Earth, Wind & Fire', album: 'I Am' }] } })
  const first = await loadOnlineAlbum({ artist: 'Earth, Wind & Fire', album: 'I Am' }, fromCatalogue)
  assert.equal(first.tracks.length, 1)
  assert.equal(fromCatalogue.calls.some(call => call.startsWith('album:')), false)

  const fallback = client({ search: [{ provider: ADDON, id: '1', title: 'In the Stone (Album Version)', artist: 'Earth, Wind & Fire', artists: ['Earth, Wind & Fire'], artistIds: ['61717'], album: 'I Am', albumId: 'alb1' }] })
  const second = await loadOnlineAlbum({ artist: 'Earth, Wind & Fire', album: 'I Am' }, fallback)
  assert.deepEqual(second.tracks.map(t => [t.title, t.exact, t.artwork_url]), [['In the Stone', true, 'https://img.example/iam.jpg'], ["Can't Let Go", true, 'https://img.example/iam.jpg']])
  assert.equal(second.provider, ADDON)
  assert.ok(fallback.calls.indexOf('catalogue:lastfm:album') < fallback.calls.indexOf('album:alb1'))
})

test("an addon album by the playing song's own album id", async () => {
  const c = client({ search: [
    { provider: ADDON, id: '9', title: 'In the Stone', artist: 'Earth, Wind & Fire', album: 'The Essential', albumId: 'ess' },
    { provider: ADDON, id: '1', title: 'In the Stone', artist: 'Earth, Wind & Fire', album: 'I Am', albumId: 'alb1' },
  ] })
  const album = await loadAddonAlbum({ artist: 'Earth, Wind & Fire', album: 'I Am', provider: ADDON, anchor: { title: 'In the Stone', provider: ADDON, id: '1' } }, c)
  assert.equal(album.albumId, 'alb1')
})

test('addon artists: the id credited on the playing song, else the namesake sharing the library\'s titles', async () => {
  const salasa = { name: 'Salasa', tracks: [{ provider: ADDON, id: 't1', title: 'Thinking of You', artist: 'Salasa' }], albums: [{ provider: ADDON, albumId: 'a1', title: 'Thinking of You' }] }
  const results = [
    { provider: ADDON, id: 'x1', title: 'Login failed', artist: 'Salasa', artists: ['Salasa'], artistIds: ['other'], album: 'Login failed' },
    { provider: ADDON, id: 'x2', title: 'Bubble Dreams', artist: 'Salasa', artists: ['Salasa'], artistIds: ['other'], album: 'Bubble Dreams' },
    { provider: ADDON, id: 't1', title: 'Thinking of You', artist: 'Salasa', artists: ['Salasa'], artistIds: ['mine'], album: 'Thinking of You' },
  ]
  const fromSong = await loadAddonArtist('Salasa', { anchor: { title: 'Thinking of You', provider: ADDON, id: 't1' } }, client({ search: results, artistIds: { mine: salasa } }))
  assert.equal(fromSong.tracks[0].title, 'Thinking of You')
  assert.equal(fromSong.albums[0].sourceAlbumId, 'a1')
  const fromLibrary = await loadAddonArtist('Salasa', { hints: ['Thinking of You'] }, client({ search: results, artistIds: { mine: salasa } }))
  assert.equal(fromLibrary?.name, 'Salasa')
  // Nothing to go on: the id most results credit.
  const c = client({ search: results, artistIds: { mine: salasa } })
  await loadAddonArtist('Salasa', {}, c)
  assert.ok(c.calls.includes('artist:other'))
})

test("songs from an addon's album page play from that addon without a search", async () => {
  const saved = []
  const c = {
    getSettings: async () => ({}), onlineProviders: async () => [], searchTracks: async () => [],
    onlineSearch: async () => { throw new Error('should not search') },
    onlineSave: async items => { saved.push(...items); return items.map(item => ({ ...item, id: `${item.provider}-x`, file_path: `ghost://addon/0123456789/${item.id}` })) },
  }
  const [row] = await resolveRecommendationTracks([{ ...iAm.tracks[0], exact: true }], c, { sources: [{ id: 'yt' }], prepareStreams: false })
  assert.equal(row.file_path, 'ghost://addon/0123456789/1')
  assert.equal(saved.length, 1)
})

test("a CDN's old copy of the manifest is skipped; the saved address stays clean", async () => {
  const db = memoryDb()
  const asked = []
  const fetchImpl = async url => { asked.push(String(url)); return json(manifest('1.1.0', ['search', 'stream', 'album'])) }
  await addons.install(db, `${BASE}/manifest.json`, { fetchImpl })
  await addons.refreshManifests(db, { maxAgeMs: 0, fetchImpl })
  assert.equal(asked.length, 2)
  assert.ok(asked.every(url => /[?&]lokal_fresh=\d+/.test(url)))
  const urls = []
  await addons.search(db, addons.list(db)[0].key, 'x y', { fetchImpl: async url => { urls.push(String(url)); return json({ tracks: [] }) } })
  assert.ok(urls[0].startsWith(`${BASE}/search?`) && !urls[0].includes('lokal_fresh'))
})

test('a plain stream link is played when the addon says "manifest": "none"; a real manifest or encryption is refused', async () => {
  const db = memoryDb()
  const { key } = await addons.install(db, `${BASE}/manifest.json`, { fetchImpl: async () => json(manifest('1.0.0', ['search', 'stream'])) })
  const file = 'https://streaming.example/file?eid=1&fmt=6'
  const stream = await addons.resolveStream(db, key, 'a', { fetchImpl: async () => json({ url: file, manifest: 'none', encrypted: false, quality: 'LOSSLESS' }) })
  assert.equal(stream.url, file)
  assert.equal(stream.format, 'flac')
  assert.equal(stream.mime, 'audio/flac')
  for (const none of [false, '', null]) await addons.resolveStream(db, key, `n${String(none)}`, { fetchImpl: async () => json({ url: file, manifest: none }) })
  await assert.rejects(() => addons.resolveStream(db, key, 'b', { fetchImpl: async () => json({ url: file, manifest: 'PE1QRD4uLi48L01QRD4=' }) }), /DASH\/HLS/)
  await assert.rejects(() => addons.resolveStream(db, key, 'c', { fetchImpl: async () => json({ url: 'https://streaming.example/x.m3u8', manifest: 'none' }) }), /DASH\/HLS/)
  await assert.rejects(() => addons.resolveStream(db, key, 'd', { fetchImpl: async () => json({ url: file, manifest: 'none', encrypted: true }) }), /encrypted/)
})

test("addon stream MIME handles detailed FLAC formats, codec/container metadata and signed URLs", async () => {
  const db = memoryDb()
  const { key } = await addons.install(db, `${BASE}/manifest.json`, { fetchImpl: async () => json(manifest('1.0.0', ['search', 'stream'])) })
  const cases = [
    {
      id: 'verbose-flac',
      response: { url: 'https://streaming.example/file?token=1', format: 'FLAC 24-bit / 192 kHz', quality: 'HI_RES' },
      format: 'flac',
      mime: 'audio/flac',
    },
    {
      id: 'codec-container',
      response: { url: 'https://streaming.example/file?token=2', codec: 'flac', container: 'audio/x-flac' },
      format: 'flac',
      mime: 'audio/flac',
    },
    {
      id: 'container-over-codec',
      response: { url: 'https://streaming.example/file?token=3', codec: 'opus', container: 'webm' },
      format: 'webm',
      mime: 'audio/webm',
    },
    {
      id: 'extension',
      response: { url: 'https://streaming.example/track.flac?signature=4', quality: 'MAX' },
      format: 'flac',
      mime: 'audio/flac',
    },
    {
      id: 'hi-res-quality',
      response: { url: 'https://streaming.example/download?signature=5', quality: 'HI-RES' },
      format: 'flac',
      mime: 'audio/flac',
    },
  ]

  for (const item of cases) {
    const stream = await addons.resolveStream(db, key, item.id, {
      fetchImpl: async () => json({ ...item.response, manifest: 'none', encrypted: false }),
    })
    assert.equal(stream.format, item.format, item.id)
    assert.equal(stream.mime, item.mime, item.id)
  }
})

test('addon audio MIME replaces generic upstream content types but preserves specific ones', () => {
  assert.equal(sources.streamContentType('application/octet-stream', 'audio/flac'), 'audio/flac')
  assert.equal(sources.streamContentType('application/octet-stream; charset=binary', 'audio/mpeg'), 'audio/mpeg')
  assert.equal(sources.streamContentType('', 'audio/flac'), 'audio/flac')
  assert.equal(sources.streamContentType('audio/aac', 'audio/flac'), 'audio/aac')
  assert.equal(sources.streamContentType('application/octet-stream', 'audio/*'), 'application/octet-stream')
})

