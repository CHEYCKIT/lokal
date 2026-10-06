import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const { buildRecap, recapTracks, listeningDays } = require('../electron/ipc/recaps.js')

function listening() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, album TEXT, genre TEXT,
    energy REAL, danceability REAL, valence REAL, acousticness REAL, instrumentalness REAL, tempo REAL);
    CREATE TABLE play_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, track_id TEXT NOT NULL, seconds_played INTEGER DEFAULT 0, played_at INTEGER);
    CREATE TABLE user_settings (user_id TEXT, key TEXT, value TEXT, PRIMARY KEY (user_id, key));`)
  const tracks = [
    ['file', '/music/september.flac', 'September'],
    ['yt', 'ghost://youtube/online/Gs069dndIYk', 'Fantasy'],
    ['addon', 'ghost://addon/2805d04035/5345863', 'In the Stone'],
    ['imported', 'ghost://import/abc', 'Imported'],
  ]
  for (const [id, path, title] of tracks) db.prepare('INSERT INTO tracks (id, file_path, title, artist, album) VALUES (?, ?, ?, ?, ?)').run(id, path, title, 'Earth, Wind & Fire', 'I Am')
  const at = Math.floor(Date.UTC(2025, 2, 10, 12) / 1000)
  for (const [i, id] of ['file', 'file', 'yt', 'addon', 'imported'].entries()) db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played, played_at) VALUES (?, ?, ?, ?)').run('guest', id, 200, at + i * 300)
  return db
}

const march = { scope: 'month', year: 2025, month: 3, tz: 'UTC' }
const plays = (db, sources) => buildRecap(db, 'guest', { ...march, sources }).totalPlays

test('a recap counts every playable song, or the library\'s files, or the songs only streamed', () => {
  const db = listening()
  assert.equal(plays(db), 4)
  assert.equal(plays(db, 'all'), 4)
  assert.equal(plays(db, 'library'), 2)
  assert.equal(plays(db, 'streamed'), 2)
  assert.deepEqual(buildRecap(db, 'guest', { ...march, sources: 'streamed' }).topTracks.map(t => t.id).sort(), ['addon', 'yt'])
})

test("an artist's songs and the days with plays follow the same filter", () => {
  const db = listening()
  assert.deepEqual(recapTracks(db, 'guest', { ...march, artist: 'Earth, Wind & Fire', sources: 'library' }).tracks.map(t => t.id), ['file'])
  assert.equal(recapTracks(db, 'guest', { ...march, artist: 'Earth, Wind & Fire' }).tracks.length, 3)
  assert.deepEqual(listeningDays(db, 'guest', { tz: 'UTC', sources: 'streamed' }).days, ['2025-03-10'])
  db.exec("DELETE FROM play_history WHERE track_id IN ('yt', 'addon')")
  assert.deepEqual(listeningDays(db, 'guest', { tz: 'UTC', sources: 'streamed' }).days, [])
})

test('a filtered recap leaves the saved listening profile alone', () => {
  const db = listening()
  buildRecap(db, 'guest', { ...march, sources: 'streamed' })
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_settings WHERE key = 'listening_preferences'").get().n, 0)
  buildRecap(db, 'guest', march)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_settings WHERE key = 'listening_preferences'").get().n, 1)
})
