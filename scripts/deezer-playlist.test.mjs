import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { playlistId, readPlaylist, requestJson } = require('../electron/playlists/deezer')
const { platformOf } = require('../electron/playlists/sync')

test('Deezer locale links canonicalize and reject lookalike hosts and non-playlists', () => {
  assert.equal(platformOf('https://www.deezer.com/fr/playlist/123?utm=x').url, 'https://www.deezer.com/playlist/123')
  for (const url of ['https://deezer.com.evil.test/playlist/123', 'https://deezer.com/album/123', 'https://user@deezer.com/playlist/123', 'https://deezer.com/playlist/123/track', 'https://deezer.page.link/abc']) assert.equal(playlistId(url), null)
})

test('read all pages without an add-on, normalize metadata and keep duplicate entries', async () => {
  const calls = []
  const row = { id: 1, title: 'Song', artist: { name: 'Artist' }, album: { title: 'Album' }, duration: 123 }
  const getJson = async url => {
    calls.push(url)
    if (url.endsWith('/123')) return { title: 'My mix', nb_tracks: 3 }
    if (url.includes('index=0&')) return { data: [row, row], total: 3, next: 'https://evil.test/steal' }
    return { data: [{ ...row, id: 2 }], total: 3 }
  }
  const result = await readPlaylist('https://www.deezer.com/fr/playlist/123', { getJson })
  assert.equal(result.name, 'My mix')
  assert.equal(result.tracks.length, 3)
  assert.equal(result.tracks[0].duration_ms, 123000)
  assert.equal(result.tracks[0].album, 'Album')
  assert.equal(calls[2], 'https://api.deezer.com/playlist/123/tracks?index=100&limit=100')
})

test('incomplete/failed pages reject before the caller can save sync history', async () => {
  await assert.rejects(readPlaylist('https://deezer.com/playlist/123', { getJson: async url => url.endsWith('/123') ? { nb_tracks: 2 } : { data: [{ id: 1, title: 'Song' }] } }), /only 1 of 2/)
})

test('API error payloads and oversized responses are rejected', async t => {
  const original = global.fetch
  t.after(() => { global.fetch = original })
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'private' } }))
  await assert.rejects(requestJson('https://api.deezer.com/playlist/123'), /private or unavailable/)
  global.fetch = async () => new Response('x', { headers: { 'content-length': '5000000' } })
  await assert.rejects(requestJson('https://api.deezer.com/playlist/123'), /too large/)
})
