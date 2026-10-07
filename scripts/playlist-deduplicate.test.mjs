import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { deduplicatePlaylist } = require('../electron/playlists/deduplicate.js')

function db() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE playlists (id TEXT PRIMARY KEY, smart_rules TEXT);
    CREATE TABLE playlist_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id TEXT, track_id TEXT, position INTEGER);
  `)
  return database
}

test('deduplicating a playlist keeps its first song occurrence and original order', () => {
  const database = db()
  database.prepare('INSERT INTO playlists (id, smart_rules) VALUES (?, NULL)').run('playlist-1')
  const add = database.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
  for (const [track, position] of [['a', 1], ['b', 2], ['a', 3], ['c', 4], ['b', 5], ['a', 6]]) add.run('playlist-1', track, position)
  assert.deepEqual(deduplicatePlaylist(database, 'playlist-1'), { ok: true, removed: 3, remaining: 3 })
  assert.deepEqual(database.prepare('SELECT track_id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all('playlist-1'), [
    { track_id: 'a', position: 1 }, { track_id: 'b', position: 2 }, { track_id: 'c', position: 4 },
  ])
  database.close()
})

test('deduplication does not touch another playlist and reports empty playlists cleanly', () => {
  const database = db()
  database.prepare('INSERT INTO playlists (id, smart_rules) VALUES (?, NULL), (?, NULL)').run('playlist-1', 'playlist-2')
  const add = database.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)')
  add.run('playlist-1', 'same', 1); add.run('playlist-1', 'same', 2); add.run('playlist-2', 'same', 1); add.run('playlist-2', 'same', 2)
  assert.deepEqual(deduplicatePlaylist(database, 'playlist-1'), { ok: true, removed: 1, remaining: 1 })
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ?').get('playlist-2').count, 2)
  assert.deepEqual(deduplicatePlaylist(database, 'playlist-1'), { ok: true, removed: 0, remaining: 1 })
  assert.deepEqual(deduplicatePlaylist(database, 'missing'), { error: 'Playlist not found', removed: 0 })
  database.close()
})

test('smart playlists are not mutated by a regular-playlist maintenance action', () => {
  const database = db()
  database.prepare('INSERT INTO playlists (id, smart_rules) VALUES (?, ?)').run('smart-1', '{"rules":[]}')
  assert.deepEqual(deduplicatePlaylist(database, 'smart-1'), { error: 'Smart playlists cannot be deduplicated.', removed: 0 })
  database.close()
})


test('desktop IPC removes duplicates and reports no duplicates on a second pass', t => {
  const database = db()
  t.after(() => database.close())
  database.exec("INSERT INTO playlists VALUES ('playlist-1', NULL); INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('playlist-1', 'a', 0), ('playlist-1', 'b', 1), ('playlist-1', 'a', 2)")
  const filename = require.resolve('../electron/ipc/scanner.js')
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  const context = vm.createContext({
    require: id => id === './db' ? { getDB: () => database } : id === 'electron' ? {} : localRequire(id),
    module, console, process, Buffer, URL, setTimeout, clearTimeout,
  })
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  const handlers = new Map()
  module.exports.registerScannerHandlers({ handle: (name, handler) => handlers.set(name, handler) })
  const invoke = playlistId => handlers.get('scanner:deduplicatePlaylist')(null, playlistId)
  assert.deepEqual(invoke('playlist-1'), { ok: true, removed: 1, remaining: 2 })
  assert.deepEqual(invoke('playlist-1'), { ok: true, removed: 0, remaining: 2 })
  assert.deepEqual(invoke('missing'), { error: 'Playlist not found', removed: 0 })
  assert.deepEqual(database.prepare('SELECT track_id, position FROM playlist_tracks ORDER BY position').all(), [{ track_id: 'a', position: 0 }, { track_id: 'b', position: 1 }])
})
