import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VOLUME_WHEEL_STEP, wheelVolume } from '../src/volumeWheel.js'

test('wheel volume increases on scroll up and decreases on scroll down', () => {
  assert.equal(wheelVolume(0.5, -1), 0.55)
  assert.equal(wheelVolume(0.5, 1), 0.45)
})

test('wheel volume clamps to the supported range', () => {
  assert.equal(wheelVolume(1, -1), 1)
  assert.equal(wheelVolume(0, 1), 0)
  assert.equal(VOLUME_WHEEL_STEP, 0.05)
})
