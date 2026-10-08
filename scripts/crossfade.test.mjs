import assert from 'node:assert/strict'
import test from 'node:test'
import { CROSSFADE_DEFAULTS, crossfadeDurations, fadeCurve, readCrossfadeSettings } from '../src/audio/crossfade.js'

const increasing = values => values.every((v, i) => i === 0 || v >= values[i - 1])

test('settings fall back to pear-desktop style defaults', () => {
  assert.deepEqual(readCrossfadeSettings({}), CROSSFADE_DEFAULTS)
  assert.deepEqual(readCrossfadeSettings({ crossfade_seconds: '8', crossfade_fade_in: '2.5', crossfade_fade_out: '6', crossfade_curve: 'linear' }),
    { beforeEnd: 8, fadeIn: 2.5, fadeOut: 6, curve: 'linear' })
  assert.deepEqual(readCrossfadeSettings({ crossfade_seconds: 'x', crossfade_fade_in: '-1', crossfade_curve: 'cubic' }), CROSSFADE_DEFAULTS)
})

test('fade-in and fade-out curves hit their endpoints and move one way', () => {
  for (const curve of ['logarithmic', 'linear']) {
    const up = Array.from(fadeCurve(0, 1, curve))
    const down = Array.from(fadeCurve(1, 0, curve))
    assert.equal(up[0], 0)
    assert.equal(up.at(-1), 1)
    assert.equal(down[0], 1)
    assert.equal(down.at(-1), 0)
    assert.ok(increasing(up), curve)
    assert.ok(increasing(down.reverse()), curve)
  }
})

test('the logarithmic fade-out is linear in dB, unlike a linear gain ramp', () => {
  const log = fadeCurve(1, 0, 'logarithmic', 5)
  const lin = fadeCurve(1, 0, 'linear', 5)
  // Halfway through, the log curve is 30 dB down (of a 60 dB range); linear is only 6 dB down.
  assert.ok(Math.abs(20 * Math.log10(log[2]) + 30) < 0.01)
  assert.ok(Math.abs(lin[2] - 0.5) < 1e-6)
  assert.ok(Math.abs(20 * Math.log10(log[1]) + 15) < 0.01)
})

test('the old song never fades for longer than it has left', () => {
  assert.deepEqual(crossfadeDurations({ fadeIn: 1.5, fadeOut: 5 }, 10), { fadeIn: 1.5, fadeOut: 5 })
  assert.deepEqual(crossfadeDurations({ fadeIn: 1.5, fadeOut: 5 }, 3), { fadeIn: 1.5, fadeOut: 3 })
  assert.deepEqual(crossfadeDurations({ fadeIn: 0, fadeOut: 5 }, NaN), { fadeIn: 0.05, fadeOut: 5 })
})
