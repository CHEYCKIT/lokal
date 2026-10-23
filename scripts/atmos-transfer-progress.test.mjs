import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { ExtensionHost } = require('../electron/mornye/host.js')

const makeHost = (root, events, response) => new ExtensionHost({
  root,
  addon: { manifest: { permissions: { file: true } } },
  storage: {},
  network: {
    auth: {},
    request: async () => response(),
  },
  onProgress: event => events.push(event),
})

test('Mornye byte progress uses actual Content-Length for Atmos toast', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lokal-atmos-transfer-'))
  try {
    const events = []
    const chunks = Array.from({ length: 4 }, () => Buffer.alloc(128, 0x41))
    const host = makeHost(root, events, () => ({
      status: 200,
      headers: { 'content-length': '512' },
      response: Readable.from(chunks),
    }))
    const result = await host.transfer('https://example.test/audio', 'audio.m4a', { maxAttempts: 1 })
    assert.equal(result.success, true)
    assert.deepEqual(events.map(event => event.percent), [0, 25, 50, 75, 100])
    assert.ok(events.every(event => event.message === 'Downloading audio…'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Unknown-size transfers show an indeterminate stage, not an invented percentage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lokal-atmos-unknown-size-'))
  try {
    const events = []
    const host = makeHost(root, events, () => ({
      status: 200,
      headers: {},
      response: Readable.from([Buffer.from('audio')]),
    }))
    await host.transfer('https://example.test/audio', 'audio.m4a', { maxAttempts: 1 })
    assert.equal(events.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Segmented downloads report completed segments, not fabricated total bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lokal-atmos-segments-'))
  try {
    const events = []
    const host = makeHost(root, events, () => ({
      status: 200,
      headers: { 'content-length': '3' },
      response: Readable.from([Buffer.from('abc')]),
    }))
    const result = await host.segments([
      'https://example.test/a', 'https://example.test/b',
    ], 'audio.m4a', { maxAttempts: 1, maxParallel: 1 }, async () => {})
    assert.equal(result.success, true)
    assert.deepEqual(events.map(event => event.percent), [0, 50, 100])
    assert.ok(events.every(event => /segments/.test(event.message)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
