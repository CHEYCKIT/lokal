import assert from 'node:assert/strict'
import { effectiveReplayGainMode, normalizeReplayGainMode, replayGainMultiplier } from '../src/audio/replayGain.mjs'

const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be close to ${expected}`)

assert.equal(normalizeReplayGainMode('track'), 'track')
assert.equal(normalizeReplayGainMode('anything-else'), 'off')
assert.equal(replayGainMultiplier({ trackGainDb: 6.020599913 }, 'off'), 1)
close(replayGainMultiplier({ trackGainDb: 6.020599913 }, 'track'), 2)
close(replayGainMultiplier({ trackGainDb: 6.020599913, albumGainDb: -6.020599913 }, 'album'), 0.5)
close(replayGainMultiplier({ trackGainDb: 6.020599913 }, 'album'), 2)
close(replayGainMultiplier({ trackGainDb: 6.020599913, trackPeak: 0.8 }, 'track'), 0.999 / 0.8)
close(replayGainMultiplier({ albumGainDb: 6.020599913, albumPeak: 0.6, trackPeak: 0.7 }, 'album'), 0.999 / 0.6)
close(replayGainMultiplier({ albumGainDb: 6.020599913, trackPeak: 0.8 }, 'album'), 0.999 / 0.8)
assert.equal(replayGainMultiplier({ trackPeak: 0.6 }, 'track'), 1)
assert.equal(replayGainMultiplier(null, 'track'), 1)

console.log('ReplayGain normalization tests passed')


const albumTracks = [
  { album: 'Album', album_artist: 'Artist', artist: 'Artist', track_num: 1 },
  { album: 'Album', album_artist: 'Artist', artist: 'Artist', track_num: 2 },
]
assert.equal(normalizeReplayGainMode('smart'), 'smart')
assert.equal(effectiveReplayGainMode('smart', albumTracks[0], { queue: albumTracks }), 'album')
assert.equal(effectiveReplayGainMode('smart', albumTracks[0], { playbackContext: { type: 'album', name: 'Album' } }), 'album')
assert.equal(effectiveReplayGainMode('smart', albumTracks[0], { queue: [albumTracks[0], { album: 'Another Album', album_artist: 'Artist' }] }), 'track')
assert.equal(effectiveReplayGainMode('smart', albumTracks[0], { queue: [albumTracks[0]] }), 'track')
