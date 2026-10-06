import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const { artistPlays } = require('../electron/ipc/recaps.js')

function library() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, album TEXT, album_artist TEXT);
    CREATE TABLE artists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE artist_track_links (artist_id TEXT, track_id TEXT);
    CREATE TABLE play_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, track_id TEXT, seconds_played INTEGER, played_at INTEGER);`)
  db.prepare("INSERT INTO artists VALUES ('a-ewf', 'Earth, Wind & Fire'), ('a-other', 'Earth')").run()
  const add = db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?)')
  add.run('file', '/music/september.flac', 'September', 'Earth, Wind & Fire', 'The Best of', null)
  add.run('yt-1', 'ghost://youtube/online/aaaaaaaaaaa', 'Fantasy', 'Earth, Wind & Fire', 'All n All', 'Earth, Wind & Fire')
  add.run('yt-2', 'ghost://youtube/online/bbbbbbbbbbb', 'Boogie Wonderland', 'Earth, Wind & Fire, The Emotions', 'I Am', 'Earth, Wind & Fire')
  add.run('yt-3', 'ghost://youtube/online/ccccccccccc', 'Earthquake', 'Earth', null, 'Earth')
  add.run('imported', 'ghost://import/x', 'Imported', 'Earth, Wind & Fire', null, null)
  db.prepare("INSERT INTO artist_track_links VALUES ('a-ewf', 'file'), ('a-other', 'yt-3')").run()
  const play = db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played, played_at) VALUES (?, ?, ?, 0)')
  for (const [user, id, secs] of [['u', 'file', 200], ['u', 'file', 200], ['u', 'file', 10], ['u', 'yt-1', 200], ['u', 'yt-2', 200], ['u', 'yt-3', 200], ['u', 'imported', 200], ['v', 'file', 200]]) play.run(user, id, secs)
  return db
}

test("an artist's plays: their files and the songs streamed under their name, 30 s or more, this user's", () => {
  const result = artistPlays(library(), 'u', 'a-ewf')
  assert.equal(result.plays, 4)
  assert.equal(result.streamed, 2)
  assert.deepEqual(result.topTracks.map(t => [t.title, t.plays]), [['September', 2], ['Boogie Wonderland', 1], ['Fantasy', 1]])
  assert.equal(result.topTracks[0].title, 'September')
})

test("a namesake's songs aren't counted, and an unknown artist says so", () => {
  const db = library()
  assert.equal(artistPlays(db, 'u', 'a-other').plays, 1)
  assert.ok(artistPlays(db, 'u', 'a-missing').error)
})

test("one song's plays: this user's, 30 s or more, streamed or not", async () => {
  const { trackPlays } = require('../electron/ipc/recaps.js')
  const db = library()
  assert.equal(trackPlays(db, 'u', 'file').plays, 2)
  assert.equal(trackPlays(db, 'u', 'yt-1').plays, 1)
  assert.equal(trackPlays(db, 'v', 'yt-1').plays, 0)
})
