import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { findPhonePlaceholder } = require('../server/linkUploadMatch')

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration REAL, file_path TEXT)')
  const insert = db.prepare('INSERT INTO tracks VALUES (?,?,?,?,?)')
  insert.run('ghost', '  駅   Live ', 'ARTIST', 181, 'ghost://link/ghost')
  insert.run('local', 'Song', 'Artist', 200, '/music/song.flac')
  insert.run('streamed', 'Other', 'Artist', 200, 'ghost://stream/other')
  return db
}
test('promotes the existing placeholder without registering link_normalize', () => {
  const db = fixture()
  try {
    assert.throws(() => db.prepare("SELECT link_normalize('x')").get(), /no such function/)
    assert.equal(findPhonePlaceholder(db, '駅 live', 'artist', 180)?.id, 'ghost')
  } finally { db.close() }
})
test('a replacement database connection also needs no LinkStore initialization', () => {
  for (let i=0;i<2;i++) {
    const db = fixture()
    try { assert.equal(findPhonePlaceholder(db, '駅 live', 'artist', 180)?.id, 'ghost') }
    finally { db.close() }
  }
})
test('does not promote local files, unrelated streams, other artists or durations', () => {
  const db = fixture()
  try {
    for (const args of [['Song','Artist',200], ['Other','Artist',200], ['駅 Live','Other',180], ['駅 Live','Artist',200]]) {
      assert.equal(findPhonePlaceholder(db, ...args), null)
    }
  } finally { db.close() }
})
