import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLibraryIndex, inLibraryIndex } from '../src/libraryIndex.js'

const index = buildLibraryIndex([
  ['Earth, Wind & Fire', 'September', 'yt:Gs069dndIYk'],
  ['Basia', 'Third Time Lucky', null],
  ['Irene Cara', 'Flashdance...What a Feeling', 'a-2805d04035:123'],
  ['Daft Punk', 'One More Time (Live)', null],
])

test('a song downloaded before is found by where it came from, whatever its title there', () => {
  assert.equal(inLibraryIndex(index, { ref: { provider: 'yt', id: 'Gs069dndIYk' }, artist: 'Someone', title: 'Something else' }), true)
  assert.equal(inLibraryIndex(index, { ref: { provider: 'a-2805d04035', id: '123' } }), true)
  assert.equal(inLibraryIndex(index, { ref: { provider: 'yt', id: 'XXXXXXXXXXX' } }), false)
})

test('or by artist and title: remaster labels, "Artist - Title" videos, credited artists, accents and case', () => {
  assert.equal(inLibraryIndex(index, { artist: 'Earth, Wind & Fire', title: 'September (2018 Remaster)' }), true)
  assert.equal(inLibraryIndex(index, { artist: 'Earth, Wind & Fire', title: 'Earth, Wind & Fire - September' }), true)
  assert.equal(inLibraryIndex(index, { artist: 'Earth, Wind & Fire, The Emotions', artists: ['Earth, Wind & Fire', 'The Emotions'], title: 'September' }), true)
  assert.equal(inLibraryIndex(index, { artist: 'basia', title: 'THIRD TIME LUCKY' }), true)
  assert.equal(inLibraryIndex(index, { artist: 'Basia feat. Someone', title: 'Third Time Lucky' }), true)
})

test("another recording, artist or song isn't taken for the library's", () => {
  assert.equal(inLibraryIndex(index, { artist: 'Daft Punk', title: 'One More Time' }), false)
  assert.equal(inLibraryIndex(index, { artist: 'Earth, Wind & Fire', title: 'September (Live)' }), false)
  assert.equal(inLibraryIndex(index, { artist: 'The Cover Band', title: 'September' }), false)
  assert.equal(inLibraryIndex(index, { artist: 'Earth', title: 'September' }), false)
  assert.equal(inLibraryIndex(null, { artist: 'Basia', title: 'Third Time Lucky' }), false)
})

test("a low-quality copy is told apart; a good copy of the same song wins", async () => {
  const { libraryCopy } = await import('../src/libraryIndex.js')
  const low = buildLibraryIndex([['Basia', 'Third Time Lucky', 'yt:aaaaaaaaaaa', 1]])
  assert.deepEqual(libraryCopy(low, { artist: 'Basia', title: 'Third Time Lucky' }), { low: true })
  assert.deepEqual(libraryCopy(low, { ref: { provider: 'yt', id: 'aaaaaaaaaaa' } }), { low: true })
  const both = buildLibraryIndex([['Basia', 'Third Time Lucky', null, 1], ['Basia', 'Third Time Lucky', null, 0]])
  assert.deepEqual(libraryCopy(both, { artist: 'Basia', title: 'Third Time Lucky' }), { low: false })
  assert.equal(libraryCopy(both, { artist: 'Basia', title: 'Cruising for Bruising' }), null)
})
