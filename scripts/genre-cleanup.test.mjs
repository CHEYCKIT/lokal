import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { genreKey as uiGenreKey, splitGenres as splitUiGenres } from '../src/genres.js'

const require = createRequire(import.meta.url)
const {
  normalizeGenreName,
  trackGenres,
  registerGenreFunctions,
  genreSummary,
} = require('../electron/genreList.js')

function fakeDb(rows) {
  let hasGenre
  return {
    function(name, options, fn) {
      assert.equal(name, 'lokal_has_genre')
      hasGenre = fn
    },
    prepare(sql) {
      assert.match(sql, /SELECT id, genre, genres, artwork_path FROM tracks/)
      return { all: () => rows }
    },
    get hasGenre() { return hasGenre },
  }
}

test('genre synonyms and subgenres fold into broad canonical categories', () => {
  assert.equal(normalizeGenreName('VGM'), 'Video Game Music')
  assert.equal(normalizeGenreName('video game'), 'Video Game Music')
  assert.equal(normalizeGenreName('Video Game Soundtrack'), 'Video Game Music')
  assert.equal(normalizeGenreName('Original Soundtrack'), 'Soundtrack')
  assert.equal(normalizeGenreName('EDM'), 'Electronic')
  assert.equal(normalizeGenreName('Techno'), 'Electronic')
  assert.equal(normalizeGenreName('Indie Rock'), 'Rock')
  assert.equal(normalizeGenreName('Hip-Hop'), 'Hip-Hop')
  assert.equal(normalizeGenreName('R&B'), 'R&B / Soul')
})

test('genre editor treats synonyms as one choice while preserving the first raw label', () => {
  assert.equal(uiGenreKey('VGM'), uiGenreKey('Video Game Music'))
  assert.equal(uiGenreKey('Video Game'), uiGenreKey('Video Game Music'))
  assert.deepEqual(splitUiGenres('VGM, Video Game, Video Game Music'), ['VGM'])
})

test('invalid and non-genre metadata values are ignored', () => {
  assert.equal(normalizeGenreName('Karaoke_Plain'), null)
  assert.equal(normalizeGenreName('Instrumental'), null)
  assert.equal(normalizeGenreName('Unknown'), null)
  assert.equal(normalizeGenreName('255'), null)
  assert.deepEqual(trackGenres({ genre: 'Karaoke_Plain', genres: 'Unknown, 255, Instrumental' }), [])
})

test('Genres summary merges aliases and folds singleton categories into Other', () => {
  const rows = [
    { id: '1', genre: 'VGM', genres: '', artwork_path: '/covers/1.jpg' },
    { id: '2', genre: 'video game', genres: '', artwork_path: '/covers/2.jpg' },
    { id: '3', genre: 'Rock', genres: 'EDM', artwork_path: '/covers/3.jpg' },
    { id: '4', genre: 'Classic Rock', genres: '', artwork_path: '/covers/4.jpg' },
    { id: '5', genre: 'Indie Rock', genres: 'Techno', artwork_path: '/covers/5.jpg' },
    { id: '6', genre: 'House', genres: '', artwork_path: '/covers/6.jpg' },
    { id: '7', genre: 'Random Tag One', genres: '', artwork_path: '/covers/7.jpg' },
    { id: '8', genre: 'Random Tag Two', genres: '', artwork_path: '/covers/8.jpg' },
    { id: '9', genre: 'Baroque', genres: '', artwork_path: '/covers/9.jpg' },
    { id: '10', genre: 'Karaoke_Plain', genres: 'Unknown, 128', artwork_path: null },
    { id: '11', genre: 'Unknown', genres: '', artwork_path: null },
  ]
  const db = fakeDb(rows)
  registerGenreFunctions(db)
  const summary = genreSummary(db)
  const byName = Object.fromEntries(summary.genres.map(item => [item.name, item]))
  assert.equal(byName['Video Game Music'].count, 2)
  assert.equal(byName.Rock.count, 3)
  assert.equal(byName.Electronic.count, 3)
  assert.equal(byName.Other.count, 3, 'two unrecognized tags plus one singleton classical tag')
  assert.equal(byName.Classical, undefined, 'singleton classical category is folded into Other')
  assert.equal(summary.none, 2)
  assert.equal(summary.genres.some(item => item.count === 1), false, 'no one-track genre cards remain')
  assert.equal(db.hasGenre('VGM', '', 'Video Game Music'), 1)
  assert.equal(db.hasGenre('video game', '', 'Video Game Music'), 1)
  assert.equal(db.hasGenre('Baroque', '', 'Other'), 1)
  assert.equal(db.hasGenre('Baroque', '', 'Classical'), 0, 'singleton category is folded into Other')
  assert.equal(db.hasGenre('Karaoke_Plain', 'Unknown, 128', ''), 1)
})
