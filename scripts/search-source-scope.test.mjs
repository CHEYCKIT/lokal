import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SEARCH_SCOPES, normalizeSearchScope, searchesLibrary, searchesOnline, scopeDescription } from '../src/searchScope.mjs'
import { SEARCH_RESULT_CATEGORIES, normalizeResultCategory, includesResultCategory, mergeSearchArtists, mergeSearchAlbums } from '../src/searchResultCategory.mjs'

test('source scope is exclusive and defaults safely to Library', () => {
  assert.deepEqual(SEARCH_SCOPES, ['library', 'online'])
  assert.equal(normalizeSearchScope(null), 'library')
  assert.equal(normalizeSearchScope('library'), 'library')
  assert.equal(normalizeSearchScope('online'), 'online')
  assert.equal(normalizeSearchScope('incorrect'), 'library')
})

test('source scope selects which catalogues actually run', () => {
  assert.deepEqual(SEARCH_SCOPES.map(scope => [
    scope, searchesLibrary(scope), searchesOnline(scope),
  ]), [
    ['library', true, false],
    ['online', false, true],
  ])
  assert.match(scopeDescription('online'), /online catalogues/i)
})

test('desktop search applies scope to both querying and rendered result sections', () => {
  const page = readFileSync(new URL('../src/pages/Search.jsx', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../src/store/search.js', import.meta.url), 'utf8')
  const online = readFileSync(new URL('../src/components/OnlineResults.jsx', import.meta.url), 'utf8')
  const header = readFileSync(new URL('../src/components/HeaderSearch.jsx', import.meta.url), 'utf8')

  // Online-only must not touch the local SQL search/lyrics APIs.
  assert.match(page, /if \(!showLibrary\) \{[\s\S]*?setTracks\(\[\]\); setArtists\(\[\]\)/)
  assert.match(page, /const showLibrary = searchesLibrary\(scope\)/)
  assert.match(page, /const showOnline = searchesOnline\(scope\)/)
  assert.match(page, /localArtists=\{showLibrary \? artists : \[\]\}/)
  assert.match(page, /localAlbums=\{showLibrary \? albums : \[\]\}/)
  assert.match(page, /\{showLibrary && showSongs && tracks\.length > 0/)
  assert.match(page, /\{showLibrary && showSongs && lyricMatches\.length > 0/)
  assert.match(page, /enableOnline=\{showOnline\}/)
  assert.match(page, /\{showOnline && showSongs && \(findOnRequest \|\| soulseekFor\) && <OnlineResults/)
  assert.match(page, /setScope\('online'\)/) // Find on provider
  assert.match(page, /aria-pressed=\{scope === value\}/)

  // The old independent globe would contradict the single-choice selector.
  assert.doesNotMatch(header, /setOnline\(!online\)/)
  assert.match(store, /lokal-search-scope/)
  assert.match(store, /lokal-online-search/)
  assert.match(online, /showLibraryHint \? t\(' · not in your library'\) : ''/)
  assert.match(page, /showLibraryHint=\{scope !== 'online'\}/)
  assert.match(page, /setResultCategory\('songs'\)/) // Find on source resets subfilter
})

test('category subfilter is single-choice and independent of source selection', () => {
  assert.deepEqual(SEARCH_RESULT_CATEGORIES, ['songs', 'artists', 'albums'])
  assert.equal(normalizeResultCategory('unknown'), 'songs')
  for (const category of ['songs', 'artists', 'albums']) {
    assert.equal(includesResultCategory(category, category), true)
    assert.equal(SEARCH_RESULT_CATEGORIES.filter(sel =>
      includesResultCategory(sel, category)).length, 1)
  }
  assert.equal(includesResultCategory('artists', 'songs'), false)
  assert.equal(includesResultCategory('songs', 'albums'), false)
})

test('local artists win, with no duplicate Global artist card', () => {
  const result = mergeSearchArtists(
    [{ id: 42, name: 'Björk', image_path: '/library/bjork.jpg' }],
    [{ id: 'spotify-1', title: 'BJÖRK', artwork_url: 'https://example.test/bjork.jpg' },
      { id: 'spotify-2', title: 'Sade' }],
  )
  assert.deepEqual(result.map(x => [x.origin, x.item.name || x.item.title]),
    [['library', 'Björk'], ['online', 'Sade']])
})

test('albums deduplicate with artist, preserving distinct releases', () => {
  const result = mergeSearchAlbums(
    [{ title: 'Discovery', artist: 'Daft Punk', track_count: 14 }],
    [{ id: 'a', title: 'Discovery', artist: 'Daft Punk' },
      { id: 'b', title: 'Discovery', artist: 'Other Artist' },
      { id: 'c', title: 'Random Access Memories', artist: 'Daft Punk' }],
  )
  assert.deepEqual(result.map(x => x.item.artist), [
    'Daft Punk', 'Other Artist', 'Daft Punk',
  ])
  const legacy = mergeSearchAlbums(
    [{ title: 'Discovery', track_count: 14 }],
    [{ id: 'a', title: 'Discovery', artist: 'Daft Punk' }],
  )
  assert.equal(legacy.length, 1)
})

test('the desktop has one artist/album presentation and one responsive category bar', () => {
  const page = readFileSync(new URL('../src/pages/Search.jsx', import.meta.url), 'utf8')
  const results = readFileSync(new URL('../src/components/GlobalCatalogueResults.jsx', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../src/store/search.js', import.meta.url), 'utf8')
  assert.match(page, /SEARCH_RESULT_CATEGORIES\.map\(value/)
  assert.match(page, /aria-pressed=\{resultCategory === value\}/)
  assert.match(page, /onClick=\{\(\) => setResultCategory\(value\)\}/)
  assert.match(store, /lokal-search-result-category/)
  assert.match(store, /resultCategory: readCategory\(\)/)
  assert.match(results, /mergeSearchArtists\(localArtists/)
  assert.match(results, /mergeSearchAlbums\(localAlbums/)
  assert.match(results, /showAlbums && \(enableOnline \|\| albums\.length > 0\)/)
  assert.match(results, /showArtists && \(enableOnline \|\| artists\.length > 0\)/)
  assert.match(results, /enableOnline && showSongs/)
  assert.match(page, /showOnline && showSongs && \(findOnRequest \|\| soulseekFor\) && <OnlineResults/)
  assert.doesNotMatch(page, /\{showLibrary && artists\.length > 0/)
  assert.doesNotMatch(page, /\{showLibrary && albums\.length > 0/)
})

test('Recent history follows selected scope and category rather than bypassing Online-only', () => {
  const page = readFileSync(new URL('../src/pages/Search.jsx', import.meta.url), 'utf8')
  assert.match(page, /scope === 'online' \? \[\] : recentItems\.filter/)
  assert.match(page, /scope === 'library' && item\.type === 'track' && isStreamed\(item\)/)
  assert.match(page, /resultCategory === 'artists' && item\.type === 'artist'/)
  assert.match(page, /resultCategory === 'albums' && item\.type === 'album'/)
  assert.match(page, /visibleRecentItems\.map\(\(item, i\) =>/)
  assert.match(page, /visibleRecentItems\.filter\(entry => entry\.type === 'track'\)/)
})

test('in-flight searches invalidate synchronously on source change', () => {
  const page = readFileSync(new URL('../src/pages/Search.jsx', import.meta.url), 'utf8')
  assert.match(page, /searchSeqRef\.current\+\+\s+setScope\('online'\)/)
  assert.match(page, /onClick=\{\(\) => \{[\s\S]*?value !== scope[\s\S]*?searchSeqRef\.current\+\+[\s\S]*?setScope\(value\)/)
  assert.match(page, /setCorrection\(null\)[\s\S]*?setOnlineQuery\(query\)/)
})


test('online categories each show a consistent heading and catalogue-specific subtitle', () => {
  const results = readFileSync(new URL('../src/components/GlobalCatalogueResults.jsx', import.meta.url), 'utf8')
  assert.match(results, /Online ' \+ categoryName/)
  assert.match(results, /catalogueName = catalogue === 'spotify' \? 'Spotify' : 'Apple Music'/)
  assert.match(results, /catalogue · plays through your configured sources/)
  assert.match(results, /heading\('Songs', 'songs'\)/)
  assert.match(results, /heading\('Albums', 'albums'\)/)
  assert.match(results, /heading\('Artists', 'artists'\)/)
  assert.doesNotMatch(results, />Global<\/h2>/)
})

test('the legacy provider search is not shown under normal Online or Library results', () => {
  const source = readFileSync(new URL('../src/pages/Search.jsx', import.meta.url), 'utf8')
  assert.match(source, /showOnline && showSongs && \(findOnRequest \|\| soulseekFor\) && <OnlineResults/)
  assert.match(source, /<GlobalCatalogueResults/)
})

test('artist portrait lookup avoids album covers and only accepts matching artist identities', () => {
  const source = readFileSync(new URL('../src/components/SearchArtistPortrait.jsx', import.meta.url), 'utf8')
  assert.match(source, /artistSearchMetadata\(name, \{ source: 'deezer' \}\)/)
  assert.match(source, /normalize\(row\?\.title\) === key/)
  assert.match(source, /if \(!known && \(!localPath \|\| !api\.isElectron \|\| brokenLocal\)\)/)
  const results = readFileSync(new URL('../src/components/GlobalCatalogueResults.jsx', import.meta.url), 'utf8')
  assert.match(results, /<SearchArtistPortrait/)
})
