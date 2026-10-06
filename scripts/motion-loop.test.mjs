import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { loopFadeFor } = require('../electron/artwork/motion.js')

const SIZE = 32 * 32
const frame = value => Buffer.alloc(SIZE, value)

test('a clip whose end leads into its start loops with a cut', () => {
  // Slow motion throughout, and the last frame is close to the first.
  assert.equal(loopFadeFor(frame(100), Buffer.concat([frame(103), frame(104)])), 0)
})

test('a clip that ends somewhere else is crossfaded into its start', () => {
  assert.equal(loopFadeFor(frame(30), Buffer.concat([frame(200), frame(201)])), 0.6)
})

test('a jump no bigger than its ordinary motion is left alone', () => {
  // Fast motion (40 levels a frame): a 45-level jump back to the start is normal.
  assert.equal(loopFadeFor(frame(40), Buffer.concat([frame(45), frame(85)])), 0)
})

test('frames that could not be read: no crossfade', () => {
  assert.equal(loopFadeFor(null, null), 0)
  assert.equal(loopFadeFor(frame(1), frame(2)), 0)
})
