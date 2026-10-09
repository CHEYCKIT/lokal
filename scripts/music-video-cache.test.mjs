import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { cachedVideoFile, peekCachedVideoFile } = require('../electron/online/musicVideoCache.js')

test('music videos download once and reuse the local cache file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-cache-'))
  let downloads = 0
  const trimmed = []
  const fetchStream = async () => {
    downloads++
    return {
      mime: 'video/mp4',
      res: new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '4' },
      }),
    }
  }
  try {
    const options = { cacheDir: dir, fetchStream, trim: value => trimmed.push(value) }
    assert.equal(peekCachedVideoFile('4NRXx6U8ABQ', options), null)
    const first = await cachedVideoFile('4NRXx6U8ABQ', options)
    assert.equal(peekCachedVideoFile('4NRXx6U8ABQ', options), first)
    const second = await cachedVideoFile('4NRXx6U8ABQ', options)
    assert.equal(first, second)
    assert.equal(downloads, 1)
    assert.deepEqual([...fs.readFileSync(first)], [0, 1, 2, 3])
    assert.deepEqual(trimmed, [{ keep: [first] }])
    assert.equal(fs.readdirSync(dir).length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
