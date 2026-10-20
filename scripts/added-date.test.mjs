// When a song joined the library lives in its file, in the LOKAL_ADDED tag
// (electron/addedDate.js); tracks.added_at is the library's copy of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { toTag, parse, fromMeta, readAddedDate, writeAddedDate, stampNewFile, stampAddedDates } = require('../electron/addedDate.js')
const { DatabaseSync } = require('node:sqlite')
const T = require('node-taglib-sharp')

// A tiny MP3: frames of MPEG-1 Layer III, 128 kbps, 44.1 kHz (417 bytes each).
function mp3(filePath) {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x64])
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, Buffer.concat(Array.from({ length: 20 }, () => frame)))
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-added-date-'))
const quiet = { log: { warn() {} } }

function tagTypesOf(filePath) {
  const file = T.File.createFromPath(filePath)
  try { return file.tagTypesOnDisk } finally { file.dispose() }
}

test('the tag holds the moment in UTC, and reads back', () => {
  assert.equal(toTag(1760875200), '2025-10-19T12:00:00Z')
  assert.equal(parse('2025-10-19T12:00:00Z'), 1760875200)
  assert.equal(parse('1760875200'), 1760875200, 'seconds')
  assert.equal(parse('1760875200000'), 1760875200, 'milliseconds')
  assert.equal(parse(''), null)
  assert.equal(parse('yesterday'), null)
  assert.equal(parse('1970-01-02T00:00:00Z'), null, 'too old to be a real date')
  assert.equal(parse(toTag(Date.now() / 1000 + 10 * 86400)), null, 'not in the future')
  assert.equal(fromMeta({ native: { vorbis: [{ id: 'LOKAL_ADDED', value: '2025-10-19T12:00:00Z' }] } }), 1760875200)
  assert.equal(fromMeta({ native: { 'ID3v2.4': [{ id: 'TXXX:LOKAL_ADDED', value: { description: 'LOKAL_ADDED', text: '2025-10-19T12:00:00Z' } }] } }), 1760875200)
  assert.equal(fromMeta({ native: { 'ID3v2.4': [{ id: 'TXXX:OTHER', value: '2025-10-19T12:00:00Z' }] } }), null)
})

test('an MP3 gets the tag without an ID3v1 tag', async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'song.mp3')
    mp3(file)
    assert.equal(await readAddedDate(file), null)
    writeAddedDate(file, 1760875200)
    assert.equal(await readAddedDate(file), 1760875200)
    assert.equal(tagTypesOf(file) & T.TagTypes.Id3v1, 0, 'no ID3v1 tag added')
    // Written again: replaced, not a second frame.
    writeAddedDate(file, 1760961600)
    assert.equal(await readAddedDate(file), 1760961600)
    const tagged = T.File.createFromPath(file)
    try {
      const id3 = tagged.getTag(T.TagTypes.Id3v2, false)
      const frames = id3.getFramesByClassType(T.Id3v2FrameClassType.UserTextInformationFrame).filter(f => f.description === 'LOKAL_ADDED')
      assert.equal(frames.length, 1)
    } finally { tagged.dispose() }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("files without the tag get the library's date; the scan doesn't see them as changed", async () => {
  const dir = tempDir()
  try {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE tracks (id TEXT, file_path TEXT, added_at INTEGER, last_modified REAL)')
    const old = path.join(dir, 'old.mp3')
    const msRow = path.join(dir, 'ms.mp3')
    const gone = path.join(dir, 'gone.mp3')
    mp3(old)
    mp3(msRow)
    db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?)').run('a', old, 1600000000, 0)
    db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?)').run('b', msRow, 1600000000123, 0)
    db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?)').run('c', gone, 1600000000, 0)
    db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?)').run('d', 'ghost://x', 1600000000, 0)

    const result = await stampAddedDates(db, [old, msRow, gone, 'ghost://x', path.join(dir, 'not-in-library.mp3')], quiet)
    assert.deepEqual(result, { written: 2, failed: 0 })
    assert.equal(await readAddedDate(old), 1600000000)
    assert.equal(await readAddedDate(msRow), 1600000000, 'milliseconds in an old row are read as such')
    const row = db.prepare('SELECT last_modified FROM tracks WHERE id = ?').get('a')
    assert.equal(row.last_modified, fs.statSync(old).mtimeMs)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("a new song gets now, whatever date its file came with", async () => {
  const dir = tempDir()
  try {
    const file = path.join(dir, 'download.mp3')
    mp3(file)
    writeAddedDate(file, 1500000000)
    const before = Math.floor(Date.now() / 1000)
    assert.equal(stampNewFile(null, file, undefined, quiet), true)
    const added = await readAddedDate(file)
    assert.ok(added >= before && added <= Math.floor(Date.now() / 1000) + 1)
    assert.equal(stampNewFile(null, path.join(dir, 'missing.mp3'), undefined, quiet), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
