import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/Genres.jsx', import.meta.url), 'utf8')

test('clicking a genre title opens a dedicated genre playlist view', () => {
  assert.match(source, /onOpen=\{\(\) => navigate\(genrePath\(item\.name\)\)\}/)
  assert.match(source, /\/genre\/:name/)
  assert.doesNotMatch(source, /import Library from '\.\/Library'|<Library\b/)
  assert.match(source, /fetchAllTrackPages\(options => api\.getTracks\(options\), \{ genre, sort: 'added_at DESC' \}, 5000\)/)
  assert.match(source, /<TrackList\s+tracks=\{tracks\}/)
})

test('genre playlist Play All and Shuffle use the genre’s own playable tracks', () => {
  assert.match(source, /const playableTracks = useMemo\(\(\) => tracks\.filter\(track => isPlayable\(track\)\), \[tracks\]\)/)
  assert.match(source, /playQueue\(playableTracks, 0\)/)
  assert.match(source, /playQueue\(shuffledLibraryTracks\(playableTracks\), 0\)/)
})
