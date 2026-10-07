// Opt-in integration stress test. Requires ffmpeg and a real yt-dlp executable:
// LOKAL_STRESS_YTDLP=/path/to/yt-dlp LOKAL_STRESS_TRACKS=120 node --test scripts/csv-addon-downloads.test.mjs
// All HTTP traffic stays on a temporary local addon; no provider account is used.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ytdlp = process.env.LOKAL_STRESS_YTDLP

test('CSV playlist downloads through a local addon leave playable library files', { skip: !ytdlp, timeout: 600000 }, async t => {
  const { initDB, getDB } = require('../electron/ipc/db.js')
  const { indexSingleFile } = require('../electron/ipc/scanner.js')
  const { DownloadManager } = require('../electron/download/manager.js')
  const sources = require('../electron/online/sources.js')
  const { applyTags, coverThumbnail } = require('../electron/download/tagger.js')
  const mm = require('music-metadata')
  const express = require('express')
  globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const { api } = await import('../src/api.js')
  const { downloadGhostSongs, downloadGhostResult, ghostDownloadSuggestions } = await import('../src/ghostDownloads.js')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-csv-stress-'))
  const priorDir = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = dir
  initDB()
  const db = getDB()
  const manager = new DownloadManager()
  let server
  t.after(async () => {
    await manager.cancelAll()
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    db.close()
    if (priorDir === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = priorDir
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const count = Number(process.env.LOKAL_STRESS_TRACKS) || 12
  const alternateDuration = process.env.LOKAL_STRESS_ALTERNATE_DURATION === '1'
  const multipleArtists = process.env.LOKAL_STRESS_MULTI_ARTIST === '1'
  const milliseconds = process.env.LOKAL_STRESS_MS !== '0'
  const withIsrc = process.env.LOKAL_STRESS_ISRC !== '0'
  const collide = process.env.LOKAL_STRESS_COLLIDE !== '0'
  const catalogue = Array.from({ length: count }, (_, i) => ({
    id: `song-${i}`, title: `Test Song ${i}`, artist: `Test Artist ${i}`, album: 'CSV stress',
    duration: 16 + i % 5, genre: 'Test', ...(withIsrc ? { isrc: `USAAA26${String(i).padStart(5, '0')}` } : {}),
  }))
  const audio = new Map()
  const fingerprints = new Map()
  const covers = new Map()
  const thumbnails = new Map()
  const ffmpeg = process.env.LOKAL_STRESS_FFMPEG || 'ffmpeg'
  const fingerprint = file => execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim()
  for (const [i, row] of catalogue.entries()) {
    const file = path.join(dir, `fixture-${i}.flac`)
    const cover = await require('sharp')({ create: { width: 8, height: 8, channels: 3, background: { r: i % 256, g: Math.floor(i / 256) % 256, b: 80 } } }).png().toBuffer()
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${220 + i}:sample_rate=8000`, '-t', String(row.duration), '-metadata', 'genre=Test', '-c:a', 'flac', file])
    await applyTags(file, { coverBytes: cover, coverMime: 'image/png' })
    audio.set(row.id, fs.readFileSync(file))
    fingerprints.set(row.id, fingerprint(file))
    covers.set(row.id, cover)
    thumbnails.set(row.id, await coverThumbnail(file))
  }
  const app = express()
  app.use(express.json())
  app.use('/playlists', require('../server/routes/playlists.js'))
  app.get('/addon/manifest.json', (_req, res) => res.json({ id: 'lokal.csv-stress', name: 'CSV stress fixture', version: '1.0.0', resources: ['search', 'stream'] }))
  app.get('/addon/search', (req, res) => res.json({ tracks: catalogue.filter(row => req.query.q.includes(row.title) && req.query.q.includes(row.artist)) }))
  let base
  app.get('/addon/stream/:id', (req, res) => res.json({ url: `${base}/audio/${req.params.id}/${collide ? 'file' : req.params.id}.flac`, format: 'flac' }))
  app.get('/audio/:id/:file', (req, res) => {
    const row = catalogue.find(item => item.id === req.params.id)
    if (!row) return res.sendStatus(404)
    res.type('audio/flac').send(audio.get(row.id))
  })
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  base = `http://127.0.0.1:${server.address().port}`
  const addon = await sources.addons.install(db, `${base}/addon/manifest.json`)
  const provider = sources.addons.providerFor(addon.key)
  const setting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries({ download_concurrency: '6', download_embed_lyrics: '0', music_folder: path.join(dir, 'music'), min_duration: '0', playback_search_order: JSON.stringify([provider, 'yt', 'sc']) })) setting.run(key, value)
  const completed = new Map()
  manager.configure({ emit: job => { if (['done', 'error'].includes(job.status)) completed.set(job.id, job) }, getDB: () => db, getStorageDir: () => dir, index: indexSingleFile,
    findTools: () => ({ ytdlp, ffmpeg: process.env.LOKAL_STRESS_FFMPEG || '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' }),
    resolveAddonUrl: async (p, id) => (await sources.resolveStream(p, id, { db, force: true })).url,
  })
  const csv = [`title,artist,album,${milliseconds ? 'duration_ms' : 'duration'},isrc`, ...catalogue.map(row => `${row.title},${multipleArtists ? row.artist + ';Guest Artist;Another Guest' : row.artist},${row.album},${(row.duration + (alternateDuration ? 280 : 0)) * (milliseconds ? 1000 : 1)},${row.isrc || ''}`)].join('\n')
  const imported = await (await fetch(`${base}/playlists/external-import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Stress CSV', fileType: 'csv', fileContent: csv }) })).json()
  assert.equal(imported.ghosted, count)
  const rows = () => db.prepare('SELECT t.* FROM playlist_tracks p JOIN tracks t ON t.id = p.track_id WHERE p.playlist_id = ? ORDER BY p.position').all(imported.playlistId)
  const client = {
    getSettings: async () => manager.settings(),
    onlineProviders: async () => [{ id: provider }, { id: 'yt' }, { id: 'sc' }],
    searchTracks: async title => db.prepare("SELECT * FROM tracks WHERE title = ? AND file_path NOT LIKE 'ghost://%'").all(title),
    onlineSearch: async (query, p) => { assert.equal(p, provider, 'fixture addon should match every song'); return sources.search(p, query, { db }) },
    onlinePrepare: async (p, id) => { await sources.resolveStream(p, id, { db }); return { ok: true } },
    onlineSave: async items => sources.saveOnlineTracks(db, items),
    resolveGhostTrack: async (ghost, target, options) => require('../server/routes/playlists.js').resolveGhostTrack(db, ghost, target, null, options),
  }
  t.mock.method(api, 'onlineDownloadUrl', async (p, id) => ({ url: (await sources.resolveStream(p, id, { db, force: true })).url }))
  t.mock.method(api, 'downloadYT', async (url, opts) => manager.enqueue('single', url, opts))
  // Reject accidental external lookups while allowing the fixture's HTTP traffic.
  const originalFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', (url, opts) => {
    if (!String(url).startsWith(base + '/')) throw new Error(`Unexpected external request: ${new URL(url).hostname}`)
    return originalFetch(url, opts)
  })
  let confirmations = 0
  const confirmDuration = async (ghost, found) => { confirmations++; assert.ok(ghost.duration - found.duration > 10); return true }
  let queued
  if (process.env.LOKAL_STRESS_MANUAL === '1') {
    const attempts = await Promise.all(rows().map(async ghost => {
      const suggestions = await ghostDownloadSuggestions(`${ghost.artist} ${ghost.title}`, provider, client)
      const item = suggestions.find(item => item.title === ghost.title)
      assert.ok(item, 'manually select the requested song, not a substring result')
      return downloadGhostResult(ghost, item, { client, confirmDuration })
    }))
    queued = { started: attempts.filter(result => result?.downloadId).length }
  } else {
    queued = await downloadGhostSongs(rows(), { client, concurrency: 6, confirmDuration, onProgress: message => { if (/ (?:\d*[05]0)\//.test(message)) console.log(message) } })
  }
  assert.equal(confirmations, alternateDuration ? count : 0)
  assert.equal(queued.started, count, JSON.stringify(queued))
  console.log('Queue submissions finished:', JSON.stringify(queued))
  const deadline = Date.now() + 480000
  while ([...manager.jobs.values()].some(job => ['queued', 'downloading'].includes(job.status))) {
    assert.ok(Date.now() < deadline, 'download queue timed out')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const jobs = [...completed.values()]
  const playlistRows = rows()
  const unresolved = playlistRows.filter(row => row.file_path.startsWith('ghost://'))
  const missing = playlistRows.filter(row => !row.file_path.startsWith('ghost://') && !fs.existsSync(row.file_path))
  const failures = jobs.filter(job => job.libraryFailures || job.status !== 'done')
  t.diagnostic(JSON.stringify({ tracks: count, milliseconds, withIsrc, collide, jobs: jobs.length, unresolved: unresolved.length, missing: missing.length, failedJobs: failures.length,
    errors: failures.slice(0, 3).map(job => ({ message: job.message, logs: job.output?.split('\n').slice(-5) })) }))
  assert.equal(unresolved.length, 0, 'playlist still contains ghosts')
  assert.equal(missing.length, 0, 'playlist points to deleted audio')
  assert.equal(failures.length, 0, 'queue contains indexing or download failures')
  assert.equal(jobs.length, count)
  assert.equal(playlistRows.length, count)
  assert.equal(new Set(playlistRows.map(row => row.file_path)).size, count)
  for (const row of playlistRows) {
    const expected = catalogue.find(item => item.title === row.title)
    assert.ok(expected)
    assert.ok(Math.abs(row.duration - expected.duration) < 0.1, "library retains measured duration")
    assert.equal(row.artist, multipleArtists ? expected.artist + ', Guest Artist, Another Guest' : expected.artist)
    const metadata = await mm.parseFile(row.file_path)
    assert.equal(metadata.common.title, expected.title)
    assert.equal(metadata.common.artist, row.artist)
    assert.ok(Math.abs(metadata.format.duration - expected.duration) < 0.1)
    assert.equal(fingerprint(row.file_path), fingerprints.get(expected.id), `Wrong audio for ${expected.id}`)
    assert.deepEqual(metadata.common.picture?.[0]?.data, covers.get(expected.id), `Wrong cover for ${expected.id}`)
    const job = jobs.find(item => item.indexedTracks.some(track => track.id === row.id))
    assert.equal(job?.thumbnail, thumbnails.get(expected.id), `Wrong queue cover for ${expected.id}`)
  }
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  t.diagnostic(`Decoded all ${count} files; audio fingerprints, embedded covers, metadata and playlist identities match their source.`)
})
