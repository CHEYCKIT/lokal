import test from 'node:test'
import assert from 'node:assert/strict'
import { bestReplacement, losslessCandidates, rankReplacements, searchReplacements } from '../src/losslessReplacements.js'

const song = (extra = {}) => ({ id: 1, title: 'Around the World', artist: 'Daft Punk', duration: 429, file_path: '/m/a.mp3', lossless: 0, ...extra })
const source = (id, label = id) => ({ id, label })

test('losslessCandidates keeps upgradable songs once and counts the rest', () => {
  const { eligible, skipped } = losslessCandidates([
    song(), song(), // the same song twice
    song({ id: 2, lossless: 1 }), // already lossless
    song({ id: 3, file_path: 'ghost://yt/x' }), // a stream
    song({ id: 4, lossless: null }), // not read yet: offered
  ])
  assert.deepEqual(eligible.map(track => track.id), [1, 4])
  assert.equal(skipped, 2)
})

test('bestReplacement prefers the same length, then lossless, then rank and source order', () => {
  const track = song()
  const longer = { id: 'a', title: 'Around the World', artist: 'Daft Punk', duration: 480, quality: 'FLAC 24-bit' }
  const sameLossy = { id: 'b', title: 'Around the World', artist: 'Daft Punk', duration: 430, quality: '' }
  const sameLossless = { id: 'c', title: 'Around the World', artist: 'Daft Punk', duration: 428, quality: 'FLAC 16-bit' }
  const best = bestReplacement(track, [{ source: source('one'), items: [longer, sameLossy] }, { source: source('two'), items: [sameLossless] }])
  assert.equal(best.item.id, 'c')
  assert.equal(best.source.id, 'two')
  assert.equal(best.checked, true)
  assert.equal(best.lengthDiffers, false)
})

test('bestReplacement suggests a different length unticked, and nothing without matches', () => {
  const only = bestReplacement(song(), [{ source: source('one'), items: [{ id: 'a', title: 'Around the World', artist: 'Daft Punk', duration: 480 }] }])
  assert.equal(only.checked, false)
  assert.equal(only.lengthDiffers, true)
  assert.equal(bestReplacement(song(), [{ source: source('one'), items: [] }, { source: source('two'), items: [], error: 'down' }]), null)
})

test('rankReplacements drops previews, lossy labels and weak matches', () => {
  const items = [
    { id: 1, title: 'Around the World', artist: 'Daft Punk', duration: 429, quality: 'FLAC' },
    { id: 2, title: 'Around the World', artist: 'Daft Punk', duration: 429, quality: 'MP3 320kbps' },
    { id: 3, title: 'Around the World', artist: 'Daft Punk', duration: 429, preview: true },
    { id: 4, title: 'Something Else', artist: 'Someone', duration: 200 },
  ]
  assert.deepEqual(rankReplacements(song(), items).map(item => item.id), [1])
})

test('searchReplacements asks each source and keeps its error', async () => {
  const asked = []
  const client = {
    onlineSearch: async (query, id) => {
      asked.push([query, id])
      if (id === 'bad') return { error: 'offline' }
      return [{ id: 'x', title: 'Around the World', artist: 'Daft Punk', duration: 429, quality: 'FLAC' }]
    },
  }
  const groups = await searchReplacements(song({ artist: 'Daft Punk, Someone' }), [source('good'), source('bad')], client)
  assert.deepEqual(asked, [['Daft Punk Around the World', 'good'], ['Daft Punk Around the World', 'bad']])
  assert.equal(groups[0].items[0].provider, 'good')
  assert.equal(groups[1].error, 'offline')
})

test('bestReplacement leaves a match of unknown length unticked, after one known to match', () => {
  const noLength = { id: 'n', title: 'Around the World', artist: 'Daft Punk', quality: 'FLAC' }
  const unknown = bestReplacement(song(), [{ source: source('one'), items: [noLength] }])
  assert.equal(unknown.checked, false)
  assert.equal(unknown.lengthUnknown, true)
  assert.equal(unknown.lengthDiffers, false)
  assert.equal(bestReplacement(song({ duration: 0 }), [{ source: source('one'), items: [{ ...noLength, duration: 429 }] }]).checked, false)
  const known = { id: 'k', title: 'Around the World', artist: 'Daft Punk', duration: 430 }
  assert.equal(bestReplacement(song(), [{ source: source('one'), items: [noLength, known] }]).item.id, 'k')
})
