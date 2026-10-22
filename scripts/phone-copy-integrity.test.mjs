import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const { resolvePhoneFiles } = require('../server/phoneFileMatch')
const { savePhoneFileMetadata } = require('../server/phoneFileMetadata')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

test('recognizes exact bytes despite different filenames, tags and path-based scanner hashes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phone-copy-'))
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY,file_path TEXT,file_hash TEXT)')
    const original = Buffer.from('original-audio'), alternate = Buffer.from('alternate-song')
    await fs.writeFile(path.join(root, 'renamed.flac'), original)
    await fs.writeFile(path.join(root, 'same-size.flac'), alternate)
    const insert = db.prepare('INSERT INTO tracks VALUES (?,?,?)')
    insert.run('original', path.join(root, 'renamed.flac'), 't-path-based-hash')
    insert.run('alternate', path.join(root, 'same-size.flac'), 't-other-path-hash')
    insert.run('deleted', path.join(root, 'missing.flac'), hash(original))
    insert.run('ghost', 'ghost://link/history', hash(original))
    const result = await resolvePhoneFiles(db, [
      { size: original.length, sha256: hash(original) },
      { size: alternate.length, sha256: hash(Buffer.from('different-data')) },
      { size: 5, sha256: hash(Buffer.from('other')) },
    ])
    assert.deepEqual(result, [{ index: 0, trackId: 'original' }])
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('imports real codec, bitrate, resolution, genres and artwork without replacing identity or likes', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY,album_artist TEXT,track_num INTEGER,year INTEGER,
      genre TEXT,genres TEXT,download_source TEXT,bitrate INTEGER,last_modified REAL,artwork_path TEXT,liked INTEGER);
      INSERT INTO tracks (id,liked) VALUES ('existing-placeholder',1)`)
    savePhoneFileMetadata(db, 'existing-placeholder', {
      common: { albumartist: 'Album Artist', track: { no: 4 }, year: 2026, genre: ['Jazz', 'Soul'] },
      format: { codec: 'FLAC', lossless: true, sampleRate: 96000, bitsPerSample: 24, bitrate: 2345678 },
    }, { artwork: '/cache/artwork/original.webp', mtimeMs: 1234 })
    const row = db.prepare('SELECT * FROM tracks').get()
    assert.equal(row.id, 'existing-placeholder')
    assert.equal(row.liked, 1)
    assert.equal(row.download_source, 'mobile')
    assert.equal(row.bitrate, 2346)
    assert.equal(row.codec, 'FLAC')
    assert.equal(row.lossless, 1)
    assert.equal(row.bit_depth, 24)
    assert.equal(row.sample_rate, 96000)
    assert.equal(row.artwork_path, '/cache/artwork/original.webp')
    assert.equal(row.album_artist, 'Album Artist')
    assert.equal(row.track_num, 4)
    assert.deepEqual(JSON.parse(row.genres), ['Jazz', 'Soul'])
  } finally { db.close() }
})

test('size preflight excludes absent files without hashing their audio and stops on cancellation', async () => {
  const { candidateOriginalSizes } = require('../server/phoneFileMatch')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phone-sizes-'))
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY,file_path TEXT)')
    await fs.writeFile(path.join(root, 'song.flac'), Buffer.alloc(123))
    const insert = db.prepare('INSERT INTO tracks VALUES (?,?)')
    insert.run('local', path.join(root, 'song.flac'))
    insert.run('missing', path.join(root, 'deleted.flac'))
    insert.run('ghost', 'ghost://link/song')
    assert.deepEqual(await candidateOriginalSizes(db, [123, 456]), [123])
    await assert.rejects(candidateOriginalSizes(db, [123], { check() { throw new Error('cancelled') } }), /cancelled/)
    await assert.rejects(resolvePhoneFiles(db, [{ size: 123, sha256: '0'.repeat(64) }], { check() { throw new Error('cancelled') } }), /cancelled/)
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }) }
})
