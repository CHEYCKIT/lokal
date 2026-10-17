import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fetchAllErrorTrackIds, getFolderPlaybackTracks, shuffledLibraryTracks } from '../src/libraryHelpers.js'

const require = createRequire(import.meta.url)
const { classifyCodec, playbackCopyPlan, playbackCopyFailure, afconvertArgs, resolveFfmpeg } = require('../electron/download/convert.js')

test('Errors lookup pages beyond the IPC 5,000-row maximum', async () => {
  const total = 12003
  const calls = []
  const getTracks = async ({ problems, limit, offset, sort }) => {
    calls.push({ problems, limit, offset, sort })
    return Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({ id: offset + i }))
  }
  const ids = await fetchAllErrorTrackIds(getTracks)
  assert.equal(ids.size, total)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(call => call.offset), [0, 5000, 10000])
  assert.ok(calls.every(call => call.problems && call.limit === 5000 && call.sort === 'added_at DESC'))
})

test('folder playback includes filtered descendant tracks and globally sorts mixed search results', () => {
  const allTracks = [
    { id: 'z', title: 'Zebra', error: false },
    { id: 'a', title: 'Apple', error: false },
    { id: 'm', title: 'Melon', error: true },
  ]
  const sorted = list => [...list].sort((a, b) => a.title.localeCompare(b.title))
  const filteredDescendants = getFolderPlaybackTracks({
    term: '',
    directTracks: [],
    deepTracks: [],
    allTracks,
    matchesFilters: track => !track.error,
    sortTracks: sorted,
  })
  assert.deepEqual(filteredDescendants.map(track => track.id), ['a', 'z'])

  const mixedSearch = getFolderPlaybackTracks({
    term: 'a',
    directTracks: [{ id: 'z', title: 'Zebra' }],
    deepTracks: [{ id: 'a', title: 'Apple' }],
    allTracks,
    sortTracks: sorted,
  })
  assert.deepEqual(mixedSearch.map(track => track.id), ['a', 'z'])

  // Direct tracks exist in the folder but the active filter removed all of
  // them. Do not substitute a descendant-only fallback into the queue.
  const hiddenDirectTracks = getFolderPlaybackTracks({
    term: '',
    directTracks: [],
    hasDirectTracks: true,
    allTracks: [{ id: 'hidden-descendant', title: 'Not visible' }],
    matchesFilters: () => true,
    sortTracks: sorted,
  })
  assert.deepEqual(hiddenDirectTracks, [])
})

test('Shuffle returns a permutation without mutating the source list', () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  const shuffled = shuffledLibraryTracks(tracks)
  assert.deepEqual([...shuffled].sort((a, b) => a.id - b.id), tracks)
  assert.notStrictEqual(shuffled, tracks)
  assert.deepEqual(tracks.map(track => track.id), [1, 2, 3, 4])
  assert.deepEqual(shuffledLibraryTracks(null), [])
})

test('ALAC aliases are classified as unplayable lossless audio', () => {
  for (const codec of ['ALAC', 'Apple Lossless', 'Apple Lossless Audio Codec']) {
    assert.deepEqual(classifyCodec(codec), { codec, lossless: true, unplayable: true })
  }
})

test('macOS uses built-in afconvert for ALAC when FFmpeg is unavailable', () => {
  const info = { codec: 'ALAC', lossless: true, unplayable: true }
  assert.deepEqual(playbackCopyPlan(info, null, 'darwin'), { converter: 'afconvert', extension: '.wav' })
  assert.deepEqual(afconvertArgs('/Music/track.m4a', '/cache/track.wav'), [
    '-f', 'WAVE', '-d', 'LEF32', '/Music/track.m4a', '/cache/track.wav',
  ])
  assert.deepEqual(playbackCopyPlan(info, '/usr/local/bin/ffmpeg', 'darwin'), { converter: 'ffmpeg', extension: '.flac' })
  assert.deepEqual(playbackCopyPlan(info, null, 'win32'), { converter: 'ffmpeg', extension: '.flac' })
})

test('playback copy resolves FFmpeg before choosing the macOS ALAC fallback', () => {
  const info = { codec: 'ALAC', lossless: true, unplayable: true }
  const installed = resolveFfmpeg(null, () => '/usr/local/bin/ffmpeg')
  const missing = resolveFfmpeg(null, () => null)
  assert.equal(installed, '/usr/local/bin/ffmpeg')
  assert.deepEqual(playbackCopyPlan(info, installed, 'darwin'), { converter: 'ffmpeg', extension: '.flac' })
  assert.equal(missing, null)
  assert.deepEqual(playbackCopyPlan(info, missing, 'darwin'), { converter: 'afconvert', extension: '.wav' })
})

test('reports missing FFmpeg only when the required converter is unavailable', () => {
  const alac = { codec: 'ALAC', lossless: true, unplayable: true }
  const wma = { codec: 'WMA', lossless: false, unplayable: true }
  assert.equal(playbackCopyFailure(alac, null, 'darwin'), null)
  assert.equal(playbackCopyFailure(alac, null, 'win32'), 'ffmpeg-missing')
  assert.equal(playbackCopyFailure(wma, null, 'darwin'), 'ffmpeg-missing')
  assert.equal(playbackCopyFailure(wma, '/usr/local/bin/ffmpeg', 'linux'), null)
  assert.equal(playbackCopyFailure({ codec: 'AAC', lossless: false, unplayable: false }, null, 'linux'), null)
})
