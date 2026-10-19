import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseLRC, parseEnhancedLRC, parseKaraokeLRC } = require('../electron/lyrics/lrc.js')
const { parseAny } = require('../electron/lyrics/detect.js')
const { embeddedText, recoverTranslations } = require('../electron/lyrics/providers/local.js')
const { toPortableLyrics, toPrivateTag, fromPrivateTag } = require('../electron/lyrics/embedded.js')

const lineSynced = `[00:01.00]第一行
First line
[00:02.00]第二行
Second line
[00:03.00]第三行
Third line`

test('line-synced LRC keeps each untimestamped translation on the previous lyric line', () => {
  const lines = parseLRC(lineSynced)
  assert.equal(lines.length, 3)
  assert.deepEqual(lines.map(line => line.translation?.text), ['First line', 'Second line', 'Third line'])
})

test('enhanced LRC keeps translations while preserving word timings', () => {
  const lyrics = `[00:01.00]<00:01.00>第一<00:01.40>行<00:01.70>
First line
[00:02.00]<00:02.00>第二<00:02.40>行<00:02.70>
Second line
[00:03.00]<00:03.00>第三<00:03.40>行<00:03.70>
Third line`
  const lines = parseEnhancedLRC(lyrics)
  assert.equal(lines.length, 3)
  assert.ok(lines.every(line => line.words.length > 0))
  assert.deepEqual(lines.map(line => line.translation?.text), ['First line', 'Second line', 'Third line'])
})

test('karaoke LRC keeps translations below timed lines', () => {
  const lyrics = `[1000,900](1000,400,0)第一行
First line
[2000,900](2000,400,0)第二行
Second line
[3000,900](3000,400,0)第三行
Third line`
  const lines = parseKaraokeLRC(lyrics)
  assert.equal(lines.length, 3)
  assert.deepEqual(lines.map(line => line.translation?.text), ['First line', 'Second line', 'Third line'])
})

test('portable and private Lokal lyric tags round-trip line translations', () => {
  const result = {
    type: 'synced',
    sync: 'line',
    source: 'local',
    language: 'zh',
    lines: [
      { time: 1, text: '第一行', words: [], translation: { text: 'First line', bgText: null } },
      { time: 2, text: '第二行', words: [], translation: { text: 'Second line', bgText: null } },
    ],
  }
  const portable = toPortableLyrics(result)
  assert.match(portable, /\[00:01\.00\]第一行\nFirst line/)
  assert.deepEqual(parseAny(portable).lines.map(line => line.translation?.text), ['First line', 'Second line'])
  const privateTag = toPrivateTag(result)
  assert.deepEqual(fromPrivateTag(privateTag).lines.map(line => line.translation?.text), ['First line', 'Second line'])
})
test('embedded lyric reader prefers the synced tag that also contains translations', () => {
  const meta = {
    native: {
      ID3v2: [
        { id: 'SYLT', value: { timeStampFormat: 2, syncText: [
          { timestamp: 1000, text: '第一行' },
          { timestamp: 2000, text: '第二行' },
          { timestamp: 3000, text: '第三行' },
        ] } },
        { id: 'USLT', value: { text: lineSynced } },
      ],
    },
  }
  const text = embeddedText(meta)
  assert.match(text, /First line/)
  assert.deepEqual(parseAny(text).lines.map(line => line.translation?.text), ['First line', 'Second line', 'Third line'])
})

test('portable LRC omits sparse translations that its reader must reject as ambiguous', () => {
  const result = {
    type: 'synced',
    sync: 'line',
    lines: [
      { time: 1, text: 'One', words: [], translation: { text: 'Uno' } },
      { time: 2, text: 'Two', words: [] },
      { time: 3, text: 'Three', words: [] },
    ],
  }
  const portable = toPortableLyrics(result)
  assert.ok(portable)
  assert.doesNotMatch(portable, /Uno/)
  assert.ok(parseAny(portable).lines.every(line => !line.translation?.text))
})

test('an empty enhanced timestamped line breaks translation adjacency', () => {
  const lyrics = `[00:01.00]<00:01.00>First<00:01.80>
[00:02.00]<00:02.00><00:02.80>
Orphan translation
[00:03.00]<00:03.00>Third<00:03.80>`
  const lines = parseEnhancedLRC(lyrics)
  assert.equal(lines.length, 2)
  assert.ok(lines.every(line => !line.translation?.text))
})

test('an empty karaoke timestamped line breaks translation adjacency', () => {
  const lyrics = `[1000,900](1000,400,0)First
[2000,900]
Orphan translation
[3000,900](3000,400,0)Third`
  const lines = parseKaraokeLRC(lyrics)
  assert.equal(lines.length, 2)
  assert.ok(lines.every(line => !line.translation?.text))
})

test('standard lyrics recover missing translations in a partially translated private tag', () => {
  const own = {
    language: 'zh',
    lines: [
      { time: 1, text: '第一行', words: [], translation: { text: 'Keep this one', bgText: null } },
      { time: 2, text: '第二行', words: [] },
    ],
  }
  const recovered = recoverTranslations(own, `[00:01.00]第一行
Standard first
[00:02.00]第二行
Standard second`)
  assert.ok(recovered)
  assert.equal(recovered.lines[0].translation.text, 'Keep this one')
  assert.equal(recovered.lines[1].translation.text, 'Standard second')
})

test('repeated timestamps recover each line from a different standard source line', () => {
  const own = {
    language: 'zh',
    lines: [
      { time: 1, text: '第一行', words: [] },
      { time: 1, text: '第二行', words: [] },
    ],
  }
  const recovered = recoverTranslations(own, `[00:01.00]第一行
First line
[00:01.00]第二行
Second line`)
  assert.ok(recovered)
  assert.deepEqual(recovered.lines.map(line => line.translation?.text), ['First line', 'Second line'])
})
