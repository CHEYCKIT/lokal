import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { followedArtistIds, followedCondition } = require('../electron/followedArtistIds.js')

function library() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE artists (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO artists VALUES ('a1', 'Daft Punk'), ('a2', 'Kroi'), ('a3', 'Westend'), ('a4', 'Ｊｕｓｔｉｃｅ');
  `)
  return db
}

test('the followed artists as library ids, names matched like the app matches them', () => {
  const db = library()
  assert.deepEqual(followedArtistIds(db), [])
  db.prepare("INSERT INTO settings VALUES ('followed_artists', ?)").run(JSON.stringify([' daft punk ', 'Westend', 'Justice', 'Not In Library']))
  assert.deepEqual(followedArtistIds(db).sort(), ['a1', 'a3', 'a4'])
})

test('the condition keeps only followed artists, and nobody when none are followed', () => {
  const db = library()
  const names = () => {
    const { sql, param } = followedCondition(db)
    return db.prepare(`SELECT a.name FROM artists a WHERE ${sql} ORDER BY a.id`).all(param).map(row => row.name)
  }
  assert.deepEqual(names(), [])
  db.prepare("INSERT INTO settings VALUES ('followed_artists', ?)").run(JSON.stringify(['Kroi']))
  assert.deepEqual(names(), ['Kroi'])
  db.prepare("UPDATE settings SET value = 'not json' WHERE key = 'followed_artists'").run()
  assert.deepEqual(names(), [])
})
