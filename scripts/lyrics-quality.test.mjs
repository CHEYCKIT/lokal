import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { lyricsQualityRank, retainBetterLyrics } = require('../electron/lyrics/service.js')

const plain = { type: 'plain', sync: 'none', lines: [{ text: 'Some words', time: null, words: [] }], source: 'local' }
const line = { type: 'synced', sync: 'line', lines: [{ text: 'Some words', time: 1000, words: [] }], source: 'remote' }
const syllable = { type: 'syllable', sync: 'syllable', lines: [{ text: 'Some words', time: 1000, words: [{ word: 'Some', time: 1000 }] }], source: 'remote' }
const instrumental = { type: 'instrumental', sync: 'none', lines: [], instrumental: true }

test('lyrics quality ranks syllable timing above line timing, plain text, and no lyric result', () => {
  assert.equal(lyricsQualityRank(syllable), 3)
  assert.equal(lyricsQualityRank(line), 2)
  assert.equal(lyricsQualityRank(plain), 1)
  assert.equal(lyricsQualityRank(instrumental), 0)
  assert.equal(lyricsQualityRank(null), 0)
})

test('equal or lower quality refreshes keep the existing file lyrics', () => {
  assert.equal(retainBetterLyrics(plain, { ...plain, source: 'remote' }), plain)
  assert.equal(retainBetterLyrics(line, plain), line)
  assert.equal(retainBetterLyrics(syllable, line), syllable)
})

test('higher quality lyrics are allowed to replace the existing result', () => {
  assert.equal(retainBetterLyrics(plain, line), line)
  assert.equal(retainBetterLyrics(line, syllable), syllable)
  assert.equal(retainBetterLyrics(null, plain), plain)
})
