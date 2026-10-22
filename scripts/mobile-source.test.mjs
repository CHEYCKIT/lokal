import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { backfillMobileSources } = require('../electron/mobileSource')

test('backfills earlier phone uploads without relabeling desktop originals or explicit sources', () => {
  const db = new DatabaseSync(':memory:')
  const root = path.resolve('fixture-data')
  try {
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY,file_path TEXT,download_source TEXT,liked INTEGER)')
    const add = db.prepare('INSERT INTO tracks VALUES (?,?,?,1)')
    add.run('old-phone', path.join(root, 'phone-downloads', 'song.flac'), null)
    add.run('pc', path.join(root, 'music', 'same-song.flac'), null)
    add.run('sibling', path.join(root, 'phone-downloads-old', 'song.flac'), null)
    add.run('traversal', path.join(root, 'phone-downloads', '..', 'music', 'song.flac'), null)
    add.run('addon', path.join(root, 'phone-downloads', 'addon.flac'), 'a-fixture')
    add.run('ghost', 'ghost://link/song', null)
    assert.equal(backfillMobileSources(db, root), 1)
    assert.equal(backfillMobileSources(db, root), 0)
    assert.equal(db.prepare('SELECT download_source FROM tracks WHERE id=?').get('old-phone').download_source, 'mobile')
    for (const id of ['pc', 'sibling', 'traversal', 'ghost']) {
      assert.equal(db.prepare('SELECT download_source FROM tracks WHERE id=?').get(id).download_source, null)
    }
    assert.equal(db.prepare('SELECT download_source FROM tracks WHERE id=?').get('addon').download_source, 'a-fixture')
    assert.equal(db.prepare('SELECT SUM(liked) AS total FROM tracks').get().total, 6)
  } finally { db.close() }
})
