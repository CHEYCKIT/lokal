import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const db = require('../electron/ipc/db.js')
const cache = require('../electron/cache.js')
const MB = 1024 * 1024

function storage(t, limitMb) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-cache-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  t.mock.method(db, 'getStorageDir', () => root)
  t.mock.method(db, 'getDB', () => ({ prepare: () => ({ get: () => (limitMb ? { value: String(limitMb) } : undefined) }) }))
  const put = (dir, name, mb, ageMinutes) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
    const p = path.join(root, dir, name)
    fs.writeFileSync(p, Buffer.alloc(mb * MB))
    const when = new Date(Date.now() - ageMinutes * 60000)
    fs.utimesSync(p, when, when)
    return p
  }
  return { root, put }
}

test('moving covers and playable copies share one limit, oldest use first, the playing file kept', t => {
  const { put } = storage(t, 512)
  const oldest = put('playback-cache', 'old.flac', 200, 300)
  const playing = put('motion-covers', 'playing.mp4', 150, 200)
  const recent = put('motion-covers', 'recent.mp4', 200, 10)
  const newest = put('playback-cache', 'new.flac', 200, 1)
  const partial = put('motion-covers', 'clip.part.mp4', 300, 400)
  cache.trim({ keep: playing })
  // 512 MB: newest (200) + recent (200) fit; old.flac (+200) doesn't; playing.mp4 is in use.
  assert.ok(fs.existsSync(newest) && fs.existsSync(recent) && fs.existsSync(playing))
  assert.ok(!fs.existsSync(oldest))
  assert.ok(fs.existsSync(partial), 'a file still being written is left alone')
  const used = cache.usage()
  assert.equal(used.motion, 350 * MB)
  assert.equal(used.playback, 200 * MB)
})

test('no limit chosen: 4 GB, and an unknown value falls back to it', t => {
  storage(t, null)
  assert.equal(cache.limitBytes(), 4096 * MB)
  assert.equal(cache.limitBytes({ cache_limit_mb: '7' }), 4096 * MB)
  assert.equal(cache.limitBytes({ cache_limit_mb: '1024' }), 1024 * MB)
})

test('Clear Cache empties both caches but not a file being written', t => {
  const { put } = storage(t, 4096)
  put('motion-covers', 'a.mp4', 1, 1)
  put('playback-cache', 'b.m4a', 1, 1)
  const partial = put('playback-cache', 'c.part.flac', 1, 1)
  assert.equal(cache.clear(), 2)
  assert.deepEqual(cache.usage(), { motion: 0, playback: 0 })
  assert.ok(fs.existsSync(partial))
})
