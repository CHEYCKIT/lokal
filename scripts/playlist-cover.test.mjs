import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { httpsImageURL, fetchCoverData } = require('../electron/playlists/remoteCover.js')

const COVER = 'https://lh3.googleusercontent.com/mix-cover=w544-h544'

test('only https covers on the internet are fetched', () => {
  assert.equal(httpsImageURL(COVER)?.href, COVER)
  for (const url of ['http://lh3.googleusercontent.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://nas.local/a', 'https://router/a', 'https://u:p@example.com/a', 'file:///etc/passwd', '', null]) {
    assert.equal(httpsImageURL(url), null, String(url))
  }
})

function withFetch(respond, run) {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return respond(url) }
  return Promise.resolve(run(calls)).finally(() => { globalThis.fetch = real })
}

test('a mix cover becomes a data URL for the playlist photo', () => withFetch(
  () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { headers: { 'content-type': 'image/jpeg' } }),
  async calls => {
    assert.equal(await fetchCoverData(COVER), 'data:image/jpeg;base64,/9j/4A==')
    assert.equal(calls[0].url, COVER)
    assert.equal(calls[0].options.redirect, 'error')
  },
))

test('pages, errors and blocked hosts give no cover', async () => {
  await withFetch(() => new Response('<html>', { headers: { 'content-type': 'text/html' } }), async () => {
    assert.equal(await fetchCoverData(COVER), null)
  })
  await withFetch(() => new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } }), async () => {
    assert.equal(await fetchCoverData(COVER), null)
  })
  await withFetch(() => { throw new Error('offline') }, async () => {
    assert.equal(await fetchCoverData(COVER), null)
  })
  await withFetch(() => { throw new Error('should not fetch') }, async calls => {
    assert.equal(await fetchCoverData('https://192.168.1.2/cover.jpg'), null)
    assert.equal(calls.length, 0)
  })
})
