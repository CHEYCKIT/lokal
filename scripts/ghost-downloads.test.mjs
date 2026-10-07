import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} }

const { downloadGhostSongs, ghostDownloadMessage } = await import('../src/ghostDownloads.js')

const imported = (i) => ({ id: `g${i}`, title: `Song ${i}`, artist: `Artist ${i}`, file_path: `ghost://spotify/pl-1/g${i}` })

function client({ inLibrary = [], online = [] } = {}) {
  const swaps = []
  return {
    swaps,
    getSettings: async () => ({ playback_search_order: JSON.stringify(['yt']) }),
    onlineProviders: async () => [{ id: 'yt' }],
    searchTracks: async (title) => inLibrary.filter(t => t.title === title),
    onlineSearch: async (query) => ({ results: online.filter(t => query.includes(t.title)).map(t => ({ ...t, id: t.vid, provider: 'yt' })) }),
    onlinePrepare: async () => ({ ok: true }),
    onlineSave: async items => items.map(item => ({ ...item, id: `yt-${item.id}`, file_path: `ghost://youtube/online/${item.id}` })),
    resolveGhostTrack: async (ghostId, targetId) => { swaps.push([ghostId, targetId]); return { ok: true } },
  }
}

test('each imported ghost is found on the playback sources and downloaded to take its place', async () => {
  const saved = []
  const c = client({ online: [{ title: 'Song 1', artist: 'Artist 1', vid: 'aaaaaaaaaa1' }, { title: 'Song 2', artist: 'Artist 2', vid: 'aaaaaaaaaa2' }] })
  const progress = []
  const result = await downloadGhostSongs([imported(1), imported(2)], { client: c, save: async (track, extra) => { saved.push([track.id, extra?.replaceImported]); return { downloadId: 'd' } }, onProgress: m => progress.push(m) })
  assert.deepEqual(result, { started: 2, existing: 0, failed: 0, notFound: 0 })
  assert.deepEqual(saved.sort(), [['yt-aaaaaaaaaa1', ['g1']], ['yt-aaaaaaaaaa2', ['g2']]])
  assert.equal(progress.at(-1), 'Finding and queuing songs… 2/2')
})

test('a song already in the library takes the ghost\'s place at once, no download', async () => {
  const saved = []
  const c = client({ inLibrary: [{ id: 'file-1', title: 'Song 1', artist: 'Artist 1', file_path: '/music/1.flac' }] })
  const result = await downloadGhostSongs([imported(1)], { client: c, save: async t => { saved.push(t); return {} } })
  assert.deepEqual(result, { started: 0, existing: 1, failed: 0, notFound: 0 })
  assert.deepEqual(c.swaps, [['g1', 'file-1']])
  assert.equal(saved.length, 0)
})

test('not found, failed downloads and streamed ghosts are told apart', async () => {
  const streamed = { id: 'yt-bbbbbbbbbbb', title: 'Streamed', artist: 'X', file_path: 'ghost://youtube/online/bbbbbbbbbbb' }
  const saved = []
  const c = client({ online: [{ title: 'Song 2', artist: 'Artist 2', vid: 'aaaaaaaaaa2' }] })
  const result = await downloadGhostSongs([imported(1), imported(2), streamed, { id: 'f', title: 'A file', artist: 'B', file_path: '/m/a.flac' }], {
    client: c, save: async (track, extra) => { saved.push([track.id, extra?.replaceImported]); return track.id === 'yt-bbbbbbbbbbb' ? { alreadyInLibrary: true } : { error: 'no' } },
  })
  assert.deepEqual(result, { started: 0, existing: 1, failed: 1, notFound: 1 })
  assert.deepEqual(saved.sort(), [['yt-aaaaaaaaaa2', ['g2']], ['yt-bbbbbbbbbbb', undefined]])
  assert.equal(ghostDownloadMessage(result), '1 already in your library; 1 not found on your playback sources; 1 unavailable')
})

test('streamed ghosts pass canonical metadata and cancellation to the downloader', async () => {
  const ghost = { id: 'yt-bbbbbbbbbbb', title: 'Canonical title', artist: 'Canonical artist', album: 'Album', duration: 201, file_path: 'ghost://youtube/online/bbbbbbbbbbb' }
  const saved = []
  const result = await downloadGhostSongs([ghost], {
    client: client(),
    save: async (track, options) => { saved.push({ track, options }); return {} },
  })
  assert.equal(result.started, 1)
  assert.equal(saved[0].track, ghost)
  assert.deepEqual(saved[0].options.tags, { title: ghost.title, artist: ghost.artist, album: ghost.album })
  assert.equal(saved[0].options.expectedDuration, 201)
  assert.equal(saved[0].options.isCurrent(), true)
})
