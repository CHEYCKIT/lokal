import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { classifyCodec } = require('../electron/download/convert.js')

test('ALAC codec names are recognized as unplayable lossless audio', () => {
  for (const codec of ['ALAC', 'Apple Lossless', 'Apple Lossless Audio Codec']) {
    assert.deepEqual(classifyCodec(codec), {
      codec,
      lossless: true,
      unplayable: true,
    }, codec)
  }
})

test('container metadata identifies unsupported ALAC when codec is missing', () => {
  for (const container of ['ALAC', 'Apple Lossless', 'Apple Lossless Audio Codec']) {
    for (const missingCodec of ['', '   ']) {
      assert.deepEqual(classifyCodec(missingCodec, false, container), {
        codec: container,
        lossless: true,
        unplayable: true,
      }, container)
    }
  }
})

test('existing unsupported lossless codecs still use the lossless fallback', () => {
  for (const codec of ['FLAC', 'APE', 'WavPack', 'DSD']) {
    const result = classifyCodec(codec)
    assert.equal(result.lossless, true, codec)
    assert.equal(result.unplayable, codec !== 'FLAC', codec)
  }
})

test('playable AAC is not classified as unsupported even when metadata is lossless', () => {
  assert.deepEqual(classifyCodec('AAC', true), {
    codec: 'AAC',
    lossless: true,
    unplayable: false,
  })
})
