import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const sources = require('../electron/online/sources.js')

test('cancelling a stream body (the player moved on) aborts the request it came from', async () => {
  let aborted = 0
  const upstream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)) } })
  const body = sources.cancellableBody(upstream, () => { aborted++ })
  const reader = body.getReader()
  assert.equal((await reader.read()).value.byteLength, 1024)
  await reader.cancel('next song')
  assert.equal(aborted, 1)
})

test('a body read to the end is passed on whole and aborts nothing', async () => {
  let aborted = 0
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])]
  const upstream = new ReadableStream({ pull(c) { const next = chunks.shift(); if (next) c.enqueue(next); else c.close() } })
  const bytes = new Uint8Array(await new Response(sources.cancellableBody(upstream, () => { aborted++ })).arrayBuffer())
  assert.deepEqual([...bytes], [1, 2, 3])
  assert.equal(aborted, 0)
})

test('YouTube and SoundCloud media requests carry the abort signal too', async t => {
  const youtube = require('../electron/online/youtube.js')
  t.mock.method(youtube, 'resolveStream', async () => ({ url: 'https://media.example.test/a.webm', headers: {}, mime: 'audio/webm', expiresAt: Date.now() + 60000 }))
  const seen = []
  const signal = new AbortController().signal
  await sources.fetchStream('yt', 'j_UhEi3GZOU', { signal, range: 'bytes=0-', fetchImpl: async (url, init) => { seen.push(init); return new Response('x', { status: 206 }) } })
  assert.equal(seen[0].signal, signal)
  assert.equal(seen[0].headers.Range, 'bytes=0-')
})
