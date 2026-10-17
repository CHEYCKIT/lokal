import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fetchAllErrorTrackIds, fetchAllTrackPages, getFolderPlaybackTracks, shuffledLibraryTracks } from '../src/libraryHelpers.js'
import { sideCardViewAfterTrackChange } from '../src/sideCardView.js'

const require = createRequire(import.meta.url)
const { classifyCodec, playbackCopyPlan, playbackCopyFailure, resolveFfmpeg } = require('../electron/download/convert.js')

test('Play All fetches every page for the current library filters', async () => {
  const total = 12003
  const calls = []
  const getTracks = async options => {
    calls.push(options)
    return Array.from({ length: Math.min(options.limit, total - options.offset) }, (_, i) => ({
      id: options.offset + i,
    }))
  }
  const tracks = await fetchAllTrackPages(getTracks, { search: 'kroi', genre: 'Rock', sort: 'title ASC' })

  assert.equal(tracks.length, total)
  assert.deepEqual(calls.map(call => call.offset), [0, 5000, 10000])
  assert.ok(calls.every(call => call.search === 'kroi' && call.genre === 'Rock' && call.sort === 'title ASC' && call.limit === 5000))
})

test('only the standalone visualizer persists; other tracks default to lyrics when available', () => {
  assert.equal(sideCardViewAfterTrackChange('visualization'), 'visualization')
  assert.equal(sideCardViewAfterTrackChange('lyrics', true), 'lyrics')
  assert.equal(sideCardViewAfterTrackChange('info', true), 'lyrics')
  assert.equal(sideCardViewAfterTrackChange('lyrics', false), 'info')
  assert.equal(sideCardViewAfterTrackChange('info', false), 'info')
  assert.equal(sideCardViewAfterTrackChange(null), 'info')
})

test('RightSidebar resets track view and auto-selects available lyrics unless visualizer persists', () => {
  const source = readFileSync(new URL('../src/components/RightSidebar.jsx', import.meta.url), 'utf8')
  assert.match(source, /useEffect\(\(\) => \{\s*setInfoCardView\(sideCardViewAfterTrackChange\)\s*\}, \[currentTrack\?\.id\]\)/)
  assert.match(source, /lookUpLyrics\(currentTrack, infoCardViewRef\.current !== 'visualization'\)/)
  assert.match(source, /setInfoCardView\(view => sideCardViewAfterTrackChange\(view, has\)\)/)
})

test('Library search is on the right of the track-count row in both modes', () => {
  const source = readFileSync(new URL('../src/pages/Library.jsx', import.meta.url), 'utf8')
  const scanBanner = source.indexOf('<ScanBanner />')
  const statusRow = source.indexOf('className="flex w-full flex-wrap items-center justify-between gap-3"', scanBanner)
  const trackCount = source.indexOf("t('loaded tracks')", statusRow)
  const search = source.indexOf(`aria-label={libraryMode === 'simple' ? t("Search tracks")`, statusRow)
  const playbackRow = source.indexOf('className="flex w-full flex-wrap items-center gap-2"', statusRow)
  assert.ok(scanBanner >= 0 && statusRow > scanBanner && trackCount > statusRow && search > trackCount && playbackRow > search)
  const addFolder = source.indexOf("t('Add music folder')", statusRow)
  assert.ok(scanBanner >= 0 && statusRow > scanBanner && trackCount > statusRow && addFolder > trackCount && search > addFolder && playbackRow > search)
  assert.match(source.slice(statusRow, playbackRow), /className="ml-auto flex min-w-0 items-center gap-2/)
  assert.ok(source.slice(statusRow, playbackRow).indexOf("t('Add music folder')") < source.slice(statusRow, playbackRow).indexOf('<Search size={14}'))
  assert.doesNotMatch(source.slice(0, statusRow), /onClick=\{addMusicFolder\}/)
})

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

test('FFmpeg is the primary converter for ALAC on every platform', () => {
  const info = { codec: 'ALAC', lossless: true, unplayable: true }
  assert.deepEqual(playbackCopyPlan(info, null, 'darwin'), { converter: 'ffmpeg', extension: '.flac' })
  assert.deepEqual(playbackCopyPlan(info, '/usr/local/bin/ffmpeg', 'darwin'), { converter: 'ffmpeg', extension: '.flac' })
  assert.deepEqual(playbackCopyPlan(info, null, 'win32'), { converter: 'ffmpeg', extension: '.flac' })
  assert.deepEqual(playbackCopyPlan(info, null, 'linux'), { converter: 'ffmpeg', extension: '.flac' })
})

test('playback copy detects an installed or missing FFmpeg without platform-specific exceptions', () => {
  const info = { codec: 'ALAC', lossless: true, unplayable: true }
  const installed = resolveFfmpeg(null, () => '/usr/local/bin/ffmpeg')
  const missing = resolveFfmpeg(null, () => null)
  assert.equal(installed, '/usr/local/bin/ffmpeg')
  assert.equal(missing, null)
  assert.equal(playbackCopyFailure(info, installed, 'darwin'), null)
  assert.equal(playbackCopyFailure(info, null, 'darwin'), 'ffmpeg-missing')
})

test('reports missing FFmpeg only when an unsupported codec needs it', () => {
  const alac = { codec: 'ALAC', lossless: true, unplayable: true }
  const wma = { codec: 'WMA', lossless: false, unplayable: true }
  assert.equal(playbackCopyFailure(alac, null, 'darwin'), 'ffmpeg-missing')
  assert.equal(playbackCopyFailure(alac, '/usr/local/bin/ffmpeg', 'darwin'), null)
  assert.equal(playbackCopyFailure(wma, null, 'darwin'), 'ffmpeg-missing')
  assert.equal(playbackCopyFailure(wma, '/usr/local/bin/ffmpeg', 'linux'), null)
  assert.equal(playbackCopyFailure({ codec: 'AAC', lossless: false, unplayable: false }, null, 'linux'), null)
})

