import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAudioEventForTrack, replaceAudioSource } from '../src/playerAudio.js'

test('replacing an audio source clears the old resource before loading the next one', () => {
  const calls = []
  const element = {
    currentTime: 3,
    pause: () => calls.push('pause'),
    removeAttribute: name => calls.push(`remove:${name}`),
    load: () => calls.push('load'),
    src: '',
  }
  replaceAudioSource(element, 'next-source')
  assert.deepEqual(calls, ['pause', 'remove:src', 'load', 'load'])
  assert.equal(element.src, 'next-source')
  assert.equal(element.currentTime, 0)
})

test('audio events from the previous track are ignored after a transition', () => {
  assert.equal(isAudioEventForTrack({ dataset: { lokalTrackId: 'first' } }, 'second'), false)
  assert.equal(isAudioEventForTrack({ dataset: { lokalTrackId: 'second' } }, 'second'), true)
  assert.equal(isAudioEventForTrack({ dataset: { lokalTrackId: 'first', lokalTrackPending: 'second' } }, 'second'), false)
})

test('untagged media elements remain compatible with existing playback events', () => {
  assert.equal(isAudioEventForTrack({ dataset: {} }, 'current'), true)
  assert.equal(isAudioEventForTrack(null, 'current'), true)
  assert.equal(isAudioEventForTrack({ dataset: { lokalTrackId: 'old' } }, null), false)
})
