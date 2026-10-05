import assert from 'node:assert/strict'
import { test } from 'node:test'
import youtube from '../electron/online/youtube.js'

const cookies = 'SAPISID=fixture-session; SID=fixture-login'
const authenticated = { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '1' }] }] }
const response = contents => ({ responseContext: authenticated, contents })
const more = token => [{ nextContinuationData: { continuation: token } }]
const modernMore = token => ({ continuationItemRenderer: { continuationEndpoint: { commandExecutorCommand: { commands: [{ continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' } }] } } } })
const card = (index, title = `My Mix ${index}`) => ({ musicTwoRowItemRenderer: {
  title: { runs: [{ text: title, navigationEndpoint: { browseEndpoint: { browseId: `VLRDTMAK5uy_mix${index}`, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_PLAYLIST' } } } } }] },
  navigationEndpoint: { watchEndpoint: { playlistId: `RDTMAK5uy_mix${index}`, videoId: 'abcdefghijk' } },
  subtitle: { runs: [{ text: 'YouTube Music' }] },
  thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `https://images.example/mix${index}=w226-h226-l90-rj` }] } } },
} })
const shelf = (contents, title = 'Mixed for you', rest = {}) => ({ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: title }] } } }, contents, ...rest } })
const home = (contents, continuations) => ({ contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents, ...(continuations ? { continuations } : {}) } } } }] } }, responseContext: authenticated })

test('native mix title links and thumbnailRenderer are parsed instead of treating seeded mix cards as songs', () => {
  const result = youtube.parseAccountMixes(home([shelf([card(0, 'My Supermix'), card(1, 'Discover Mix')])]))
  assert.deepEqual(result.map(mix => mix.id), ['RDTMAK5uy_mix0', 'RDTMAK5uy_mix1'])
  assert.deepEqual(result.map(mix => mix.title), ['My Supermix', 'Discover Mix'])
  assert.equal(result[0].thumbnail, 'https://images.example/mix0=w544-h544-l90-rj')
  assert.deepEqual(youtube.parseAccountTracks(home([shelf([card(0), card(1)])])), [], 'mix seed videos are not individual song cards')
  const watchOnly = { musicTwoRowItemRenderer: { ...card(0).musicTwoRowItemRenderer, title: { simpleText: 'My Supermix' } } }
  assert.equal(youtube.parseAccountMixes(home([shelf([watchOnly])]))[0].id, 'RDTMAK5uy_mix0')
  assert.deepEqual(youtube.parseAccountTracks(watchOnly), [])
})

test('localized mix shelves use personalized playlist identity without including unrelated saved playlists or album play links', () => {
  const unrelated = { musicTwoRowItemRenderer: { ...card(0).musicTwoRowItemRenderer, title: { runs: [{ text: 'Saved playlist', navigationEndpoint: { browseEndpoint: { browseId: 'VLPLsaved' } } }] } } }
  const album = { musicTwoRowItemRenderer: { ...card(0).musicTwoRowItemRenderer, title: { runs: [{ text: 'Album', navigationEndpoint: { browseEndpoint: { browseId: 'MPREalbum', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' } } } } }] } } }
  assert.deepEqual(youtube.parseAccountMixes(home([shelf([card(0), unrelated, album], '为你混搭')])).map(mix => mix.id), ['RDTMAK5uy_mix0'])
})

test('account retrieval follows home continuations to find the real mix shelf and every mix continuation', async () => {
  youtube.clearAccountCache()
  const requests = []
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => 'ytcfg.set({"INNERTUBE_CLIENT_VERSION":"fixture","INNERTUBE_CONTEXT":{"client":{"hl":"zh-CN"}}});' }
    const body = JSON.parse(init.body)
    requests.push({ url, body, headers: init.headers })
    let result = response([])
    if (body.browseId === 'FEmusic_home' && !body.continuation) result = home([shelf([], 'Listen again')], more('home-page-two'))
    if (body.continuation === 'home-page-two') result = { responseContext: authenticated, continuationContents: { sectionListContinuation: { contents: [shelf([card(0, 'My Supermix'), card(1, 'Discover Mix')], 'Mixed for you', { continuations: more('mix-page-two') })], continuations: more('unrelated-home-page') } } }
    if (body.continuation === 'mix-page-two') result = { responseContext: authenticated, continuationContents: { musicCarouselShelfContinuation: { contents: [card(1), card(2), modernMore('mix-page-three')] } } }
    if (body.continuation === 'mix-page-three') result = { responseContext: authenticated, onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: Array.from({ length: 16 }, (_, i) => card(i + 3)) } }] }
    return { ok: true, json: async () => result }
  }
  const account = await youtube.fetchAccountData({ cookies, fetchImpl, force: true })
  assert.equal(account.authenticated, true)
  assert.equal(account.mixes.length, 19)
  assert.deepEqual(account.mixes.map(mix => mix.id), Array.from({ length: 19 }, (_, i) => `RDTMAK5uy_mix${i}`))
  assert.equal(account.mixError, '')
  assert.deepEqual(requests.filter(request => request.body.continuation).map(request => request.body.continuation), ['home-page-two', 'mix-page-two', 'mix-page-three'])
  for (const request of requests) {
    assert.equal(request.body.context.client.hl, 'en')
    assert.match(request.headers.Authorization, /SAPISIDHASH/)
  }
  assert.match(requests.find(request => request.body.continuation).url, /ctoken=home-page-two/)
})

test('see-all mix pages follow modern grid continuation commands and preserve endpoint params', async () => {
  youtube.clearAccountCache()
  const endpoint = { browseId: 'FEmusic_mixed_for_you', params: 'native-mixes' }
  const requests = []
  const account = await youtube.fetchAccountData({ cookies, force: true, fetchImpl: async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    const body = JSON.parse(init.body)
    requests.push(body)
    let result = response([])
    if (body.browseId === 'FEmusic_home') result = home([shelf([card(0)], 'Mixed for you', { header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Mixed for you', navigationEndpoint: { browseEndpoint: endpoint } }] }, moreContentButton: { buttonRenderer: { navigationEndpoint: { browseEndpoint: endpoint } } } } } })])
    if (body.browseId === endpoint.browseId && !body.continuation) result = response({ gridRenderer: { items: [card(0), card(1), modernMore('all-mixes-next')] } })
    if (body.continuation === 'all-mixes-next') result = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [card(2), card(3)] } }] }
    return { ok: true, json: async () => result }
  } })
  assert.equal(account.mixes.length, 4)
  assert.equal(requests.filter(body => body.browseId === endpoint.browseId && !body.continuation).length, 1, 'title and more button point to the same endpoint')
  assert.equal(requests.find(body => body.continuation).params, endpoint.params)
})

test('a failed home continuation reports the mix error and does not cache an empty mix result', async () => {
  youtube.clearAccountCache()
  let homeRequests = 0
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    const body = JSON.parse(init.body)
    if (body.continuation) return { ok: false, status: 503 }
    if (body.browseId === 'FEmusic_home') { homeRequests++; return { ok: true, json: async () => home([], more('failed-home')) } }
    return { ok: true, json: async () => response([]) }
  }
  const account = await youtube.fetchAccountData({ cookies, fetchImpl })
  assert.equal(account.authenticated, true)
  assert.match(account.mixError, /503/)
  await youtube.fetchAccountData({ cookies, fetchImpl })
  assert.equal(homeRequests, 2)
})

test('repeated continuation tokens terminate instead of looping through the home feed', async () => {
  youtube.clearAccountCache()
  let continued = 0
  const account = await youtube.fetchAccountData({ cookies, force: true, fetchImpl: async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    const body = JSON.parse(init.body)
    if (body.continuation) { continued++; return { ok: true, json: async () => ({ continuationContents: { sectionListContinuation: { contents: [], continuations: more('same-page') } } }) } }
    return { ok: true, json: async () => body.browseId === 'FEmusic_home' ? home([], more('same-page')) : response([]) }
  } })
  assert.equal(continued, 1)
  assert.deepEqual(account.mixes, [])
})

test('personalized mix playback uses the authenticated next endpoint, not an unsupported VL radio browse', async () => {
  youtube.clearAccountCache()
  let request
  const playlist = await youtube.fetchAccountPlaylist('RDTMAK5uy_supermix', cookies, async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    request = { url, body: JSON.parse(init.body), headers: init.headers }
    return { ok: true, json: async () => response({ playlistPanelRenderer: { contents: [{ playlistPanelVideoRenderer: { videoId: 'abcdefghijk', title: { simpleText: 'First Song' }, longBylineText: { runs: [{ text: 'Artist' }] } } }] } }) }
  })
  assert.match(request.url, /\/next\?/)
  assert.equal(request.body.playlistId, 'RDTMAK5uy_supermix')
  assert.equal(request.body.browseId, undefined)
  assert.equal(request.body.enablePersistentPlaylistPanel, true)
  assert.match(request.headers.Authorization, /SAPISIDHASH/)
  assert.equal(playlist.tracks[0].title, 'First Song')
})
