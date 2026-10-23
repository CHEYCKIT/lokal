import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveRecommendationTracks } from '../src/recommendations.js'
import { saveTracksToLibrary } from '../src/onlineTracks.js'

test('batch source resolution emits real completed-track progress', async () => {
  const candidates = [1, 2, 3, 4].map(id => ({
    id: 'file-' + id, title: 'Song ' + id, artist: 'Artist', file_path: '/music/' + id + '.flac',
  }))
  const events = []
  const resolved = await resolveRecommendationTracks(candidates, {}, {
    sources: [],
    onProgress: (message, progress) => {
      if (progress) events.push({ message, progress })
    },
  })
  assert.equal(resolved.length, 4)
  assert.deepEqual(events.map(event => event.progress.percent), [25, 50, 75, 100])
  assert.ok(events.every(event => event.progress.total === 4))
  assert.ok(events.every(event => /Resolving tracks/.test(event.message)))
})

test('single-track resolution does not invent a provider lookup percentage', async () => {
  const events = []
  await resolveRecommendationTracks([
    { id: 'local-1', title: 'One', artist: 'Artist', file_path: '/music/one.flac' },
  ], {}, { sources: [], onProgress: (_message, progress) => events.push(progress) })
  assert.equal(events.length, 0)
})

test('bulk library saves count queued songs, not downloaded bytes', async () => {
  const tracks = [1, 2, 3, 4].map(id => ({
    id: 'song-' + id, title: 'Song ' + id, artist: 'Artist',
    file_path: 'ghost://youtube/online/abcdefghij' + id,
  }))
  const events = []
  const result = await saveTracksToLibrary(tracks, {
    save: async () => ({ downloadId: 'started' }),
    onProgress: (message, progress) => { if (progress) events.push({ message, progress }) },
  })
  assert.equal(result.started, 4)
  assert.deepEqual(events.filter(event => event.message === 'Queuing downloads…')
    .map(event => event.progress.percent), [25, 50, 75, 100])
  assert.equal(events.at(-1).progress.completed, 4)
  assert.equal(events.at(-1).progress.total, 4)
})

test('single-item queue does not claim byte-level download completion', async () => {
  const events = []
  await saveTracksToLibrary([
    { id: 'one', title: 'One', artist: 'Artist', file_path: 'ghost://youtube/online/abcdefghijk' },
  ], { save: async () => ({ downloadId: 'started' }), onProgress: (_message, value) => events.push(value) })
  assert.ok(events.every(event => event === undefined))
})
