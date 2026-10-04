import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadDiscoveryCatalogue } from '../src/discoveryCatalogue.js'
import { resolveRecommendationTracks } from '../src/recommendations.js'

const addon = 'a-0123456789'
const song = { title: 'Song', artist: 'Artist', album: 'Album' }

test('album metadata failure falls through YouTube, SoundCloud, and addons and keeps only the exact album', async () => {
  const calls = []
  const client = {
    discoveryCatalogue: async options => { calls.push(options.source); return { error: 'Album unavailable' } },
    getSettings: async () => ({ playback_search_order: JSON.stringify(['yt', 'sc', addon]) }),
    onlineProviders: async () => [{ id: 'yt' }, { id: 'sc' }, { id: addon }],
    onlineSearch: async (query, source) => { calls.push(source); return { results: source === addon ? [{ ...song, id: '2', title: 'Second', track_num: 2 }, { ...song, id: '1', title: 'First', track_num: 1 }, { ...song, id: 'wrong', album: 'Other Album' }] : [] } },
  }
  const result = await loadDiscoveryCatalogue({ source: 'youtube', type: 'album', artist: 'Artist', album: 'Album' }, client)
  assert.deepEqual(calls, ['youtube', 'lastfm', 'yt', 'sc', addon])
  assert.deepEqual(result.tracks.map(track => track.title), ['First', 'Second'])
})

test('no matching album reports a specific error and never uses unrelated artist songs', async () => {
  const client = {
    discoveryCatalogue: async () => ({ tracks: [] }), getSettings: async () => ({}), onlineProviders: async () => [{ id: 'sc' }],
    onlineSearch: async () => ({ results: [{ ...song, album: 'Different' }] }),
  }
  const result = await loadDiscoveryCatalogue({ type: 'album', artist: 'Artist', album: 'Album' }, client)
  assert.deepEqual(result.tracks, [])
  assert.match(result.error, /No matching album.*Album.*Artist/)
})

test('artist catalogues are bounded and provider metadata is separate from playback search priority', async () => {
  const client = { discoveryCatalogue: async () => ({ tracks: Array.from({ length: 60 }, (_, i) => ({ ...song, title: `Song ${i}` })) }) }
  assert.equal((await loadDiscoveryCatalogue({ type: 'artist', artist: 'Artist' }, client)).tracks.length, 24)
})

test('prefixed SoundCloud titles match the correct song and hidden previews still fall through during queue filling', async () => {
  const sources = [{ id: 'sc' }, { id: addon }]
  const prepared = []
  const saved = []
  const client = {
    searchTracks: async () => [], onlineSearch: async (query, source) => ({ results: [{ ...song, id: '123', title: source === 'sc' ? 'Artist - Song (Official Audio)' : 'Song' }] }),
    onlinePrepare: async source => { prepared.push(source); return { ok: true, preview: source === 'sc' } },
    onlineSave: async items => { saved.push(items[0].provider); return [{ ...song, id: 'addon', file_path: 'ghost://addon/0123456789/123' }] },
  }
  const result = await resolveRecommendationTracks([song], client, { sources, prepareStreams: false })
  assert.deepEqual(prepared, ['sc'])
  assert.deepEqual(saved, [addon])
  assert.equal(result[0].title, 'Song')
})
