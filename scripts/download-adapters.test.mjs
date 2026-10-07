import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
const require = createRequire(import.meta.url)
const scanner = require('../electron/ipc/scanner.js')
const { getDownloadManager } = require('../electron/download/manager.js')
const fs = require('fs-extra')

test('web download adapter keeps expected duration and scanner validation failures', async t => {
  const router = require('../server/routes/download.js')
  const manager = getDownloadManager()
  const requests = []
  t.mock.method(manager, 'enqueue', (kind, url, opts) => { requests.push(opts); return { downloadId: 'test' } })
  const handler = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack[0].handle
  const response = { status: () => response, json() {} }
  handler({ body: { url: 'https://example.test/song.flac', expectedDuration: 201.5 } }, response)
  handler({ body: { url: 'https://example.test/song.flac', expectedDuration: 'Infinity' } }, response)
  assert.equal(requests[0].expectedDuration, 201.5)
  assert.equal(requests[1].expectedDuration, undefined)
  t.mock.method(fs, 'existsSync', () => true)
  t.mock.method(scanner, 'indexSingleFile', async () => ({ error: 'Duration mismatch' }))
  assert.deepEqual(await manager.deps.index('/fixture.flac', {}), { error: 'Duration mismatch' })
})

test('desktop download adapter preserves scanner validation failures', async t => {
  const manager = require('../electron/ipc/downloader.js').manager()
  t.mock.method(fs, 'existsSync', () => true)
  t.mock.method(scanner, 'indexSingleFile', async () => ({ error: 'Duration mismatch' }))
  assert.deepEqual(await manager.deps.index('/fixture.flac', {}), { error: 'Duration mismatch' })
})
