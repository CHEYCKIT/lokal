import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseRadioStreamTarget, proxyRadioStream } = require('../electron/radio/streamProxy')

function fakeRequest(method = 'GET', headers = {}) {
  return { method, headers: new Headers(headers), signal: new AbortController().signal }
}

test('only accepts public HTTP(S)-style URLs, without embedded credentials', () => {
  assert.equal(parseRadioStreamTarget('https://radio.example/live.aac'), 'https://radio.example/live.aac')
  assert.equal(parseRadioStreamTarget('http://radio.example:8000/stream'), 'http://radio.example:8000/stream')
  assert.equal(parseRadioStreamTarget('file:///etc/passwd'), null)
  assert.equal(parseRadioStreamTarget('ftp://radio.example/live'), null)
  assert.equal(parseRadioStreamTarget('http://user:pass@radio.example/live'), null)
})

test('answers preflight requests without contacting the station', async () => {
  let called = false
  const response = await proxyRadioStream(fakeRequest('OPTIONS'), 'https://radio.example/live', {
    fetchImpl: async () => { called = true; throw new Error('must not fetch') },
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.match(response.headers.get('access-control-allow-headers'), /icy-metadata/i)
  assert.equal(called, false)
})

test('forwards ICY metadata requests and exposes stream metadata to the player', async () => {
  let requestedUrl = ''
  let sentMetadataHeader = ''
  const response = await proxyRadioStream(
    fakeRequest('GET', { 'Icy-MetaData': '1' }),
    'https://radio.example/live',
    {
      validateUrl: async () => true,
      fetchImpl: async (url, init) => {
        requestedUrl = url
        sentMetadataHeader = init.headers.get('icy-metadata')
        return new Response('sample audio', {
          status: 200,
          headers: {
            'content-type': 'audio/aac',
            'icy-metaint': '16000',
            'icy-name': 'Example Radio',
          },
        })
      },
    },
  )
  assert.equal(requestedUrl, 'https://radio.example/live')
  assert.equal(sentMetadataHeader, '1')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('icy-metaint'), '16000')
  assert.equal(response.headers.get('icy-name'), 'Example Radio')
  assert.equal(await response.text(), 'sample audio')
})

test('follows redirects only after validating each target', async () => {
  const requested = []
  const validated = []
  const response = await proxyRadioStream(fakeRequest(), 'https://radio.example/start', {
    validateUrl: async url => { validated.push(url); return true },
    fetchImpl: async url => {
      requested.push(url)
      if (url.endsWith('/start')) return new Response(null, { status: 302, headers: { location: '/live.aac' } })
      return new Response('stream', { status: 200, headers: { 'content-type': 'audio/aac' } })
    },
  })
  assert.deepEqual(requested, ['https://radio.example/start', 'https://radio.example/live.aac'])
  assert.deepEqual(validated, requested)
  assert.equal(await response.text(), 'stream')
})

test('rejects private redirect targets before fetching them', async () => {
  let fetchCount = 0
  const response = await proxyRadioStream(fakeRequest(), 'http://127.0.0.1:9000/live', {
    validateUrl: async url => !new URL(url).hostname.startsWith('127.'),
    fetchImpl: async () => { fetchCount++; return new Response('should not fetch') },
  })
  assert.equal(response.status, 403)
  assert.equal(fetchCount, 0)
})
