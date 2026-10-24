import { createRequire } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const {
  isConfirmedBitstream, outputOptions, supportedHost, mpvCandidates,
  parseAudioDevices, inspectAtmosFile,
} = require('../electron/audio/atmos.js')

test('only the native HDMI compressed bitstream path is offered', () => {
  assert.equal(supportedHost('darwin'), true)
  assert.equal(supportedHost('win32'), true)
  assert.equal(supportedHost('freebsd'), false)
  assert.deepEqual(
    outputOptions('win32', 'wasapi/{0.0.0.00000000}.{abcd}').filter(v => v.startsWith('--ao=') || v.startsWith('--audio-spdif=')),
    ['--audio-spdif=eac3']
  )
  assert.equal(outputOptions('win32').includes('--ao=wasapi'), true)
  assert.equal(outputOptions('win32').includes('--audio-exclusive=yes'), true)
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

test('portable Windows mpv, winget and Scoop locations are candidates independent of PATH', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\tester',
    ProgramFiles: 'C:\\Program Files',
  }
  const candidates = mpvCandidates({ platform: 'win32', env, resourcesPath: 'C:\\Lokal\\resources',
    userBin: 'C:\\Lokal\\userdata\\bin', customPath: 'D:\\Portable\\mpv.exe' })
  assert.equal(candidates[0], 'D:\\Portable\\mpv.exe')
  assert.ok(candidates.includes('mpv'))
  assert.ok(candidates.some(value => value.includes('WinGet') && value.endsWith('mpv.exe')))
  assert.ok(candidates.some(value => value.includes('scoop') && value.endsWith('mpv.exe')))
  assert.ok(candidates.some(value => value.includes('userdata') && value.endsWith('mpv.exe')))
  assert.equal(new Set(candidates).size, candidates.length)
})

test('device enumeration offers only host-compatible outputs', () => {
  const output = [
    " 'auto' (Autoselect device)",
    " 'wasapi/{0.0.0.00000000}.{abc}' (LG HDMI Receiver)",
    " 'wasapi/{0.0.0.00000000}.{def}' (Headphones)",
    " 'pulse/alsa_output' (PulseAudio sink)",
    " 'coreaudio/42' (USB DAC)",
  ].join('\n')
  assert.deepEqual(parseAudioDevices(output, 'win32'), [
    { id: 'wasapi/{0.0.0.00000000}.{abc}', label: 'LG HDMI Receiver' },
    { id: 'wasapi/{0.0.0.00000000}.{def}', label: 'Headphones' },
  ])
  assert.deepEqual(parseAudioDevices(output, 'darwin'), [{ id: 'coreaudio/42', label: 'USB DAC' }])
  assert.deepEqual(parseAudioDevices(output, 'linux'), [])
})

test('local files cannot be identified as Atmos without a codec/profile probe', async () => {
  await assert.rejects(inspectAtmosFile('anything.m4a', null), /FFprobe is required/)
})

test('Windows headphone capabilities are distinct from native HDMI availability', () => {
  const { headphoneCapability } = require('../electron/audio/headphones.js')
  assert.deepEqual(headphoneCapability('linux'), {
    available: false, mode: 'windows-media-foundation', rendererVerified: false,
  })
  assert.deepEqual(headphoneCapability('darwin'), {
    available: false, mode: 'windows-media-foundation', rendererVerified: false,
  })
})


test('Windows headphone decoder failures retain native diagnostics and never claim Atmos', () => {
  const { headphoneDecoderFailure } = require('../electron/audio/headphones.js')
  const detailed = headphoneDecoderFailure(
    'Unsupported video type [MediaPlayerError=SourceNotSupported; HRESULT=0xC00D36C4]'
  )
  assert.match(detailed, /Windows Media Foundation/)
  assert.match(detailed, /SourceNotSupported/)
  assert.match(detailed, /0xC00D36C4/)
  assert.match(detailed, /E-AC-3/)
  assert.doesNotMatch(detailed, /Atmos (?:rendered|enabled successfully)/i)
  assert.match(headphoneDecoderFailure(''), /decoder could not open/i)
})
