import assert from 'node:assert/strict'
import { test } from 'node:test'
import youtube from '../electron/online/youtube.js'

const cookies = 'Cookie: __Secure-3PAPISID=test-session-value; __Secure-3PSID=test-login-value'
const musicConfig = { INNERTUBE_CLIENT_VERSION: '1.test.client', VISITOR_DATA: 'test-visitor', SESSION_INDEX: '2', DELEGATED_SESSION_ID: 'test-channel' }
const accountRoot = { responseContext: { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '1' }] }] }, contents: { musicTwoRowItemRenderer: { navigationEndpoint: { watchEndpoint: { videoId: 'abcdefghijk' } }, title: { runs: [{ text: 'Song' }] }, subtitle: { runs: [{ text: 'Artist' }] }, thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://images.example/cover.jpg' }] } } } } } }

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
