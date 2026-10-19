import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parseAny } = require('../electron/lyrics/detect')
const { finish } = require('../electron/lyrics/postprocess')
const local = require('../electron/lyrics/providers/local')
const fileLyrics = require('../electron/lyrics/fileLyrics')

const FILE = '[00:21.65] Saigo no Kisu wa\n    The last kiss\n\n[00:26.60] Tabako no flavor ga shita\n    Had a tobacco flavor\n\n[00:38.95]\n\n[00:42.94] Ashita no ima goro ni wa\n    Around this time tomorrow\n'
const sung = result => result.lines.filter(line => line.text).map(line => [line.time, line.text, line.translation?.text || null])

// A real (silent, tags-only) FLAC with these Vorbis comments.
function flac(fields) {
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const vendor = Buffer.from('lokal-test')
  const comments = Buffer.concat([u32(vendor.length), vendor, u32(fields.length), ...fields.flatMap(f => { const b = Buffer.from(f); return [u32(b.length), b] })])
  const block = (type, last, data) => { const h = Buffer.alloc(4); h[0] = (last ? 0x80 : 0) | type; h.writeUIntBE(data.length, 1, 3); return Buffer.concat([h, data]) }
  const info = Buffer.alloc(34); info.writeUInt16BE(4096, 0); info.writeUInt16BE(4096, 2); info[10] = 0x0a; info[11] = 0xc4; info[12] = 0x42; info[13] = 0xf0
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-lrc-')), 'song.flac')
  fs.writeFileSync(file, Buffer.concat([Buffer.from('fLaC'), block(0, false, info), block(4, true, comments)]))
  return file
}
const fromFile = async file => { const got = await local.fetch({ filePath: file }); return finish(parseAny(got.raw).lines, { source: 'local' }) }

test('an LRC with a translation under each line stays line-synced and keeps the translations', () => {
  const result = finish(parseAny(FILE).lines, { source: 'local' })
  assert.equal(result.type, 'synced')
  assert.deepEqual(sung(result), [
    [21.65, 'Saigo no Kisu wa', 'The last kiss'],
    [26.6, 'Tabako no flavor ga shita', 'Had a tobacco flavor'],
    [42.94, 'Ashita no ima goro ni wa', 'Around this time tomorrow'],
  ])
  assert.equal(result.translationLang, '*')
})

test('a stray unstamped line in an ordinary LRC is not taken for a translation', () => {
  const result = finish(parseAny('[00:01.00] one\n[00:02.00] two\nLyrics by Someone\n[00:03.00] three\n[00:04.00] four\n').lines, { source: 'local' })
  assert.ok(sung(result).every(([, , translation]) => translation === null))
  assert.equal(result.translationLang, null)
})

test('old-Mac (CR only) and Windows line endings, and a byte-order mark', () => {
  for (const text of [FILE.replace(/\n/g, '\r'), FILE.replace(/\n/g, '\r\n'), '﻿' + FILE]) {
    assert.equal(sung(finish(parseAny(text).lines, { source: 'local' })).length, 3)
  }
})

test('a FLAC LYRICS tag with LRC stays synced (the tag reader hands back its words without the stamps)', async () => {
  const result = await fromFile(flac([`LYRICS=${FILE}`]))
  assert.equal(result.type, 'synced')
  assert.deepEqual(sung(result)[0], [21.65, 'Saigo no Kisu wa', 'The last kiss'])
})

test('a FLAC with both UNSYNCEDLYRICS and LYRICS gives the synced one, either order', async () => {
  for (const fields of [[ 'UNSYNCEDLYRICS=Saigo no Kisu wa\nThe last kiss', `LYRICS=${FILE}` ], [ `LYRICS=${FILE}`, 'UNSYNCEDLYRICS=Saigo no Kisu wa' ]]) {
    assert.equal((await fromFile(flac(fields))).type, 'synced')
  }
})

test('a FLAC with only plain lyrics stays plain', async () => {
  assert.equal((await fromFile(flac(['UNSYNCEDLYRICS=just words\nmore words\nand more']))).type, 'unsynced')
})

test('an MP3 with USLT + SYLT (as Lokal writes them) is synced', async () => {
  const frame = Buffer.alloc(417); frame.writeUInt32BE(0xFFFB9064, 0)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-lrc-')), 'song.mp3')
  fs.writeFileSync(file, Buffer.concat(Array(40).fill(frame)))
  fileLyrics.writeFileLyrics(file, '[00:21.65] Saigo no Kisu wa\n[00:26.60] Tabako no flavor ga shita\n[00:31.85] Nigakute')
  const result = await fromFile(file)
  assert.equal(result.type, 'synced')
  assert.equal(sung(result)[1][0], 26.6)
})

test('an ID3 SYLT frame alone is rebuilt into timed lyrics', () => {
  const sylt = { id: 'SYLT', value: { timeStampFormat: 2, syncText: [{ text: 'one', timestamp: 1000 }, { text: 'two', timestamp: 2500 }] } }
  const text = local.embeddedText({ native: { 'ID3v2.3': [sylt] }, common: {} })
  assert.match(text, /^\[00:01\.00\] one\n\[00:02\.50\] two$/)
})

test('lyrics cached as plain from a file before this fix are read again, and come back synced', async () => {
  const Database = require('better-sqlite3')
  const service = require('../electron/lyrics/service')
  const db = new Database(':memory:')
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT); CREATE TABLE lyrics_cache (track_id TEXT PRIMARY KEY, lyrics_type TEXT, content TEXT, source TEXT, cached_at INTEGER)')
  // Only the file is asked: no network in a test.
  db.prepare("INSERT INTO settings VALUES ('lyrics_sources_enabled', ?), ('lyrics_sources_order', ?)").run('["local"]', '["local","spicylyrics"]')
  const file = flac([`LYRICS=${FILE}`])
  db.prepare('INSERT INTO tracks VALUES (?, ?)').run('t1', file)
  const args = { trackId: 't1', title: 'First Love', artist: 'Hikaru Utada', album: '', duration: 250 }
  assert.equal((await service.getLyrics(db, args)).type, 'synced')
  // What an older version saved: the same file read as plain lyrics.
  db.prepare("UPDATE lyrics_cache SET lyrics_type = 'unsynced' WHERE track_id = 't1'").run()
  assert.equal((await service.getLyrics(db, args)).type, 'synced')
})
