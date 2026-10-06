import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const linkImport = require('../electron/playlists/linkImport.js')

const PLAYLIST = 'https://www.youtube.com/playlist?list=PLabc123'

function flat(entries, extra = {}) {
  return JSON.stringify({ title: 'Road Trip', uploader: 'Some Person', webpage_url: PLAYLIST, entries, ...extra })
}

function video(id, title, channel = 'Artist - Topic', extra = {}) {
  return { id, title, channel, uploader: channel, duration: 200, ie_key: 'Youtube', url: `https://www.youtube.com/watch?v=${id}`, ...extra }
}

function memoryDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, album TEXT, duration INTEGER, source_url TEXT, source_ref TEXT, artwork_url TEXT);
    CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT, user_id TEXT);
    CREATE TABLE playlist_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id TEXT, track_id TEXT, position INTEGER, added_by TEXT, added_at INTEGER);
  `)
  return db
}

const helpers = {
  findTrack: (db, entry) => db.prepare("SELECT id FROM tracks WHERE LOWER(title) = ? AND file_path NOT LIKE 'ghost://%' LIMIT 1").get(String(entry.title).toLowerCase()) || null,
  createGhostTrack: (db, entry, platform, playlistId) => {
    const id = `g-${Math.random().toString(36).slice(2, 9)}`
    db.prepare('INSERT INTO tracks (id, file_path, title, artist, source_url) VALUES (?, ?, ?, ?, ?)').run(id, `ghost://${platform}/${playlistId}/${id}`, entry.title, entry.artist, entry.source_url)
    return { id }
  },
}

test('only real playlist links are accepted', () => {
  assert.equal(linkImport.playlistLinkProblem(PLAYLIST), null)
  assert.equal(linkImport.playlistLinkProblem('https://music.youtube.com/playlist?list=OLAK5uy_abc'), null)
  assert.equal(linkImport.playlistLinkProblem('https://soundcloud.com/artist/sets/album'), null)
  assert.match(linkImport.playlistLinkProblem('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), /isn't a playlist/)
  assert.match(linkImport.playlistLinkProblem('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ'), /Mixes/)
  assert.match(linkImport.playlistLinkProblem('file:///etc/passwd'), /http/)
  assert.match(linkImport.playlistLinkProblem('not a link'), /link/)
})

test('a flat yt-dlp playlist becomes clean entries', () => {
  const out = flat([
    video('aaaaaaaaaaa', 'Artist - Song One', 'Artist'),
    video('bbbbbbbbbbb', '[Deleted video]', 'NA'),
    video('ccccccccccc', '[Private video]', 'NA'),
    video('aaaaaaaaaaa', 'Artist - Song One', 'Artist'),
    video('ddddddddddd', 'Song Two', 'SomeoneVEVO'),
    { title: 'No id and no link' },
  ])
  const result = linkImport.parsePlaylistJson(out, '', { url: PLAYLIST })
  assert.equal(result.title, 'Road Trip')
  assert.equal(result.platform, 'youtube')
  assert.deepEqual(result.entries.map(e => [e.title, e.artist, e.source_url]), [
    ['Song One', 'Artist', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'],
    ['Song Two', 'Someone', 'https://www.youtube.com/watch?v=ddddddddddd'],
  ])
  assert.equal(result.skipped, 4)
  assert.equal(result.truncated, false)
})

test('the playlist owner only stands in for the artist outside YouTube', () => {
  const sc = 'https://soundcloud.com/band/sets/album'
  const out = JSON.stringify({ title: 'Album', uploader: 'Band', entries: [{ id: '1', title: 'Track', url: 'https://soundcloud.com/band/track' }] })
  assert.equal(linkImport.parsePlaylistJson(out, '', { url: sc }).entries[0].artist, 'Band')
  assert.equal(linkImport.parsePlaylistJson(out, '', { url: sc }).platform, 'soundcloud')
  const yt = flat([{ id: 'eeeeeeeeeee', title: 'Untagged', ie_key: 'Youtube' }])
  assert.equal(linkImport.parsePlaylistJson(yt, '', { url: PLAYLIST }).entries[0].artist, null)
})

test('long playlists are cut and said so', () => {
  const entries = Array.from({ length: 12 }, (_, i) => video(String(i).padStart(11, 'x'), `Song ${i}`))
  const result = linkImport.parsePlaylistJson(flat(entries), '', { url: PLAYLIST, limit: 10 })
  assert.equal(result.entries.length, 10)
  assert.equal(result.truncated, true)
})

test('empty or unreadable output gives the yt-dlp error', () => {
  const failed = linkImport.parsePlaylistJson('', 'ERROR: [youtube:tab] PLabc: This playlist is private\n', { url: PLAYLIST })
  assert.equal(failed.error, 'PLabc: This playlist is private')
  assert.match(linkImport.parsePlaylistJson(flat([]), '', { url: PLAYLIST }).error, /no tracks/)
})

test('entries sent back by the app are checked', () => {
  const clean = linkImport.sanitizeEntries([
    { title: 'Fine', artist: 'A', source_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', duration: '181.4', thumbnail: 'javascript:alert(1)' },
    { title: 'Same link', source_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { title: 'Bad link', source_url: 'file:///etc/passwd' },
    { title: '', source_url: 'https://example.com/a' },
    null,
  ])
  assert.equal(clean.length, 1)
  assert.equal(clean[0].duration, 181)
  assert.equal(clean[0].thumbnail, null)
  assert.equal(linkImport.sanitizeEntries([{ title: 'T', source_url: 'https://example.com/a', thumbnail: 'http://example.com/a.jpg' }])[0].thumbnail, null)
  assert.equal(linkImport.sanitizeEntries('nope').length, 0)
})

test('importing makes a playlist from library songs, existing ghosts and new ghosts', async () => {
  const db = memoryDb()
  db.prepare("INSERT INTO tracks (id, file_path, title, artist, source_ref) VALUES ('t1', '/music/one.opus', 'Downloaded Before', 'Artist', 'yt:aaaaaaaaaaa')").run()
  db.prepare("INSERT INTO tracks (id, file_path, title, artist) VALUES ('t2', '/music/two.mp3', 'Matched By Name', 'Artist')").run()
  db.prepare("INSERT INTO tracks (id, file_path, title, artist, source_url) VALUES ('g-old', 'ghost://youtube/pl-x/g-old', 'Streamed', 'Artist', 'https://www.youtube.com/watch?v=ccccccccccc')").run()
  const entries = linkImport.sanitizeEntries([
    { title: 'Whatever The Title Is', artist: 'Artist', source_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { title: 'Matched By Name', artist: 'Artist', source_url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
    { title: 'Streamed', artist: 'Artist', source_url: 'https://www.youtube.com/watch?v=ccccccccccc' },
    { title: 'Brand New', artist: 'Artist', source_url: 'https://www.youtube.com/watch?v=ddddddddddd' },
  ])
  const result = await linkImport.importLinkEntries(db, { name: 'Road Trip', userId: 'u1', entries, helpers, platform: 'youtube' })
  assert.equal(result.matched, 2)
  assert.equal(result.reused, 1)
  assert.equal(result.ghosted, 1)
  assert.equal(result.ghosts.length, 1)
  assert.equal(result.ghosts[0].source_url, 'https://www.youtube.com/watch?v=ddddddddddd')
  const rows = db.prepare('SELECT track_id, position, added_by FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(result.playlistId)
  assert.deepEqual(rows.map(r => r.track_id).slice(0, 3), ['t1', 't2', 'g-old'])
  assert.deepEqual(rows.map(r => r.position), [1, 2, 3, 4])
  assert.ok(rows.every(r => r.added_by === 'u1'))
  assert.equal(db.prepare('SELECT user_id FROM playlists WHERE id = ?').get(result.playlistId).user_id, 'u1')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE file_path LIKE 'ghost://%'").get().n, 2)
})

test('the same song twice in one import is added once', async () => {
  const db = memoryDb()
  db.prepare("INSERT INTO tracks (id, file_path, title, artist) VALUES ('t1', '/music/one.mp3', 'Song', 'Artist')").run()
  const entries = linkImport.sanitizeEntries([
    { title: 'Song', source_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { title: 'Song', source_url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' },
  ])
  const result = await linkImport.importLinkEntries(db, { name: 'Dupes', entries, helpers, platform: 'youtube' })
  assert.equal(result.duplicates, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks').get().n, 1)
})

test('a failed import leaves no half-made playlist', async () => {
  const db = memoryDb()
  const entries = linkImport.sanitizeEntries([{ title: 'A', source_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }])
  const broken = { ...helpers, createGhostTrack: () => { throw new Error('disk full') } }
  await assert.rejects(linkImport.importLinkEntries(db, { name: 'Nope', entries, helpers: broken, platform: 'youtube' }), /disk full/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 0)
})

test('downloading afterwards is opt-in work done per ghost song', () => {
  const calls = []
  const manager = { enqueue: (kind, url, opts) => { calls.push({ kind, url, opts }); return url.endsWith('b') ? { error: 'Already in your library: B', alreadyInLibrary: true } : { downloadId: 'x' } } }
  const ghosts = [
    { trackId: 'g1', source_url: 'https://www.youtube.com/watch?v=a', title: 'A', artist: 'X', thumbnail: 'https://i.ytimg.com/vi/a/hqdefault.jpg' },
    { trackId: 'g2', source_url: 'https://www.youtube.com/watch?v=b', title: 'B', artist: 'X' },
  ]
  const result = linkImport.queueGhostDownloads(manager, ghosts)
  assert.deepEqual(result, { queued: 2, failed: 0 })
  assert.equal(calls[0].kind, 'single')
  assert.equal(calls[0].opts.replaceTrackId, 'g1')
  assert.equal(calls[0].opts.tags.title, 'A')
  assert.equal(calls[0].opts.tags.cover, 'https://i.ytimg.com/vi/a/hqdefault.jpg')
})

test('yt-dlp is asked to list the playlist, not download it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-link-'))
  const fake = path.join(dir, 'fake-ytdlp.js')
  fs.writeFileSync(fake, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(path.join(dir, 'args.json'))}, JSON.stringify(process.argv.slice(2)))\nprocess.stdout.write(JSON.stringify({ title: 'Listed', entries: [{ id: 'aaaaaaaaaaa', title: 'Song', channel: 'Band', ie_key: 'Youtube' }] }))\n`)
  fs.chmodSync(fake, 0o755)
  try {
    const result = await linkImport.fetchPlaylist({ ytdlp: fake, url: PLAYLIST })
    assert.equal(result.title, 'Listed')
    assert.equal(result.entries[0].title, 'Song')
    const args = JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8'))
    assert.ok(args.includes('--flat-playlist'))
    assert.ok(!args.includes('-x'))
    assert.deepEqual(args.slice(-2), ['--', PLAYLIST])
    assert.ok((await linkImport.fetchPlaylist({ ytdlp: null, url: PLAYLIST })).error)
    assert.ok((await linkImport.fetchPlaylist({ ytdlp: fake, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' })).error)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('plain downloads never make a library playlist', () => {
  for (const file of ['../electron/download/manager.js', '../electron/ipc/downloader.js', '../server/routes/download.js', '../src/components/LinkDownload.jsx']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /linkImport/, file)
    assert.doesNotMatch(source, /INSERT INTO playlists\b/, file)
    assert.doesNotMatch(source, /INSERT INTO playlist_tracks/, file)
  }
})

test('every track of a big playlist is read, not just the first few hundred', () => {
  const entries = Array.from({ length: 3600 }, (_, i) => video(`v${String(i).padStart(10, '0')}`, `Song ${i}`))
  const result = linkImport.parsePlaylistJson(flat(entries), '', { url: 'https://music.youtube.com/playlist?list=LM' })
  assert.equal(result.entries.length, 3600)
  assert.equal(result.truncated, false)
  assert.ok(linkImport.MAX_ENTRIES >= 5000)
  assert.equal(linkImport.playlistLinkProblem('https://music.youtube.com/playlist?list=LM'), null)
})

test('the biggest listed thumbnail is used, with a YouTube fallback', () => {
  const big = linkImport.bestThumbnail({ thumbnails: [
    { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/default.jpg', width: 120, height: 90 },
    { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg', width: 1280, height: 720 },
    { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', width: 480, height: 360 },
  ] }, 'aaaaaaaaaaa')
  assert.equal(big, 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg')
  assert.equal(linkImport.bestThumbnail({ thumbnails: [{ url: 'https://a.example/1.jpg' }, { url: 'https://a.example/2.jpg' }] }, 'x'), 'https://a.example/2.jpg')
  assert.equal(linkImport.bestThumbnail({ thumbnails: [{ url: 'http://insecure.example/a.jpg', width: 9999, height: 9999 }] }, 'aaaaaaaaaaa'), 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg')
  assert.equal(linkImport.bestThumbnail({}, ''), null)
})

test('titles are tidied the way downloads tidy them', () => {
  const upload = linkImport.normalizeEntry(video('aaaaaaaaaaa', 'Cool Band - Great Song (Official Video)', 'Some Label'), { playlistIsYouTube: true })
  assert.equal(upload.artist, 'Cool Band')
  assert.equal(upload.title, 'Great Song')
  const catalogue = linkImport.normalizeEntry(video('bbbbbbbbbbb', 'Song - Remastered 2011', 'Cool Band'), { playlistIsYouTube: true, catalogue: true })
  assert.equal(catalogue.artist, 'Cool Band')
  assert.equal(catalogue.title, 'Song - Remastered 2011')
  const topic = linkImport.normalizeEntry(video('ccccccccccc', 'A - B', 'Cool Band - Topic'), { playlistIsYouTube: true })
  assert.equal(topic.title, 'A - B')
  const kept = linkImport.normalizeEntry(video('ddddddddddd', 'Song (Official Video)', 'Cool Band'), { playlistIsYouTube: true, cleanTitles: false })
  assert.equal(kept.title, 'Song (Official Video)')
})

test('ghost songs get the YouTube cover', async () => {
  const db = memoryDb()
  const entries = linkImport.sanitizeEntries([{ title: 'New', artist: 'A', source_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg' }])
  const result = await linkImport.importLinkEntries(db, { name: 'Covers', entries, helpers, platform: 'youtube' })
  assert.equal(db.prepare('SELECT artwork_url FROM tracks WHERE id = ?').get(result.ghosts[0].trackId).artwork_url, 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg')
  assert.equal(result.ghosts[0].thumbnail, 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg')
})

test('matching thousands of songs gives the app time to breathe', async () => {
  const db = memoryDb()
  const entries = linkImport.sanitizeEntries(Array.from({ length: 1500 }, (_, i) => ({ title: `Song ${i}`, source_url: `https://www.youtube.com/watch?v=${String(i).padStart(11, '0')}` })))
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 0)
  const preview = await linkImport.previewEntries(db, entries, helpers)
  clearInterval(timer)
  assert.equal(preview.rows.length, 1500)
  assert.ok(ticks > 0)
})
