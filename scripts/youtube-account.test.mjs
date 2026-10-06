import assert from 'node:assert/strict'
import { test } from 'node:test'
import youtube from '../electron/online/youtube.js'

const cookies = 'Cookie: __Secure-3PAPISID=test-session-value; __Secure-3PSID=test-login-value'
const musicConfig = { INNERTUBE_CLIENT_VERSION: '1.test.client', VISITOR_DATA: 'test-visitor', SESSION_INDEX: '2', DELEGATED_SESSION_ID: 'test-channel' }
const accountRoot = { responseContext: { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '1' }] }] }, contents: { musicTwoRowItemRenderer: { navigationEndpoint: { watchEndpoint: { videoId: 'abcdefghijk' } }, title: { runs: [{ text: 'Song' }] }, subtitle: { runs: [{ text: 'Artist' }, { text: ' • ' }, { text: 'Album' }] }, thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://images.example/cover.jpg' }] } } } } } }
const column = runs => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } })
const linked = (text, browseId, type) => ({ text, navigationEndpoint: { browseEndpoint: { browseId, ...(type ? { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: `MUSIC_PAGE_TYPE_${type}` } } } : {}) } } })

test('history rows read separate album and duration columns, including album endpoints without pageType', () => {
  const track = youtube.parseItem({ playlistItemData: { videoId: 'abcdefghijk' }, flexColumns: [column([{ text: 'History Song' }]), column([linked('Artist', 'UCartist', 'ARTIST')]), column([linked('History Album', 'MPREalbum')])], fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:42' }] } } }] })
  assert.equal(track.album, 'History Album')
  assert.equal(track.albumId, 'MPREalbum')
  assert.equal(track.artist, 'Artist')
  assert.equal(track.duration, 222)
  assert.equal(youtube.parseItem({ playlistItemData: { videoId: 'abcdefghijk' }, flexColumns: [column([{ text: 'Song' }]), column([{ text: 'Artist' }]), column([{ text: 'Plain Album' }])] }).album, 'Plain Album')
  assert.equal(youtube.parseItem({ playlistItemData: { videoId: 'abcdefghijk' }, flexColumns: [column([{ text: 'Song' }]), column([{ text: 'Artist' }]), column([{ text: '1989' }])] }).album, '1989')
  assert.equal(youtube.parseAccountTracks({ musicTwoRowItemRenderer: { ...accountRoot.contents.musicTwoRowItemRenderer, subtitle: { runs: [{ text: 'Artist • Album' }] } } })[0].album, 'Album')
})

test('account tracks preserve provider order across renderer types and do not mistake video views for albums', () => {
  const card = { musicTwoRowItemRenderer: { ...accountRoot.contents.musicTwoRowItemRenderer, subtitle: { runs: [{ text: 'Artist' }, { text: ' • ' }, { text: '2.3M views' }] } } }
  const panel = { playlistPanelVideoRenderer: { videoId: 'bcdefghijkl', title: { simpleText: 'Panel Song' }, longBylineText: { runs: [linked('Artist', 'UCartist', 'ARTIST'), { text: ' • ' }, linked('Panel Album', 'MPREpanel', 'ALBUM')] } } }
  const row = { musicResponsiveListItemRenderer: { playlistItemData: { videoId: 'cdefghijklm' }, flexColumns: [column([{ text: 'Row Song' }]), column([{ text: 'Artist' }, { text: ' • ' }, { text: 'Row Album' }])] } }
  const tracks = youtube.parseAccountTracks([card, panel, row, card])
  assert.deepEqual(tracks.map(track => track.title), ['Song', 'Panel Song', 'Row Song'])
  assert.deepEqual(tracks.map(track => track.album), [null, 'Panel Album', 'Row Album'])
  assert.deepEqual(youtube.parseAccountTracks([card, panel, row], 2).map(track => track.title), ['Song', 'Panel Song'])
})

const mixCard = (id, endpoint = 'watchPlaylistEndpoint') => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: `Mix ${id}` }] }, navigationEndpoint: { [endpoint]: endpoint === 'browseEndpoint' ? { browseId: `VL${id}` } : { playlistId: id } } } })
const mixShelf = (contents, header = {}) => ({ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Mixed for you' }] }, ...header } }, contents } })

test('Mixed for you retains all playlist cards and supports browse, watch, and overlay play endpoints', () => {
  const cards = Array.from({ length: 20 }, (_, i) => mixCard(`RDmix${i}`, i % 2 ? 'browseEndpoint' : 'watchPlaylistEndpoint'))
  cards.push({ musicTwoRowItemRenderer: { title: { simpleText: 'Overlay Mix' }, thumbnailOverlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDoverlay' } } } } } } } })
  cards.push({ musicTwoRowItemRenderer: { ...accountRoot.contents.musicTwoRowItemRenderer, navigationEndpoint: { watchEndpoint: { videoId: 'abcdefghijk', playlistId: 'RDsongRadio' } } } })
  const root = [mixShelf(cards), { musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { simpleText: 'Recommended playlists' } } }, contents: [mixCard('PLunrelated')] } }]
  const mixes = youtube.parseAccountMixes(root)
  assert.equal(mixes.length, 21)
  assert.equal(mixes.at(-1).id, 'RDoverlay')
  assert.ok(mixes.every(mix => mix.id !== 'PLunrelated'))
})

test('account data expands Mixed for you see-all endpoints without the former twelve-playlist limit', async () => {
  youtube.clearAccountCache()
  const requests = []
  const endpoint = { browseId: 'FEmusic_mixed_for_you', params: 'mix-page' }
  const result = await youtube.fetchAccountData({ cookies, force: true, fetchImpl: async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    const body = JSON.parse(init.body)
    requests.push(body)
    const contents = body.browseId === 'FEmusic_home' ? [mixShelf([mixCard('RDmix0')], { moreContentButton: { buttonRenderer: { navigationEndpoint: { browseEndpoint: endpoint } } } }), mixCard('PLunrelated')]
      : body.browseId === endpoint.browseId ? Array.from({ length: 18 }, (_, i) => mixCard(`RDmix${i}`)) : []
    return { ok: true, json: async () => ({ responseContext: accountRoot.responseContext, contents }) }
  } })
  assert.equal(result.mixes.length, 18)
  assert.deepEqual(requests.at(-1).params, endpoint.params)
  assert.ok(result.homePlaylists.some(playlist => playlist.id === 'PLunrelated'))
  assert.ok(!result.mixes.some(playlist => playlist.id === 'PLunrelated'))
})

test('history can recover missing albums from other account surfaces only for the identical video', async () => {
  youtube.clearAccountCache()
  const result = await youtube.fetchAccountData({ cookies, force: true, fetchImpl: async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    const history = JSON.parse(init.body).browseId === 'FEmusic_history'
    return { ok: true, json: async () => history ? { ...accountRoot, contents: { musicTwoRowItemRenderer: { ...accountRoot.contents.musicTwoRowItemRenderer, subtitle: { simpleText: 'Artist' } } } } : accountRoot }
  } })
  assert.equal(result.history[0].album, 'Album')
})

test('account cookies normalize header prefixes and secure variants generate all required auth schemes', () => {
  const headers = youtube.accountHeaders(cookies, musicConfig)
  assert.ok(headers.Cookie.startsWith('__Secure-3PAPISID='))
  assert.match(headers.Cookie, /; SAPISID=test-session-value/)
  assert.match(headers.Authorization, /SAPISIDHASH \d+_[a-f0-9]{40}/)
  assert.match(headers.Authorization, /SAPISID3PHASH \d+_[a-f0-9]{40}/)
  assert.equal(headers['X-Goog-AuthUser'], '2')
  assert.equal(headers['X-Goog-PageId'], 'test-channel')
  assert.equal(headers['X-YouTube-Client-Version'], '1.test.client')
  assert.equal(youtube.normalizeAccountCookies('.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\ttest'), 'SAPISID=test')
})

test('music client configuration is parsed as JSON and mixed tracking login flags do not reject login', () => {
  assert.deepEqual(youtube.parseMusicConfig(`prefix ytcfg.set(${JSON.stringify(musicConfig)}); suffix`), musicConfig)
  assert.equal(youtube.isLoggedOutResponse({ responseContext: { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '0' }, { key: 'logged_in', value: '1' }] }] } }), false)
  assert.equal(youtube.isLoggedOutResponse({ responseContext: { mainAppWebResponseContext: { loggedOut: true } } }), true)
})

test('account requests use bootstrapped client/account context and return personalized home tracks', async () => {
  youtube.clearAccountCache()
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push({ url, init })
    return url.endsWith('/') ? { ok: true, text: async () => `ytcfg.set(${JSON.stringify(musicConfig)});` } : { ok: true, json: async () => accountRoot }
  }
  const result = await youtube.fetchAccountData({ cookies, fetchImpl, force: true })
  assert.equal(result.authenticated, true)
  assert.equal(result.home[0].title, 'Song')
  assert.equal(result.home[0].album, 'Album')
  assert.equal(result.history[0].album, 'Album')
  assert.equal(requests.length, 5)
  for (const request of requests.slice(1)) {
    const body = JSON.parse(request.init.body)
    assert.equal(body.context.client.clientVersion, musicConfig.INNERTUBE_CLIENT_VERSION)
    assert.equal(body.context.user.onBehalfOfUser, 'test-channel')
    assert.equal(request.init.headers['X-Goog-AuthUser'], '2')
  }
})

test('invalid account sessions remain unverified and report how to reconnect instead of empty recommendations', async () => {
  youtube.clearAccountCache()
  const fetchImpl = async url => url.endsWith('/') ? { ok: true, text: async () => '' } : { ok: true, json: async () => ({ responseContext: { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '0' }] }] } }) }
  const result = await youtube.fetchAccountData({ cookies, fetchImpl, force: true })
  assert.equal(result.authenticated, false)
  assert.match(result.error, /Sign in again/)
})

test('public album catalogues load without requiring account cookies', async () => {
  const result = await youtube.fetchCatalogue({ type: 'album', artist: 'Artist', album: 'Album', albumId: 'MPREtestAlbum' }, '', async url => url.endsWith('/')
    ? { ok: true, text: async () => '' }
    : { ok: true, json: async () => ({ ...accountRoot, responseContext: {}, contents: accountRoot.contents }) })
  assert.equal(result.tracks[0].title, 'Song')
  assert.equal(result.tracks[0].album, 'Album')
})

test('authenticated album catalogues keep album order and account context', async () => {
  youtube.clearAccountCache()
  const tracks = ['First', 'Second'].map((title, index) => ({ musicTwoRowItemRenderer: {
    ...accountRoot.contents.musicTwoRowItemRenderer,
    title: { runs: [{ text: title }] },
    navigationEndpoint: { watchEndpoint: { videoId: index ? 'bcdefghijkl' : 'abcdefghijk' } },
  } }))
  let browseRequest
  const result = await youtube.fetchCatalogue({ type: 'album', artist: 'Artist', album: 'Album', albumId: 'MPREtestAlbum' }, cookies, async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => `ytcfg.set(${JSON.stringify(musicConfig)});` }
    browseRequest = init
    return { ok: true, json: async () => ({ ...accountRoot, contents: tracks }) }
  })
  assert.deepEqual(result.tracks.map(track => track.title), ['First', 'Second'])
  assert.ok(result.tracks.every(track => track.album === 'Album'))
  assert.equal(JSON.parse(browseRequest.body).browseId, 'MPREtestAlbum')
  assert.equal(browseRequest.headers['X-Goog-AuthUser'], '2')
})

test('album tracks without artist runs inherit the requested artist while parsed credits are preserved', async () => {
  youtube.clearAccountCache()
  const row = (videoId, title, artists = []) => ({ musicResponsiveListItemRenderer: {
    playlistItemData: { videoId },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: artists.map(text => ({ text, navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } } })) } } },
    ],
  } })
  const result = await youtube.fetchCatalogue({ type: 'album', artist: 'Album Artist', album: 'Album', albumId: 'MPREtestAlbum' }, cookies, async url => url.endsWith('/')
    ? { ok: true, text: async () => `ytcfg.set(${JSON.stringify(musicConfig)});` }
    : { ok: true, json: async () => ({ ...accountRoot, contents: [row('abcdefghijk', 'No Credits'), row('bcdefghijkl', 'Guest Credits', ['Guest Artist', 'Second Artist'])] }) })
  assert.deepEqual(result.tracks.map(track => [track.title, track.artist, track.artists]), [['No Credits', 'Album Artist', ['Album Artist']], ['Guest Credits', 'Guest Artist, Second Artist', ['Guest Artist', 'Second Artist']]])
})

test('captured browser request context preserves the selected account, visitor, client, and user-agent', async () => {
  youtube.clearAccountCache()
  const copied = JSON.stringify({ Cookie: '__Secure-3PAPISID=test-session; SID=test-login', 'X-Goog-AuthUser': '3', 'X-Goog-PageId': 'brand-channel', 'X-Goog-Visitor-Id': 'browser-visitor', 'X-YouTube-Client-Version': '1.browser.version', 'User-Agent': 'Browser Test UA' })
  const requests = []
  const result = await youtube.fetchAccountData({ cookies: copied, fetchImpl: async (url, init) => {
    requests.push(init)
    return url.endsWith('/') ? { ok: true, text: async () => `ytcfg.set(${JSON.stringify(musicConfig)});` } : { ok: true, json: async () => accountRoot }
  } })
  assert.equal(result.authenticated, true)
  for (const request of requests.slice(1)) {
    assert.equal(request.headers['X-Goog-AuthUser'], '3')
    assert.equal(request.headers['X-Goog-PageId'], 'brand-channel')
    assert.equal(request.headers['X-Goog-Visitor-Id'], 'browser-visitor')
    assert.equal(request.headers['User-Agent'], 'Browser Test UA')
    assert.equal(JSON.parse(request.body).context.client.clientVersion, '1.browser.version')
  }
  const cookieTools = (await import('../electron/ipc/ytCookies.js')).default
  assert.match(cookieTools.cookiesTxtFrom(copied), /\t__Secure-3PAPISID\ttest-session/)
  assert.ok(!cookieTools.cookiesTxtFrom(copied).includes('X-Goog-AuthUser'))
})

test('generic or unmarked home data is never presented as a verified personalized account', async () => {
  youtube.clearAccountCache()
  const result = await youtube.fetchAccountData({ cookies, fetchImpl: async url => url.endsWith('/') ? { ok: true, text: async () => '' } : { ok: true, json: async () => ({ ...accountRoot, responseContext: {} }) } })
  assert.equal(result.authenticated, false)
  assert.match(result.error, /did not confirm an authenticated account/)
})

test("an artist's albums come from YouTube Music's album search, theirs only", async () => {
  youtube.clearAccountCache()
  const album = (title, artist, browseId, year, kind = 'Album') => ({ musicResponsiveListItemRenderer: {
    flexColumns: [column([linked(title, browseId, 'ALBUM')]), column([{ text: kind }, { text: ' • ' }, { text: artist }, { text: ' • ' }, { text: String(year) }])],
    navigationEndpoint: { browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' } } } },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `https://images.example/${browseId}.jpg` }] } } },
  } })
  const results = { contents: [album('I Am', 'Earth, Wind & Fire', 'MPREiam', 1979), album('Boogie Wonderland', 'Earth, Wind & Fire', 'MPREbw', 1979, 'Single'), album('Earth Songs', 'Someone Else', 'MPREother', 2001)] }
  let query = ''
  const result = await youtube.fetchCatalogue({ type: 'albums', artist: 'Earth, Wind & Fire' }, '', async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    query = JSON.parse(init.body).query
    return { ok: true, json: async () => results }
  })
  assert.equal(query, 'Earth, Wind & Fire')
  assert.deepEqual(result.albums.map(item => [item.title, item.albumId, item.year, item.release_type]), [['I Am', 'MPREiam', 1979, 'album'], ['Boogie Wonderland', 'MPREbw', 1979, 'single']])
  assert.equal(result.albums[0].artwork_url.startsWith('https://images.example/MPREiam'), true)
})
