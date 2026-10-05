import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { DownloadManager } = require('../electron/download/manager.js')
const upgrade = require('../electron/quality/upgrade.js')

// A library with one track (the song downloaded earlier) and a new file of it.
function setup(t, track, newTier) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-upgrade-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const oldFile = path.join(dir, 'Daft Punk - One More Time.m4a')
  const newFile = path.join(dir, 'One More Time.flac')
  fs.writeFileSync(oldFile, 'old'); fs.writeFileSync(newFile, 'new')
  const row = { id: 't-1', file_path: oldFile, ...track }
  const db = { prepare: () => ({ get: id => (id === row.id ? row : undefined) }) }
  const mgr = new DownloadManager()
  mgr.deps = { getDB: () => db, getStorageDir: () => dir }
  mgr.fileTier = async file => (file === newFile ? newTier : 'unknown')
  const calls = []
  t.mock.method(upgrade, 'upgradeTrackFile', async (_db, id, file) => { calls.push([id, file]); return { id, movedTo: path.join(dir, 'replaced', 'old.m4a') } })
  const job = { outputLines: [] }
  return { mgr, job, newFile, calls }
}

const YOUTUBE_AAC = { download_source: 'yt', lossless: 0, bitrate: 128, codec: 'AAC' }

test('an earlier YouTube download is replaced by the same song in lossless, keeping its track', async t => {
  const { mgr, job, newFile, calls } = setup(t, YOUTUBE_AAC, 'lossless')
  assert.equal(await mgr.replaceWorseCopy(job, 't-1', newFile), true)
  assert.deepEqual(calls, [['t-1', newFile]])
  assert.match(job.outputLines.at(-1), /Replaced the earlier low-quality copy with this lossless file/)
})

test('a copy that is not better (same tier, or worse) leaves the earlier one in place', async t => {
  for (const tier of ['low', 'unknown']) {
    const { mgr, job, newFile, calls } = setup(t, YOUTUBE_AAC, tier)
    assert.equal(await mgr.replaceWorseCopy(job, 't-1', newFile), false)
    assert.equal(calls.length, 0)
  }
  const { mgr, job, newFile, calls } = setup(t, { download_source: 'a-2805d04035', lossless: 1, bit_depth: 16, sample_rate: 44100, codec: 'FLAC' }, 'high')
  assert.equal(await mgr.replaceWorseCopy(job, 't-1', newFile), false)
  assert.equal(calls.length, 0)
})

test('your own files are never replaced by a download', async t => {
  const { mgr, job, newFile, calls } = setup(t, { download_source: null, lossless: 0, bitrate: 128, codec: 'MPEG 1 Layer 3' }, 'hires')
  assert.equal(await mgr.replaceWorseCopy(job, 't-1', newFile), false)
  assert.equal(calls.length, 0)
})
