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

test('Spicy Lyrics omits empty object entries from static lyrics', () => {
  const result = parse({ Body: { Type: 'Static', Content: [{ Text: '' }, { Text: 'Kept' }] } })
  assert.deepEqual(result.lines.map(line => line.text), ['Kept'])
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

test('Static lyrics omit empty object entries and preserve strings', () => {
  const result = parse({ Body: { Type: 'Static', Content: [{ Text: '' }, {}, null, '', { Text: 'Object line' }, 'String line'] } })
  assert.deepEqual(result.lines.map(line => line.text), ['Object line', 'String line'])
})

test('source migration enables unseen Spicy Lyrics but respects an explicit disable', () => {
  const settings = order => service.readSettings({ prepare: () => ({ all: () => [
    { key: 'lyrics_sources_order', value: JSON.stringify(order) },
    { key: 'lyrics_sources_enabled', value: '["local","betterlyrics"]' },
  ] }) })
  assert.ok(settings(['local', 'betterlyrics']).enabled.includes('spicylyrics'))
  const disabled = settings(['local', 'spicylyrics', 'betterlyrics'])
  assert.deepEqual(disabled.enabled, ['local', 'betterlyrics'])
  assert.deepEqual(disabled.order, ['local', 'spicylyrics', 'betterlyrics'])
})

test('changing either credential retries negative lyrics without persisting credentials or fingerprints', async t => {
  const fs = await import('node:fs')
  const vm = await import('node:vm')
  const filename = require.resolve('../electron/lyrics/service.js')
  const localRequire = createRequire(filename)
  let calls = 0
  const context = vm.createContext({ module: { exports: {} }, require: id => id === './repository'
    ? { ...localRequire(id), lookup: async () => { calls++; return { result: null, attempts: {} } } }
    : localRequire(id) })
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  const current = context.module.exports
  const db = new Database(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, instrumental INTEGER);
    CREATE TABLE lyrics_cache (track_id TEXT PRIMARY KEY, lyrics_type TEXT, content TEXT, source TEXT, fetched_at INTEGER, file_path TEXT, meta TEXT);`)
  const set = db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)')
  set.run('spicylyrics_api_key', 'synthetic-key-one')
  set.run('spotify_sp_dc', 'synthetic-cookie-one')
  const args = { trackId: 'one', title: 'Song', artist: 'Artist' }
  await current.getLyrics(db, args)
  await current.getLyrics(db, args)
  assert.equal(calls, 1)
  const first = current.readSettings(db).settingsKey
  set.run('spicylyrics_api_key', 'synthetic-key-two')
  await current.getLyrics(db, args)
  assert.equal(calls, 2)
  assert.notEqual(current.readSettings(db).settingsKey, first)
  set.run('spotify_sp_dc', 'synthetic-cookie-two')
  await current.getLyrics(db, args)
  await current.getLyrics(db, args)
  assert.equal(calls, 3)
  const meta = db.prepare('SELECT meta FROM lyrics_cache').get().meta
  assert.equal(JSON.parse(meta).settingsKey, undefined)
  assert.equal(meta.includes('synthetic-'), false)
  assert.equal(current.readSettings(db).settingsKey.includes('synthetic-'), false)
})

test('legacy source settings migrate Spicy Lyrics without overriding an explicit disable', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
  const put = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  put.run('lyrics_sources_order', JSON.stringify(['betterlyrics', 'lrclib', 'spicylyrics']))
  put.run('lyrics_sources_enabled', JSON.stringify(['betterlyrics', 'lrclib']))
  put.run('spicylyrics_api_key', 'secret-one')
  put.run('spotify_sp_dc', 'cookie-one')
  const explicit = service.readSettings(db)
  assert.equal(explicit.enabled.includes('spicylyrics'), false)
  assert.equal(explicit.settingsKey.includes('secret-one'), false)
  assert.equal(explicit.settingsKey, service.readSettings(db).settingsKey)
  put.run('lyrics_sources_order', JSON.stringify(['betterlyrics', 'lrclib']))
  const legacy = service.readSettings(db)
  assert.equal(legacy.enabled.includes('spicylyrics'), true)
  put.run('spicylyrics_api_key', 'secret-two')
  assert.notEqual(legacy.settingsKey, service.readSettings(db).settingsKey)
  db.close()
})
