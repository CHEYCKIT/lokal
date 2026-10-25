import test from 'node:test'
import assert from 'node:assert/strict'

const { flowPlaylistTracks } = await import('../src/flow/playlist.js')

test('a Flow playlist keeps local and permanent online IDs in original order', () => {
  const items = [
    { id: 'local:1', title: 'Local', artist: 'L', file_path: '/library/local.flac' },
    { id: 'ghost:yt', title: 'Online', artist: 'O', file_path: 'ghost://youtube/online/12345678901', artwork_url: 'https://example.org/cover.jpg' },
    { id: 'ghost:yt-alt', title: 'Online', artist: 'O', file_path: 'ghost://youtube/online/12345678901' },
    { id: 'ghost:addon', title: 'Different', artist: 'N', file_path: 'ghost://addon/abc123def4/remote-track' },
  ]
  assert.deepEqual(flowPlaylistTracks(items).map(x => x.id), ['local:1', 'ghost:yt', 'ghost:addon'])
})

test('a temporary stream URL and a non-playable ghost are not persisted', () => {
  const items = [
    { id: 'temp', title: 'Temp', artist: 'A', file_path: 'https://cdn.example/song.flac?expires=30' },
    { id: 'ghost-missing', title: 'No provider', artist: 'B', file_path: 'ghost://imported' },
    { id: 'valid', title: 'Saved', artist: 'C', file_path: 'ghost://youtube/online/abcdefghijk' },
  ]
  assert.deepEqual(flowPlaylistTracks(items).map(x => x.id), ['valid'])
})
