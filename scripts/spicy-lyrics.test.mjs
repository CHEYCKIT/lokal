import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = require('../electron/lyrics/providers/spicyLyrics.js')
const { sequenceFor } = require('../electron/lyrics/repository.js')
const service = require('../electron/lyrics/service.js')
const Database = require('better-sqlite3')

test('Spicy Lyrics syllable responses preserve timings, background words, and required attribution', () => {
  const result = parse({
    Body: {
      Type: 'Syllable',
      source: 'spicy_lyrics',
      Content: [{
        Lead: {
          StartTime: 1.25,
          EndTime: 2.4,
          Syllables: [
            { Text: 'Hello', StartTime: 1.25, EndTime: 1.8, IsPartOfWord: true },
            { Text: ' world', StartTime: 1.8, EndTime: 2.4, IsPartOfWord: false },
          ],
        },
        Background: [{ Syllables: [{ Text: 'oh', StartTime: 1.5, EndTime: 1.8, IsPartOfWord: false }] }],
      }],
      UploadAttribution: {
        Uploader: { username: 'uploader', url: 'https://spicylyrics.org/uid/1' },
        Maker: { username: 'maker', url: 'https://spicylyrics.org/uid/2' },
      },
    },
  })

  assert.equal(result.lines[0].time, 1.25)
  assert.equal(result.lines[0].end, 2.4)
  assert.deepEqual(result.lines[0].words.map(word => word.word), ['Hello', 'world'])
  assert.equal(result.lines[0].bgWords[0].word, 'oh')
  assert.deepEqual(result.attribution, {
    provider: 'Spicy Lyrics',
    uploader: { name: 'uploader', url: 'https://spicylyrics.org/uid/1' },
    maker: { name: 'maker', url: 'https://spicylyrics.org/uid/2' },
  })
})

test('Spicy Lyrics commercial responses do not invent contributor credits', () => {
  const result = parse({ Body: { Type: 'Line', source: 'apple_music', Content: [{ Text: 'A line', StartTime: 3, EndTime: 4 }] } })
  assert.equal(result.attribution.provider, 'Apple Music')
  assert.equal(result.attribution.uploader, null)
  assert.equal(result.attribution.maker, null)
})

test('Spicy Lyrics is inserted before BetterLyrics for legacy source orders', () => {
  const order = sequenceFor(['local', 'betterlyrics', 'betterlyrics_qq', 'lrclib'], [
    'local', 'betterlyrics', 'betterlyrics_qq', 'lrclib', 'spicylyrics',
  ])
  assert.ok(order.indexOf('spicylyrics') < order.indexOf('betterlyrics'))
})

test('a manually selected source remains pinned per track in the lyrics cache', async () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, instrumental INTEGER DEFAULT 0);
    CREATE TABLE lyrics_cache (track_id TEXT PRIMARY KEY, lyrics_type TEXT, content TEXT, source TEXT, fetched_at INTEGER, file_path TEXT, meta TEXT);
  `)
  db.prepare('INSERT INTO tracks (id, file_path) VALUES (?, ?)').run('track-1', '/music/song.flac')
  db.prepare('INSERT INTO lyrics_cache (track_id, lyrics_type, content, source, fetched_at, file_path, meta) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'track-1', 'synced', JSON.stringify([{ time: 1, end: 2, text: 'Pinned', words: [] }]), 'betterlyrics', Date.now(), '/music/song.flac',
    JSON.stringify({ v: 2, sync: 'line', pinned: true, attempts: { betterlyrics: 'line' } }),
  )
  const lyrics = await service.getLyrics(db, { trackId: 'track-1', title: 'Song', artist: 'Artist', duration: 2 })
  assert.equal(lyrics.source, 'betterlyrics')
  assert.equal(lyrics.pinned, true)
  db.close()
})
