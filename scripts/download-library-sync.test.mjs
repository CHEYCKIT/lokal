import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { initDB, getDB } = require('../electron/ipc/db.js')
const { indexSingleFile } = require('../electron/ipc/scanner.js')
const { DownloadManager } = require('../electron/download/manager.js')
const mm = require('music-metadata')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-library-sync-'))
  const previousDir = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = dir
  initDB()
  const db = getDB()
  t.after(() => {
    db.close()
    if (previousDir === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previousDir
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const filepath = path.join(dir, 'song.flac')
  fs.writeFileSync(filepath, 'synthetic audio; metadata parser mocked')
  const add = (id, file, title = 'Song', artist = 'Artist', duration = 200) => {
    db.prepare('INSERT INTO tracks (id, file_path, file_hash, title, artist, duration) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, file, id, title, artist, duration)
  }
  return { db, filepath, add }
}

for (const [stored, current, rejected] of [[100, 200, false], [200, 100, true]]) {
  test(`changed-file duration uses ${current}s instead of stored ${stored}s`, async t => {
    const { db, filepath, add } = fixture(t)
    add('existing', filepath, 'Old title', 'Artist', stored)
    const parse = t.mock.method(mm, 'parseFile', async () => ({ format: { duration: current } }))
    const result = await indexSingleFile(filepath, { metadata: { title: 'Song', duration: 200 } })
    assert.equal(parse.mock.callCount(), 1)
    if (rejected) {
      assert.match(result.error, /duration does not match/)
      assert.equal(db.prepare('SELECT title FROM tracks').get().title, 'Old title')
    } else {
      assert.equal(result.id, 'existing')
      assert.equal(result.repaired, true)
    }
  })
}

test('unchanged-file duration avoids parsing and artist repairs refresh links', async t => {
  const { db, filepath, add } = fixture(t)
  add('existing', filepath, 'Song', 'Old artist')
  const stat = fs.statSync(filepath)
  const hash = 't-' + crypto.createHash('sha256').update(filepath + stat.size + stat.mtimeMs).digest('hex').slice(0, 16)
  db.prepare('UPDATE tracks SET file_hash = ?').run(hash)
  db.exec("INSERT INTO artists (id, name) VALUES ('old', 'Old artist'); INSERT INTO artist_track_links VALUES ('old', 'existing')")
  const parse = t.mock.method(mm, 'parseFile', async () => { throw new Error('Unexpected parsing') })
  const result = await indexSingleFile(filepath, { metadata: { artist: 'New Artist feat. Guest', album: 'Album', duration: 200 } })
  assert.equal(result.repaired, true)
  assert.equal(parse.mock.callCount(), 0)
  assert.deepEqual(db.prepare('SELECT artist, album FROM tracks').get(), { artist: 'New Artist feat. Guest', album: 'Album' })
  assert.deepEqual(db.prepare('SELECT name FROM artists JOIN artist_track_links ON artist_id = artists.id WHERE track_id = ? ORDER BY name').all('existing').map(r => r.name), ['Guest', 'New Artist'])
  assert.equal(db.prepare("SELECT id FROM artists WHERE id = 'old'").get(), undefined)
})

test('changed-file parse failure leaves existing metadata intact', async t => {
  const { db, filepath, add } = fixture(t)
  add('existing', filepath)
  t.mock.method(mm, 'parseFile', async () => { throw new Error('Invalid audio') })
  const result = await indexSingleFile(filepath, { metadata: { title: 'Replacement', duration: 200 } })
  assert.match(result.error, /Failed to parse/)
  assert.equal(db.prepare('SELECT title FROM tracks').get().title, 'Song')
})

function downloadFixture(t, indexResult, mismatch = true) {
  const fixtureData = fixture(t)
  const { db, filepath, add } = fixtureData
  add('target', filepath)
  add('g1', 'ghost://import/list/1')
  add('g2', 'ghost://import/list/2', mismatch ? 'Different song' : 'Song')
  add('streamed', 'ghost://youtube/online/aaaaaaaaaaa')
  db.exec(`INSERT INTO playlists (id, name) VALUES ('p', 'Playlist');
    INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p', 'g1', 0), ('p', 'g2', 1), ('p', 'streamed', 2);
    INSERT INTO user_likes (user_id, track_id) VALUES ('guest', 'g1');
    INSERT INTO play_history (user_id, track_id) VALUES ('guest', 'g1');
    INSERT INTO artists (id, name) VALUES ('artist', 'Artist');
    INSERT INTO artist_track_links VALUES ('artist', 'target');
    UPDATE tracks SET source_url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa' WHERE id = 'streamed';`)
  const mgr = new DownloadManager()
  let notified = 0
  mgr.deps = { getDB: () => db, index: async () => ({ id: 'target', ...indexResult }), onLibraryUpdated: () => { notified++ } }
  mgr.update = (job, patch) => Object.assign(job, patch)
  const job = {
    kind: 'single', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    opts: { replaceImported: ['g1', 'g2', 'g1'], replaceTrackId: 'streamed' },
    indexedTracks: [], outputLines: [], thumbnail: 'data:synthetic',
  }
  return { ...fixtureData, mgr, job, notifications: () => notified }
}

for (const indexResult of [{ success: true }, { skipped: true }, { duplicate: true }]) {
  test(`failed imported batch rolls back all references (${Object.keys(indexResult)[0]})`, async t => {
    const { db, filepath, mgr, job, notifications } = downloadFixture(t, indexResult)
    const result = await mgr.indexOne(job, filepath)
    assert.equal(result.libraryAdded, false)
    assert.equal(job.libraryFailures, 1)
    assert.equal(job.indexedTracks.length, 0)
    assert.equal(notifications(), 0)
    assert.deepEqual(db.prepare('SELECT track_id FROM playlist_tracks ORDER BY position').all().map(r => r.track_id), ['g1', 'g2', 'streamed'])
    assert.equal(db.prepare('SELECT track_id FROM user_likes').get().track_id, 'g1')
    assert.equal(db.prepare('SELECT track_id FROM play_history').get().track_id, 'g1')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM track_aliases').get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE id = 'target'").get().n, indexResult.success ? 0 : 1)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artist_track_links WHERE track_id = 'target'").get().n, indexResult.success ? 0 : 1)
    assert.equal(fs.existsSync(filepath), !!indexResult.duplicate)
    assert.equal(job.outputLines.some(line => line.includes('Replaced the streamed version')), false)
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  })
}

test('successful imported batch commits once, dedupes playlists, and resolves streamed copies', async t => {
  const { db, filepath, mgr, job, notifications } = downloadFixture(t, { success: true }, false)
  // The same ghost may also be selected through the explicit replacement path.
  job.opts.alsoReplace = ['g1']
  const result = await mgr.indexOne(job, filepath)
  assert.equal(result.libraryAdded, true)
  assert.equal(job.indexedTracks.length, 1)
  assert.equal(notifications(), 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE file_path LIKE 'ghost://%'").get().n, 0)
  assert.ok(db.prepare('SELECT track_id FROM playlist_tracks').all().every(row => row.track_id === 'target'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE position IN (0, 1)').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM track_aliases').get().n, 3)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})

test('partial playlist completion includes indexing failures', async () => {
  const mgr = new DownloadManager()
  mgr.cleanup = async () => {}
  mgr.markPlaylist = () => {}
  mgr.update = (job, patch) => Object.assign(job, patch)
  const job = { id: 'partial', kind: 'playlist', post: Promise.resolve(), downloadedTracks: ['one.flac', 'two.flac'], libraryFailures: 1, errorLines: ['ERROR: unavailable'], outputLines: [] }
  mgr.jobs.set(job.id, job)
  await mgr.onExit(job, 1)
  assert.equal(job.status, 'done')
  assert.equal(job.message, '2 downloaded, 1 unavailable · 1 not added to library')
})
