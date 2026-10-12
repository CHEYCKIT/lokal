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
