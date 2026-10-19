import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parseAny } = require('../electron/lyrics/detect')
const { finish } = require('../electron/lyrics/postprocess')
const { embeddedText } = require('../electron/lyrics/providers/local')

const FILE = '[00:21.65] Saigo no Kisu wa\n    The last kiss\n\n[00:26.60] Tabako no flavor ga shita\n    Had a tobacco flavor\n\n[00:38.95]\n\n[00:42.94] Ashita no ima goro ni wa\n'

test('an LRC with a translation under each line stays line-synced and keeps the translations', () => {
  const parsed = parseAny(FILE)
  const result = finish(parsed.lines, { source: 'local' })
  assert.equal(result.type, 'synced')
  const sung = result.lines.filter(line => line.text)
  assert.deepEqual(sung.map(line => [line.time, line.text, line.translation?.text || null]), [
    [21.65, 'Saigo no Kisu wa', 'The last kiss'],
    [26.6, 'Tabako no flavor ga shita', 'Had a tobacco flavor'],
    [42.94, 'Ashita no ima goro ni wa', null],
  ])
  assert.equal(result.translationLang, '*')
})

test('a file with plain and synced lyrics tags gives the synced one', () => {
  assert.equal(embeddedText({ common: { lyrics: ['Saigo no Kisu wa', FILE] } }), FILE)
})
