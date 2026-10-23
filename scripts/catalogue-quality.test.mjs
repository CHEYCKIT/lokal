import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

// The renderer utility is an ESM module loaded by Vite; importing a data URL
// avoids changing Electron's CommonJS package type just for this test.
const source = readFileSync(new URL('../src/catalogueQuality.js', import.meta.url), 'utf8')
const { advertisedQuality } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

test('show known bit depth and kHz without inventing missing sample rate', () => {
  assert.equal(advertisedQuality({ quality: '24bit/96kHz' }), '24-bit / 96 kHz')
  assert.equal(advertisedQuality({ quality: '16bit/44.1kHz' }), '16-bit / 44.1 kHz')
  assert.equal(advertisedQuality({ quality: '24bit' }), '24-bit')
  assert.equal(advertisedQuality({ quality: 'HI_RES_LOSSLESS' }), 'Hi-res lossless')
  assert.equal(advertisedQuality({}), '')
  assert.equal(advertisedQuality({ bit_depth: 24, sample_rate: 96000 }), '24-bit / 96 kHz')
})
