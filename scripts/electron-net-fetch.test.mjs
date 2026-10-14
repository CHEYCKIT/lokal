import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const require = createRequire(import.meta.url)
const { netFetch } = require('../electron/online/netFetch.js')

function fakeNet(onEnd) {
  const state = { options: null, request: null }
  return {
    state,
    net: {
      request(options) {
        state.options = options
        const request = new EventEmitter()
        request.end = () => onEnd(request, state)
        request.abort = () => { request.aborted = true }
        state.request = request
        return request
      },
    },
  }
}

test('manual redirects resolve as a 3xx Response with Location', async () => {
  const { net, state } = fakeNet(request => queueMicrotask(() => {
    request.emit('redirect', 302, 'GET', 'https://cdn.example/audio', {
      location: ['https://cdn.example/audio'],
      'content-type': ['text/plain'],
    })
  }))

  const response = await netFetch(net, 'https://addon.example/stream/track', {
    headers: { Range: 'bytes=0-' },
  })

  assert.equal(state.options.redirect, 'manual')
  assert.equal(state.options.method, 'GET')
  assert.equal(state.options.headers.range, 'bytes=0-')
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://cdn.example/audio')
})

test('a close emitted before a delayed manual redirect does not reject the response', async () => {
  const { net } = fakeNet(request => {
    request.emit('close')
    setTimeout(() => request.emit('redirect', 307, 'GET', 'https://cdn.example/audio', {
      location: ['https://cdn.example/audio'],
    }), 20)
  })

  const response = await netFetch(net, 'https://addon.example/stream/track')

  assert.equal(response.status, 307)
  assert.equal(response.headers.get('location'), 'https://cdn.example/audio')
})

test('normal media responses preserve status, headers and streamed bytes', async () => {
  const audio = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0x01])
  const { net } = fakeNet(request => queueMicrotask(() => {
    const incoming = new PassThrough()
    incoming.statusCode = 206
    incoming.headers = {
      'content-type': ['audio/flac'],
      'content-range': ['bytes 0-5/6'],
      'accept-ranges': ['bytes'],
    }
    request.emit('response', incoming)
    incoming.end(audio)
  }))

  const response = await netFetch(net, 'https://cdn.example/audio', {
    headers: { Range: 'bytes=0-' },
  })

  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-type'), 'audio/flac')
  assert.equal(response.headers.get('content-range'), 'bytes 0-5/6')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio)
})

test('an already-aborted signal does not start an HTTP request', async () => {
  let requested = false
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    netFetch({ request() { requested = true; throw new Error('should not run') } }, 'https://addon.example/audio', {
      signal: controller.signal,
    }),
    error => error?.name === 'AbortError',
  )
  assert.equal(requested, false)
})
