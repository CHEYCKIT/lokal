import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
const require = createRequire(import.meta.url)
const { initDB, getDB } = require('../electron/ipc/db')
const { scanFolder, applyFileChanges } = require('../electron/ipc/scanner')
const { noteFileWritten } = require('../electron/fileStamp')
const mm = require('../electron/musicMetadata')

// A music folder whose "tags" are what `tags` says for each file name; reads
// counts how many files had their tags read (covers included: a scan's read).
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-watch-'))
  const previous = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = path.join(dir, 'data')
  initDB()
  const db = getDB()
  const music = path.join(dir, 'music')
  fs.mkdirSync(music)
  const tags = {}
  const reads = []
  t.mock.method(mm, 'parseFile', async (file, opts) => {
    if (opts?.skipCovers === false) reads.push(path.basename(file))
    const own = tags[path.basename(file)] || {}
    return { common: { title: own.title || path.basename(file, '.mp3'), artist: 'Band', track: { no: own.track ?? null } }, format: { duration: 200, bitrate: 320000 } }
  })
  t.after(() => {
    db.close()
    if (previous === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  })
  let tick = Date.now() / 1000 - 1000
  // Writes the file with a modification time of its own (as an edit would give it).
  const write = (name, content = name) => {
    const file = path.join(music, name)
    fs.writeFileSync(file, `synthetic audio ${content}`)
    tick += 10
    fs.utimesSync(file, tick, tick)
    return file
  }
  const row = file => db.prepare('SELECT * FROM tracks WHERE file_path = ?').get(file)
  return { db, music, tags, reads, write, row }
}

test('a scan reads only new and changed files; a changed file keeps its library entry', async t => {
  const { reads, write, row } = fixture(t)
  const a = write('a.mp3')
  write('b.mp3')
  await scanFolder(path.dirname(a))
  assert.deepEqual(reads.sort(), ['a.mp3', 'b.mp3'])
  const id = row(a).id

  reads.length = 0
  await scanFolder(path.dirname(a))
  assert.deepEqual(reads, [], 'an unchanged library reads no tags')

  write('a.mp3', 'retagged')
  await scanFolder(path.dirname(a))
  assert.deepEqual(reads, ['a.mp3'])
  assert.equal(row(a).id, id)

  // Once more: the changed file is up to date now (its id no longer matches its hash).
  reads.length = 0
  await scanFolder(path.dirname(a))
  assert.deepEqual(reads, [])
})

test('a file Lokal wrote into itself is not read again', async t => {
  const { db, reads, write, row } = fixture(t)
  const a = write('a.mp3')
  await scanFolder(path.dirname(a))
  db.prepare('UPDATE tracks SET title = ? WHERE file_path = ?').run('Edited in Lokal', a)
  write('a.mp3', 'comment written')
  noteFileWritten(db, a)
  reads.length = 0
  await scanFolder(path.dirname(a))
  assert.deepEqual(reads, [])
  assert.equal(row(a).title, 'Edited in Lokal')
})

test('watched changes: retagged files are read again, deleted ones leave, renamed ones keep their likes', async t => {
  const { db, music, tags, reads, write, row } = fixture(t)
  const a = write('a.mp3')
  const b = write('b.mp3')
  const c = write('c.mp3')
  await scanFolder(music)
  const ids = { a: row(a).id, b: row(b).id, c: row(c).id }
  db.prepare("INSERT INTO user_likes (user_id, track_id) VALUES ('guest', ?)").run(ids.b)

  // Renumbered by a tag editor; a play (no modification) is ignored.
  tags['a.mp3'] = { track: 7 }
  write('a.mp3', 'renumbered')
  reads.length = 0
  let changes = await applyFileChanges([{ path: a }, { path: c }])
  assert.deepEqual(reads, ['a.mp3'])
  assert.deepEqual(changes, { added: [], updated: [ids.a], removed: [] })
  assert.equal(row(a).track_num, 7)

  // Deleted in Explorer.
  fs.rmSync(c)
  changes = await applyFileChanges([{ path: c, renamed: true }])
  assert.deepEqual(changes.removed, [ids.c])
  assert.equal(row(c), undefined)

  // Renamed in Explorer: the new name joins, the old entry hands it its like.
  const renamed = path.join(music, 'b (renamed).mp3')
  tags['b (renamed).mp3'] = { title: 'b' }
  fs.renameSync(b, renamed)
  changes = await applyFileChanges([{ path: b, renamed: true }, { path: renamed, renamed: true }])
  assert.equal(changes.added.length, 1)
  assert.deepEqual(changes.removed, [ids.b])
  assert.equal(db.prepare('SELECT track_id FROM user_likes').get().track_id, changes.added[0])
})

test('a folder moved into the music folder is read; one moved out leaves', async t => {
  const { music, reads, row } = fixture(t)
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-watch-album-'))
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  fs.writeFileSync(path.join(outside, 'x.mp3'), 'synthetic audio x')
  fs.writeFileSync(path.join(outside, 'y.mp3'), 'synthetic audio y')
  const album = path.join(music, 'Album')
  fs.cpSync(outside, album, { recursive: true })
  let changes = await applyFileChanges([{ path: album, renamed: true }])
  assert.equal(changes.added.length, 2)
  assert.deepEqual(reads.sort(), ['x.mp3', 'y.mp3'])

  fs.rmSync(album, { recursive: true })
  changes = await applyFileChanges([{ path: album, renamed: true }])
  assert.equal(changes.removed.length, 2)
  assert.equal(row(path.join(album, 'x.mp3')), undefined)
})
