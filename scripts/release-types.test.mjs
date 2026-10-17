import assert from 'node:assert/strict'
import { test } from 'node:test'

const store = new Map()
globalThis.localStorage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => { store.set(key, String(value)) } }
const { groupReleases, releaseTypeCounts, releaseTypeOf, shownReleaseTypes } = await import('../src/releaseTypes.js')

const releases = [
  { title: 'I Am', release_type: 'album' }, { title: 'Let\'s Go Dumb Crasy', release_type: 'ep' },
  { title: 'September', release_type: 'single' }, { title: 'Live in Tokyo', release_type: 'live' },
  { title: 'Greatest Hits', release_type: 'compilation' }, { title: 'Raise!' }, { title: 'Odd', release_type: 'bootleg' }, { title: 'Unknown Album', release_type: 'album' },
]

test('releases come in sections, in a fixed order, unknown types as unknown albums', () => {
  assert.deepEqual(groupReleases(releases).map(group => [group.label, group.items.map(item => item.title)]), [
    ['Albums', ['I Am']], ['EPs', ["Let's Go Dumb Crasy"]], ['Singles', ['September']], ['Compilations', ['Greatest Hits']], ['Live', ['Live in Tokyo']], ['Unknown albums', ['Raise!', 'Odd', 'Unknown Album']],
  ])
  assert.equal(releaseTypeOf({}), 'unknown')
  assert.deepEqual(releaseTypeCounts(releases.slice(0, 3)).map(entry => [entry.type, entry.count]), [['album', 1], ['ep', 1], ['single', 1]])
})

test('hidden types are left out; the choice is per artist, all shown until chosen', () => {
  assert.deepEqual(groupReleases(releases, new Set(['album', 'single'])).map(group => group.type), ['album', 'single'])
  assert.equal(shownReleaseTypes('Earth, Wind & Fire').size, 6)
  store.set('lokal-artist-release-types', JSON.stringify({ 'earth wind fire': ['album', 'ep', 'nonsense'] }))
  assert.deepEqual([...shownReleaseTypes('Earth Wind & Fire')], ['album', 'ep'])
  assert.equal(shownReleaseTypes('Someone Else').size, 6)
  store.set('lokal-artist-release-types', 'not json')
  assert.equal(shownReleaseTypes('Earth, Wind & Fire').size, 6)
})
