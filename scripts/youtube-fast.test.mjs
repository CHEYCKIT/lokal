import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fast = require('../electron/online/youtubeFast.js')

const format = (mime, bitrate, extra = {}) => ({ mime_type: mime, bitrate, ...extra, decipher: async () => `https://rr1.googlevideo.example/videoplayback?expire=4102444800&cver=1.20250219.01.00&itag=${bitrate}` })

test('the highest bitrate audio for Best, the lowest for Data saver; no video, no DRC', () => {
  const formats = [format('video/mp4; codecs="avc1"', 2000000), format('audio/mp4; codecs="mp4a.40.2"', 130000), format('audio/webm; codecs="opus"', 150000), format('audio/webm; codecs="opus"', 160000, { is_drc: true }), format('audio/webm; codecs="opus"', 50000)]
  assert.equal(fast.pickAudioFormat(formats, 'best').bitrate, 150000)
  assert.equal(fast.pickAudioFormat(formats, 'saver').bitrate, 50000)
  assert.equal(fast.pickAudioFormat([format('video/mp4', 1)]), null)
})

test('the link names the client version the session used; the rest of the signed query is untouched', () => {
  const url = 'https://rr1.googlevideo.example/videoplayback?xpc=EgVo2aDSNQ%3D%3D&cver=1.20250219.01.00&sig=AB%2Fcd'
  assert.equal(fast.withClientVersion(url, '1.20261008.01.00'), 'https://rr1.googlevideo.example/videoplayback?xpc=EgVo2aDSNQ%3D%3D&cver=1.20261008.01.00&sig=AB%2Fcd')
  assert.equal(fast.withClientVersion(url, null), url)
  assert.equal(fast.expiryOf('https://x/?expire=4102444800'), 4102444800 * 1000 - 60000)
})

function fakeClient({ status = 'OK', formats } = {}) {
  const calls = []
  const yt = {
    session: { context: { client: { clientVersion: '1.20261008.01.00' } }, player: {} },
    async getBasicInfo(id, options) {
      calls.push({ id, token: options?.po_token, sessionToken: yt.session.po_token, playerToken: yt.session.player.po_token })
      await new Promise(resolve => setTimeout(resolve, 5))
      return { playability_status: { status, reason: status === 'OK' ? '' : 'Sign in to confirm your age' }, streaming_data: { adaptive_formats: formats || [format('audio/webm; codecs="opus"', 150000)] } }
    },
  }
  return { yt, calls }
}

test('resolves with a token bound to the song, the right client version, one song at a time', async () => {
  const { yt, calls } = fakeClient()
  const options = { clientFor: async () => yt, mint: async id => `token-for-${id}` }
  const [a, b] = await Promise.all([fast.resolveAudio('aaaaaaaaaaa', options), fast.resolveAudio('bbbbbbbbbbb', options)])
  assert.deepEqual(calls.map(c => [c.id, c.token, c.sessionToken, c.playerToken]), [
    ['aaaaaaaaaaa', 'token-for-aaaaaaaaaaa', 'token-for-aaaaaaaaaaa', 'token-for-aaaaaaaaaaa'],
    ['bbbbbbbbbbb', 'token-for-bbbbbbbbbbb', 'token-for-bbbbbbbbbbb', 'token-for-bbbbbbbbbbb'],
  ])
  assert.match(a.url, /cver=1\.20261008\.01\.00/)
  assert.equal(a.mime, 'audio/webm')
  assert.equal(a.format, 'opus 150 kbps')
  assert.equal(a.engine, 'youtubei')
  assert.ok(b.expiresAt > Date.now())
})

test('a song YouTube won\'t play this way throws (yt-dlp takes it); no token still tries', async () => {
  const blocked = fakeClient({ status: 'LOGIN_REQUIRED' })
  await assert.rejects(fast.resolveAudio('ccccccccccc', { clientFor: async () => blocked.yt, mint: async () => 't' }), /Sign in to confirm your age/)
  const empty = fakeClient({ formats: [format('video/mp4', 1)] })
  await assert.rejects(fast.resolveAudio('ddddddddddd', { clientFor: async () => empty.yt, mint: async () => 't' }), /no audio/)
  const tokenless = fakeClient()
  const stream = await fast.resolveAudio('eeeeeeeeeee', { clientFor: async () => tokenless.yt, mint: async () => undefined })
  assert.equal(stream.poToken, false)
  assert.equal(tokenless.calls[0].token, undefined)
})

test('a music video\'s picture: the tallest within the cap, H.264 before VP9; sound-carrying or taller only as fallbacks', () => {
  const v = (codec, height, bitrate = height * 1000) => format(`video/${codec === 'vp9' ? 'webm' : 'mp4'}; codecs="${codec}"`, bitrate, { height })
  const adaptive = [v('vp9', 1080), v('avc1.640028', 1080), v('avc1.4d401f', 720), v('vp9', 2160), v('av01.0.08M.08', 1080, 9e6), format('audio/webm; codecs="opus"', 150000)]
  assert.equal(fast.pickVideoFormat(adaptive, [], 1080).mime_type, 'video/mp4; codecs="avc1.640028"')
  assert.equal(fast.pickVideoFormat(adaptive, [], 720).height, 720)
  assert.equal(fast.pickVideoFormat([v('vp9', 1080)], [v('avc1', 360)], 480).height, 360, 'a muxed format within the cap before a taller picture')
  assert.equal(fast.pickVideoFormat([v('vp9', 1440), v('vp9', 2160)], [], 480).height, 1440, 'nothing within the cap: the smallest over it')
  assert.equal(fast.pickVideoFormat([format('audio/mp4', 1)], [], 1080), null)
})

test('resolveVideo: the picture\'s link, mime and a readable format', async () => {
  const yt = {
    session: { context: { client: { clientVersion: '1.20261008.01.00' } }, player: {} },
    async getBasicInfo() { return { playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [format('video/webm; codecs="vp9"', 2e6, { height: 1080 }), format('audio/webm; codecs="opus"', 150000)], formats: [] } } },
  }
  const stream = await fast.resolveVideo('ccccccccccc', { height: 1080, clientFor: async () => yt, mint: async () => 'token' })
  assert.equal(stream.mime, 'video/webm')
  assert.equal(stream.format, 'vp9 1080p')
  assert.equal(stream.engine, 'youtubei')
  assert.match(stream.url, /cver=1\.20261008\.01\.00/)
  await assert.rejects(fast.resolveVideo('ddddddddddd', { clientFor: async () => ({ ...yt, async getBasicInfo() { return { playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [format('audio/mp4', 1)] } } } }), mint: async () => null }), /no picture/)
})

test('a video YouTube Music gives no picture for is asked for as YouTube\'s other clients', async () => {
  const asked = []
  const picture = format('video/mp4; codecs="avc1.4d401f"', 2e6, { height: 720 })
  const yt = {
    session: { context: { client: { clientVersion: '1.20261008.01.00' } }, player: {} },
    async getBasicInfo(id, options) {
      asked.push(options?.client || 'session')
      const adaptive = options?.client === 'MWEB' ? [picture] : [format('audio/webm; codecs="opus"', 150000)]
      return { playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: adaptive, formats: [] } }
    },
  }
  const stream = await fast.resolveVideo('eeeeeeeeeee', { height: 1080, clientFor: async () => yt, mint: async () => 'token', signedClient: async () => null })
  assert.deepEqual(asked, ['session', 'MWEB'])
  assert.equal(stream.format, 'avc1 720p')
  assert.match(stream.url, /cver=1\.20250219\.01\.00/, 'another client\'s link keeps the version it was asked with')
  // None of them: why, per client.
  await assert.rejects(fast.resolveVideo('fffffffffff', { signedClient: async () => null, clientFor: async () => ({ ...yt, async getBasicInfo() { return { playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in' } } } }), mint: async () => null }),
    /YouTube offered no picture for this video \(YouTube Music: Sign in; MWEB: Sign in\)/)
})

test('a video behind "confirm you\'re not a bot" signed out is asked for as the account', async () => {
  const picture = format('video/mp4; codecs="avc1.640028"', 3e6, { height: 1080, url: 'https://rr1.googlevideo.example/videoplayback?itag=137&cver=1.20261009.01.00&expire=4102444800' })
  const session = { context: { client: { clientVersion: '1.20261008.01.00' } }, player: {} }
  const anonymous = { session, async getBasicInfo() { return { playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you\u2019re not a bot' } } } }
  const account = { session: { ...session, context: { client: { clientVersion: '1.20261008.01.00' } } }, async getBasicInfo() { return { playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [picture], formats: [] } } } }
  const stream = await fast.resolveVideo('ggggggggggg', { clientFor: async () => anonymous, signedClient: async () => account, mint: async () => 'token' })
  assert.equal(stream.format, 'avc1 1080p')
  assert.match(stream.url, /cver=1\.20261009\.01\.00/, 'the version YouTube put in the link (the account\'s), not youtubei.js\'s')
})
