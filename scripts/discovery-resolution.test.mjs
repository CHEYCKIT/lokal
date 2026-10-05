import assert from 'node:assert/strict'
import { test } from 'node:test'
import youtube from '../electron/online/youtube.js'
import addons from '../electron/online/addons.js'
import { createRecommendationSession } from '../src/recommendationSession.js'
import { recommendationKey, recommendationMatch, recommendationVideoId, resolveRecommendationTracks } from '../src/recommendations.js'

const recordings = [
  { videoId: 'j_UhEi3GZOU', title: 'Sunnyday,Holiday', artist: 'Satellite Lovers', album: 'Sons of 1973' },
  { videoId: 'CjdEqFMuNFU', title: '流線 - ryusen', artist: 'Tsuredure Shokan', album: 'Taisyuu novel' },
]
const addonKey = addons.addonKey('unicode-catalogue-fixture')
const addon = addons.providerFor(addonKey)
const providers = [{ id: 'yt' }, { id: addon }, { id: 'sc' }]
const settings = { recommendation_source: 'youtube', playback_search_order: JSON.stringify(providers.map(source => source.id)) }
const addonDb = {
  prepare: () => ({ get: () => ({ value: JSON.stringify([{ key: addonKey, baseUrl: 'https://addon.example.test', manifest: { resources: ['search', 'stream'] } }]) }) }),
}
const accountCards = recordings.map((track, index) => ({ musicTwoRowItemRenderer: {
  title: { runs: [{ text: track.title, ...(index === 0 ? { navigationEndpoint: { watchEndpoint: { videoId: track.videoId } } } : {}) }] },
  ...(index === 1 ? { thumbnailOverlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: track.videoId } } } } } } } : {}),
  subtitle: { runs: [{ text: track.artist }, { text: ' • ' }, { text: track.album }] },
} }))

test('both reported recordings retain native identity from account cards through session shelves and first playback', async () => {
  const tracks = youtube.parseAccountTracks(accountCards)
  assert.deepEqual(tracks.map(track => track.videoId), recordings.map(track => track.videoId))
  const prepared = [], saved = []
  const client = {
    getSettings: async () => settings,
    onlineProviders: async () => providers,
    youtubeAccount: async () => ({ home: tracks, liked: tracks, history: tracks }),
    discoveryArtwork: async items => items.map(() => ({ image: 'https://artwork.example.test/cover.jpg' })),
    searchTracks: async () => [],
    onlineSearch: async () => { assert.fail('A known YouTube recording must never run a text search') },
    onlinePrepare: async (provider, id) => { prepared.push([provider, id]); return { ok: true } },
    onlineSave: async items => {
      saved.push(...items)
      return items.map(item => ({ id: `yt-${item.id}`, file_path: `ghost://youtube/online/${item.id}` }))
    },
  }
  const session = createRecommendationSession(client, { profile: 'native-recording-fixture', storage: null })
  await session.ensure()
  await new Promise(setImmediate)
  for (const section of ['candidates', 'freshFinds', 'liked', 'history']) {
    const candidates = session.getSnapshot().data[section]
    assert.deepEqual(candidates.map(track => track.id), recordings.map(track => track.videoId))
    assert.ok(candidates.every(track => track.provider === 'yt' && track.source_url === `https://music.youtube.com/watch?v=${track.videoId}`))
    const resolved = await resolveRecommendationTracks(candidates, client)
    assert.deepEqual(resolved.map(track => track.videoId), recordings.map(track => track.videoId))
    assert.deepEqual(resolved.map(track => track.title), recordings.map(track => track.title))
    assert.deepEqual(prepared.splice(0), recordings.map(track => ['yt', track.videoId]))
    assert.deepEqual(saved.splice(0).map(track => track.id), recordings.map(track => track.videoId))
  }
})

test('normalized native provider IDs still bypass search without misreading another provider or a database row', () => {
  for (const track of recordings) {
    assert.equal(recommendationVideoId({ title: track.title, artist: track.artist, source: 'youtube', id: track.videoId }), track.videoId)
    assert.equal(recommendationVideoId({ provider: 'yt', id: track.videoId }), track.videoId)
  }
  assert.equal(recommendationVideoId({ source: 'youtube', provider: 'sc', id: '12345678901' }), null)
  assert.equal(recommendationVideoId({ source: 'youtube', id: 'sc-12345678', file_path: 'ghost://soundcloud/online/12345678' }), null)
})

test('explicit bilingual aliases find the same recording while rejecting wrong artists, versions and numeric suffixes', () => {
  const target = recordings[1]
  for (const title of ['ryusen', '流線', '流線 / ryusen', 'ryusen — 流線']) {
    const result = { ...target, title }
    assert.equal(recommendationMatch(target, [result]), result)
    assert.equal(recommendationMatch(result, [target]), target)
  }
  for (const result of [
    { ...target, title: 'ryusen', artist: 'Cover Artist' },
    ...['Live', 'Remix', 'Cover', 'Acoustic', 'Instrumental', 'Edit'].map(version => ({ ...target, title: `流線 - ryusen (${version})` })),
    { ...target, title: '流線 - 2023' },
    { ...target, title: 'Different Song - ryusen' },
  ]) {
    assert.equal(recommendationMatch(target, [result]), null)
    assert.equal(recommendationMatch(result, [target]), null)
  }
})

test('normalization preserves Japanese voicing and other scripts while normalizing canonical forms and Latin accents', () => {
  for (const title of ['ガラス', '流線', '사랑', 'Любовь', 'حُبّ']) {
    assert.equal(recommendationKey(title), recommendationKey(title.normalize('NFD')))
    assert.equal(recommendationMatch({ title, artist: 'Artist' }, [{ title: title.normalize('NFD'), artist: 'Artist' }])?.title, title.normalize('NFD'))
  }
  assert.notEqual(recommendationKey('ガラス'), recommendationKey('カラス'))
  assert.equal(recommendationMatch({ title: 'ガラス', artist: 'Artist' }, [{ title: 'カラス', artist: 'Artist' }]), null)
  assert.equal(recommendationKey('Beyoncé'), recommendationKey('Beyonce'))
})

test('bilingual addon lookup retries the catalogue alias before falling through to SoundCloud', async () => {
  const requests = [], prepared = [], failures = []
  const fetchImpl = async raw => {
    const url = new URL(raw)
    requests.push([url.pathname, url.searchParams.get('q')])
    const body = url.pathname === '/search'
      ? { tracks: url.searchParams.get('q') === 'Tsuredure Shokan ryusen' ? [{ id: '2436547095', title: 'ryusen', artists: [{ name: 'Tsuredure Shokan' }], album: { title: 'Taisyuu novel' }, duration: 180 }] : [] }
      : { url: 'https://media.example.test/ryusen.flac', format: 'flac' }
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }
  const client = {
    getSettings: async () => settings,
    onlineProviders: async () => providers,
    searchTracks: async () => [],
    onlineSearch: async (query, provider) => {
      assert.equal(provider, addon, 'native YouTube skips search; a matching addon must prevent SoundCloud fallback')
      return { results: await addons.search(addonDb, addonKey, query, { fetchImpl }) }
    },
    onlinePrepare: async (provider, id) => {
      prepared.push([provider, id])
      if (provider === 'yt') return { error: 'Native stream unavailable (fixture)' }
      assert.equal((await addons.resolveStream(addonDb, addonKey, id, { fetchImpl })).url, 'https://media.example.test/ryusen.flac')
      return { ok: true }
    },
    onlineSave: async items => items.map(item => ({ id: 'addon-db-row', file_path: `ghost://addon/${addonKey}/${item.id}` })),
  }
  const [resolved] = await resolveRecommendationTracks([recordings[1]], client, { onProviderFailure: failure => failures.push(failure) })
  assert.equal(resolved.title, '流線 - ryusen')
  assert.equal(resolved.videoId, 'CjdEqFMuNFU')
  assert.equal(resolved.file_path, `ghost://addon/${addonKey}/2436547095`)
  assert.deepEqual(requests, [['/search', 'Tsuredure Shokan 流線 - ryusen'], ['/search', 'Tsuredure Shokan ryusen'], ['/stream/2436547095', null]])
  assert.deepEqual(prepared, [['yt', 'CjdEqFMuNFU'], [addon, '2436547095']])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].reason, 'unavailable', 'a known recording with a stream error is not reported as missing')
})

test('addon search carries Unicode unchanged and supports scalar, object and array artist credits', async () => {
  const query = 'Beyoncé ガラス 流線 - ryusen'
  const payload = [
    { id: 'artist-string', title: '流線', artist: 'Tsuredure Shokan' },
    { id: 'artist-object', title: 'ガラス', artist: { name: 'Beyoncé' }, artists: [] },
    { id: 'artist-array', title: '流線 - ryusen', artists: ['Tsuredure Shokan', { name: 'Beyoncé' }] },
  ]
  const tracks = await addons.search(addonDb, addonKey, query, { fetchImpl: async raw => {
    assert.equal(new URL(raw).searchParams.get('q'), query)
    return new Response(JSON.stringify({ tracks: payload }), { headers: { 'Content-Type': 'application/json' } })
  } })
  assert.deepEqual(tracks.map(track => track.title), payload.map(track => track.title))
  assert.deepEqual(tracks.map(track => track.artists), [['Tsuredure Shokan'], ['Beyoncé'], ['Tsuredure Shokan', 'Beyoncé']])
  assert.deepEqual(tracks.map(track => track.artist), ['Tsuredure Shokan', 'Beyoncé', 'Tsuredure Shokan, Beyoncé'])
})

test('alias retries share one provider lookup budget instead of multiplying the timeout', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const queries = [], failures = []
  const client = { onlineSearch: async query => {
    queries.push(query)
    if (queries.length > 1) return new Promise(() => {})
    await new Promise(resolve => setTimeout(resolve, 35))
    return { results: [] }
  } }
  const request = resolveRecommendationTracks([{ title: '流線 - ryusen', artist: 'Tsuredure Shokan' }], client, { searchLocal: false, sources: [{ id: addon }], timeoutMs: 50, onProviderFailure: failure => failures.push(failure) })
  await new Promise(setImmediate)
  t.mock.timers.tick(35)
  await new Promise(setImmediate)
  assert.deepEqual(queries, ['Tsuredure Shokan 流線 - ryusen', 'Tsuredure Shokan ryusen'])
  t.mock.timers.tick(15)
  assert.deepEqual(await request, [])
  assert.equal(failures.length, 1)
  assert.match(failures[0].detail, /Provider lookup timed out/)
})

test('native audio preparation has a separate budget from short metadata lookups', async () => {
  const saved = [], failures = []
  const client = {
    getSettings: async () => ({ playback_search_order: '["yt"]' }),
    onlineProviders: async () => [{ id: 'yt' }],
    searchTracks: async () => [],
    onlineSearch: async () => { assert.fail('Native recording must not be searched') },
    onlinePrepare: async () => { await new Promise(resolve => setTimeout(resolve, 35)); return { ok: true } },
    onlineSave: async items => { saved.push(...items); return items.map(item => ({ id: `yt-${item.id}`, file_path: `ghost://youtube/online/${item.id}` })) },
  }
  assert.equal((await resolveRecommendationTracks([recordings[0]], client, { timeoutMs: 10, onProviderFailure: failure => failures.push(failure) })).length, 1)
  assert.equal(saved.length, 1)
  assert.deepEqual(failures, [])
  client.onlinePrepare = async () => new Promise(() => {})
  assert.deepEqual(await resolveRecommendationTracks([recordings[1]], client, { timeoutMs: 10, prepareTimeoutMs: 10, onProviderFailure: failure => failures.push(failure) }), [])
  assert.equal(saved.length, 1, 'timed-out preparation must not save a playable row')
  assert.equal(failures[0].reason, 'unavailable')
  assert.match(failures[0].detail, /Audio preparation timed out/)
})
