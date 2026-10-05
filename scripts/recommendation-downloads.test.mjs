import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api } from '../src/api.js'
import { libraryDownloadMessage, saveToLibrary, saveTracksToLibrary } from '../src/onlineTracks.js'

const tracks = [
  { id: 'yt', title: 'YouTube Song', artist: 'Artist', file_path: 'ghost://youtube/online/abcdefghijk' },
  { id: 'sc', title: 'SoundCloud Song', artist: 'Artist', file_path: 'ghost://soundcloud/online/123' },
  { id: 'addon', title: 'Addon Song', artist: 'Artist', album: 'Album', file_path: 'ghost://addon/0123456789/song' },
]

test('recommendation downloads use each resolved provider and preserve replacement identity', async () => {
  const calls = [], links = []
  const originalDownload = api.downloadYT, originalLink = api.onlineDownloadUrl
  api.downloadYT = async (url, options) => { calls.push({ url, options }); return { downloadId: `job${calls.length}` } }
  api.onlineDownloadUrl = async (provider, id) => { links.push([provider, id]); return { url: 'https://addon.example/song.flac' } }
  try {
    const result = await saveTracksToLibrary(tracks)
    assert.deepEqual(result, { started: 3, existing: 0, failed: 0 })
    assert.deepEqual(calls.map(call => call.url), ['https://music.youtube.com/watch?v=abcdefghijk', 'https://api.soundcloud.com/tracks/123', 'https://addon.example/song.flac'])
    assert.deepEqual(calls.map(call => call.options.replaceTrackId), tracks.map(track => track.id))
    assert.deepEqual(links, [['a-0123456789', 'song']])
    assert.deepEqual(calls[2].options.addonSource, { provider: 'a-0123456789', id: 'song' })
    assert.equal(calls[2].options.tags.album, 'Album')
  } finally { api.downloadYT = originalDownload; api.onlineDownloadUrl = originalLink }
})

test('bulk downloads deduplicate sources, skip local songs, and keep going after errors', async () => {
  const saved = []
  const result = await saveTracksToLibrary([...tracks, { ...tracks[0], id: 'duplicate' }, { id: 'local', file_path: '/music/song.flac' }], { save: async track => {
    saved.push(track.id)
    if (track.id === 'sc') throw new Error('Unavailable')
    return track.id === 'addon' ? { alreadyInLibrary: true } : { downloadId: 'job' }
  } })
  assert.deepEqual(saved, ['yt', 'sc', 'addon'])
  assert.deepEqual(result, { started: 1, existing: 2, failed: 1 })
  assert.match(libraryDownloadMessage(result), /Started 1 download; 2 already in your library; 1 unavailable/)
})

test('account cancellation stops subsequent download submissions', async () => {
  let current = true
  const saved = []
  await saveTracksToLibrary(tracks, { isCurrent: () => current, save: async track => { saved.push(track.id); current = false; return { downloadId: 'job' } } })
  assert.deepEqual(saved, ['yt'])
})

test('missing addon links remain actionable download failures', async () => {
  const original = api.onlineDownloadUrl
  api.onlineDownloadUrl = async () => ({ error: 'Reconnect the addon' })
  try { assert.deepEqual(await saveToLibrary(tracks[2]), { error: 'Reconnect the addon' }) }
  finally { api.onlineDownloadUrl = original }
})
