import assert from 'node:assert/strict'
import { normalizeReplayGainMode, replayGainMultiplier } from '../src/audio/replayGain.mjs'

const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be close to ${expected}`)

assert.equal(normalizeReplayGainMode('track'), 'track')
assert.equal(normalizeReplayGainMode('anything-else'), 'off')
assert.equal(replayGainMultiplier({ trackGainDb: 6.020599913 }, 'off'), 1)
close(replayGainMultiplier({ trackGainDb: 6.020599913 }, 'track'), 2)
close(replayGainMultiplier({ trackGainDb: 6.020599913, albumGainDb: -6.020599913 }, 'album'), 0.5)
close(replayGainMultiplier({ trackGainDb: 6.020599913 }, 'album'), 2)
close(replayGainMultiplier({ trackGainDb: 6.020599913, trackPeak: 0.8 }, 'track'), 0.999 / 0.8)
assert.equal(replayGainMultiplier({ trackPeak: 0.6 }, 'track'), 1)
assert.equal(replayGainMultiplier(null, 'track'), 1)

console.log('ReplayGain normalization tests passed')
