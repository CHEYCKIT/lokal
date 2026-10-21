import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { exportedLyrics } = require('../electron/link/lyricsExport')

test('paired copy exports cached syllables over a line-only sidecar', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lokal-lyrics-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, 'song.lrc'), '[00:10.00]見覚えのある')
  const words = [{ word: '見覚え', time: 10, end: 11 }, { word: 'のある', time: 11, end: 13 }]
  const result = await exportedLyrics({ file_path: path.join(dir, 'song.flac'), lyrics_type: 'syllable',
    source: 'binilyrics', content: JSON.stringify([{ text: '見覚えのある', time: 10, end: 13, words }]),
    meta: JSON.stringify({ sync: 'syllable', language: 'ja' }) })
  assert.equal(result.source, 'binilyrics')
  assert.equal(result.language, 'ja')
  assert.deepEqual(result.lines[0].words, words)
})

test('paired copy reads existing TTML without a fetched cache or meta column', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lokal-lyrics-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, 'song.ttml'), '<tt xml:lang="ja"><body><div><p begin="10.25" end="13"><span begin="10.25" end="11">見覚え</span><span begin="11" end="13">のある</span></p></div></body></tt>')
  const result = await exportedLyrics({ file_path: path.join(dir, 'song.flac') })
  assert.equal(result.sync, 'syllable')
  assert.equal(result.lines.find(l => !l.gap).words[0].time, 10.25)
  assert.equal(result.lines.find(l => !l.gap).words[1].end, 13)
})

test('ghost songs cannot export lyric cache data', async () => {
  assert.equal(await exportedLyrics({ file_path: 'ghost://streamed-once', content: '[{"text":"private"}]' }), null)
})
