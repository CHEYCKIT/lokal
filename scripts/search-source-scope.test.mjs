import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SEARCH_SCOPES, normalizeSearchScope, searchesLibrary, searchesOnline, scopeDescription } from '../src/searchScope.mjs'

test('source scope is exclusive and defaults safely to All', () => {
  assert.deepEqual(SEARCH_SCOPES, ['all', 'library', 'online'])
  assert.equal(normalizeSearchScope(null), 'all')
  assert.equal(normalizeSearchScope('library'), 'library')
  assert.equal(normalizeSearchScope('online'), 'online')
  assert.equal(normalizeSearchScope('incorrect'), 'all')
})

test('source scope selects which catalogues actually run', () => {
  assert.deepEqual(SEARCH_SCOPES.map(scope => [
    scope, searchesLibrary(scope), searchesOnline(scope),
  ]), [
    ['all', true, true],
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
  assert.match(page, /\{showLibrary && artists\.length > 0/)
  assert.match(page, /\{showLibrary && albums\.length > 0/)
  assert.match(page, /\{showLibrary && tracks\.length > 0/)
  assert.match(page, /\{showLibrary && lyricMatches\.length > 0/)
  assert.match(page, /\{showOnline && <GlobalCatalogueResults/)
  assert.match(page, /\{showOnline && <OnlineResults/)
  assert.match(page, /setScope\('online'\)/) // Find on provider
  assert.match(page, /aria-pressed=\{scope === value\}/)

  // The old independent globe would contradict the single-choice selector.
  assert.doesNotMatch(header, /setOnline\(!online\)/)
  assert.match(store, /lokal-search-scope/)
  assert.match(store, /lokal-online-search/)
  assert.match(online, /showLibraryHint \? t\(' · not in your library'\) : ''/)
  assert.match(page, /showLibraryHint=\{scope !== 'online'\}/)
})
