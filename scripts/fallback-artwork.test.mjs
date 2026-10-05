import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const sources = require('../electron/online/sources.js')
const { remoteArtworkURL } = require('../electron/ipc/artworkFx.js')

// The rows written, by id, through the two statements saveOnlineTracks uses.
function fakeDb() {
  const rows = new Map()
  return {
    rows,
    transaction: fn => (...args) => fn(...args),
    prepare: sql => sql.includes('INSERT INTO tracks')
      ? { run: row => { rows.set(row.id, row) } }
      : { get: id => rows.get(id) },
  }
}

const QOBUZ_COVER = 'https://static.qobuz.com/images/covers/50/06/0724384960650_600.jpg'

test('a song that falls back to YouTube keeps the cover it had (no thumbnail, only artwork_url)', () => {
  const db = fakeDb()
  // What recovery saves: the failed addon row, re-pointed at YouTube.
  const [row] = sources.saveOnlineTracks(db, [{ provider: 'yt', id: 'j_UhEi3GZOU', title: 'One More Time', artist: 'Daft Punk', artwork_url: QOBUZ_COVER }])
  assert.equal(row.artwork_url, QOBUZ_COVER)
  assert.equal(row.file_path, 'ghost://youtube/online/j_UhEi3GZOU')
  // ...and that cover gives the colour background.
  assert.equal(remoteArtworkURL(row)?.toString(), QOBUZ_COVER)
})

test('a search result\'s thumbnail still wins, and non-https artwork is dropped', () => {
  const db = fakeDb()
  const [a, b] = sources.saveOnlineTracks(db, [
    { provider: 'yt', id: 'CjdEqFMuNFU', title: 'A', artist: 'B', thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg', artwork_url: QOBUZ_COVER },
    { provider: 'yt', id: 'dLl4PZtxia8', title: 'C', artist: 'D', artwork_url: 'http://example.com/a.jpg' },
  ])
  assert.equal(a.artwork_url, 'https://i.ytimg.com/vi/x/hq.jpg')
  assert.equal(b.artwork_url, null)
})

test('colours are never fetched from this computer, the local network or plain http', () => {
  const ghost = artwork_url => ({ file_path: 'ghost://youtube/online/j_UhEi3GZOU', artwork_url })
  for (const url of ['http://static.qobuz.com/a.jpg', 'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://[::1]/a.jpg', 'https://192.168.1.10/a.jpg', 'https://nas.local/a.jpg', 'https://router/a.jpg', 'https://user:pw@example.com/a.jpg']) {
    assert.equal(remoteArtworkURL(ghost(url)), null, url)
  }
  // Library files use their own artwork file, not a URL.
  assert.equal(remoteArtworkURL({ file_path: 'C:\\\\Music\\\\a.flac', artwork_url: QOBUZ_COVER }), null)
  assert.ok(remoteArtworkURL({ file_path: 'ghost://addon/2805d04035/1068442', artwork_url: QOBUZ_COVER }))
})
