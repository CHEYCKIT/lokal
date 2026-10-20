import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { targetFolder, placeDownload } = require('../electron/downloadFolder.js')
const { DatabaseSync } = require('node:sqlite')

function mp3(filePath) {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x64])
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, Buffer.concat(Array.from({ length: 20 }, () => frame)))
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-download-folder-'))
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE tracks (id TEXT, file_path TEXT, track_num INTEGER)')
  db.prepare('INSERT INTO settings VALUES (?, ?)').run('music_folder', root)
  return { root, db }
}

test('creates a relative folder inside the selected music root and rejects traversal', t => {
  const { root, db } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.equal(targetFolder(db, 'Downloads/Incoming'), path.join(root, 'Downloads', 'Incoming'))
  assert.throws(() => targetFolder(db, '../outside'), /relative folder/)
  assert.throws(() => targetFolder(db, 'C:/outside'), /relative folder/)
})

test('moves downloads into the folder, numbers files before indexing, and moves lyric sidecars', t => {
  const { root, db } = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'Artist', 'Album', 'song.mp3')
  mp3(source)
  fs.writeFileSync(path.join(path.dirname(source), 'song.lrc'), '[00:01.00]Line')
  const assigned = {}
  const first = placeDownload(db, source, 'Downloads', assigned)
  assert.equal(first.filePath, path.join(root, 'Downloads', 'song.mp3'))
  assert.equal(first.trackNum, 1)
  assert.equal(fs.existsSync(first.filePath), true)
  assert.equal(fs.existsSync(path.join(root, 'Downloads', 'song.lrc')), true)
  const secondSource = path.join(root, 'other.mp3')
  mp3(secondSource)
  const second = placeDownload(db, secondSource, 'Downloads', assigned)
  assert.equal(second.trackNum, 2)
  assert.equal(fs.existsSync(second.filePath), true)
})
