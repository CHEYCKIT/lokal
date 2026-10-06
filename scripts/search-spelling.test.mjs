import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const { correctSpelling } = require('../electron/librarySearch.js')
const youtube = require('../electron/online/youtube.js')
const { spelling } = require('../electron/online/spelling.js')

function library(rows) {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE tracks (id TEXT, file_path TEXT, title TEXT, artist TEXT, album TEXT, album_artist TEXT, play_count INT)')
  const add = db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, 0)')
  rows.forEach((row, i) => add.run(String(i), row.file_path || `/music/${i}.flac`, row.title, row.artist, row.album || null, row.album_artist || null))
  return db
}
const db = library([
  { title: 'Billie Jean', artist: 'Michael Jackson', album: 'Thriller' },
  { title: 'September', artist: 'Earth, Wind & Fire', album: 'The Best Of' },
  { title: 'Ghost Song', artist: 'Mitchell Jackson', file_path: 'ghost://youtube/online/abcdefghijk' },
])

test("typos are corrected to the library's own words", () => {
  assert.equal(correctSpelling(db, 'micheal jackson'), 'michael jackson')
  assert.equal(correctSpelling(db, 'thriler'), 'thriller')
  assert.equal(correctSpelling(db, 'erth wind fire'), 'earth wind fire')
  assert.equal(correctSpelling(db, 'micheal jackson billie'), 'michael jackson billie')
})

test('nothing to correct: found as typed, short words, nothing close, streamed songs ignored', () => {
  assert.equal(correctSpelling(db, 'michael jackson'), null)
  assert.equal(correctSpelling(db, 'mich'), null) // part of a word: found as typed
  assert.equal(correctSpelling(db, 'beyonce'), null)
  assert.equal(correctSpelling(db, 'mitchel'), null) // only a streamed song has "mitchell"
})

const response = corrected => ({ ok: true, json: async () => ({ contents: { showingResultsForRenderer: { correctedQuery: { runs: [{ text: corrected.split(' ')[0], italics: true }, { text: ` ${corrected.split(' ').slice(1).join(' ')}` }] }, originalQuery: { runs: [{ text: 'x' }] } } } }) })
const page = { ok: true, text: async () => 'ytcfg.set({"VISITOR_DATA":"v"});' }

test("YouTube Music's correction is read from its search", async () => {
  const fetchImpl = async url => (url.endsWith('/') ? page : response('beyoncé knowles'))
  assert.equal(await youtube.spellCheck('beyonse knowles', { fetchImpl }), 'beyoncé knowles')
  assert.equal(await youtube.spellCheck('ok', { fetchImpl }), null)
})

test("the library's spelling first, then YouTube Music's, none when found as typed", async () => {
  let asked = 0
  const fetchImpl = async url => { if (url.endsWith('/')) return page; asked++; return response('frank ocean') }
  assert.deepEqual(await spelling(db, 'micheal jackson', { fetchImpl }), { corrected: 'michael jackson', source: 'library' })
  assert.deepEqual(await spelling(db, 'michael jackson', { fetchImpl }), { corrected: null })
  assert.equal(asked, 0)
  assert.deepEqual(await spelling(db, 'frank ocaen', { fetchImpl }), { corrected: 'frank ocean', source: 'youtube' })
})
