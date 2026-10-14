import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const sources = require('../electron/online/sources.js')

function tracksDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT UNIQUE NOT NULL,
      file_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      album_artist TEXT,
      track_num INTEGER,
      year INTEGER,
      genre TEXT,
      duration REAL,
      source_url TEXT,
      artwork_url TEXT,
      last_modified INTEGER
    )
  `)
  return db
}

test('streamed add-on tracks retain their source album id across metadata refreshes', () => {
  const db = tracksDatabase()
  try {
    const item = {
      provider: 'a-0123456789',
      id: 'amazon-track-123',
      title: 'Song',
      artist: 'Artist',
      artists: ['Artist'],
      album: 'Amazon Album',
      albumId: 'B012345678',
      duration: 180,
    }
    const [saved] = sources.saveOnlineTracks(db, [item])
    assert.equal(saved.source_album_id, 'B012345678')

    const [refreshed] = sources.saveOnlineTracks(db, [{ ...item, albumId: null }])
    assert.equal(refreshed.source_album_id, 'B012345678')
  } finally {
    db.close()
  }
})
