import { createRequire } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { isConfirmedBitstream, outputOptions, supportedHost } = require('../electron/audio/atmos.js')

test('only native WASAPI or ALSA HDMI passthrough can be selected', () => {
  assert.equal(supportedHost('darwin'), true)
  assert.equal(supportedHost('win32'), true)
  assert.deepEqual(
    outputOptions('win32', 'wasapi/{0.0.0.00000000}.{abcd}').filter(v => v.startsWith('--ao=') || v.startsWith('--audio-spdif=')),
    ['--audio-spdif=eac3']
  )
  assert.throws(() => outputOptions('linux', 'wasapi/abc'), /does not match/)
  assert.throws(() => outputOptions('win32', '--audio-device=foo'), /Choose/)
  assert.equal(outputOptions('darwin').includes('--ao=coreaudio'), true)
  assert.equal(outputOptions('darwin', 'coreaudio/1').includes('--audio-spdif=eac3'), true)
  assert.equal(outputOptions('linux').includes('--ao=alsa'), true)
})

test('only an explicitly reported compressed eac3 AO counts as Atmos bitstream', () => {
  assert.equal(isConfirmedBitstream('AO: [wasapi] 48000Hz 5.1 6ch spdif-eac3'), true)
  assert.equal(isConfirmedBitstream('AO: [alsa] 48000Hz 5.1 6ch spdif-eac3'), true)
  assert.equal(isConfirmedBitstream('AO: [wasapi] 48000Hz stereo 2ch float'), false)
  assert.equal(isConfirmedBitstream('Decoder: eac3; AO: [wasapi] 48000Hz 5.1 6ch s32'), false)
})
