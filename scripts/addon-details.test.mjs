import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const { streamQuality, saveOnlineTracks } = require('../electron/online/sources.js')
const { knownTagsOf } = require('../electron/download/postprocess.js')
const { applyTags } = require('../electron/download/tagger.js')

test("a source's quality string is read: FLAC bit depth and rate, lossy bitrate", () => {
  assert.deepEqual(streamQuality('FLAC 16/44.1'), { codec: 'flac', lossless: 1, bit_depth: 16, sample_rate: 44100, bitrate: null })
  assert.deepEqual(streamQuality('FLAC 24-bit / 192 kHz'), { codec: 'flac', lossless: 1, bit_depth: 24, sample_rate: 192000, bitrate: null })
  assert.deepEqual(streamQuality('MP3 320'), { codec: 'mp3', lossless: 0, bit_depth: null, sample_rate: null, bitrate: 320 })
  assert.deepEqual(streamQuality(''), { codec: null, lossless: null, bit_depth: null, sample_rate: null, bitrate: null })
})

test("a streamed addon song keeps what the addon said (and a later save without it doesn't erase it)", () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, file_hash TEXT, title TEXT, artist TEXT, album TEXT, album_artist TEXT, duration REAL,
    source_url TEXT, artwork_url TEXT, last_modified INTEGER, year INTEGER, track_num INTEGER, genre TEXT, bitrate INTEGER, play_count INTEGER DEFAULT 0)`)
  db.transaction = fn => fn
  const item = { provider: 'a-0123456789', id: '5345863', title: 'In the Stone (Album Version)', artist: 'Earth, Wind & Fire', album: 'I Am', year: 1979, track_num: 1, isrc: 'USSM19802930', quality: 'FLAC 16/44.1' }
  const [row] = saveOnlineTracks(db, [item])
  assert.deepEqual([row.year, row.track_num, row.isrc, row.codec, row.bit_depth, row.sample_rate, row.lossless], [1979, 1, 'USSM19802930', 'flac', 16, 44100, 1])
  const [again] = saveOnlineTracks(db, [{ provider: item.provider, id: item.id, title: item.title, artist: item.artist }])
  assert.deepEqual([again.year, again.track_num, again.codec], [1979, 1, 'flac'])
})

// The smallest FLAC there is: STREAMINFO and an empty Vorbis comment.
function minimalFlac() {
  const info = Buffer.alloc(34)
  info.writeUInt16BE(4096, 0); info.writeUInt16BE(4096, 2)
  info.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n), 10)
  const vendor = Buffer.from('lokal-test')
  const comment = Buffer.alloc(8 + vendor.length)
  comment.writeUInt32LE(vendor.length, 0); vendor.copy(comment, 4)
  const header = (last, type, length) => Buffer.from([(last ? 0x80 : 0) | type, (length >> 16) & 255, (length >> 8) & 255, length & 255])
  return Buffer.concat([Buffer.from('fLaC'), header(false, 0, 34), info, header(true, 4, comment.length), comment])
}

test("an addon download is tagged with the addon's year, track, disc, ISRC and genre where it has none", async () => {
  const known = knownTagsOf({ title: 'In the Stone', artist: 'Earth, Wind & Fire', year: 1979, track: 1, disc: 1, isrc: 'US-SM1-98-02930', genre: 'Funk', bogus: 1 })
  assert.deepEqual([known.year, known.track, known.disc, known.isrc, known.genre, known.bogus], [1979, 1, 1, 'USSM19802930', 'Funk', undefined])
  assert.equal(knownTagsOf({ title: 'x', year: 99999, isrc: 'nope' }).year, undefined)

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-')), 'song.flac')
  fs.writeFileSync(file, minimalFlac())
  const done = await applyTags(file, { year: 1979, track: 1, disc: 1, isrc: known.isrc, genre: 'Funk' })
  assert.deepEqual([done.year, done.track, done.isrc, done.genre], [1979, 1, 'USSM19802930', 'Funk'])
  const T = require('node-taglib-sharp')
  const read = () => { const f = T.File.createFromPath(file); try { return { year: f.tag.year, track: f.tag.track, disc: f.tag.disc, isrc: f.tag.isrc, genres: f.tag.genres } } finally { f.dispose() } }
  assert.deepEqual(read(), { year: 1979, track: 1, disc: 1, isrc: 'USSM19802930', genres: ['Funk'] })
  // What the file has stays.
  await applyTags(file, { year: 2001, genre: 'Pop' })
  assert.deepEqual([read().year, read().genres], [1979, ['Funk']])
})
