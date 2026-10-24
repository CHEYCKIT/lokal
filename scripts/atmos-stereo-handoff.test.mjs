import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { beginAtmosOutputRelease, awaitAtmosOutputRelease, shouldToggleNormalStream } from '../src/audio/atmosHandoff.mjs'

const require = createRequire(import.meta.url)
const { stereoPlaybackQuality, isAtmosQuality } = require('../electron/mornye/playbackQuality.js')

test('Atmos is never selected for regular Tidal streaming, even if configured as default', () => {
  const addon = {
    name: 'tidal',
    manifest: { qualityOptions: [
      { id: 'DOLBY_ATMOS', kind: 'spatial' },
      { id: 'HIGH', kind: 'lossy' },
      { id: 'LOSSLESS', kind: 'lossless' },
      { id: 'HI_RES_LOSSLESS', kind: 'lossless' },
    ] },
  }
  assert.equal(stereoPlaybackQuality(addon, { downloadQuality: 'DOLBY_ATMOS' }), 'HI_RES_LOSSLESS')
  assert.equal(stereoPlaybackQuality(addon, { downloadQuality: 'LOSSLESS' }), 'LOSSLESS')
  assert.equal(stereoPlaybackQuality(addon, { downloadQuality: 'HIGH' }), 'HIGH')
  assert.equal(stereoPlaybackQuality(addon, { downloadQuality: 'ATMOS' }), 'HI_RES_LOSSLESS')
  assert.equal(stereoPlaybackQuality({ name: 'Tidal', manifest: {} }, { downloadQuality: 'DOLBY_ATMOS' }), 'HI_RES_LOSSLESS')
  assert.equal(isAtmosQuality(stereoPlaybackQuality(addon, { downloadQuality: 'DOLBY_ATMOS' })), false)
})

test('only lossless/stereo tiers are used when no preferred quality exists', () => {
  const addon = { name: 'tidal', manifest: { qualityOptions: [
    { id: 'DOLBY_ATMOS' }, { id: 'LOSSLESS', kind: 'lossless' },
  ] } }
  assert.equal(stereoPlaybackQuality(addon, { downloadQuality: 'DOLBY_ATMOS' }), 'LOSSLESS')
  assert.equal(stereoPlaybackQuality({ name: 'other', manifest: {} }, { downloadQuality: 'DOLBY_ATMOS' }), undefined)
  assert.equal(stereoPlaybackQuality(addon, {}), undefined)
})

test('Atmos-to-normal handoff holds the PCM start until native teardown completes', async () => {
  let finish
  const nativeStopped = new Promise(resolve => { finish = resolve })
  const events = []
  const native = beginAtmosOutputRelease(async () => {
    events.push('native_stop_begin')
    await nativeStopped
    events.push('native_stop_complete')
  })
  const pcm = awaitAtmosOutputRelease().then(() => events.push('pcm_start'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, ['native_stop_begin'])
  finish()
  await Promise.all([native, pcm])
  assert.deepEqual(events, ['native_stop_begin', 'native_stop_complete', 'pcm_start'])
})

test('rapid Atmos release requests serialize rather than overlap', async () => {
  const calls = []
  let unblock
  const gate = new Promise(resolve => { unblock = resolve })
  const first = beginAtmosOutputRelease(async () => {
    calls.push('stop_one_start')
    await gate
    calls.push('stop_one_end')
  })
  const second = beginAtmosOutputRelease(async () => calls.push('stop_two'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['stop_one_start'])
  unblock()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['stop_one_start', 'stop_one_end', 'stop_two'])
})

test('same Tidal track after Atmos changes engine instead of pausing native session', () => {
  const sameSource = true
  assert.equal(shouldToggleNormalStream({ id: 42, atmosNative: true }, sameSource), false)
  assert.equal(shouldToggleNormalStream({ id: 42, atmosNative: false }, sameSource), true)
  assert.equal(shouldToggleNormalStream({ id: 42, atmosNative: false }, false), false)
})
