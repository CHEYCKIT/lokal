import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextPlaylistSort, sortPlaylistTracks } from '../src/playlistSorting.js'

const tracks = [
  { id: 'first', added_at: 1700000000000, duration: 600 },
  { id: 'second', added_at: 1700000100, duration: '90' },
  { id: 'third', added_at: 1699999900000, duration: 90 },
  { id: 'unknown', added_at: null, duration: null },
]
const ids = items => items.map(track => track.id)

test('each playlist column toggles its direction and a newly chosen column starts ascending', () => {
  let sort = { column: 'number', direction: 'asc' }
  for (const column of ['number', 'added', 'time']) {
    sort = nextPlaylistSort(sort, column)
    assert.equal(sort.direction, column === 'number' ? 'desc' : 'asc')
    assert.equal(sort.column, column)
    sort = nextPlaylistSort(sort, column)
    assert.equal(sort.direction, column === 'number' ? 'asc' : 'desc')
  }
})

test('playlist number restores or reverses the original list order without mutating it', () => {
  assert.equal(sortPlaylistTracks(tracks, { column: 'number', direction: 'asc' }), tracks)
  assert.deepEqual(ids(sortPlaylistTracks(tracks, { column: 'number', direction: 'desc' })), ['unknown', 'third', 'second', 'first'])
  assert.deepEqual(ids(tracks), ['first', 'second', 'third', 'unknown'])
})

test('date added sorts actual instants across seconds and milliseconds with missing dates last', () => {
  assert.deepEqual(ids(sortPlaylistTracks(tracks, { column: 'added', direction: 'asc' })), ['third', 'first', 'second', 'unknown'])
  assert.deepEqual(ids(sortPlaylistTracks(tracks, { column: 'added', direction: 'desc' })), ['second', 'first', 'third', 'unknown'])
})

test('duration sorts numerically, preserves playlist order for ties, and leaves unknown lengths last in both directions', () => {
  assert.deepEqual(ids(sortPlaylistTracks(tracks, { column: 'time', direction: 'asc' })), ['second', 'third', 'first', 'unknown'])
  assert.deepEqual(ids(sortPlaylistTracks(tracks, { column: 'time', direction: 'desc' })), ['first', 'second', 'third', 'unknown'])
})

test('bad metadata stays last and equal instants keep the playlist order in either direction', () => {
  const items = [
    { id: 'a', added_at: 1700000000000, duration: 60 },
    { id: 'b', added_at: 1700000000, duration: 60 },
    { id: 'invalid', added_at: 'bad', duration: Infinity },
    { id: 'zero', added_at: 0, duration: 0 },
    { id: 'negative', added_at: -1, duration: -1 },
  ]
  for (const column of ['added', 'time']) for (const direction of ['asc', 'desc']) {
    const sorted = sortPlaylistTracks(items, { column, direction })
    assert.deepEqual(ids(sorted), ids(items))
    assert.equal(sorted[0], items[0], 'sorting retains track identity and metadata')
  }
})
