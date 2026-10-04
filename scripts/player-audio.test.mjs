import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAudioEventForTrack } from '../src/playerAudio.js'

test('audio events from the previous track are ignored after a transition', () => {
  assert.equal(isAudioEventForTrack({ dataset: { lokalTrackId: 'first' } }, 'second'), false)
  assert.equal(isAudioEventForTrack({ dataset: { lokalTrackId: 'second' } }, 'second'), true)
})

test('untagged media elements remain compatible with existing playback events', () => {
  assert.equal(isAudioEventForTrack({ dataset: {} }, 'current'), true)
  assert.equal(isAudioEventForTrack(null, 'current'), true)
  assert.equal(isAudioEventForTrack({ dataset: { lokalTrackId: 'old' } }, null), false)
})
