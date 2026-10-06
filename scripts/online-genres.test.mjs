import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const genres = require('../electron/online/genres.js')

const itunes = (results, calls = []) => async url => { calls.push(String(url)); return { ok: true, json: async () => ({ results }) } }

function db() {
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, genre TEXT);
    CREATE TABLE play_history (id INTEGER PRIMARY KEY, user_id TEXT, track_id TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`)
  const add = d.prepare('INSERT INTO tracks (id, file_path, title, artist, genre) VALUES (?, ?, ?, ?, ?)')
  add.run('yt', 'ghost://youtube/online/Gs069dndIYk', 'September (2018 Remaster)', 'Earth, Wind & Fire', null)
  add.run('addon', 'ghost://addon/2805d04035/1', 'Canopus', 'Premier Contact', null)
  add.run('file', '/music/a.flac', 'Fantasy', 'Earth, Wind & Fire', null)
  d.prepare("INSERT INTO play_history (user_id, track_id) VALUES ('u', 'yt'), ('u', 'file')").run()
  return d
}

test("iTunes' genre is taken from a song by that artist, not another one's", async () => {
  const results = [
    { artistName: 'The Cover Band', trackName: 'September', primaryGenreName: 'Pop' },
    { artistName: 'Earth, Wind & Fire', trackName: 'September', primaryGenreName: 'R&B/Soul' },
  ]
  const calls = []
  assert.equal(await genres.itunesGenre('September (2018 Remaster)', 'Earth, Wind & Fire', { fetchImpl: itunes(results, calls) }), 'R&B/Soul')
  assert.match(decodeURIComponent(calls[0]).replace(/\+/g, ' '), /term=Earth, Wind & Fire September&/)
  assert.equal(await genres.itunesGenre('September', 'Someone Else', { fetchImpl: itunes(results) }), null)
})

test('a streamed song played before gets its genre kept; library files and songs with one are left alone', async () => {
  genres._forget()
  const d = db()
  const calls = []
  await genres.backfillOnlineGenres(d, { fetchImpl: itunes([{ artistName: 'Earth, Wind & Fire', trackName: 'September', primaryGenreName: 'R&B/Soul' }], calls), gapMs: 0 })
  assert.equal(d.prepare("SELECT genre FROM tracks WHERE id = 'yt'").get().genre, 'R&B/Soul')
  assert.equal(d.prepare("SELECT genre FROM tracks WHERE id = 'file'").get().genre, null)
  assert.equal(d.prepare("SELECT genre FROM tracks WHERE id = 'addon'").get().genre, null) // never played
  assert.equal(calls.length, 1)
})

test('the details panel asks for one song; each is looked up once; off with "Fetch Online Artwork"', async () => {
  genres._forget()
  const d = db()
  const calls = []
  const fetchImpl = itunes([{ artistName: 'Premier Contact', trackName: 'Canopus', primaryGenreName: 'Electronic' }], calls)
  assert.equal(await genres.trackGenre(d, 'addon', { fetchImpl }), 'Electronic')
  assert.equal(await genres.trackGenre(d, 'addon', { fetchImpl }), 'Electronic')
  assert.equal(calls.length, 1)
  assert.equal(await genres.trackGenre(d, 'file', { fetchImpl }), null)
  genres._forget()
  d.exec("UPDATE tracks SET genre = NULL; INSERT INTO settings VALUES ('fetch_online_artwork', '0')")
  assert.equal(await genres.trackGenre(d, 'addon', { fetchImpl }), null)
  assert.equal(calls.length, 1)
})
