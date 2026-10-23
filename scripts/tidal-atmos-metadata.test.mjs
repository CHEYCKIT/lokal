import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { hasAtmosMetadata } = require('../electron/mornye/atmos.js')

test('recognizes Tidal Atmos modes from source metadata', () => {
  for (const input of [
    { audio_modes: ['STEREO', 'DOLBY_ATMOS'] },
    { audio_modes: 'DOLBY_ATMOS' }, // Tidal-web Mornye extension shape
    { audioModes: ['DOLBY_ATMOS'] },
    { audio_mode: 'DOLBY_ATMOS' },
    { audioMode: 'DOLBY ATMOS' },
    { audio_quality: 'DOLBY_ATMOS' },
  ]) assert.equal(hasAtmosMetadata(input), true)
})

test('does not infer Atmos from stereo, lossless or HiRes quality', () => {
  for (const input of [
    { audio_quality: 'HI_RES_LOSSLESS' },
    { audioModes: ['STEREO'], audioQuality: 'LOSSLESS' },
    { audio_mode: 'STEREO', bit_depth: 24, sample_rate: 96000 },
    { codec: 'eac3', channels: 6 },
    {},
  ]) assert.equal(hasAtmosMetadata(input), false)
})
