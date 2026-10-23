import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { repairPhoneCopyFilenames } = require('../electron/phoneCopyFilenames')

test('repairs existing UUID filenames without changing song IDs, likes or audio', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-phone-legacy-'))
  const db = new DatabaseSync(':memory:')
  try {
    const directory = path.join(root, 'phone-downloads')
    await fs.mkdir(directory)
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT UNIQUE, title TEXT, artist TEXT, liked INTEGER)')
    const original = path.join(directory, '5855e467-d50b-45e1-a500-9c70289ab873.flac')
    const sameName = path.join(directory, 'The Motion Epic - Love Somebody.flac')
    await fs.writeFile(original, 'flac original bytes')
    await fs.writeFile(sameName, 'existing different music')
    db.prepare('INSERT INTO tracks VALUES (?,?,?,?,?)').run(
      'existing-track-id', original, 'Love Somebody', 'The Motion Epic', 1,
    )
    assert.equal(repairPhoneCopyFilenames(db, root), 1)
    const row = db.prepare('SELECT * FROM tracks WHERE id=?').get('existing-track-id')
    assert.equal(row.id, 'existing-track-id')
    assert.equal(row.liked, 1)
    assert.equal(path.basename(row.file_path), 'The Motion Epic - Love Somebody (2).flac')
    assert.equal(await fs.readFile(row.file_path, 'utf8'), 'flac original bytes')
    assert.equal(await fs.readFile(sameName, 'utf8'), 'existing different music')
    await assert.rejects(fs.stat(original), { code: 'ENOENT' })
    assert.equal(repairPhoneCopyFilenames(db, root), 0)
  } finally {
    db.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('does not touch UUID-named music outside the phone upload folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-phone-other-'))
  const db = new DatabaseSync(':memory:')
  try {
    const elsewhere = path.join(root, 'original-library')
    await fs.mkdir(elsewhere)
    const original = path.join(elsewhere, '5855e467-d50b-45e1-a500-9c70289ab873.flac')
    await fs.writeFile(original, 'original untouched')
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT UNIQUE, title TEXT, artist TEXT)')
    db.prepare('INSERT INTO tracks VALUES (?,?,?,?)').run('original', original, 'Song', 'Artist')
    assert.equal(repairPhoneCopyFilenames(db, root), 0)
    assert.equal(db.prepare('SELECT file_path FROM tracks').get().file_path, original)
    assert.equal(await fs.readFile(original, 'utf8'), 'original untouched')
  } finally {
    db.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
