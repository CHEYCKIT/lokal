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

test("Fill In Genres: one lookup per album, by that artist, for files and streams; songs without an album by title", async () => {
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, album TEXT, album_artist TEXT, genre TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`)
  const add = d.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)')
  add.run('a1', '/m/1.flac', 'In the Stone', 'Earth, Wind & Fire', 'I Am', 'Earth, Wind & Fire', null)
  add.run('a2', '/m/2.flac', 'Star', 'Earth, Wind & Fire', 'I Am (Expanded Edition)', 'Earth, Wind & Fire', null)
  add.run('a3', 'ghost://youtube/online/x', 'Wait', 'Earth, Wind & Fire', 'I Am', 'Earth, Wind & Fire', null)
  add.run('b1', '/m/3.flac', 'Loose Song', 'Basia', null, null, null)
  add.run('c1', '/m/4.flac', 'Kept', 'Basia', 'Time and Tide', null, 'Jazz')
  add.run('imp', 'ghost://import/z', 'Imported', 'Basia', 'Time and Tide', null, null)
  const calls = []
  const fetchImpl = async url => {
    calls.push(decodeURIComponent(String(url)).replace(/\+/g, ' '))
    const results = /entity=album/.test(url)
      ? [{ artistName: 'Someone Else', collectionName: 'I Am', primaryGenreName: 'Rock' }, { artistName: 'Earth, Wind & Fire', collectionName: 'I Am', primaryGenreName: 'R&B/Soul' }]
      : [{ artistName: 'Basia', trackName: 'Loose Song', primaryGenreName: 'Pop' }]
    return { ok: true, json: async () => ({ results }) }
  }
  genres.startLibraryGenres(d, { fetchImpl, gapMs: 0 })
  for (let i = 0; i < 50 && genres.libraryGenresStatus().running; i++) await new Promise(r => setTimeout(r, 10))
  const status = genres.libraryGenresStatus()
  assert.equal(status.running, false)
  assert.equal(status.total, 2) // the album (three songs, an edition named apart) and the loose song
  assert.equal(status.updated, 4)
  assert.deepEqual(d.prepare("SELECT id, genre FROM tracks ORDER BY id").all().map(r => [r.id, r.genre]), [['a1', 'R&B/Soul'], ['a2', 'R&B/Soul'], ['a3', 'R&B/Soul'], ['b1', 'Pop'], ['c1', 'Jazz'], ['imp', null]])
  assert.equal(calls.length, 2)
})

test('"Music" counts as no genre: it gets looked up and replaced; iTunes answering "Music" is no answer', async () => {
  assert.equal(genres.noGenre('Music'), true)
  assert.equal(genres.noGenre(' music '), true)
  assert.equal(genres.noGenre('Electronic'), false)
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, album TEXT, album_artist TEXT, genre TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`)
  d.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)').run('m1', '/m/1.mp3', 'Canopus', 'Premier Contact', 'Hamburger Galaxy', null, 'Music')
  d.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)').run('m2', '/m/2.mp3', 'Other', 'Nobody', 'Nothing', null, 'Music')
  const fetchImpl = async url => ({ ok: true, json: async () => ({ results: /Premier/.test(decodeURIComponent(String(url))) && /entity=album/.test(url)
    ? [{ artistName: 'Premier Contact', collectionName: 'Hamburger Galaxy', primaryGenreName: 'Electronic' }]
    : [{ artistName: 'Nobody', collectionName: 'Nothing', trackName: 'Other', primaryGenreName: 'Music' }] }) })
  genres.startLibraryGenres(d, { fetchImpl, gapMs: 0 })
  for (let i = 0; i < 50 && genres.libraryGenresStatus().running; i++) await new Promise(r => setTimeout(r, 10))
  assert.deepEqual(d.prepare('SELECT id, genre FROM tracks ORDER BY id').all().map(r => [r.id, r.genre]), [['m1', 'Electronic'], ['m2', 'Music']])
})
