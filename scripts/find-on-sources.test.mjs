import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FIND_ON_SOURCES, buildFindOnRequest, orderedFindOnSources } from '../src/findOnSources.js'

test('lists built-in sources, Soulseek, then enabled addon sources with their icons', () => {
  const sources = orderedFindOnSources([
    { id: 'yt', label: 'YouTube Music' },
    { id: 'sc', label: 'SoundCloud' },
    { id: 'a-1234567890', label: 'HiFi addon', addon: true, icon: 'https://example.com/icon.png' },
  ])
  assert.deepEqual(sources.map(source => source.id), ['yt', 'sc', 'slsk', 'a-1234567890'])
  assert.equal(sources[3].label, 'HiFi addon')
  assert.equal(sources[3].icon, 'https://example.com/icon.png')
})

test('exports valid default menu sources including Soulseek', () => {
  assert.deepEqual(DEFAULT_FIND_ON_SOURCES.map(source => source.id), ['yt', 'sc', 'slsk'])
})

test('uses safe defaults and does not duplicate Soulseek or providers', () => {
  const sources = orderedFindOnSources([{ id: 'slsk', label: 'Old Soulseek entry' }, { id: 'yt', label: 'YT' }])
  assert.deepEqual(sources.map(source => source.id), ['yt', 'sc', 'slsk'])
  assert.equal(sources.find(source => source.id === 'slsk').label, 'Soulseek')
})

test('builds a source search request that retains the replacement track', () => {
  const request = buildFindOnRequest('sc', {
    id: 'ghost://youtube/online/abcdefghijk',
    title: 'A Song (feat. Guest)',
    artist: 'An Artist',
  })
  assert.deepEqual(request, {
    provider: 'sc',
    query: 'An Artist A Song',
    replaceTrackId: 'ghost://youtube/online/abcdefghijk',
    title: 'A Song (feat. Guest)',
    artist: 'An Artist',
  })
})

test('builds a useful query from metadata when the track has not been materialized yet', () => {
  const request = buildFindOnRequest('a-1234567890', null, { title: 'Track', artists: ['A', 'B'] })
  assert.equal(request.query, 'A, B Track')
  assert.equal(request.replaceTrackId, undefined)
})
